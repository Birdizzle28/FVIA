import { createClient } from "@supabase/supabase-js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

// ✅ RLP UUIDs (agents.id)
const RLP_AGENT_UUIDS = [
  "1153ef63-bfb1-4d94-ad21-9c4031e5fd77",
  "56ef28c7-3c39-4045-beb3-dfb8e67a1eb3",
];

function toTitle(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(^|\s)\S/g, (m) => m.toUpperCase());
}

function normLoa(s) {
  return toTitle(String(s || "").trim());
}

function normState(s) {
  return String(s || "").trim().toUpperCase();
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: "Missing env vars" }) };
    }

    // target agent NPN (text)
    const agent_id = String(event.queryStringParameters?.agent_id || "").trim();
    if (!agent_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Missing agent_id" }) };
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // ------------------------------------------------------------
    // 1) Fetch RLP NPNs from agents table using UUIDs
    // ------------------------------------------------------------
    const { data: rlpAgents, error: rlpErr } = await supabase
      .from("agents")
      .select("id, agent_id")
      .in("id", RLP_AGENT_UUIDS);

    if (rlpErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: rlpErr.message }) };
    }

    const rlpNpns = (rlpAgents || [])
      .map((a) => String(a?.agent_id || "").trim())
      .filter(Boolean);

    if (rlpNpns.length === 0) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ ok: false, error: "RLP agents missing agent_id (NPN) in agents table" }),
      };
    }

    // ------------------------------------------------------------
    // 2) Build allowed map from RLP active licenses:
    //    allowed[state] = Set(loaName)
    // ------------------------------------------------------------
    const { data: rlpLicRows, error: rlpLicErr } = await supabase
      .from("agent_nipr_licenses")
      .select("agent_id, state, active, loa_names")
      .in("agent_id", rlpNpns)
      .eq("active", true)
      .limit(5000);

    if (rlpLicErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: rlpLicErr.message }) };
    }

    const allowed = new Map(); // state -> Set(loa)
    for (const r of (rlpLicRows || [])) {
      const st = normState(r?.state);
      if (!st) continue;

      if (!allowed.has(st)) allowed.set(st, new Set());

      const set = allowed.get(st);
      const loaArr = Array.isArray(r?.loa_names) ? r.loa_names : [];
      for (const loa of loaArr) {
        const clean = normLoa(loa);
        if (clean) set.add(clean);
      }
    }

    // If for some reason allowed is empty, return nothing (safe)
    if (allowed.size === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, licenses: [] }) };
    }

    // ------------------------------------------------------------
    // 3) Fetch target agent licenses
    // ------------------------------------------------------------
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

    // ------------------------------------------------------------
    // 4) Filter to agency bounds (RLP union):
    //    keep only LOAs that are allowed in that state
    // ------------------------------------------------------------
    const map = new Map(); // state -> Set(loa)
    for (const r of activeRows) {
      const st = normState(r?.state);
      if (!st) continue;

      const allowedLoas = allowed.get(st);
      if (!allowedLoas || allowedLoas.size === 0) continue; // state not allowed at all

      const loaArr = Array.isArray(r?.loa_names) ? r.loa_names : [];
      for (const loa of loaArr) {
        const clean = normLoa(loa);
        if (!clean) continue;
        if (!allowedLoas.has(clean)) continue; // LOA not in RLP bounds

        if (!map.has(st)) map.set(st, new Set());
        map.get(st).add(clean);
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
