// netlify/functions/makeCall.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
    }

    const { agentId, agentNumber, prospectNumber, leadId } = JSON.parse(event.body || "{}");
    if (!agentId || !agentNumber || !prospectNumber) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing agentId/agentNumber/prospectNumber" }) };
    }

    // Env checks
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_FROM_NUMBER } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Supabase env vars not set" }) };
    }
    if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID || !TELNYX_FROM_NUMBER) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Telnyx env vars not set" }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Re-check: agent must be active AND online
    const { data: agent, error: eAgent } = await supabase
      .from("agents")
      .select("id, is_active")
      .eq("id", agentId)
      .maybeSingle();
    if (eAgent) throw eAgent;
    if (!agent?.is_active) {
      return { statusCode: 409, headers: cors(), body: JSON.stringify({ ok:false, reason:"AGENT_INACTIVE" }) };
    }

    const { data: avail, error: eAvail } = await supabase
      .from("agent_availability")
      .select("available")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (eAvail) throw eAvail;
    if (!avail?.available) {
      return { statusCode: 409, headers: cors(), body: JSON.stringify({ ok:false, reason:"AGENT_OFFLINE" }) };
    }

    // Start agent leg
    const telnyxRes = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        connection_id: TELNYX_CONNECTION_ID,
        to: agentNumber,
        from: TELNYX_FROM_NUMBER
        // Your Call Control App must point to telnyx_webhook.js below
      })
    });
    const telnyxJson = await telnyxRes.json();
    if (!telnyxRes.ok) {
      return { statusCode: telnyxRes.status, headers: cors(), body: JSON.stringify(telnyxJson) };
    }

    const telnyx_call_id = telnyxJson?.data?.id;

    // Store session so webhook can find prospect + lead
    await supabase.from("call_sessions").insert({
      telnyx_call_id,
      agent_id: agentId,
      lead_id: leadId || null,
      prospect_number: prospectNumber
    });

    return { statusCode: 200, headers: cors(), body: JSON.stringify({ ok:true, telnyx_call_id }) };

  } catch (error) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: error.message }) };
  }
}
