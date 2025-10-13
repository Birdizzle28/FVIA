// netlify/functions/telnyx_webhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";
const headers = {
  "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json"
};

// Your preferred voice
const VOICE = "Telnyx.KokoroTTS.af";

// Call Control helper
const act = async (id, action, body = {}) => {
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  if (!r.ok) console.error("Telnyx action failed", { id, action, status: r.status, txt });
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

    if (!callId) return { statusCode: 200, body: "OK" };

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Look up each leg separately
    const [{ data: sessAgent }, { data: sessClient }] = await Promise.all([
      supabase.from("call_sessions").select("*").eq("telnyx_call_id", callId).maybeSingle(),
      supabase.from("call_sessions").select("*").eq("client_call_id", callId).maybeSingle()
    ]);

    const isAgentLeg  = !!sessAgent;
    const isClientLeg = !!sessClient;

    // ========== ANSWERED ==========
    if (eventType === "call.answered") {
      // Client leg answered → just bridge, no TTS for client
      if (isClientLeg) {
        await supabase.from("call_sessions")
          .update({ client_answered_at: new Date().toISOString() })
          .eq("id", sessClient.id);

        await act(sessClient.telnyx_call_id, "transfer_call", { to: callId });
        return { statusCode: 200, body: "OK" };
      }

      // Agent leg answered → whisper + gather
      if (isAgentLeg) {
        await supabase.from("call_sessions")
          .update({ agent_answered_at: new Date().toISOString() })
          .eq("id", sessAgent.id);

        let name = "Prospect";
        let summary = "";
        if (sessAgent.lead_id) {
          const { data: lead } = await supabase
            .from("leads")
            .select("first_name, last_name, product_type, contact_id, zip, contacts:contact_id(first_name, last_name)")
            .eq("id", sessAgent.lead_id)
            .maybeSingle();

          const lf = lead?.first_name || lead?.contacts?.first_name || "";
          const ll = lead?.last_name  || lead?.contacts?.last_name  || "";
          name = `${lf} ${ll}`.trim() || name;
          if (lead?.product_type) summary += `Product: ${lead.product_type}. `;
          if (lead?.zip)         summary += `ZIP ${lead.zip}. `;
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

      // Unknown leg; ignore
      return { statusCode: 200, body: "OK" };
    }

    // ========== DTMF / GATHER (agent only) ==========
    if ((eventType === "call.dtmf.received" || eventType === "call.gather.ended") && isAgentLeg) {
      const p = payload?.data?.payload || {};
      const digit = eventType === "call.dtmf.received" ? p.digit : (p.digits || "")[0];

      if (digit === "1" && sessAgent.prospect_number) {
        // Dial client leg
        const r = await fetch(`${TAPI}/calls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            connection_id: process.env.TELNYX_CONNECTION_ID,
            to: sessAgent.prospect_number,
            from: process.env.TELNYX_FROM_NUMBER
          })
        });
        const txt = await r.text();
        let newCallJson; try { newCallJson = JSON.parse(txt); } catch { newCallJson = { raw: txt }; }

        if (!r.ok) {
          await act(sessAgent.telnyx_call_id, "speak", {
            voice: VOICE, language: "en-US",
            payload: "Unable to reach the client."
          });
          return { statusCode: r.status, body: txt };
        }

        const clientCallId = newCallJson?.data?.id;

        await supabase.from("call_sessions")
          .update({ client_call_id: clientCallId, client_started_at: new Date().toISOString() })
          .eq("id", sessAgent.id);

        // Optional: let agent know we’re dialing (agent hears it, client does not)
        await act(sessAgent.telnyx_call_id, "speak", {
          voice: VOICE, language: "en-US",
          payload: "Dialing the client now."
        });

        return { statusCode: 200, body: "OK" };
      }

      if (digit && digit !== "1") {
        await act(sessAgent.telnyx_call_id, "speak", {
          voice: VOICE, language: "en-US",
          payload: "Got it. Canceling."
        });
        await act(sessAgent.telnyx_call_id, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }

      // No digit: reprompt agent
      await act(sessAgent.telnyx_call_id, "gather_using_speak", {
        voice: VOICE, language: "en-US",
        minimum_digits: 1, maximum_digits: 1,
        inter_digit_timeout_ms: 4000, valid_digits: "1",
        payload: "Sorry, I didn’t catch that. Press 1 to connect now."
      });
      return { statusCode: 200, body: "OK" };
    }

    // ========== HANGUP ==========
    if (eventType === "call.hangup" && (isAgentLeg || isClientLeg)) {
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
