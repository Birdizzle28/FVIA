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

function normState(s) {
  return String(s || "").trim().toUpperCase();
}

function normStr(s) {
  return String(s || "").trim().toLowerCase();
}

// Map any LOA string -> Set of canonical lines
function canonicalLinesFromLoaNames(loaNames) {
  const lines = new Set();
  const arr = Array.isArray(loaNames) ? loaNames : [];

  for (const raw of arr) {
    const n = normStr(raw);

    // life
    if (n.includes("life")) lines.add("life");

    // health
    if (
      n.includes("health") ||
      n.includes("accident") ||
      n.includes("sickness") ||
      n.includes("accident & health") ||
      n.includes("accident and health")
    ) {
      lines.add("health");
    }

    // property
    if (n.includes("property")) lines.add("property");

    // casualty
    if (n.includes("casualty")) lines.add("casualty");
  }

  return lines;
}

function prettyLine(line) {
  switch (line) {
    case "life": return "Life";
    case "health": return "Health";
    case "property": return "Property";
    case "casualty": return "Casualty";
    default: return line;
  }
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

    // 1) Fetch RLP NPNs
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

    // 2) Build agency allowed bounds from RLP active licenses:
    // allowed[state] = Set(canonicalLine)
    const { data: rlpLicRows, error: rlpLicErr } = await supabase
      .from("agent_nipr_licenses")
      .select("agent_id, state, active, loa_names")
      .in("agent_id", rlpNpns)
      .eq("active", true)
      .limit(5000);

    if (rlpLicErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: rlpLicErr.message }) };
    }

    const allowed = new Map(); // state -> Set(line)
    for (const r of (rlpLicRows || [])) {
      const st = normState(r?.state);
      if (!st) continue;

      const lines = canonicalLinesFromLoaNames(r?.loa_names);
      if (lines.size === 0) continue;

      if (!allowed.has(st)) allowed.set(st, new Set());
      const set = allowed.get(st);
      for (const line of lines) set.add(line);
    }

    if (allowed.size === 0) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, licenses: [] }) };
    }

    // 3) Fetch target agent active licenses
    const { data: agentLicRows, error: agentLicErr } = await supabase
      .from("agent_nipr_licenses")
      .select("state, active, loa_names, created_at")
      .eq("agent_id", agent_id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(2000);

    if (agentLicErr) {
      return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: agentLicErr.message }) };
    }

    // 4) Filter to agency bounds + return grouped
    const outMap = new Map(); // state -> Set(prettyLine)
    for (const r of (agentLicRows || [])) {
      const st = normState(r?.state);
      if (!st) continue;

      const allowedLines = allowed.get(st);
      if (!allowedLines || allowedLines.size === 0) continue;

      const agentLines = canonicalLinesFromLoaNames(r?.loa_names);
      const kept = Array.from(agentLines).filter((l) => allowedLines.has(l));
      if (!kept.length) continue;

      if (!outMap.has(st)) outMap.set(st, new Set());
      const set = outMap.get(st);
      for (const l of kept) set.add(prettyLine(l));
    }

    const out = Array.from(outMap.entries())
      .map(([state, loaSet]) => ({ state, loas: Array.from(loaSet).sort() }))
      .sort((a, b) => a.state.localeCompare(b.state));

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, licenses: out }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" }) };
  }
};
