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

    const { agentId, agentNumber, toNumber, prospectNumber, leadId } = JSON.parse(event.body || "{}");
    const to = agentNumber || toNumber; // backward-compat
    if (!agentId || !to) {
      return {
        statusCode: 400,
        headers: cors(),
        body: JSON.stringify({ error: "Missing agentId and/or agentNumber" })
      };
    }

    // Env sanity
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Supabase env vars not set" }) };
    }
    if (!process.env.TELNYX_API_KEY || !process.env.TELNYX_CONNECTION_ID || !process.env.TELNYX_FROM_NUMBER) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "Telnyx env vars not set" }) };
    }

    // Re-check agent online on the server (authoritative)
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    const { data: agent, error: eAgent } = await supabase
      .from("agents")
      .select("id, is_active")
      .eq("id", agentId)
      .maybeSingle();
    if (eAgent) throw eAgent;
    if (!agent?.is_active) {
      return { statusCode: 409, headers: cors(), body: JSON.stringify({ ok: false, reason: "AGENT_INACTIVE" }) };
    }

    const { data: avail, error: eAvail } = await supabase
      .from("agent_availability")
      .select("available")
      .eq("agent_id", agentId)
      .maybeSingle();
    if (eAvail) throw eAvail;
    if (!avail?.available) {
      return { statusCode: 409, headers: cors(), body: JSON.stringify({ ok: false, reason: "AGENT_OFFLINE" }) };
    }

    // Build Telnyx payload; pass prospect + lead info via client_state (base64 JSON)
    const clientState = Buffer.from(JSON.stringify({ prospectNumber, leadId })).toString("base64");
    const payload = {
      connection_id: process.env.TELNYX_CONNECTION_ID,
      to,                                   // dial the agent first
      from: process.env.TELNYX_FROM_NUMBER, // your owned DID
      client_state: clientState
    };

    const res = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text(); // keep raw text for readable Telnyx errors
    return { statusCode: res.status, headers: cors(), body: text };

  } catch (error) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: error.message }) };
  }
}
