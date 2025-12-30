// netlify/functions/downloadCarrierPaySchedule.js
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const cors = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
});

function cleanFilename(name) {
  return String(name || "pay-schedule")
    .replace(/[^a-z0-9\-_ ]/gi, "")
    .trim()
    .replace(/\s+/g, " ");
}

function rateToPercentString(v) {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "—";
  // If stored as 0.4500 => 45%
  // If stored as 45.0000 => 45%
  const pct = n > 1.5 ? n : n * 100;
  return `${pct.toFixed(2)}%`;
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return "—";
  }
}

async function fetchImageBytes(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch {
    return null;
  }
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// “Active with carrier” rule (based on your intent):
// - is_contracted MUST be true
// - status must be 'active'
// - effective_date <= today (if set)
// - terminated_date null OR > today (if set)
async function agentHasActiveCarrierLink(supabase, agentId, carrierId) {
  const iso = todayISO();

  const { data, error } = await supabase
    .from("agent_carriers")
    .select("id, is_contracted, status, effective_date, terminated_date")
    .eq("agent_id", agentId)
    .eq("carrier_id", carrierId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return false;

  if (data.is_contracted !== true) return false;
  if (String(data.status || "").toLowerCase() !== "active") return false;

  if (data.effective_date && String(data.effective_date) > iso) return false;
  if (data.terminated_date && String(data.terminated_date) <= iso) return false;

  return true;
}

function buildPdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      layout: "portrait",
      margins: { top: 48, bottom: 54, left: 48, right: 48 }
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    buildFn(doc).then(() => doc.end()).catch(reject);
  });
}

function drawFooter(doc, disclaimerText) {
  const pageBottom = doc.page.height - doc.page.margins.bottom + 18;
  doc
    .fontSize(8)
    .fillColor("#666666")
    .text(disclaimerText, doc.page.margins.left, pageBottom, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "center"
    })
    .fillColor("#000000");
}

function drawTableHeader(doc, y) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const w = right - left;

  // Columns (fixed widths)
  const cols = [
    { label: "Product Line", w: w * 0.20 },
    { label: "Policy Type",  w: w * 0.18 },
    { label: "Base",         w: w * 0.10 },
    { label: "Advance",      w: w * 0.10 },
    { label: "Renewal",      w: w * 0.10 },
    { label: "Renewal Years",w: w * 0.12 },
    { label: "Notes",        w: w * 0.20 }
  ];

  doc
    .rect(left, y, w, 18)
    .fill("#f2f2f2")
    .fillColor("#000000");

  let x = left;
  doc.fontSize(9).font("Helvetica-Bold");
  for (const c of cols) {
    doc.text(c.label, x + 6, y + 5, { width: c.w - 12, ellipsis: true });
    x += c.w;
  }

  doc.font("Helvetica").fontSize(9);
  return { cols, nextY: y + 22 };
}

function parseRenewalTrailCells(rule) {
  if (!rule) return { renewalText: "—", yearsText: "—" };

  let obj = rule;

  // if stored as text, parse it
  if (typeof obj === "string") {
    try { obj = JSON.parse(obj); } catch { obj = null; }
  }

  const bands = Array.isArray(obj?.bands) ? obj.bands : [];
  if (!bands.length) return { renewalText: "—", yearsText: "—" };

  const renewalLines = [];
  const yearsLines = [];

  for (const b of bands) {
    const ratePct = rateToPercentString(b?.rate);
    const s = b?.start_year ?? "—";
    const e = b?.end_year ?? "—";

    let years = "—";
    if (s !== "—" && e === "—") years = `${s}+`;
    else if (s !== "—" && e !== "—") years = `${s}-${e}`;

    renewalLines.push(ratePct);
    yearsLines.push(years);
  }

  return {
    renewalText: renewalLines.join("\n"),
    yearsText: yearsLines.join("\n")
  };
}

function drawTableRow(doc, row, y, cols) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const w = right - left;

  const { renewalText, yearsText } = parseRenewalTrailCells(row.renewal_trail_rule);

  const cells = [
    row.product_line || "—",
    row.policy_type || "—",
    rateToPercentString(row.base_commission_rate),
    rateToPercentString(row.advance_rate),
    renewalText,
    yearsText,
    row.notes || "—"
  ];

  // estimate row height (notes can wrap)
  const baseH = 16;
  const leftPad = 6;
  let maxH = baseH;

  // measure heights
  let x = left;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const h = doc.heightOfString(String(cells[i]), { width: c.w - (leftPad * 2) });
    maxH = Math.max(maxH, h + 10);
    x += c.w;
  }

  // draw border
  doc.rect(left, y, w, maxH).strokeColor("#dddddd").stroke();

  // draw text
  x = left;
  doc.fillColor("#000000").fontSize(9).font("Helvetica");
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    doc.text(String(cells[i]), x + leftPad, y + 6, {
      width: c.w - (leftPad * 2),
      height: maxH - 8
    });
    x += c.w;
  }

  return y + maxH;
}

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: cors(), body: "" };
  }

  if (event.httpMethod !== "GET") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }

  try {
    const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        headers: cors(),
        body: JSON.stringify({ error: "Supabase env vars not set" })
      };
    }

    // Require auth
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return { statusCode: 401, headers: cors(), body: JSON.stringify({ error: "Missing Bearer token" }) };
    }

    const carrierId = event.queryStringParameters?.carrier_id || null;
    if (!carrierId) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing carrier_id" }) };
    }

    // Admin client
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user from JWT
    const { data: uData, error: uErr } = await supabase.auth.getUser(token);
    if (uErr || !uData?.user) {
      return { statusCode: 401, headers: cors(), body: JSON.stringify({ error: "Invalid session" }) };
    }

    const userId = uData.user.id;

    // Load agent row
    const { data: agent, error: aErr } = await supabase
      .from("agents")
      .select("id, full_name, is_active, is_admin, level")
      .eq("id", userId)
      .maybeSingle();

    if (aErr) throw aErr;
    if (!agent) {
      return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: "Not an agent" }) };
    }

    const isAdmin = agent.is_admin === true;

    // Block inactive unless admin
    if (!isAdmin && agent.is_active !== true) {
      return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: "AGENT_INACTIVE" }) };
    }

    // Non-admin must be actively contracted with carrier
    if (!isAdmin) {
      const ok = await agentHasActiveCarrierLink(supabase, agent.id, carrierId);
      if (!ok) {
        return { statusCode: 403, headers: cors(), body: JSON.stringify({ error: "NOT_ACTIVE_WITH_CARRIER" }) };
      }
    }

    // Load carrier
    const { data: carrier, error: cErr } = await supabase
      .from("carriers")
      .select("id, carrier_name, carrier_logo, carrier_url")
      .eq("id", carrierId)
      .single();

    if (cErr) throw cErr;

    const agentLevel = (agent.level || "agent").toLowerCase();
    const iso = todayISO();

    // Load schedules for this carrier + agent level
    // Current schedules only:
    const { data: schedules, error: sErr } = await supabase
      .from("commission_schedules")
      .select(`
        id,
        carrier_id,
        carrier_name,
        product_line,
        policy_type,
        agent_level,
        base_commission_rate,
        advance_rate,
        renewal_trail_rule,
        effective_from,
        effective_to,
        notes
      `)
      .eq("carrier_id", carrierId)
      .eq("agent_level", agentLevel)
      .lte("effective_from", iso)
      .or(`effective_to.is.null,effective_to.gte.${iso}`)
      .order("product_line", { ascending: true })
      .order("policy_type", { ascending: true });

    if (sErr) throw sErr;

    // If none, still produce a PDF that says “no schedules”
    const disclaimer =
      "This schedule is for informational purposes only. Commission rates and advance terms may change. Refer to carrier contracting documents for final terms.";

    // carrier_logo could be:
    // - a full URL
    // - a public storage URL you stored
    // If it’s a storage path, you should store the public URL in carriers.carrier_logo.
    const logoBytes = await fetchImageBytes(carrier.carrier_logo);

    const pdfBuffer = await buildPdfBuffer(async (doc) => {
      const left = doc.page.margins.left;
      const right = doc.page.width - doc.page.margins.right;

      // Header
      let headerTop = doc.y;

      // Logo square (not stretched)
      if (logoBytes) {
        try {
          doc.image(logoBytes, left, headerTop, { fit: [64, 64], align: "left", valign: "top" });
        } catch {
          // ignore logo render failure
        }
      }

      const titleX = left + (logoBytes ? 76 : 0);
      doc
        .font("Helvetica-Bold")
        .fontSize(18)
        .text(carrier.carrier_name || "Carrier", titleX, headerTop + 4, { width: right - titleX });

      doc
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#333333")
        .text("Pay Schedules", titleX, headerTop + 28, { width: right - titleX });

      doc
        .fontSize(9)
        .fillColor("#666666")
        .text(
          `Agent: ${agent.full_name || "—"}   •   Level: ${agentLevel.replace("_", " ")}   •   Generated: ${formatDate(new Date())}`,
          titleX,
          headerTop + 46,
          { width: right - titleX }
        );

      doc.fillColor("#000000");
      doc.moveDown(2);

      // Divider
      doc
        .moveTo(left, doc.y)
        .lineTo(right, doc.y)
        .strokeColor("#dddddd")
        .stroke();
      doc.moveDown(1);

      // Body
      if (!schedules || schedules.length === 0) {
        doc
          .font("Helvetica")
          .fontSize(11)
          .text("No commission schedules were found for your level with this carrier.", left, doc.y, {
            width: right - left
          });
        drawFooter(doc, disclaimer);
        return;
      }

      // Table
      let y = doc.y;
      const pageBottomLimit = doc.page.height - doc.page.margins.bottom - 30;

      // Header row
      let header = drawTableHeader(doc, y);
      let cols = header.cols;
      y = header.nextY;

      for (const row of schedules) {
        // New page if needed
        if (y > pageBottomLimit) {
          doc.addPage();
          y = doc.y;
          header = drawTableHeader(doc, y);
          cols = header.cols;
          y = header.nextY;
        }

        y = drawTableRow(doc, row, y, cols);
      }

      // Footer on last page
      drawFooter(doc, disclaimer);
    });

    const filename = cleanFilename(`Pay Schedule - ${carrier.carrier_name} - ${agentLevel}.pdf`);

    return {
      statusCode: 200,
      headers: {
        ...cors(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error("downloadCarrierPaySchedule error:", err);
    return {
      statusCode: 500,
      headers: cors(),
      body: JSON.stringify({ error: err.message || "Server error" })
    };
  }
}
