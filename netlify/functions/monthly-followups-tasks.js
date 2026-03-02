import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

const TZ = "America/Chicago";
const STATUSES = ["renewed", "reinstated", "issued", "in_force"];
const MIN_DAYS_OLD = 89;

// Storage bucket name for the CSV files
// Create this bucket in Supabase Storage: "followups"
// Make it PUBLIC (or keep private + use signed URLs; public is easiest for now)
const FOLLOWUPS_BUCKET = "followups";

function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function pickPrimary(arr) {
  if (!arr) return "";
  if (Array.isArray(arr)) return arr[0] || "";
  return String(arr || "");
}

function buildCsvRows(groupedContacts) {
  const headers = [
    "Agent Name",
    "Contact Name",
    "Phone",
    "Email",
    "Address",
    "City",
    "State",
    "Zip",
    "Policy Count",
    "Most Recent Issued Date",
    "Statuses",
    "Carriers",
    "Policy Numbers",
    "Product Lines",
    "Annual Premium Total"
  ];

  const lines = [headers.join(",")];

  for (const c of groupedContacts) {
    const line = [
      csvEscape(c.agent_name),
      csvEscape(c.contact_name),
      csvEscape(c.phone),
      csvEscape(c.email),
      csvEscape(c.address_line1),
      csvEscape(c.city),
      csvEscape(c.state),
      csvEscape(c.zip),
      csvEscape(c.policy_count),
      csvEscape(c.latest_issued_at_local),
      csvEscape(c.statuses.join(" | ")),
      csvEscape(c.carriers.join(" | ")),
      csvEscape(c.policy_numbers.join(" | ")),
      csvEscape(c.product_lines.join(" | ")),
      csvEscape(c.premium_annual_total)
    ].join(",");
    lines.push(line);
  }

  return lines.join("\n");
}

async function uploadCsv(sb, { path, csvText }) {
  // Upload/overwrite
  const { error: upErr } = await sb.storage
    .from(FOLLOWUPS_BUCKET)
    .upload(path, Buffer.from(csvText, "utf8"), {
      contentType: "text/csv",
      upsert: true,
      cacheControl: "3600"
    });

  if (upErr) throw upErr;

  // Public URL
  const { data } = sb.storage.from(FOLLOWUPS_BUCKET).getPublicUrl(path);
  return data?.publicUrl || null;
}

async function taskExistsForMonth(sb, { agentId, monthKey }) {
  // monthKey example: "2026-03"
  const { data, error } = await sb
    .from("tasks")
    .select("id")
    .eq("assigned_to", agentId)
    .contains("metadata", { type: "monthly_followups", month: monthKey })
    .limit(1);

  if (error) throw error;
  return !!(data && data.length);
}

export async function handler() {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        body: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
      };
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    // "Now" in CST/CDT correctly
    const nowChicago = DateTime.now().setZone(TZ);

    // This run’s "monthKey" so we don’t duplicate tasks if function reruns
    const monthKey = nowChicago.toFormat("yyyy-LL"); // e.g. "2026-03"
    const monthLabel = nowChicago.toFormat("LLLL yyyy"); // e.g. "March 2026"

    // cutoff: issued_at must be <= now - 89 days
    const cutoffUtcIso = nowChicago.minus({ days: MIN_DAYS_OLD }).toUTC().toISO();

    // scheduled_at: 8:00 AM local for this month’s 2nd day (the run day)
    const scheduledLocal = nowChicago.set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
    const scheduled_at = scheduledLocal.toUTC().toISO();
    const due_at = scheduled_at; // you can change this later (ex: +2 days)

    // 1) Load active agents
    const { data: agents, error: agentsErr } = await sb
      .from("agents")
      .select("id, full_name, is_active")
      .eq("is_active", true)
      .order("full_name", { ascending: true });

    if (agentsErr) throw agentsErr;

    if (!agents || !agents.length) {
      return { statusCode: 200, body: "No active agents found." };
    }

    let createdCount = 0;
    let skippedCount = 0;
    let pushCount = 0;

    // 2) For each agent, build followup list → CSV → task
    for (const agent of agents) {
      const agentId = agent.id;
      const agentName = agent.full_name || agent.id;

      // Prevent duplicates for this month (if Netlify retries)
      const exists = await taskExistsForMonth(sb, { agentId, monthKey });
      if (exists) {
        skippedCount++;
        continue;
      }

      // Pull qualifying policies for this agent
      // (issued_at not null, status in list, issued_at <= cutoff)
      const { data: policies, error: polErr } = await sb
        .from("policies")
        .select(`
          id,
          contact_id,
          agent_id,
          issued_at,
          status,
          carrier_name,
          policy_number,
          product_line,
          premium_annual,
          contacts:contact_id(
            id,
            full_name,
            first_name,
            last_name,
            phones,
            emails,
            address_line1,
            address_line2,
            city,
            state,
            zip
          )
        `)
        .eq("agent_id", agentId)
        .in("status", STATUSES)
        .not("issued_at", "is", null)
        .lte("issued_at", cutoffUtcIso)
        .limit(5000);

      if (polErr) throw polErr;

      // Group by contact
      const map = new Map();

      for (const p of policies || []) {
        const c = p.contacts || {};
        const contactId = p.contact_id;

        if (!contactId) continue;

        const contactName =
          c.full_name ||
          `${c.first_name || ""} ${c.last_name || ""}`.trim() ||
          "Unknown";

        const phone = pickPrimary(c.phones);
        const email = pickPrimary(c.emails);

        const issuedUtc = p.issued_at ? DateTime.fromISO(p.issued_at, { zone: "utc" }) : null;
        const issuedLocal = issuedUtc ? issuedUtc.setZone(TZ) : null;

        if (!map.has(contactId)) {
          map.set(contactId, {
            agent_name: agentName,
            contact_id: contactId,
            contact_name: contactName,
            phone,
            email,
            address_line1: [c.address_line1, c.address_line2].filter(Boolean).join(" ").trim(),
            city: c.city || "",
            state: c.state || "",
            zip: c.zip || "",
            policy_count: 0,
            latest_issued_at: issuedLocal ? issuedLocal.toMillis() : 0,
            latest_issued_at_local: issuedLocal ? issuedLocal.toFormat("LLL dd, yyyy") : "",
            statuses: new Set(),
            carriers: new Set(),
            policy_numbers: new Set(),
            product_lines: new Set(),
            premium_annual_total: 0
          });
        }

        const row = map.get(contactId);
        row.policy_count += 1;
        row.statuses.add(p.status || "");
        row.carriers.add(p.carrier_name || "");
        row.policy_numbers.add(p.policy_number || "");
        row.product_lines.add(p.product_line || "");

        const prem = Number(p.premium_annual || 0);
        if (Number.isFinite(prem)) row.premium_annual_total += prem;

        if (issuedLocal && issuedLocal.toMillis() > row.latest_issued_at) {
          row.latest_issued_at = issuedLocal.toMillis();
          row.latest_issued_at_local = issuedLocal.toFormat("LLL dd, yyyy");
        }
      }

      // Convert map → array & sort by premium_total desc
      const groupedContacts = Array.from(map.values())
        .map(r => ({
          ...r,
          statuses: Array.from(r.statuses).filter(Boolean),
          carriers: Array.from(r.carriers).filter(Boolean),
          policy_numbers: Array.from(r.policy_numbers).filter(Boolean),
          product_lines: Array.from(r.product_lines).filter(Boolean),
          premium_annual_total: Math.round((r.premium_annual_total + Number.EPSILON) * 100) / 100
        }))
        .sort((a, b) => b.premium_annual_total - a.premium_annual_total);

      // Build CSV (even if empty)
      const csvText = buildCsvRows(groupedContacts);

      // Upload CSV for this agent for this month
      const path = `monthly/${monthKey}/${agentId}-followups.csv`;
      const csvUrl = await uploadCsv(sb, { path, csvText });

      // Create Task
      const meta = {
        type: "monthly_followups",
        month: monthKey,
        source: "scheduled_function",
        cutoff_days: MIN_DAYS_OLD,
        cutoff_issued_at_lte_utc: cutoffUtcIso,
        link_url: csvUrl,
        total_contacts: groupedContacts.length,
        total_policies: (policies || []).length
      };

      const title = `Follow Ups (${monthLabel})`;

      const { data: taskRow, error: taskErr } = await sb
        .from("tasks")
        .insert({
          assigned_to: agentId,
          title,
          channel: "phone",
          scheduled_at,
          due_at,
          status: "open",
          metadata: meta
        })
        .select("id")
        .maybeSingle();

      if (taskErr) throw taskErr;

      createdCount++;

      // Push notif for each task (non-fatal if it fails)
      try {
        const res = await fetch(`${process.env.URL || ""}/.netlify/functions/send-push`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "task", task_id: taskRow.id })
        });
        if (res.ok) pushCount++;
      } catch (_) {}
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        monthKey,
        createdCount,
        skippedCount,
        pushCount
      })
    };
  } catch (e) {
    console.error("monthly-followups-tasks error:", e);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e?.message || String(e) })
    };
  }
}
