// netlify/functions/telnyxWebhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";
const headers = {
  Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json",
};

const VOICE = "Telnyx.KokoroTTS.af";

// ------- utils -------
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

const act = async (id, action, body = {}) => {
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!r.ok) {
    console.error("Telnyx action failed", { id, action, status: r.status, txt });
  } else {
    console.log("Telnyx action ok", { id, action, json: json ?? txt });
  }
  return { ok: r.ok, status: r.status, json: json ?? txt };
};

// Voicemail helper (records on THIS leg)
async function startVoicemailOn(callId) {
  await act(callId, "speak", {
    voice: VOICE, language: "en-US",
    payload: "Please leave a message after the tone."
  });
  await act(callId, "record_start", {
    format: "mp3",
    channels: "single",
    play_beep: true,
    max_duration_secs: 120,
    terminate_silence_secs: 6
  });
}

// ------- handler -------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const payload = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const p = payload?.data?.payload || {};
    const callId = p?.call_control_id;

    const fromNum = toE164(p.from);
    const toNum   = toE164(p.to);
    const businessNum = toE164(process.env.TELNYX_BUSINESS_NUMBER);

    console.log("TELNYX EVENT", { eventType, callId, fromNum, toNum });

    if (!callId) return { statusCode: 200, body: "OK" };

    // Supabase (service key)
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Identify context
    // If this callId matches an agent leg, there will be a call_sessions row with telnyx_call_id = callId
    // If it's the client/prospect leg, it will match client_call_id = callId
    let { data: sessionAgent } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("telnyx_call_id", callId)
      .maybeSingle();

    let { data: sessionClient } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("client_call_id", callId)
      .maybeSingle();

    const isAgentLeg  = !!sessionAgent;
    const isClientLeg = !!sessionClient;

    // Inbound admin call = no session found AND the called number is our business DID
    const isInboundAdmin = !isAgentLeg && !isClientLeg && !!businessNum && toNum === businessNum;

    // ----- Recording saved → store voicemail -----
    if (eventType === "call.recording.saved") {
      const rec = payload?.data?.payload;
      const url = rec?.recording_urls?.[0]?.url || rec?.recording_url;
      const call_id = rec?.call_control_id;

      await supabase.from("voicemails").insert({
        call_id,
        from_number: toE164(rec?.from),
        to_number: toE164(rec?.to),
        recording_url: url
      });

      return { statusCode: 200, body: "OK" };
    }

    // =============================
    // 1) CLIENT LEG ANSWERED → bridge (website lead flow)
    // =============================
    if (eventType === "call.answered" && isClientLeg) {
      // We have the client/prospect leg answered. Transfer the agent leg to this client leg.
      if (sessionClient?.telnyx_call_id) {
        const r = await act(sessionClient.telnyx_call_id, "transfer_call", { to: callId });
        if (!r.ok) console.error("Bridge failed", { status: r.status, json: r.json });
      }
      return { statusCode: 200, body: "OK" };
    }

    // =============================
    // 2) AGENT LEG ANSWERED → whisper & gather '1' to call prospect (website lead flow)
    // =============================
    if (eventType === "call.answered" && isAgentLeg) {
      let name = "Prospect";
      let summary = "";

      if (sessionAgent?.lead_id) {
        const { data: lead } = await supabase
          .from("leads")
          .select(
            "first_name,last_name,product_type,contact_id,zip,contacts:contact_id(first_name,last_name)"
          )
          .eq("id", sessionAgent.lead_id)
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
        payload: `New lead. ${name}. ${summary} Press 1 to connect now.`
      });

      return { statusCode: 200, body: "OK" };
    }

    // =============================
    // 3) INBOUND ADMIN CALL ANSWERED → whisper & gather '1' to connect (administrative flow)
    // =============================
    if (eventType === "call.answered" && isInboundAdmin) {
      await act(callId, "gather_using_speak", {
        voice: VOICE,
        language: "en-US",
        minimum_digits: 1,
        maximum_digits: 1,
        valid_digits: "1",
        inter_digit_timeout_ms: 6000,
        payload: "Administrative call. Press 1 to connect."
      });
      return { statusCode: 200, body: "OK" };
    }

    // =============================
    // 4) DTMF/GATHER ENDED → branch per context
    // =============================
    if (eventType === "call.dtmf.received" || eventType === "call.gather.ended") {
      const pay = payload?.data?.payload || {};
      const digit = eventType === "call.dtmf.received" ? pay.digit : (pay.digits || "")[0];
      console.log("DTMF/GATHER", { eventType, digit, isAgentLeg, isInboundAdmin });

      // (a) Website lead: Agent pressed key on agent leg
      if (isAgentLeg) {
        if (digit === "1" && sessionAgent.prospect_number) {
          // Place the client leg
          const make = await fetch(`${TAPI}/calls`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              connection_id: process.env.TELNYX_CONNECTION_ID,
              to: sessionAgent.prospect_number,
              from: process.env.TELNYX_FROM_NUMBER,
            }),
          });
          const j = await make.json();
          console.log("CLIENT LEG CREATE RESP", { status: make.status, json: j });

          if (!make.ok) {
            await act(callId, "speak", {
              voice: VOICE, language: "en-US",
              payload: "Unable to reach the client."
            });
            return { statusCode: make.status, body: JSON.stringify(j) };
          }

          const clientCallId = j?.data?.id;
          const upd = await supabase
            .from("call_sessions")
            .update({ client_call_id: clientCallId })
            .eq("id", sessionAgent.id)
            .select("id, client_call_id")
            .maybeSingle();

          console.log("CLIENT LEG STORED", { updated: upd.data, error: upd.error });

          await act(callId, "speak", {
            voice: VOICE, language: "en-US",
            payload: "Dialing the client now."
          });

          // We bridge when the client answers (handled earlier).
          return { statusCode: 200, body: JSON.stringify({ ok: true }) };
        }

        // any other key → cancel
        await act(callId, "speak", {
          voice: VOICE, language: "en-US",
          payload: "Got it. Canceling."
        });
        await act(callId, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }

      // (b) Inbound admin call: pressed key on the inbound leg
      if (isInboundAdmin) {
        if (digit === "1") {
          // “Connect” here just means keep the call live (no transfer target).
          await act(callId, "speak", {
            voice: VOICE, language: "en-US",
            payload: "Connecting."
          });
          // Nothing else to do — you’re already on the call.
          return { statusCode: 200, body: "OK" };
        }
        // No 1 → drop to voicemail
        await startVoicemailOn(callId);
        return { statusCode: 200, body: "OK" };
      }
    }

    // =============================
    // 5) Hangup cleanup
    // =============================
    if (eventType === "call.hangup") {
      console.log("HANGUP", { callId, isInboundAdmin, isAgentLeg, isClientLeg });
      // Optional: if desired, you can detect inbound admin hangups with no DTMF and start VM earlier,
      // but once the caller hung up there's nobody left to record.
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
