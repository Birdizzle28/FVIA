// netlify/functions/exportLeads.js
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";
import crypto from "crypto";

// Optional: fetch for logo URL
// Netlify Node 18+ has global fetch. If not, add node-fetch.
const BRAND = {
  name: "Family Values Group",
  // Put a PUBLIC absolute URL to your logo (recommended).
  // Example: https://your-site.netlify.app/Pics/img17.png
  logoUrl: process.env.BRAND_LOGO_URL || "",

  // Your brand colors (adjust if you want)
  ink: "#6B5BD6",     // purple
  accent: "#5FB7D4",  // blue
  light: "#f7f7fb",
  text: "#111111"
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function safeJsonParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function asArrayIds(idsParam) {
  if (!idsParam) return [];
  // ids can be JSON array or comma-separated
  if (idsParam.trim().startsWith("[")) {
    const arr = safeJsonParse(idsParam, []);
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  }
  return idsParam.split(",").map(x => x.trim()).filter(Boolean);
}

function prettyList(v) {
  if (v == null) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join(", ");

  if (typeof v === "string") {
    const s = v.trim();
    // handle JSON array strings like '["a@b.com","c@d.com"]'
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr.filter(Boolean).join(", ");
      } catch {}
    }
    return s;
  }

  return String(v);
}

function prettyLines(v) {
  const s = prettyList(v);
  if (!s) return "";
  return s.split(",").map(x => x.trim()).filter(Boolean).join("<br>");
}

function escCsv(v) {
  const s = (v ?? "").toString();
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatDate(d) {
  if (!d) return "";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US");
}

function joinPhones(p) {
  if (Array.isArray(p)) return p.join(", ");
  if (p == null) return "";
  return String(p);
}

async function fetchLogoBuffer(url) {
  if (!url) return null;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

// Server-side auth: verify caller is logged in and restrict leads if not admin
async function getRequesterContext({ supabaseUrl, anonKey, serviceKey, authHeader }) {
  const token = (authHeader || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
  if (!token) return { ok: false, error: "Missing Authorization bearer token." };

  // 1) Verify user via anon client
  const supabaseAuth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: userRes, error: userErr } = await supabaseAuth.auth.getUser(token);
  if (userErr || !userRes?.user?.id) {
    return { ok: false, error: "Invalid session. Please log in again." };
  }

  // 2) Load agent row via service role (to read is_admin safely)
  const supabaseSrv = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: agentRow, error: agentErr } = await supabaseSrv
    .from("agents")
    .select("id, is_admin, full_name, first_name, last_name")
    .eq("id", userRes.user.id)
    .maybeSingle();

  if (agentErr) {
    return { ok: false, error: `Agent lookup failed: ${agentErr.message}` };
  }

  return {
    ok: true,
    userId: userRes.user.id,
    isAdmin: !!agentRow?.is_admin,
    agentRow,
    token
  };
}

async function loadLeads({ supabaseSrv, ids, userId, isAdmin }) {
  if (!ids.length) return [];

  // Only pull what you need for export
  let q = supabaseSrv
    .from("leads")
    .select(`
      id,
      created_at,
      submitted_by_name,
      first_name,
      last_name,
      age,
      phone,
      email,
      address,
      city,
      state,
      zip,
      lead_type,
      product_type,
      notes,
      assigned_to,
      archived
    `)
    .in("id", ids);

  // Non-admins can only export their own assigned leads
  if (!isAdmin) q = q.eq("assigned_to", userId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  // Preserve the selection order (ids order)
  const map = new Map((data || []).map(l => [l.id, l]));
  return ids.map(id => map.get(id)).filter(Boolean);
}

function buildCsv(leads) {
  const headers = [
    "id","date","agent","first_name","last_name","age","phones","email",
    "address","city","state","zip","lead_type","product_type","notes"
  ];

  const rows = leads.map(l => ([
    l.id,
    formatDate(l.created_at),
    l.submitted_by_name || "",
    l.first_name || "",
    l.last_name || "",
    (l.age ?? "").toString(),
    joinPhones(l.phone),
    Array.isArray(l.email) ? (l.email[0] || "") : (l.email || ""),
    l.address || "",
    l.city || "",
    l.state || "",
    l.zip || "",
    l.lead_type || "",
    l.product_type || "",
    (l.notes || "").replace(/\s+\|\|\s+/g, " | ")
  ]));

  const out = [
    headers.map(escCsv).join(","),
    ...rows.map(r => r.map(escCsv).join(","))
  ].join("\n");

  return out;
}

function leadToPrettyHtml(lead, pageNum, total) {
  const phones = prettyLines(lead.phone);
  const email  = prettyLines(lead.email);

  const addrLine = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");

  return `
  <section class="page">
    <div class="topbar">
      <div class="brand">
        ${BRAND.logoUrl ? `<img class="logo" src="${BRAND.logoUrl}" alt="Logo">` : `<div class="logo-fallback"></div>`}
        <div class="brandtext">
          <div class="brandname">${BRAND.name}</div>
          <div class="subtitle">Lead Export</div>
        </div>
      </div>
      <div class="meta">
        <div><strong>Date:</strong> ${formatDate(lead.created_at)}</div>
        <div><strong>Lead ID:</strong> ${lead.id}</div>
      </div>
    </div>
    <div class="pagecount">Page ${pageNum} of ${total}</div>
    
    <div class="card">
      <div class="row">
        <div class="field"><div class="k">Client</div><div class="v">${(lead.first_name||"")} ${(lead.last_name||"")}</div></div>
        <div class="field"><div class="k">Age</div><div class="v">${lead.age ?? "—"}</div></div>
        <div class="field"><div class="k">Agent</div><div class="v">${lead.submitted_by_name || "—"}</div></div>
      </div>

      <div class="row">
        <div class="field"><div class="k">Phones</div><div class="v">${phones || "—"}</div></div>
        <div class="field"><div class="k">Email</div><div class="v">${email || "—"}</div></div>
      </div>

      <div class="row">
        <div class="field" style="flex:1;"><div class="k">Address</div><div class="v">${addrLine || "—"}</div></div>
      </div>

      <div class="row">
        <div class="field"><div class="k">Lead Type</div><div class="v">${lead.lead_type || "—"}</div></div>
        <div class="field"><div class="k">Product</div><div class="v">${lead.product_type || "—"}</div></div>
      </div>

      <div class="notes">
        <div class="k">Notes</div>
        <div class="v">${(lead.notes || "—").toString().replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
      </div>
    </div>

    <div class="footer">
      <div class="line"></div>
      <div class="small">Confidential — Internal Use Only</div>
    </div>
  </section>
  `;
}

function buildPrintHtml(leads) {
  const pages = leads.map((l, i) => leadToPrettyHtml(l, i+1, leads.length)).join("\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Lead Export</title>
  <style>
    @page { margin: 0.55in; }
    body { font-family: "Bellota Text", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin:0; color:${BRAND.text}; background:${BRAND.light}; }
    .page { page-break-after: always; background:${BRAND.light}; }
    .page:last-child { page-break-after: auto; }

    .topbar{
      display:flex; justify-content:space-between; gap:16px;
      padding:14px 14px 10px 14px;
      border: 2px solid ${BRAND.ink};
      background: #fff;
    }
    .brand{ display:flex; gap:12px; align-items:center; }
    .logo{ width:56px; height:56px; object-fit:cover; border-radius:10px; border:2px solid ${BRAND.accent}; background:#fff; }
    .logo-fallback{ width:56px; height:56px; border-radius:10px; border:2px solid ${BRAND.accent}; background:${BRAND.accent}; }
    .brandname{ font-size:18px; font-weight:800; color:${BRAND.ink}; }
    .subtitle{ font-size:12px; opacity:.85; }
    .meta{ text-align:right; font-size:12px; line-height:1.35; }
    .meta{ max-width:260px; }
    .meta > div{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .small{ font-size:11px; opacity:.8; }

    .card{
      margin-top:14px;
      border:2px solid ${BRAND.ink};
      background:#fff;
      padding:14px;
    }

    .row{ display:flex; gap:12px; margin-bottom:12px; flex-wrap:wrap; }
    .field{
      flex: 1 1 200px;
      min-width: 0;
      border:1px solid rgba(0,0,0,.08);
      padding:10px 10px;
      background: rgba(237,158,165,.10);
    }
    .k{ font-size:11px; letter-spacing:.02em; text-transform:uppercase; opacity:.85; margin-bottom:6px; }
    .v{ font-size:14px; font-weight:700; color:${BRAND.ink}; overflow-wrap:anywhere; word-break:break-word; line-height:1.25; }

    .notes{
      border:1px solid rgba(0,0,0,.08);
      padding:10px;
      background:#fff;
    }
    .notes .v{ font-weight:600; color:#111; white-space:pre-wrap; }

    .footer{ margin-top:12px; }
    .line{ height:3px; background:${BRAND.ink}; border-radius:999px; }
  </style>
</head>
<body>
  ${pages}
  <script>
    // Auto-open print dialog
    window.onload = () => setTimeout(() => window.print(), 200);
  </script>
</body>
</html>`;
}

function drawLeadPagePdf(doc, lead, logoBuf, pageNum, total) {
  const margin = 40;
  const w = doc.page.width;
  const h = doc.page.height;

  // Background
  doc.save();
  doc.rect(0, 0, w, h).fill(BRAND.light);
  doc.restore();

  // Header box
  const headerH = 92;
  doc.save();
  doc.rect(margin, margin, w - margin*2, headerH).lineWidth(2).stroke(BRAND.ink).fillOpacity(1).fillAndStroke("#ffffff", BRAND.ink);
  doc.restore();

  // Accent stripe
  doc.save();
  doc.rect(margin, margin + headerH - 8, w - margin*2, 8).fill(BRAND.accent);
  doc.restore();

  // Logo (square, not stretched)
  const logoSize = 54;
  const logoX = margin + 14;
  const logoY = margin + 18;
  if (logoBuf) {
    try {
      doc.image(logoBuf, logoX, logoY, { fit: [logoSize, logoSize], align: "center", valign: "center" });
      // border
      doc.roundedRect(logoX, logoY, logoSize, logoSize, 10).lineWidth(2).stroke(BRAND.accent);
    } catch {
      // ignore
    }
  } else {
    doc.roundedRect(logoX, logoY, logoSize, logoSize, 10).fill(BRAND.accent);
  }

  // Brand text
  doc.fillColor(BRAND.ink).fontSize(18).font("Helvetica-Bold").text(BRAND.name, logoX + logoSize + 14, margin + 20, { width: 320 });
  doc.fillColor("#333").fontSize(11).font("Helvetica").text("Lead Export", logoX + logoSize + 14, margin + 44);

  // Meta right
  const metaX = w - margin - 210;
  doc.fillColor("#111").fontSize(10).font("Helvetica");
  doc.text(`Date: ${formatDate(leadDate(lead))}`, metaX, margin + 20, { width: 200, align: "right" });
  doc.text(`Lead ID: ${lead.id}`, metaX, margin + 36, { width: 200, align: "right", lineBreak: false, ellipsis: true });
  
  // ✅ Page number moved OUT of the meta column so it can never collide
  doc.fillColor("#444").fontSize(10).font("Helvetica")
    .text(`Page ${pageNum} of ${total}`, margin, margin + headerH + 6, {
      width: w - margin * 2,
      align: "center"
    });
  // Card
  const cardY = margin + headerH + 18;
  const cardW = w - margin*2;
  const cardH = h - cardY - margin - 24;

  doc.save();
  doc.rect(margin, cardY, cardW, cardH).lineWidth(2).stroke(BRAND.ink).fill("#ffffff");
  doc.restore();

  const pad = 14;
  let y = cardY + pad;

  function field(label, value, x, width) {
    const boxH = 50;
    doc.save();
    doc.rect(x, y, width, boxH).lineWidth(1).strokeOpacity(0.15).stroke("#000").fillOpacity(1).fill(BRAND.accent);
    doc.fillOpacity(0.10).rect(x, y, width, boxH).fill(BRAND.accent);
    doc.restore();

    doc.fillColor("#333").fontSize(9).font("Helvetica").text(label.toUpperCase(), x + 10, y + 8, { width: width - 20 });
    const val = (value || "—").toString();
    doc.fillColor(BRAND.ink).fontSize(11).font("Helvetica-Bold").text(val, x + 10, y + 22, {
       width: width - 20,
       lineBreak: false,
       ellipsis: true
    });
  }

  const colGap = 12;
  const innerW = cardW - pad * 2;     // ✅ account for inner padding
  const colW = (innerW - colGap) / 2; // ✅ correct usable width

  field("Client", `${lead.first_name || ""} ${lead.last_name || ""}`.trim(), margin + pad, colW);
  field("Age", (lead.age ?? "").toString() || "—", margin + pad + colW + colGap, colW);
  y += 62;

  field("Phones", joinPhones(lead.phone), margin + pad, colW);
  field("Email", prettyList(lead.email), margin + pad + colW + colGap, colW);
  y += 62;

  const addr = [lead.address, lead.city, lead.state, lead.zip].filter(Boolean).join(", ");
  field("Address", addr, margin + pad, cardW - pad*2);
  y += 62;

  field("Lead Type", lead.lead_type || "", margin + pad, colW);
  field("Product", lead.product_type || "", margin + pad + colW + colGap, colW);
  y += 62;

  // Notes block
  doc.save();
  doc.rect(margin + pad, y, cardW - pad*2, cardH - (y - (cardY + pad)) - 12)
    .lineWidth(1)
    .strokeOpacity(0.15)
    .stroke("#000")
    .fill("#fff");
  doc.restore();

  doc.fillColor("#333").fontSize(9).font("Helvetica").text("NOTES", margin + pad + 10, y + 10);
  doc.fillColor("#111").fontSize(11).font("Helvetica").text((lead.notes || "—").toString(), margin + pad + 10, y + 26, {
    width: cardW - pad*2 - 20,
    height: cardH - (y - cardY) - 40
  });

  // Footer line
  doc.save();
  doc.rect(margin, h - margin - 10, cardW, 4).fill(BRAND.ink);
  doc.restore();
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey     = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return { statusCode: 500, headers: corsHeaders, body: "Missing Supabase env vars" };
    }

    const format = (event.queryStringParameters?.format || "pdf").toLowerCase();
    const idsRaw = event.queryStringParameters?.ids || "";
    const ids = asArrayIds(idsRaw);

    if (!["pdf","csv","print"].includes(format)) {
      return { statusCode: 400, headers: corsHeaders, body: "Invalid format" };
    }
    if (!ids.length) {
      return { statusCode: 400, headers: corsHeaders, body: "No lead IDs provided" };
    }

    // Auth + role gate
    const ctx = await getRequesterContext({
      supabaseUrl,
      anonKey,
      serviceKey,
      authHeader: event.headers?.authorization || event.headers?.Authorization || ""
    });
    if (!ctx.ok) {
      return { statusCode: 401, headers: corsHeaders, body: ctx.error };
    }

    const supabaseSrv = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const leads = await loadLeads({ supabaseSrv, ids, userId: ctx.userId, isAdmin: ctx.isAdmin });

    if (!leads.length) {
      return { statusCode: 404, headers: corsHeaders, body: "No leads found for export" };
    }

    // CSV
    if (format === "csv") {
      const csv = buildCsv(leads);
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="FVIA_Leads_${leads.length}.csv"`
        },
        body: csv
      };
    }

    // PRINT (HTML)
    if (format === "print") {
      const html = buildPrintHtml(leads);
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8"
        },
        body: html
      };
    }

    // PDF
    const logoBuf = await fetchLogoBuffer(BRAND.logoUrl);

    const doc = new PDFDocument({ size: "LETTER", margin: 0 });
    const chunks = [];
    doc.on("data", (d) => chunks.push(d));

    const done = new Promise((resolve, reject) => {
      doc.on("end", resolve);
      doc.on("error", reject);
    });

    leads.forEach((lead, i) => {
      if (i > 0) doc.addPage();
      drawLeadPagePdf(doc, lead, logoBuf, i + 1, leads.length);
    });

    doc.end();
    await done;

    const pdfBuffer = Buffer.concat(chunks);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="FVIA_Leads_${leads.length}.pdf"`
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: `Export failed: ${e?.message || "Unknown error"}`
    };
  }
};
