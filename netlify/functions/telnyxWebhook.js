// netlify/functions/telnyx_webhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";

const headers = {
  "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json"
};

// Call Control actions
const act = (id, action, body = {}) =>
  fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const payload = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const callId    = payload?.data?.payload?.id; // the agent-leg call id

    if (!callId) return { statusCode: 200, body: "OK" };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Find the session created when we placed the agent leg
    const { data: session } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("telnyx_call_id", callId)
      .maybeSingle();

    // 1) Agent answered: whisper + gather
    if (eventType === "call.answered" && session) {
      // Load lead + contact for whisper details (best effort)
      let name = "Prospect";
      let summary = "";

      if (session.lead_id) {
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

      // Whisper message (then gather)
      await act(callId, "speak", {
        language: "en-US",
        voice: "female",
        payload: `New lead. ${name || "Prospect"}. ${summary}Press 1 to connect to the client.`
      });

      await act(callId, "gather_using_speak", {
        minimum_digits: 1,
        maximum_digits: 1,
        inter_digit_timeout_ms: 4000,
        language: "en-US",
        voice: "female",
        payload: "Press 1 to connect now, or any other key to cancel."
      });

      return { statusCode: 200, body: "OK" };
    }

    // 2) Agent pressed a key (DTMF)
    if (eventType === "call.dtmf.received" && session) {
      const digit = payload?.data?.payload?.digit;

      if (digit === "1" && session.prospect_number) {
        // Place prospect leg
        const newCallRes = await fetch(`${TAPI}/calls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            connection_id: process.env.TELNYX_CONNECTION_ID,
            to: session.prospect_number,
            from: process.env.TELNYX_FROM_NUMBER
          })
        });
        const newCallJson = await newCallRes.json();

        if (!newCallRes.ok) {
          await act(callId, "speak", { payload: "Unable to reach the client." });
          return { statusCode: newCallRes.status, body: JSON.stringify(newCallJson) };
        }

        const clientCallId = newCallJson?.data?.id;

        // Bridge: transfer agent leg to the client leg
        await act(callId, "transfer_call", { to: clientCallId });

        // (Optional) You could update a status column if you add one
        // await supabase.from("call_sessions").update({ bridged_at: new Date().toISOString() }).eq("id", session.id);

        return { statusCode: 200, body: "OK" };
      }

      // Any key other than 1 → hang up
      await act(callId, "hangup", {});
      return { statusCode: 200, body: "OK" };
    }

    // 3) Clean up on hangup (optional)
    if (eventType === "call.hangup" && session) {
      // (Optional) mark ended, or delete the row—your call
      // await supabase.from("call_sessions").delete().eq("id", session.id);
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
