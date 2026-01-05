// netlify/functions/makeCall.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function safeJsonParse(str) {
  try { return JSON.parse(str || "{}"); } catch { return {}; }
}

function verifyCallToken(secret, token) {
  if (!secret) return { ok: false, error: "CALL_TOKEN_SECRET missing on server" };
  if (!token || typeof token !== "string" || !token.includes(".")) return { ok: false, error: "Missing/invalid callToken" };

  const [payloadB64, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  if (expected !== sig) return { ok: false, error: "Bad token signature" };

  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")); }
  catch { return { ok: false, error: "Bad token payload" }; }

  if (!payload?.exp || Date.now() > Number(payload.exp)) return { ok: false, error: "Token expired" };
  if (!payload?.leadId || !payload?.agentId) return { ok: false, error: "Token missing leadId/agentId" };

  return { ok: true, payload };
}

function toE164(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
    }

    const body = safeJsonParse(event.body);
    const { agentId, leadId, callToken } = body;

    if (!agentId || !leadId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing agentId/leadId" }) };
    }

    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      TELNYX_API_KEY,
      TELNYX_CONNECTION_ID,
      TELNYX_FROM_NUMBER,
      CALL_TOKEN_SECRET
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Supabase env vars not set" }) };
    }
    if (!TELNYX_API_KEY || !TELNYX_CONNECTION_ID || !TELNYX_FROM_NUMBER) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Telnyx env vars not set" }) };
    }

    // ✅ Verify token
    const v = verifyCallToken(CALL_TOKEN_SECRET || "", callToken);
    if (!v.ok) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ ok: false, error: v.error }) };
    }
    if (String(v.payload.agentId) !== String(agentId) || String(v.payload.leadId) !== String(leadId)) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Token mismatch" }) };
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Re-check agent in Supabase (active + available + phone)
    const { data: agent, error: eAgent } = await supabase
      .from("agents")
      .select("id, is_active, is_available, phone")
      .eq("id", agentId)
      .maybeSingle();
    if (eAgent) throw eAgent;

    if (!agent?.is_active) {
      return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ ok: false, reason: "AGENT_INACTIVE" }) };
    }
    if (!agent?.is_available) {
      return { statusCode: 409, headers: corsHeaders, body: JSON.stringify({ ok: false, reason: "AGENT_OFFLINE" }) };
    }

    // Load lead & confirm assignment
    const { data: lead, error: eLead } = await supabase
      .from("leads")
      .select("id, assigned_to, phone, contact_id")
      .eq("id", leadId)
      .maybeSingle();
    if (eLead) throw eLead;

    if (!lead) {
      return { statusCode: 404, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Lead not found" }) };
    }
    if (String(lead.assigned_to) !== String(agentId)) {
      return { statusCode: 403, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Lead not assigned to this agent" }) };
    }

    // Prospect number: lead.phone first; fallback to contact phones
    let prospect = Array.isArray(lead.phone) ? lead.phone[0] : null;

    if (!prospect && lead.contact_id) {
      const { data: contact, error: eC } = await supabase
        .from("contacts")
        .select("phones")
        .eq("id", lead.contact_id)
        .maybeSingle();
      if (!eC && contact?.phones?.length) prospect = contact.phones[0];
    }

    const agentNumber = toE164(Array.isArray(agent.phone) ? agent.phone[0] : agent.phone);
    const prospectNumber = toE164(prospect);

    if (!agentNumber || !prospectNumber) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing agent/prospect phone in DB" }) };
    }

    // Create the agent leg with Telnyx
    const createPayload = {
      connection_id: TELNYX_CONNECTION_ID,
      to: agentNumber,
      from: TELNYX_FROM_NUMBER
    };

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
    try { telnyxJson = JSON.parse(telnyxText); }
    catch { telnyxJson = { raw: telnyxText }; }

    if (!telnyxRes.ok) {
      return { statusCode: telnyxRes.status, headers: corsHeaders, body: JSON.stringify(telnyxJson) };
    }

    const telnyx_call_id = telnyxJson?.data?.id || telnyxJson?.data?.call_control_id;
    if (!telnyx_call_id) {
      return { statusCode: 502, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "No Telnyx call id", telnyxJson }) };
    }

    // Insert session
    const { data: inserted, error: iErr } = await supabase
      .from("call_sessions")
      .insert({
        telnyx_call_id,
        agent_id: agentId,
        lead_id: leadId,
        prospect_number: prospectNumber
      })
      .select("id, telnyx_call_id, prospect_number")
      .single();

    if (iErr) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "DB insert failed", details: iErr.message }) };
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, telnyx_call_id, session_id: inserted.id })
    };
  } catch (error) {
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: error?.message || "Unknown error" }) };
  }
}
