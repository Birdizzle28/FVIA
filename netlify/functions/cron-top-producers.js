import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { DateTime } from "luxon";
import { createClient } from "@supabase/supabase-js";

export const config = {
  schedule: "*/10 * * * *", // every 10 minutes; code gates to 10:00 PM Chicago time
};

const TZ = "America/Chicago";
const MAX_TOP = 10;

function money(n) {
  const v = Number(n || 0);
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function isoDate(dt) {
  return dt.toFormat("yyyy-LL-dd");
}

async function fetchJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const txt = await res.text();
  let json = null;
  try {
    json = JSON.parse(txt);
  } catch {}
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

    // delete expired announcements first
    const nowIso = DateTime.now().toUTC().toISO();
    const { error: delErr } = await sb
      .from("announcements")
      .delete()
      .lte("expires_at", nowIso);

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

    const dayKey = isoDate(nowChi);
    const title = `Top Producers — ${dayKey}`;

    // Dedup: if already posted for this day, exit
    const { data: existing, error: exErr } = await sb
      .from("announcements")
      .select("id")
      .eq("title", title)
      .limit(1);

    if (exErr) {
      console.error("Dedup check error:", exErr);
    } else if (existing && existing.length) {
      return new Response("Already posted today.", { status: 200 });
    }

    // UTC day boundaries for submitted_at leaderboard
    const nowUtcDt = DateTime.now().toUTC();
    const startUtc = nowUtcDt.startOf("day").toISO();
    const endUtc = nowUtcDt.endOf("day").toISO();

    // Month-to-date window still based on Chicago month
    const startMonth = nowChi.startOf("month").startOf("day");
    const startMonthUtc = startMonth.toUTC().toISO();
    const nowUtc = nowChi.toUTC().toISO();

    // Pull policies for TODAY (submitted_at in UTC day)
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
    let dailyAp = 0;

    for (const p of todayPolicies || []) {
      const agentId = p.agent_id;
      if (!agentId) continue;

      const ap = Number(
        p.premium_annual ??
        (p.premium_modal != null ? Number(p.premium_modal) * 12 : 0)
      ) || 0;

      if (ap <= 0) continue;

      dailyAp += ap;
      apByAgent.set(agentId, (apByAgent.get(agentId) || 0) + ap);
    }

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
          const name =
            a.full_name ||
            `${a.first_name || ""} ${a.last_name || ""}`.trim() ||
            "Unknown";
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
      const ap = Number(
        p.premium_annual ??
        (p.premium_modal != null ? Number(p.premium_modal) * 12 : 0)
      ) || 0;

      if (ap > 0) mtdAp += ap;
    }

    const templatePath = path.join(process.cwd(), "assets", "announcements", "top-producers-template.jpg");
    if (!fs.existsSync(templatePath)) {
      return new Response(`Missing template at ${templatePath}`, { status: 500 });
    }

    const fontPath = path.join(process.cwd(), "assets", "fonts", "BellotaText-Bold.ttf");
    if (!fs.existsSync(fontPath)) {
      return new Response(`Missing font at ${fontPath}`, { status: 500 });
    }

    const doc = new PDFDocument({
      size: [1080, 1350],
      margin: 0,
      info: {
        Title: title,
        Author: "Family Values Group",
      },
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.registerFont("BellotaBold", fontPath);

    doc.image(templatePath, 0, 0, { width: 1080, height: 1350 });

    const dateLabel = nowChi.toFormat("cccc, LLL d • h:mm a 'CT'");

    const headerY = 240;
    const subY = 295;
    const mtdBoxY = 345;
    const dailyBoxY = 420;
    const listStartY = 555;

    const colorTitle = "#2a245c";
    const colorSub = "#6b5e8a";
    const colorGold = "#f1d58b";
    const colorDarkPurple = "#3d3a78";
    const colorDarkPurple2 = "#353468";
    const colorWhite = "#ffffff";

    doc
      .font("BellotaBold")
      .fontSize(44)
      .fillColor(colorTitle)
      .text("Top Producers Tonight", 0, headerY, {
        width: 1080,
        align: "center",
      });

    doc
      .font("BellotaBold")
      .fontSize(20)
      .fillColor(colorSub)
      .text(dateLabel, 0, subY, {
        width: 1080,
        align: "center",
      });

    // MTD AP pill
    doc
      .save()
      .roundedRect(260, mtdBoxY, 560, 64, 20)
      .fillOpacity(0.92)
      .fill(colorDarkPurple)
      .restore();

    doc
      .font("BellotaBold")
      .fontSize(22)
      .fillColor(colorWhite)
      .text(`Month-to-date AP: ${money(mtdAp)}`, 0, mtdBoxY + 19, {
        width: 1080,
        align: "center",
      });

    // Daily AP pill
    doc
      .save()
      .roundedRect(260, dailyBoxY, 560, 64, 20)
      .fillOpacity(0.92)
      .fill(colorDarkPurple2)
      .restore();

    doc
      .font("BellotaBold")
      .fontSize(22)
      .fillColor(colorWhite)
      .text(`Total AP Today: ${money(dailyAp)}`, 0, dailyBoxY + 19, {
        width: 1080,
        align: "center",
      });

    const leftX = 90;
    const rowH = 72;
    const maxNameLen = 22;

    if (rows.length) {
      rows.forEach((r, i) => {
        const y = listStartY + i * rowH;
        const name = (r.full_name || "Unknown").slice(0, maxNameLen);

        doc
          .save()
          .roundedRect(leftX, y - 22, 1080 - leftX * 2, 56, 16)
          .fillOpacity(i % 2 === 0 ? 0.92 : 0.86)
          .fill(i % 2 === 0 ? colorDarkPurple : colorDarkPurple2)
          .restore();

        doc
          .font("BellotaBold")
          .fontSize(24)
          .fillColor(colorGold)
          .text(`${i + 1}.`, leftX + 22, y + 2, {
            width: 50,
          });

        doc
          .font("BellotaBold")
          .fontSize(24)
          .fillColor(colorWhite)
          .text(name, leftX + 80, y + 2, {
            width: 600,
          });

        doc
          .font("BellotaBold")
          .fontSize(24)
          .fillColor(colorWhite)
          .text(money(r.ap), 0, y + 2, {
            width: 1080 - leftX - 22,
            align: "right",
          });
      });
    } else {
      doc
        .save()
        .roundedRect(leftX, listStartY - 22, 1080 - leftX * 2, 110, 16)
        .fillOpacity(0.92)
        .fill(colorDarkPurple)
        .restore();

      doc
        .font("BellotaBold")
        .fontSize(26)
        .fillColor(colorWhite)
        .text("No submitted policies today.", 0, listStartY + 10, {
          width: 1080,
          align: "center",
        });

      doc
        .font("BellotaBold")
        .fontSize(18)
        .fillColor("#d7d3ef")
        .text("(We’ll post the moment we have AP.)", 0, listStartY + 48, {
          width: 1080,
          align: "center",
        });
    }

    doc
      .font("BellotaBold")
      .fontSize(16)
      .fillColor(colorSub)
      .text("Based on submitted policies (UTC day)", 0, 1290, {
        width: 1080,
        align: "center",
      });

    doc.end();

    const pdfBuffer = await new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    const outBuffer = pdfBuffer;

    const fileName = `top-producers/${dayKey}.pdf`;

    const { error: upErr } = await sb.storage
      .from("announcements")
      .upload(fileName, outBuffer, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "3600",
      });

    if (upErr) throw upErr;

    const { data: pub } = sb.storage.from("announcements").getPublicUrl(fileName);
    const image_url = pub?.publicUrl || null;

    const lines = rows.length
      ? rows.map((r, i) => `${i + 1}. ${r.full_name} — ${money(r.ap)}`)
      : ["No submitted policies today."];

    const body =
      `Month-to-date AP: ${money(mtdAp)}\n` +
      `Total AP Today: ${money(dailyAp)}\n\n` +
      `Top Producers (${dayKey}):\n` +
      lines.join("\n");

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

    if (SITE_URL) {
      const pushUrl = `${SITE_URL}/.netlify/functions/send-push`;
      const pushRes = await fetchJson(pushUrl, {
        type: "announcement",
        announcement_id: created.id,
      });
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
