// netlify/functions/telnyx_webhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";
const headers = {
  "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json"
};

// Keep the voice you liked
const VOICE = "Telnyx.KokoroTTS.af";

// Call Control action helper with logging
const act = async (id, action, body = {}) => {
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  const ok = r.ok;
  const status = r.status;
  if (!ok) {
    console.error("TELNYX ACTION FAIL", { id, action, status, body, txt });
  } else {
    console.log("TELNYX ACTION OK", { id, action, status, body, txt });
  }
  return { ok, status, body: txt };
};

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const payload   = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const callId    = payload?.data?.payload?.call_control_id;

    console.log("TELNYX EVENT", { eventType, callId, raw: payload?.data?.payload });

    if (!callId) return { statusCode: 200, body: "OK" };

    // Supabase SR client
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Try to find an agent session (we stored telnyx_call_id when we dialed the AGENT)
    const { data: agentSession, error: sessionErr } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("telnyx_call_id", callId)
      .maybeSingle();

    if (sessionErr) console.error("SUPABASE sessionErr", sessionErr);

    // Also check if THIS call is the CLIENT leg we created later
    let sessClient = null;
    if (eventType === "call.answered") {
      const { data: sc, error: scErr } = await supabase
        .from("call_sessions")
        .select("*")
        .eq("client_call_id", callId)
        .maybeSingle();
      if (scErr) console.error("SUPABASE client-leg lookup error", scErr);
      sessClient = sc || null;
    }

    console.log("LEG CHECK", {
      isAgentLeg: !!agentSession,
      isClientLeg: !!sessClient
    });

    // If THIS is the CLIENT leg answering, bridge the agent to it (safety net / idempotent)
    if (eventType === "call.answered" && sessClient) {
      console.log("CLIENT LEG ANSWERED — bridging agent → client", {
        agent_leg: sessClient.telnyx_call_id,
        client_leg: callId
      });
      await act(sessClient.telnyx_call_id, "transfer_call", { to: callId });
      return { statusCode: 200, body: "OK" };
    }

    // Agent leg answered → whisper + gather
    if (eventType === "call.answered" && agentSession) {
      let name = "Prospect";
      let summary = "";

      if (agentSession.lead_id) {
        const { data: lead } = await supabase
          .from("leads")
          .select("first_name, last_name, product_type, contact_id, zip, contacts:contact_id(first_name, last_name)")
          .eq("id", agentSession.lead_id)
          .maybeSingle();

        const lf = lead?.first_name || lead?.contacts?.first_name || "";
        const ll = lead?.last_name  || lead?.contacts?.last_name  || "";
        name = `${lf} ${ll}`.trim() || name;
        if (lead?.product_type) summary += `Product: ${lead.product_type}. `;
        if (lead?.zip)         summary += `ZIP ${lead.zip}. `;
      }

      await act(callId, "speak", {
        voice: VOICE,
        language: "en-US",
        payload: `New lead. ${name}. ${summary}Press 1 to connect to the client.`
      });

      await act(callId, "gather_using_speak", {
        voice: VOICE,
        language: "en-US",
        minimum_digits: 1,
        maximum_digits: 1,
        inter_digit_timeout_ms: 4000,
        valid_digits: "1",
        payload: "Press 1 to connect now, or any other key to cancel."
      });

      return { statusCode: 200, body: "OK" };
    }

    // DTMF / gather result on agent leg
    if ((eventType === "call.dtmf.received" || eventType === "call.gather.ended") && agentSession) {
      const p = payload?.data?.payload || {};
      const digit = eventType === "call.dtmf.received" ? p.digit : (p.digits || "")[0];
      console.log("DTMF/GATHER", { eventType, digit, p });

      if (digit === "1" && agentSession.prospect_number) {
        // Create CLIENT leg
        const r = await fetch(`${TAPI}/calls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            connection_id: process.env.TELNYX_CONNECTION_ID, // must be same CC app as webhook!
            to: agentSession.prospect_number,
            from: process.env.TELNYX_FROM_NUMBER
          })
        });
        const newCallJson = await r.json();
        console.log("CREATE CLIENT LEG", { status: r.status, newCallJson });

        if (!r.ok) {
          await act(callId, "speak", {
            voice: VOICE,
            language: "en-US",
            payload: "Unable to reach the client."
          });
          return { statusCode: r.status, body: JSON.stringify(newCallJson) };
        }

        const clientCallId = newCallJson?.data?.id;

        // Save client leg id
        await supabase
          .from("call_sessions")
          .update({ client_call_id: clientCallId })
          .eq("id", agentSession.id);

        // **IMMEDIATE TRANSFER** (queues bridge; Telnyx will connect when client answers)
        console.log("IMMEDIATE TRANSFER attempt", { agent_leg: callId, client_leg: clientCallId });
        await act(callId, "transfer_call", { to: clientCallId });

        await act(callId, "speak", {
          voice: VOICE,
          language: "en-US",
          payload: "Dialing the client now."
        });

        return { statusCode: 200, body: JSON.stringify({ ok: true, clientCallId }) };
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

      // No/unknown digit → reprompt once
      await act(callId, "gather_using_speak", {
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

    // Optional cleanup
    if (eventType === "call.hangup" && agentSession) {
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
