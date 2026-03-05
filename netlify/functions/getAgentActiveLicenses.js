import { createClient } from "@supabase/supabase-js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

function toTitle(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: "Missing env vars" }) };
    }

    const agent_id = String(event.queryStringParameters?.agent_id || "").trim(); // NPN (text)
    if (!agent_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Missing agent_id" }) };
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data, error } = await supabase
      .from("agent_nipr_licenses")
      .select("state, active, loa_names, created_at")
      .eq("agent_id", agent_id)
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: error.message }) };
    }

    const rows = Array.isArray(data) ? data : [];
    const activeRows = rows.filter((r) => r?.active === true);

    // Group by state, combine LOAs
    const map = new Map(); // state -> Set(loa)
    for (const r of activeRows) {
      const st = String(r.state || "").trim().toUpperCase();
      if (!st) continue;
      if (!map.has(st)) map.set(st, new Set());
      const set = map.get(st);

      const loaArr = Array.isArray(r.loa_names) ? r.loa_names : [];
      for (const loa of loaArr) {
        const clean = toTitle(loa);
        if (clean) set.add(clean);
      }
    }

    const out = Array.from(map.entries())
      .map(([state, loaSet]) => ({ state, loas: Array.from(loaSet).sort() }))
      .sort((a, b) => a.state.localeCompare(b.state));

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, licenses: out }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" }) };
  }
};
