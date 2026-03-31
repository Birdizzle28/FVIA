// netlify/functions/monthly-top-producers.js
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

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

    // delete expired announcements first
    const nowIso = DateTime.now().toUTC().toISO();
    const { error: delErr } = await sb
      .from("announcements")
      .delete()
      .lte("expires_at", nowIso);

    if (delErr) {
      console.error("Expired announcement delete error:", delErr);
    }

    // --- Time window: previous month in America/Chicago ---
    const ZONE = "America/Chicago";
    const nowChi = DateTime.now().setZone(ZONE);

    const startPrev = nowChi.minus({ months: 1 }).startOf("month");
    const endPrev = nowChi.minus({ months: 1 }).endOf("month");

    // Convert to UTC ISO strings for querying timestamptz in Postgres
    const startUtcISO = startPrev.toUTC().toISO();
    const endUtcISO = endPrev.toUTC().toISO();

    // --- Pull policies issued in previous month ---
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
    const apByAgent = new Map();
    let totalMonthAp = 0;

    for (const p of policies || []) {
      const agentId = p.agent_id;
      const ap = Number(p.premium_annual || 0);
      if (!agentId || !Number.isFinite(ap) || ap <= 0) continue;

      totalMonthAp += ap;
      apByAgent.set(agentId, (apByAgent.get(agentId) || 0) + ap);
    }

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

    const monthLabel = startPrev.toFormat("LLLL yyyy");
    const title = `🏆 Top Producers — ${monthLabel}`;
    const totalText = formatMoney0(totalMonthAp);

    const lines = entries.length
      ? entries.map((x, i) => {
          const nm = nameById.get(x.agent_id) || "Unknown Agent";
          return `${i + 1}. ${nm} — ${formatMoney0(x.ap)} AP`;
        })
      : ["No issued policies last month."];

    // --- Generate image using PDFKit instead of SVG/Sharp ---
    const bgPath = path.join(process.cwd(), "Pics", "monthly-leaderboard-bg.jpg");
    const fontPath = path.join(process.cwd(), "assets", "fonts", "BellotaText-Bold.ttf");

    if (!fs.existsSync(bgPath)) {
      return json(500, { error: `Missing background image: ${bgPath}` });
    }

    if (!fs.existsSync(fontPath)) {
      return json(500, { error: `Missing font file: ${fontPath}` });
    }

    const doc = new PDFDocument({
      size: [1080, 1080],
      margin: 0,
      info: {
        Title: title,
        Author: "Family Values Group",
      },
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.registerFont("BellotaBold", fontPath);

    doc.image(bgPath, 0, 0, { width: 1080, height: 1080 });

    const W = 1080;
    const H = 1080;

    const panelX = 76;
    const panelY = 238;
    const panelW = 928;
    const panelH = 670;
    const pad = 54;

    const titleY = panelY + 72;
    const totalY = panelY + 132;
    const dividerY = panelY + 186;
    const listStartY = panelY + 252;
    const rowH = 52;

    const darkPurple = "#3d3a78";
    const darkPurple2 = "#353468";
    const white = "#ffffff";
    const pink = "#ffd7e6";
    const muted = "#e8e1ff";

    // readability panel
    doc
      .save()
      .roundedRect(panelX, panelY, panelW, panelH, 32)
      .fillOpacity(0.78)
      .fill("#1b1938")
      .restore();

    doc
      .save()
      .roundedRect(panelX, panelY, panelW, panelH, 32)
      .lineWidth(2)
      .strokeOpacity(0.18)
      .stroke("#ffffff")
      .restore();

    // header
    doc
      .font("BellotaBold")
      .fontSize(54)
      .fillColor(white)
      .text(`Top 10 Producers — ${monthLabel}`, panelX + pad, titleY, {
        width: panelW - pad * 2,
        align: "left",
      });

    doc
      .font("BellotaBold")
      .fontSize(38)
      .fillColor(pink)
      .text(`Family Values Group Monthly AP: ${totalText}`, panelX + pad, totalY, {
        width: panelW - pad * 2,
        align: "left",
      });

    doc
      .save()
      .rect(panelX + pad, dividerY, panelW - pad * 2, 2)
      .fillOpacity(0.18)
      .fill("#ffffff")
      .restore();

    // list
    if (lines.length) {
      lines.forEach((line, idx) => {
        const y = listStartY + idx * rowH;

        doc
          .save()
          .roundedRect(panelX + pad - 18, y - 30, panelW - pad * 2 + 36, 42, 14)
          .fillOpacity(idx % 2 === 0 ? 0.92 : 0.86)
          .fill(idx % 2 === 0 ? darkPurple : darkPurple2)
          .restore();

        doc
          .font("BellotaBold")
          .fontSize(32)
          .fillColor(white)
          .text(line, panelX + pad, y - 10, {
            width: panelW - pad * 2,
            align: "left",
            lineBreak: false,
          });
      });
    }

    // footer note
    doc
      .font("BellotaBold")
      .fontSize(26)
      .fillColor(muted)
      .text("Based on policies with issued dates in America/Chicago time.", panelX + pad, panelY + panelH - 56, {
        width: panelW - pad * 2,
        align: "left",
        lineBreak: false,
      });

    doc.end();

    const pdfBuffer = await new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const storagePath = `monthly/${startPrev.toFormat("yyyy-LL")}.pdf`;

    const { error: upErr } = await sb.storage
      .from("announcements")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
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

    const publishAt = DateTime.now().toUTC();
    const expiresAt = publishAt.plus({ days: 27 });

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

    // --- Trigger push notification ---
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
