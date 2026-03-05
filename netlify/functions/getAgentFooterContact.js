import { createClient } from "@supabase/supabase-js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: "Missing env vars" }) };
    }

    const agent_uuid = String(event.queryStringParameters?.agent_uuid || "").trim();
    if (!agent_uuid) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Missing agent_uuid" }) };
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from("agents")
      .select("phone, email")
      .eq("id", agent_uuid)
      .maybeSingle();

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        phone: data?.phone || null,
        email: data?.email || null,
      }),
    };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" }) };
  }
};
