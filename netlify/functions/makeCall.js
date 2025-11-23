// netlify/functions/makeCall.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
});

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
      return {
        statusCode: 400,
        headers: cors(),
        body: JSON.stringify({ error: "Missing agentId/agentNumber/prospectNumber" })
      };
    }

    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      TELNYX_API_KEY,
      TELNYX_CONNECTION_ID,
      TELNYX_FROM_NUMBER
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ error: "Supabase env vars not set" })
      };
    }
    if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID || !TELNYX_FROM_NUMBER) {
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ error: "Telnyx env vars not set" })
      };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Re-check agent in Supabase (active + available)
    const { data: agent, error: eAgent } = await supabase
      .from("agents")
      .select("id, is_active, is_available")
      .eq("id", agentId)
      .maybeSingle();

    if (eAgent) throw eAgent;

    if (!agent?.is_active) {
      return {
        statusCode: 409,
        headers: cors(),
        body: JSON.stringify({ ok: false, reason: "AGENT_INACTIVE" })
      };
    }

    if (!agent?.is_available) {
      return {
        statusCode: 409,
        headers: cors(),
        body: JSON.stringify({ ok: false, reason: "AGENT_OFFLINE" })
      };
    }

    // Create the agent leg with Telnyx
    const createPayload = {
      connection_id: TELNYX_CONNECTION_ID,
      to: agentNumber,
      from: TELNYX_FROM_NUMBER
    };
    console.log("Telnyx create-call →", createPayload);

    const telnyxRes = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(createPayload)
    });

    const telnyxText = await telnyxRes.text();
    let telnyxJson;
    try {
      telnyxJson = JSON.parse(telnyxText);
    } catch {
      telnyxJson = { raw: telnyxText };
    }

    console.log("Telnyx response", { status: telnyxRes.status, body: telnyxJson });

    if (!telnyxRes.ok) {
      return {
        statusCode: telnyxRes.status,
        headers: cors(),
        body: JSON.stringify(telnyxJson)
      };
    }

    const telnyx_call_id =
      telnyxJson?.data?.id || telnyxJson?.data?.call_control_id;
    if (!telnyx_call_id) {
      return {
        statusCode: 502,
        headers: cors(),
        body: JSON.stringify({
          error: "No Telnyx call id in response",
          telnyxJson
        })
      };
    }

    // Insert session with the agent leg id
    const insertPayload = {
      telnyx_call_id,
      agent_id: agentId,
      lead_id: leadId || null,
      prospect_number: prospectNumber
    };
    console.log("Insert call_sessions →", insertPayload);

    const { data: inserted, error: iErr } = await supabase
      .from("call_sessions")
      .insert(insertPayload)
      .select("id, telnyx_call_id, prospect_number")
      .single();

    if (iErr) {
      console.error("call_sessions insert error", iErr);
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({
          error: "DB insert failed",
          details: iErr.message
        })
      };
    }

    console.log("call_sessions inserted", inserted);

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({
        ok: true,
        telnyx_call_id,
        session_id: inserted.id
      })
    };
  } catch (error) {
    console.error("makeCall fatal", error);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: error.message })
    };
  }
}
