import { createClient } from "@supabase/supabase-js";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const RLP_UUIDS = [
  "1153ef63-bfb1-4d94-ad21-9c4031e5fd77",
  "56ef28c7-3c39-4045-beb3-dfb8e67a1eb3",
];

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: "Missing env vars" }) };
    }

    const state = String(event.queryStringParameters?.state || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(state)) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Missing/invalid state" }) };
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // 1) load the RLP NPNs from agents table
    const { data: rlpAgents, error: rlpErr } = await supabase
      .from("agents")
      .select("id, agent_id")
      .in("id", RLP_UUIDS);

    if (rlpErr) throw new Error(rlpErr.message);

    const rlpNpns = (rlpAgents || [])
      .map((a) => String(a?.agent_id || "").trim())
      .filter(Boolean);

    if (!rlpNpns.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lines: [] }) };
    }

    // 2) load active licenses for those NPNs in this state
    const { data: rows, error } = await supabase
      .from("agent_nipr_licenses")
      .select("agent_id, active, loa_names")
      .eq("state", state)
      .in("agent_id", rlpNpns);

    if (error) throw new Error(error.message);

    // 3) convert LOAs -> normalized agency lines
    const allowed = new Set();

    for (const r of (rows || [])) {
      if (r?.active !== true) continue;
      const loaArr = Array.isArray(r?.loa_names) ? r.loa_names : [];

      for (const loa of loaArr) {
        const n = String(loa || "").toLowerCase();
        if (n.includes("life")) allowed.add("life");
        if (n.includes("accident") || n.includes("health") || n.includes("sickness")) allowed.add("health");
        if (n.includes("property")) allowed.add("property");
        if (n.includes("casualty")) allowed.add("casualty");
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lines: Array.from(allowed) }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" }) };
  }
};
