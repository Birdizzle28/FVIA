// netlify/functions/telnyx_webhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";

const headers = {
  "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json"
};

// Log-aware Call Control action helper
const act = async (id, action, body = {}) => {
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const txt = await r.text();
  if (!r.ok) {
    console.error("Telnyx action failed", { action, status: r.status, txt });
  } else {
    console.log("Telnyx action ok", { action, txt });
  }
  return { ok: r.ok, status: r.status, body: txt };
};

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const payload = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const callId    = payload?.data?.payload?.call_control_id;

    console.log("TELNYX EVENT", { eventType, callId });

        // ===== TEMP TEST: force whisper on any answered call =====
    if (eventType === "call.answered" && callId) {
      await act(callId, "speak", { payload: "Test whisper from webhook." });
      // return { statusCode: 200, body: "OK" }; // ← uncomment to isolate just this test
    }
    
    if (!callId) return { statusCode: 200, body: "OK" };

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Session matching for agent leg (we stored telnyx_call_id when creating the agent call)
    const { data: session } = await supabase
      .from("call_sessions")
      .select("*")
      .eq("telnyx_call_id", callId)
      .maybeSingle();

    // ---- Option B: safer bridging ----
    // If THIS answered leg is the CLIENT leg we created earlier, bridge the agent to it.
    if (eventType === "call.answered") {
      const answeredId = callId; // this event's leg
      const { data: sess } = await supabase
        .from("call_sessions").select("*")
        .eq("client_call_id", answeredId)
        .maybeSingle();

      if (sess) {
        await act(sess.telnyx_call_id, "transfer_call", { to: answeredId });
        return { statusCode: 200, body: "OK" };
      }
    }

    // 1) Agent answered → whisper + gather (only when this leg is the AGENT leg we started)
    if (eventType === "call.answered" && session) {
      // Build whisper (best-effort)
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
      const digit =
        eventType === "call.dtmf.received"
          ? payload?.data?.payload?.digit
          : (payload?.data?.payload?.digits || "")[0];

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
          await act(callId, "speak", { payload: "Unable to reach the client." });
          return { statusCode: r.status, body: JSON.stringify(newCallJson) };
        }

        const clientCallId = newCallJson?.data?.id;

        // Store client leg; we'll bridge when THAT leg answers (see call.answered above)
        await supabase
          .from("call_sessions")
          .update({ client_call_id: clientCallId })
          .eq("id", session.id);

        await act(callId, "speak", { payload: "Dialing the client now." });
        return { statusCode: 200, body: "OK" };
      }

      // Any key other than 1 → hang up
      await act(callId, "hangup", {});
      return { statusCode: 200, body: "OK" };
    }

    // 3) Clean up on hangup (optional)
    if (eventType === "call.hangup" && session) {
      // e.g., await supabase.from("call_sessions").delete().eq("id", session.id);
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
