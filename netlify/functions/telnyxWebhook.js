// netlify/functions/telnyxWebhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";
const headers = {
  Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json",
};

const VOICE = "Telnyx.KokoroTTS.af";

// E.164 helper (very forgiving)
const toE164 = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
};

// Call Control with logging + parsed body
const act = async (id, action, body = {}) => {
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* ignore */ }

  if (!r.ok) {
    console.error("Telnyx action failed", { id, action, status: r.status, txt });
  } else {
    console.log("Telnyx action ok", { id, action, json: json ?? txt });
  }
  return { ok: r.ok, status: r.status, json: json ?? txt };
};

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const payload = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const callId = payload?.data?.payload?.call_control_id;
    const p = payload?.data?.payload || {};
    const fromNum = toE164(p.from);
    const toNum = toE164(p.to);

    console.log("TELNYX EVENT", { eventType, callId, fromNum, toNum });

    if (!callId) return { statusCode: 200, body: "OK" };

    // Supabase (service key)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Try to match this leg to the agent session row we created first
    let { data: session } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("telnyx_call_id", callId)
      .maybeSingle();

    // If not agent, maybe it's the client leg row
    if (!session) {
      const { data: asClient } = await supabase
        .from("call_sessions")
        .select("*")
        .eq("client_call_id", callId)
        .maybeSingle();
      session = asClient || null;
    }

    // === When the CLIENT answers, bridge agent -> client ===
    if (eventType === "call.answered") {
      // Fast path: find the row where this callId is the client leg
      let { data: sessClient } = await supabase
        .from("call_sessions")
        .select("*")
        .eq("client_call_id", callId)
        .maybeSingle();

      // Fallback: occasionally the write is late. Try by prospect number from event payload.
      if (!sessClient && toNum) {
        const { data: byProspect } = await supabase
          .from("call_sessions")
          .select("*")
          .eq("prospect_number", toNum)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (byProspect?.client_call_id) {
          sessClient = byProspect;
          console.warn("Fallback matched by prospect_number", {
            toNum,
            callId,
            rowId: byProspect.id,
            client_call_id: byProspect.client_call_id,
          });
        }
      }

      console.log("BRIDGING CHECK", {
        foundByClientId: !!sessClient,
        agent_leg: sessClient?.telnyx_call_id,
        client_leg: callId,
      });

      if (sessClient?.telnyx_call_id) {
        // Bridge now. (Do not include voice/language on transfer_call.)
        const r = await act(sessClient.telnyx_call_id, "transfer_call", { to: callId });
        if (!r.ok) {
          console.error("Bridge failed", { status: r.status, json: r.json });
        }
        return { statusCode: 200, body: "OK" };
      }
      // If we still didn't find it, just ack; the agent path below will handle whisper/gather.
    }

    // === When the AGENT answers, whisper + gather ===
    if (eventType === "call.answered") {
      // Build whisper (best-effort)
      let name = "Prospect";
      let summary = "";

      if (session?.lead_id) {
        const { data: lead } = await supabase
          .from("leads")
          .select(
            "first_name,last_name,product_type,contact_id,zip,contacts:contact_id(first_name,last_name)"
          )
          .eq("id", session.lead_id)
          .maybeSingle();

        const lf = lead?.first_name || lead?.contacts?.first_name || "";
        const ll = lead?.last_name || lead?.contacts?.last_name || "";
        name = `${lf} ${ll}`.trim() || name;
        if (lead?.product_type) summary += `Product: ${lead.product_type}. `;
        if (lead?.zip) summary += `ZIP ${lead.zip}. `;
      }

      await act(callId, "gather_using_speak", {
        voice: VOICE,
        language: "en-US",
        minimum_digits: 1,
        maximum_digits: 1,
        valid_digits: "1",
        inter_digit_timeout_ms: 6000,
        payload: `New lead. ${name}. ${summary} Press 1 to connect now.`,
      });

      return { statusCode: 200, body: "OK" };
    }

    // === Agent pressed a key (place client leg, then wait for client's call.answered to bridge) ===
    if (
      (eventType === "call.dtmf.received" || eventType === "call.gather.ended") &&
      session
    ) {
      const pay = payload?.data?.payload || {};
      const digit =
        eventType === "call.dtmf.received"
          ? pay.digit
          : (pay.digits || "")[0];

      console.log("DTMF/GATHER", { eventType, digit });

      if (digit === "1" && session.prospect_number) {
        // Call prospect now
        const make = await fetch(`${TAPI}/calls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            connection_id: process.env.TELNYX_CONNECTION_ID,
            to: session.prospect_number,
            from: process.env.TELNYX_FROM_NUMBER,
          }),
        });
        const j = await make.json();
        console.log("CLIENT LEG CREATE RESP", { status: make.status, json: j });

        if (!make.ok) {
          await act(callId, "speak", {
            voice: VOICE,
            language: "en-US",
            payload: "Unable to reach the client.",
          });
          return { statusCode: make.status, body: JSON.stringify(j) };
        }

        const clientCallId = j?.data?.id;
        console.log("CLIENT LEG CREATED", { clientCallId });

        const upd = await supabase
          .from("call_sessions")
          .update({ client_call_id: clientCallId })
          .eq("id", session.id)
          .select("id, client_call_id")
          .maybeSingle();

        console.log("CLIENT LEG STORED", { updated: upd.data, error: upd.error });

        await act(callId, "speak", {
          voice: VOICE,
          language: "en-US",
          payload: "Dialing the client now.",
        });

        // We do NOT transfer here. We’ll transfer when the client answers.
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      if (digit !== "1") {
        await act(callId, "speak", {
          voice: VOICE,
          language: "en-US",
          payload: "Got it. Canceling.",
        });
        await act(callId, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }
    }

    // cleanup (optional)
    if (eventType === "call.hangup") {
      console.log("HANGUP", { callId });
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
