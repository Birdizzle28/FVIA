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
// If the CLIENT leg answered, bridge the agent leg to it
if (eventType === "call.answered") {
  const answeredId = payload?.data?.payload?.call_control_id;
  const { data: sess } = await supabase
    .from("call_sessions").select("*")
    .eq("client_call_id", answeredId)
    .maybeSingle();

  if (sess) {
    await act(sess.telnyx_call_id, "transfer_call", { to: answeredId });
    return { statusCode: 200, body: "OK" };
  }
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const payload = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const callId = payload?.data?.payload?.call_control_id;

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

    // 2) Agent responded (handle both gather + raw dtmf)
    if ((eventType === "call.dtmf.received" || eventType === "call.gather.ended") && session) {
      // digit location differs by event type
      const digit =
        eventType === "call.dtmf.received"
          ? payload?.data?.payload?.digit
          : (payload?.data?.payload?.digits || "")[0]; // first digit from gather
    
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
    
        // (Option A) transfer immediately — Telnyx will bridge when the client answers
        await supabase
          .from("call_sessions")
          .update({ client_call_id: clientCallId })
          .eq("id", session.id);
        
        await act(callId, "speak", { payload: "Dialing the client now." });
    
        // (Option B - safer): store clientCallId and wait for client's call.answered, then transfer.
        // Uncomment if you want that pattern instead:
        // await supabase.from("call_sessions").update({ client_call_id: clientCallId }).eq("id", session.id);
    
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
