// netlify/functions/monthly-top-producers.js
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";
import sharp from "sharp";

export default async (req) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }
    if (!SITE_URL) {
      return json(500, { error: "Missing SITE_URL env var (ex: https://fv-ia.com)" });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // --- Time window: previous month in America/Chicago ---
    const ZONE = "America/Chicago";
    const nowChi = DateTime.now().setZone(ZONE);

    const startPrev = nowChi.minus({ months: 1 }).startOf("month");
    const endPrev = nowChi.minus({ months: 1 }).endOf("month");

    // Convert to UTC ISO strings for querying timestamptz in Postgres
    const startUtcISO = startPrev.toUTC().toISO();
    const endUtcISO = endPrev.toUTC().toISO();

    // --- Pull policies issued in previous month ---
    // Only policies with issued_at set, and premium_annual present, and agent_id present.
    // If you want only "issued/in_force" etc, add .in('status', [...])
    const { data: policies, error: polErr } = await sb
      .from("policies")
      .select("agent_id, premium_annual, issued_at")
      .not("issued_at", "is", null)
      .not("agent_id", "is", null)
      .not("premium_annual", "is", null)
      .gte("issued_at", startUtcISO)
      .lte("issued_at", endUtcISO);

    if (polErr) throw polErr;

    // --- Aggregate AP by agent ---
    const apByAgent = new Map(); // agent_id -> number
    let totalMonthAp = 0;

    for (const p of policies || []) {
      const agentId = p.agent_id;
      const ap = Number(p.premium_annual || 0);
      if (!agentId || !Number.isFinite(ap) || ap <= 0) continue;

      totalMonthAp += ap;
      apByAgent.set(agentId, (apByAgent.get(agentId) || 0) + ap);
    }

    // If nobody produced, we still publish an announcement (optional).
    const entries = Array.from(apByAgent.entries())
      .map(([agent_id, ap]) => ({ agent_id, ap }))
      .sort((a, b) => b.ap - a.ap)
      .slice(0, 10);

    // --- Get agent names ---
    const agentIds = entries.map((x) => x.agent_id);
    let nameById = new Map();

    if (agentIds.length) {
      const { data: agents, error: aErr } = await sb
        .from("agents")
        .select("id, full_name, first_name, last_name")
        .in("id", agentIds);

      if (aErr) throw aErr;

      for (const a of agents || []) {
        const full = (a.full_name || `${a.first_name || ""} ${a.last_name || ""}`.trim() || a.id).trim();
        nameById.set(a.id, full);
      }
    }

    const monthLabel = startPrev.toFormat("LLLL yyyy"); // "March 2026"
    const title = `🏆 Top Producers — ${monthLabel}`;
    const totalText = formatMoney0(totalMonthAp);

    // Build leaderboard lines
    const lines = entries.length
      ? entries.map((x, i) => {
          const nm = nameById.get(x.agent_id) || "Unknown Agent";
          return `${i + 1}. ${nm} — ${formatMoney0(x.ap)} AP`;
        })
      : ["No issued policies last month."];

    // --- Generate image on top of background ---
    // Background from your site repo (static file)
    const bgUrl = `${SITE_URL}/Pics/monthly-leaderboard-bg.jpg`;

    const bgRes = await fetch(bgUrl);
    if (!bgRes.ok) {
      const t = await bgRes.text().catch(() => "");
      return json(500, { error: `Failed to fetch background image: ${bgUrl}`, detail: t.slice(0, 300) });
    }
    const bgBuffer = Buffer.from(await bgRes.arrayBuffer());

    // We’ll use the background’s dimensions automatically
    const bgMeta = await sharp(bgBuffer).metadata();
    const W = bgMeta.width || 1080;
    const H = bgMeta.height || 1080;

    const svg = buildMonthlySvg({
      width: W,
      height: H,
      monthLabel,
      totalText,
      lines,
    });

    const finalPng = await sharp(bgBuffer)
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    // --- Upload image to Supabase Storage ---
    // Bucket: announcements (same bucket you used for manual announcements)
    // Path: monthly/YYYY-MM.png
    const monthKey = startPrev.toFormat("yyyy-LL");
    const storagePath = `monthly/${monthKey}.png`;

    const { error: upErr } = await sb.storage
      .from("announcements")
      .upload(storagePath, finalPng, {
        contentType: "image/png",
        upsert: true,
        cacheControl: "3600",
      });

    if (upErr) throw upErr;

    const { data: pub } = sb.storage.from("announcements").getPublicUrl(storagePath);
    const image_url = pub?.publicUrl || null;

    // --- Insert announcement row ---
    const body =
      `**${title}**\n` +
      `**Monthly AP (Team):** ${totalText}\n\n` +
      lines.join("\n");

    const payload = {
      title,
      body,
      created_by: null,
      audience: { scope: "all" },
      publish_at: null, // publish now
      expires_at: null,
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

    // --- Trigger push notification (your existing function) ---
    // Non-fatal if it fails
    try {
      await fetch(`${SITE_URL}/.netlify/functions/send-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "announcement", announcement_id: created.id }),
      });
    } catch (_) {}

    return json(200, {
      ok: true,
      month: monthLabel,
      total_month_ap: totalMonthAp,
      top_count: entries.length,
      announcement_id: created.id,
      image_url,
    });
  } catch (e) {
    console.error("monthly-top-producers error:", e);
    return json(500, { error: e?.message || "Server error" });
  }
};

function json(statusCode, obj) {
  return new Response(JSON.stringify(obj), {
    status: statusCode,
    headers: { "Content-Type": "application/json" },
  });
}

function formatMoney0(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function escapeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildMonthlySvg({ width, height, monthLabel, totalText, lines }) {
  // Placement tuned for your background: big empty space in center.
  const pad = Math.round(width * 0.07);
  const panelW = Math.round(width * 0.86);
  const panelH = Math.round(height * 0.62);
  const panelX = Math.round((width - panelW) / 2);
  const panelY = Math.round(height * 0.22);

  const titleY = panelY + Math.round(panelH * 0.16);
  const totalY = panelY + Math.round(panelH * 0.26);
  const listStartY = panelY + Math.round(panelH * 0.36);
  const lineGap = Math.round(panelH * 0.055);

  const titleSize = Math.round(width * 0.055);
  const totalSize = Math.round(width * 0.042);
  const lineSize = Math.round(width * 0.036);

  const safeLines = (lines || []).slice(0, 10);

  const listText = safeLines
    .map((t, idx) => {
      const y = listStartY + idx * lineGap;
      return `<text x="${panelX + pad}" y="${y}" class="line">${escapeXml(t)}</text>`;
    })
    .join("");

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.45"/>
    </filter>

    <linearGradient id="panelGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(20,20,28,0.70)"/>
      <stop offset="100%" stop-color="rgba(20,20,28,0.52)"/>
    </linearGradient>

    <style>
      .title {
        font-family: "Bellota Text", "Trebuchet MS", Arial, sans-serif;
        font-size: ${titleSize}px;
        font-weight: 700;
        fill: #ffffff;
        letter-spacing: 0.5px;
      }
      .sub {
        font-family: "Bellota Text", "Trebuchet MS", Arial, sans-serif;
        font-size: ${totalSize}px;
        font-weight: 700;
        fill: #ffd7e6;
      }
      .line {
        font-family: "Bellota Text", "Trebuchet MS", Arial, sans-serif;
        font-size: ${lineSize}px;
        font-weight: 700;
        fill: #ffffff;
      }
      .muted {
        font-family: "Bellota Text", "Trebuchet MS", Arial, sans-serif;
        font-size: ${Math.round(lineSize * 0.9)}px;
        font-weight: 600;
        fill: rgba(255,255,255,0.85);
      }
    </style>
  </defs>

  <!-- Readability panel -->
  <g filter="url(#shadow)">
    <rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="${Math.round(width * 0.03)}" fill="url(#panelGrad)" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>
  </g>

  <!-- Header -->
  <text x="${panelX + pad}" y="${titleY}" class="title">Top 10 Producers — ${escapeXml(monthLabel)}</text>
  <text x="${panelX + pad}" y="${totalY}" class="sub">Family Values Group Monthly AP: ${escapeXml(totalText)}</text>

  <!-- Divider -->
  <rect x="${panelX + pad}" y="${panelY + Math.round(panelH * 0.30)}" width="${panelW - pad * 2}" height="2" fill="rgba(255,255,255,0.18)"/>

  <!-- List -->
  ${listText}

  <!-- Footer note -->
  <text x="${panelX + pad}" y="${panelY + panelH - Math.round(panelH * 0.06)}" class="muted">
    Based on policies with issued dates in America/Chicago time.
  </text>
</svg>
`.trim();
}
