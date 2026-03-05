import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

function normStr(s) {
  return String(s || "").trim().toLowerCase();
}

function parseLinesFromLoaNames(loaNames) {
  const lines = new Set();
  const arr = Array.isArray(loaNames) ? loaNames : [];

  for (const name of arr) {
    const n = normStr(name);

    if (n.includes("life")) lines.add("life");
    if (
      n.includes("health") ||
      n.includes("accident & health") ||
      n.includes("accident and health") ||
      n.includes("sickness")
    ) lines.add("health");

    if (n.includes("property")) lines.add("property");
    if (n.includes("casualty")) lines.add("casualty");
  }

  return Array.from(lines);
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing Supabase env vars" }),
      };
    }

    const agent_id = String(event.queryStringParameters?.agent_id || "").trim();
    const state = String(event.queryStringParameters?.state || "").trim().toUpperCase();

    if (!agent_id || !state || !/^[A-Z]{2}$/.test(state)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing/invalid agent_id or state" }),
      };
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from("agent_nipr_licenses")
      .select("active, loa_names, created_at")
      .eq("agent_id", agent_id)
      .eq("state", state)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: error.message }),
      };
    }

    const rows = Array.isArray(data) ? data : [];
    const activeRows = rows.filter(r => r?.active === true);
    const rowsToUse = activeRows.length ? activeRows : rows;

    const loaNames = rowsToUse.flatMap(r => Array.isArray(r.loa_names) ? r.loa_names : []);
    const lines = parseLinesFromLoaNames(loaNames);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ok: true, agent_id, state, lines }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" }),
    };
  }
};
