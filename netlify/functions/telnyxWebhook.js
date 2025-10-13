// netlify/functions/telnyx_webhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";
const headers = {
  "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json"
};

// Use the same voice you liked in your test
const VOICE = "Telnyx.KokoroTTS.af";

// Log-aware Call Control action helper
const act = async (id, action, body = {}) => {
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  if (!r.ok) {
    console.error("Telnyx action failed", { id, action, status: r.status, txt });
  } else {
    console.log("Telnyx action ok", { id, action, txt });
  }
  return { ok: r.ok, status: r.status, body: txt };
};

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const payload   = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const callId    = payload?.data?.payload?.call_control_id;

    console.log("TELNYX EVENT", { eventType, callId });
    if (!callId) return { statusCode: 200, body: "OK" };

    // ---- Supabase (service role) ----
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Agent leg session we created first
    let { data: session } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("telnyx_call_id", callId)
      .maybeSingle();
    
    // Fallback: try matching as client_call_id if not found
    if (!session) {
      const { data: fallback } = await supabase
        .from("call_sessions")
        .select("*")
        .eq("client_call_id", callId)
        .maybeSingle();
      session = fallback;
    }
    // Is THIS the client leg answering?
    let sessClient = null;
    if (eventType === "call.answered") {
      const res = await supabase
        .from("call_sessions").select("*")
        .eq("client_call_id", callId)
        .maybeSingle();
      sessClient = res.data || null;
    }

    console.log("LEG CHECK", {
      haveAgentSession: !!session,
      isClientLeg: !!sessClient,
      eventType
    });

    // Client leg answered → bridge now
    if (eventType === "call.answered" && sessClient) {
      await act(sessClient.telnyx_call_id, "transfer_call", { to: callId });
      return { statusCode: 200, body: "OK" };
    }

    // --- If the AGENT leg answered (or session missing), whisper + gather ---
    if (eventType === "call.answered") {
      let name = "Prospect";
      let summary = "";
    
      if (session?.lead_id) {
        const { data: lead } = await supabase
          .from("leads")
          .select("first_name, last_name, product_type, contact_id, zip, contacts:contact_id(first_name, last_name)")
          .eq("id", session.lead_id)
          .maybeSingle();
    
        const lf = lead?.first_name || lead?.contacts?.first_name || "";
        const ll = lead?.last_name  || lead?.contacts?.last_name  || "";
        name = `${lf} ${ll}`.trim() || name;
        if (lead?.product_type) summary += `Product: ${lead.product_type}. `;
        if (lead?.zip)         summary += `ZIP ${lead.zip}. `;
      }
    
      // One action that both whispers and gathers
      await act(callId, "gather_using_speak", {
        voice: "Telnyx.KokoroTTS.af",
        language: "en-US",
        minimum_digits: 1,
        maximum_digits: 1,
        valid_digits: "1",
        inter_digit_timeout_ms: 6000,
        payload: `New lead. ${name}. ${summary} Press 1 to connect now.`
      });
    
      return { statusCode: 200, body: "OK" };
    }

    // DTMF / gather result
    if ((eventType === "call.dtmf.received" || eventType === "call.gather.ended") && session) {
      const dtmfPayload = payload?.data?.payload || {};       // ← added
      const digit = eventType === "call.dtmf.received"
        ? dtmfPayload.digit
        : (dtmfPayload.digits || "")[0];
      console.log("DTMF/GATHER DIGIT", { eventType, digit, raw: dtmfPayload }); // ← added

      if (digit === "1" && session.prospect_number) {
        // Place prospect leg
        const r = await fetch(`${TAPI}/calls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            connection_id: process.env.TELNYX_CONNECTION_ID,
            to: session.prospect_number,
            from: process.env.TELNYX_FROM_NUMBER
          })
        });
        const newCallJson = await r.json();

        if (!r.ok) {
          await act(callId, "speak", {
            voice: VOICE,
            language: "en-US",
            payload: "Unable to reach the client."
          });
        } else {
          const clientCallId = newCallJson?.data?.id;
          await supabase
            .from("call_sessions")
            .update({ client_call_id: clientCallId })
            .eq("id", session.id);

          await act(callId, "speak", {
            voice: VOICE,
            language: "en-US",
            payload: "Dialing the client now."
          });
        }
        return { statusCode: r.status || 200, body: JSON.stringify(newCallJson) };
      }

      if (digit !== "1") {
        await act(callId, "speak", {
          voice: VOICE,
          language: "en-US",
          payload: "Got it. Canceling."
        });
        await act(callId, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }

      // No digit captured → reprompt once
      await act(callId, "gather_using_speak", {               // ← added (reprompt)
        voice: VOICE,
        language: "en-US",
        minimum_digits: 1,
        maximum_digits: 1,
        inter_digit_timeout_ms: 4000,
        valid_digits: "1",
        payload: "Sorry, I didn’t catch that. Press 1 to connect now."
      });
      return { statusCode: 200, body: "OK" };
    }

    if (eventType === "call.hangup" && session) {
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
