import fs from "fs";
import path from "path";
import sharp from "sharp";
import { DateTime } from "luxon";
import { createClient } from "@supabase/supabase-js";

export const config = {
  schedule: "*/10 * * * *", // every 10 minutes; code gates to 10:00 PM Chicago time
};

const TZ = "America/Chicago";
const MAX_TOP = 10;

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function isoDate(dt) {
  return dt.toFormat("yyyy-LL-dd");
}

function safeText(s) {
  return String(s ?? "").replace(/[<>&]/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[m]));
}

// Build a “stylized” SVG overlay (Sharp composites SVG nicely)
function buildOverlaySvg({ width, height, dateLabel, mtdAp, rows }) {
  // layout tuning
  const leftX = 90;
  const topY = 220;

  const headerY = 150;
  const mtdY = 200;

  const listStartY = 280;
  const rowH = 70;

  const title = "Top Producers Tonight";
  const sub = dateLabel;

  // Colors (picked to match your palette vibe)
  const colorTitle = "#2a245c";
  const colorSub = "#6b5e8a";
  const colorWhite = "#ffffff";
  const colorGold = "#f1d58b";
  const colorDark = "#1e1a3d";

  const maxNameLen = 22;

  const listSvg = rows
    .map((r, i) => {
      const y = listStartY + i * rowH;

      const rank = i + 1;
      const name = (r.full_name || "Unknown").slice(0, maxNameLen);
      const ap = money(r.ap);

      // alternating subtle background bars for readability
      const barOpacity = i % 2 === 0 ? 0.16 : 0.10;

      return `
        <g>
          <rect x="${leftX}" y="${y - 40}" rx="14" ry="14" width="${width - leftX * 2}" height="58" fill="${colorWhite}" opacity="${barOpacity}" />
          <text x="${leftX + 22}" y="${y}" font-size="26" font-weight="800" fill="${colorGold}" font-family="Bellota Text, Arial, sans-serif">${rank}.</text>
          <text x="${leftX + 70}" y="${y}" font-size="26" font-weight="700" fill="${colorDark}" font-family="Bellota Text, Arial, sans-serif">${safeText(name)}</text>
          <text x="${width - leftX - 22}" y="${y}" font-size="26" font-weight="900" fill="${colorTitle}" text-anchor="end" font-family="Bellota Text, Arial, sans-serif">${safeText(ap)}</text>
        </g>
      `;
    })
    .join("");

  // If no rows, display a friendly message
  const emptySvg = `
    <g>
      <rect x="${leftX}" y="${listStartY - 40}" rx="16" ry="16" width="${width - leftX * 2}" height="110" fill="${colorWhite}" opacity="0.14" />
      <text x="${width / 2}" y="${listStartY + 20}" font-size="26" font-weight="800" fill="${colorTitle}" text-anchor="middle" font-family="Bellota Text, Arial, sans-serif">
        No issued policies today.
      </text>
      <text x="${width / 2}" y="${listStartY + 55}" font-size="18" font-weight="600" fill="${colorSub}" text-anchor="middle" font-family="Bellota Text, Arial, sans-serif">
        (We’ll post the moment we have AP.)
      </text>
    </g>
  `;

  return `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.25"/>
      </filter>
    </defs>

    <!-- Title -->
    <text x="${width / 2}" y="${headerY}" font-size="44" font-weight="900" fill="${colorTitle}" text-anchor="middle"
          font-family="Bellota Text, Arial, sans-serif" filter="url(#shadow)">${safeText(title)}</text>

    <text x="${width / 2}" y="${headerY + 34}" font-size="20" font-weight="700" fill="${colorSub}" text-anchor="middle"
          font-family="Bellota Text, Arial, sans-serif">${safeText(sub)}</text>

    <!-- MTD AP pill -->
    <g filter="url(#shadow)">
      <rect x="${width / 2 - 260}" y="${mtdY - 34}" rx="18" ry="18" width="520" height="56" fill="#ffffff" opacity="0.18"/>
      <text x="${width / 2}" y="${mtdY}" font-size="22" font-weight="800" fill="${colorWhite}" text-anchor="middle"
            font-family="Bellota Text, Arial, sans-serif">
        Month-to-date AP: ${safeText(money(mtdAp))}
      </text>
    </g>

    <!-- List -->
    ${rows.length ? listSvg : emptySvg}

    <!-- Footer note -->
    <text x="${width / 2}" y="${height - 60}" font-size="16" font-weight="600" fill="${colorSub}" text-anchor="middle"
          font-family="Bellota Text, Arial, sans-serif">
      Based on issued policies (CST/CDT day)
    </text>
  </svg>`;
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  return { ok: res.ok, status: res.status, text: txt, json };
}

export default async function handler() {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SITE_URL = (process.env.SITE_URL || "").replace(/\/+$/, "");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const testAgentId = "1153ef63-bfb1-4d94-ad21-9c4031e5fd77";

    const { data: testAgent, error: testErr } = await sb
      .from("agents")
      .select("id, full_name, first_name, last_name")
      .eq("id", testAgentId)
      .maybeSingle();
    
    console.log("TEST AGENT LOOKUP:", {
      testAgentId,
      testAgent,
      testErr,
    });

    // delete expired announcements first
    const nowIso = DateTime.now().toUTC().toISO();
    const { error: delErr } = await sb
      .from("announcements")
      .delete()
      .lt("expires_at", nowIso);

    if (delErr) {
      console.error("Expired announcement delete error:", delErr);
    }

    // Gate: only run at 10:00 PM Chicago time (allow first 10 minutes window)
    const nowChi = DateTime.now().setZone(TZ);
    const isTargetHour = nowChi.hour === 22;
    const inWindow = nowChi.minute >= 0 && nowChi.minute < 10;

    if (!isTargetHour || !inWindow) {
      return new Response("Not in 10:00 PM Chicago window.", { status: 200 });
    }

    const dayKey = isoDate(nowChi); // yyyy-mm-dd
    const title = `Top Producers — ${dayKey}`;

    // Dedup: if already posted for this day, exit
    const { data: existing, error: exErr } = await sb
      .from("announcements")
      .select("id")
      .eq("title", title)
      .limit(1);

    if (exErr) {
      console.error("Dedup check error:", exErr);
      // keep going (worst case: duplicate)
    } else if (existing && existing.length) {
      return new Response("Already posted today.", { status: 200 });
    }

    // Compute CST/CDT day boundaries
    const startOfDay = nowChi.startOf("day");
    const endOfDay = nowChi.endOf("day");

    const startUtc = startOfDay.toUTC().toISO();
    const endUtc = endOfDay.toUTC().toISO();

    // Month-to-date window
    const startMonth = nowChi.startOf("month").startOf("day");
    const startMonthUtc = startMonth.toUTC().toISO();
    const nowUtc = nowChi.toUTC().toISO();

    // Pull policies for TODAY (issued_at in CST/CDT day)
    // We keep statuses that mean “issued happened”
    const { data: todayPolicies, error: polErr } = await sb
      .from("policies")
      .select("id, agent_id, submitted_at, premium_annual, premium_modal, status")
      .gte("submitted_at", startUtc)
      .lte("submitted_at", endUtc)
      .in("status", ["issued", "in_force", "renewed", "reinstated"]);

    if (polErr) throw polErr;

    // Pull policies for MTD AP
    const { data: mtdPolicies, error: mtdErr } = await sb
      .from("policies")
      .select("id, premium_annual, premium_modal, issued_at, status")
      .gte("issued_at", startMonthUtc)
      .lte("issued_at", nowUtc)
      .in("status", ["issued", "in_force", "renewed", "reinstated"]);

    if (mtdErr) throw mtdErr;

    // Aggregate today by agent
    const apByAgent = new Map();
    for (const p of todayPolicies || []) {
      const agentId = p.agent_id;
      if (!agentId) continue;

      const ap = Number(p.premium_annual ?? (p.premium_modal != null ? Number(p.premium_modal) * 12 : 0)) || 0;
      if (ap <= 0) continue;

      apByAgent.set(agentId, (apByAgent.get(agentId) || 0) + ap);
    }

    // If we have no agents with AP today, we still post (you wanted “only what we have”)
    // Fetch agent names for involved agents (top 10 only after sorting)
    const ranked = Array.from(apByAgent.entries())
      .map(([agent_id, ap]) => ({ agent_id, ap }))
      .sort((a, b) => b.ap - a.ap)
      .slice(0, MAX_TOP);

    const agentIds = ranked.map(r => r.agent_id);

    let agentsById = new Map();
    if (agentIds.length) {
      const { data: agents, error: agErr } = await sb
        .from("agents")
        .select("id, full_name, first_name, last_name")
        .in("id", agentIds);

      if (agErr) throw agErr;

      agentsById = new Map(
        (agents || []).map(a => {
          const name = a.full_name || `${a.first_name || ""} ${a.last_name || ""}`.trim() || "Unknown";
          return [a.id, name];
        })
      );
    }

    const rows = ranked.map(r => ({
      full_name: agentsById.get(r.agent_id) || "Unknown",
      ap: r.ap,
    }));

    // MTD AP sum
    let mtdAp = 0;
    for (const p of mtdPolicies || []) {
      const ap = Number(p.premium_annual ?? (p.premium_modal != null ? Number(p.premium_modal) * 12 : 0)) || 0;
      if (ap > 0) mtdAp += ap;
    }

    // Generate image on your template
    const templatePath = path.join(process.cwd(), "assets", "announcements", "top-producers-template.jpg");
    if (!fs.existsSync(templatePath)) {
      return new Response(`Missing template at ${templatePath}`, { status: 500 });
    }

    const base = sharp(templatePath);
    const meta = await base.metadata();
    const width = meta.width || 1080;
    const height = meta.height || 1350;

    const dateLabel = nowChi.toFormat("cccc, LLL d • h:mm a 'CT'");

    const svg = buildOverlaySvg({ width, height, dateLabel, mtdAp, rows });

    const outBuffer = await base
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 92 })
      .toBuffer();

    // Upload image to Supabase Storage (announcements bucket)
    const fileName = `top-producers/${dayKey}.jpg`;

    const { error: upErr } = await sb.storage
      .from("announcements")
      .upload(fileName, outBuffer, {
        contentType: "image/jpeg",
        upsert: true,
        cacheControl: "3600",
      });

    if (upErr) throw upErr;

    const { data: pub } = sb.storage.from("announcements").getPublicUrl(fileName);
    const image_url = pub?.publicUrl || null;

    // Build announcement body text (push + fallback)
    const lines = rows.length
      ? rows.map((r, i) => `${i + 1}. ${r.full_name} — ${money(r.ap)}`)
      : ["No issued policies today."];

    const body =
      `Month-to-date AP: ${money(mtdAp)}\n\n` +
      `Top Producers (${dayKey}):\n` +
      lines.join("\n");

    // Insert announcement
    const publishAt = DateTime.now().toUTC();
    const expiresAt = publishAt.plus({ hours: 23 });
    
    const payload = {
      title,
      body,
      created_by: null,
      audience: { scope: "all" },
      publish_at: publishAt.toISO(),
      expires_at: expiresAt.toISO(),
      is_active: true,
      image_url,
      link_url: null,
      push_sent: false,
      push_sent_at: null,
    };

    const { data: created, error: insErr } = await sb
      .from("announcements")
      .insert(payload)
      .select("id")
      .single();

    if (insErr) throw insErr;

    // Trigger push notif (uses your existing function)
    if (SITE_URL) {
      const pushUrl = `${SITE_URL}/.netlify/functions/send-push`;
      const pushRes = await fetchJson(pushUrl, { type: "announcement", announcement_id: created.id });
      if (!pushRes.ok) {
        console.warn("Push failed (non-fatal):", pushRes.status, pushRes.text);
      }
    } else {
      console.warn("SITE_URL not set, skipping push trigger.");
    }

    return new Response(`Posted top producers for ${dayKey}`, { status: 200 });
  } catch (e) {
    console.error("cron-top-producers failed:", e);
    return new Response(`Error: ${e?.message || "Unknown error"}`, { status: 500 });
  }
}
