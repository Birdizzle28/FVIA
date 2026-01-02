import PDFDocument from "pdfkit";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function bearer(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function money(n) {
  const num = Number(n || 0);
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function safe(v) {
  return String(v ?? "").trim();
}

function pdfToBase64(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
    doc.on("error", reject);
    doc.end();
  });
}

function divider(doc) {
  const y = doc.y;
  doc
    .save()
    .moveTo(42, y)
    .lineTo(570, y)
    .lineWidth(1)
    .strokeColor("#e5e7eb")
    .stroke()
    .restore();
  doc.moveDown(0.8);
}

function ensurePageSpace(doc, minSpace = 120) {
  if (doc.y + minSpace > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function drawHeader(doc, title, subtitle) {
  doc.save().rect(42, 36, 528, 64).fill("#0f172a").restore();
  doc.fillColor("#ffffff").fontSize(18).text(title, 56, 56, { lineBreak: false });
  doc.fillColor("#cbd5e1").fontSize(10).text(subtitle, 56, 80);
  doc.fillColor("#111827");
}

function drawCardRow(doc, cards) {
  const y = doc.y;
  const w = 162;
  const gap = 21;
  const xs = [42, 42 + w + gap, 42 + (w + gap) * 2];

  cards.forEach((c, i) => {
    doc.save().roundedRect(xs[i], y, w, 66, 10).fill("#f8fafc").restore();
    doc.fillColor("#334155").fontSize(9).text(c.title, xs[i] + 12, y + 10);
    doc.fillColor("#0f172a").fontSize(14).text(c.value, xs[i] + 12, y + 26);
    if (c.note) doc.fillColor("#64748b").fontSize(8).text(c.note, xs[i] + 12, y + 48);
  });

  doc.moveDown(4.5);
}

function table(doc, { title, columns, rows, note }) {
  ensurePageSpace(doc, 160);
  doc.fillColor("#0f172a").fontSize(12).text(title, 42);
  if (note) {
    doc.moveDown(0.4);
    doc.fillColor("#64748b").fontSize(9).text(note, 42, doc.y, { width: 528 });
  }
  doc.moveDown(0.8);

  // column widths (simple proportional)
  const totalWidth = 528;
  const colCount = columns.length;
  const baseW = Math.floor(totalWidth / colCount);
  const widths = columns.map((c) => c.width || baseW);
  const sumW = widths.reduce((a, b) => a + b, 0);
  const scale = totalWidth / sumW;
  const finalW = widths.map((w) => Math.floor(w * scale));

  const startX = 42;
  let x = startX;
  const headerY = doc.y;

  doc.save().roundedRect(42, headerY - 4, 528, 20, 6).fill("#eef2ff").restore();
  doc.fillColor("#111827").fontSize(9);
  columns.forEach((c, i) => {
    doc.text(c.label, x + 6, headerY, { width: finalW[i] - 12, lineBreak: false });
    x += finalW[i];
  });
  doc.moveDown(1.3);

  doc.fillColor("#111827").fontSize(9);

  const maxRows = 60; // avoid insane PDFs; you can raise this later
  const showRows = rows.slice(0, maxRows);

  showRows.forEach((r, idx) => {
    ensurePageSpace(doc, 40);
    const rowY = doc.y;

    if (idx % 2 === 1) {
      doc.save().roundedRect(42, rowY - 2, 528, 18, 4).fill("#f8fafc").restore();
    }

    x = startX;
    columns.forEach((c, i) => {
      const txt = safe(r[c.key]);
      doc.text(txt, x + 6, rowY, { width: finalW[i] - 12, lineBreak: false, ellipsis: true });
      x += finalW[i];
    });

    doc.moveDown(1.1);
  });

  if (rows.length > maxRows) {
    doc.fillColor("#64748b").fontSize(9).text(`(Showing ${maxRows} of ${rows.length})`, 42);
    doc.moveDown(0.8);
  }

  divider(doc);
}

function groupLedgerByPolicy(ledgerRows) {
  const out = new Map();

  for (const r of ledgerRows || []) {
    const policyId = r.policy_id || "—";
    const k = String(policyId);

    if (!out.has(k)) {
      out.set(k, {
        policy_id: k,
        policyholder: "—",
        carrier: "—",
        product: "—",
        advance: 0,
        paythru: 0,
        renewal: 0,
        override: 0,
        bonus: 0,
        other: 0,
        total: 0
      });
    }

    const row = out.get(k);
    const t = String(r.entry_type || "other").toLowerCase();
    const amt = Number(r.amount || 0);

    if (t === "advance") row.advance += amt;
    else if (t === "paythru" || t === "pay_thru") row.paythru += amt;
    else if (t === "renewal" || t === "trail" || t === "trails") row.renewal += amt;
    else if (t === "override") row.override += amt;
    else if (t === "bonus") row.bonus += amt;
    else row.other += amt;

    row.total += amt;

    // optional metadata
    if (r.policyholder_name) row.policyholder = r.policyholder_name;
    if (r.carrier_name) row.carrier = r.carrier_name;
    if (r.product_name) row.product = r.product_name;
  }

  return Array.from(out.values()).sort((a, b) => (b.total || 0) - (a.total || 0));
}

async function fetchPoliciesForIds(policyIds) {
  // Try to enrich with policies table if it exists / columns exist.
  // If your schema differs, the PDF still works; it will just show policy_id only.
  if (!policyIds.length) return new Map();

  // chunk to avoid URL too long
  const chunks = [];
  for (let i = 0; i < policyIds.length; i += 200) chunks.push(policyIds.slice(i, i + 200));

  const map = new Map();

  for (const chunk of chunks) {
    const { data, error } = await supabaseAdmin
      .from("policies")
      .select(`
        id,
        carrier_name,
        product,
        product_name,
        product_type,
        contact:contacts(first_name,last_name)
      `)
      .in("id", chunk);

    if (error || !data) continue;

    for (const p of data) {
      const c = p.contact || {};
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "—";
      map.set(String(p.id), {
        policyholder: name,
        carrier: safe(p.carrier_name) || "—",
        product: safe(p.product || p.product_name || p.product_type) || "—"
      });
    }
  }

  return map;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return { statusCode: 405, body: "Use POST" };
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return { statusCode: 500, body: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" };
    }

    const token = bearer(event);
    if (!token) return { statusCode: 401, body: "Missing Authorization: Bearer <token>" };

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return { statusCode: 401, body: "Invalid session token" };
    const requesterId = userData.user.id;

    const body = JSON.parse(event.body || "{}");

    const requestedAgentId = safe(body.agent_id);
    let agentId = requestedAgentId || requesterId;

    const { data: requesterProfile } = await supabaseAdmin
      .from("agents")
      .select("id,is_admin")
      .eq("id", requesterId)
      .maybeSingle();

    const isAdmin = !!requesterProfile?.is_admin;

    if (requestedAgentId && requestedAgentId !== requesterId && !isAdmin) {
      return { statusCode: 403, body: "Not allowed to generate reports for other agents." };
    }

    const { data: agent, error: agentErr } = await supabaseAdmin
      .from("agents")
      .select("id,full_name,email,agent_id,level")
      .eq("id", agentId)
      .maybeSingle();

    if (agentErr) return { statusCode: 500, body: `Error loading agent: ${agentErr.message}` };
    if (!agent) return { statusCode: 404, body: "Agent not found" };

    // Input modes:
    // A) { dates: ["YYYY-MM-DD", ...] }  -> sections per pay_date
    // B) { start_date, end_date }        -> one statement for range
    // C) { date }                        -> same as range with same date
    const dates = Array.isArray(body.dates) ? body.dates.map(safe).filter(Boolean) : [];
    let startDate = safe(body.start_date) || safe(body.date);
    let endDate = safe(body.end_date) || safe(body.date);

    if (!dates.length && (!startDate || !endDate)) {
      return {
        statusCode: 400,
        body: 'Provide { dates: ["YYYY-MM-DD", ...] } OR { date } OR { start_date, end_date }.'
      };
    }

    // Fetch payouts for the relevant pay_date(s)
    let payouts = [];
    if (dates.length) {
      const { data, error } = await supabaseAdmin
        .from("agent_payouts_view")
        .select("*")
        .eq("agent_id", agentId)
        .in("pay_date", dates)
        .order("pay_date", { ascending: true });

      if (error) return { statusCode: 500, body: `Error loading payouts: ${error.message}` };
      payouts = data || [];
    } else {
      const { data, error } = await supabaseAdmin
        .from("agent_payouts_view")
        .select("*")
        .eq("agent_id", agentId)
        .gte("pay_date", startDate)
        .lte("pay_date", endDate)
        .order("pay_date", { ascending: true });

      if (error) return { statusCode: 500, body: `Error loading payouts: ${error.message}` };
      payouts = data || [];
    }

    // We need payout_batch_ids to pull settled ledger rows tied to those batches
    const batchIds = Array.from(
      new Set((payouts || []).map((p) => p.payout_batch_id).filter(Boolean))
    );

    // Pull settled ledger rows for these batches (per-policy breakdown source)
    let ledger = [];
    if (batchIds.length) {
      const { data, error } = await supabaseAdmin
        .from("commission_ledger")
        .select("id,created_at,entry_type,amount,policy_id,payout_batch_id,is_settled,meta")
        .eq("agent_id", agentId)
        .eq("is_settled", true)
        .in("payout_batch_id", batchIds)
        .order("created_at", { ascending: true });

      if (error) return { statusCode: 500, body: `Error loading commission_ledger: ${error.message}` };
      ledger = data || [];
    }

    // Group by pay_date for multi-date mode
    const payoutsByDate = new Map();
    (payouts || []).forEach((p) => {
      const d = safe(p.pay_date);
      if (!payoutsByDate.has(d)) payoutsByDate.set(d, []);
      payoutsByDate.get(d).push(p);
    });

    // We'll also group ledger by payout_batch_id so we can build each date section accurately
    const ledgerByBatch = new Map();
    (ledger || []).forEach((r) => {
      const b = r.payout_batch_id;
      if (!b) return;
      if (!ledgerByBatch.has(b)) ledgerByBatch.set(b, []);
      ledgerByBatch.get(b).push(r);
    });

    // Build PDF
    const doc = new PDFDocument({ size: "LETTER", margin: 42 });

    const title = "Commission Statement";
    const subtitle = dates.length
      ? `Pay Dates: ${dates.join(", ")}`
      : (startDate === endDate ? `Pay Date: ${startDate}` : `Pay Date Range: ${startDate} → ${endDate}`);

    drawHeader(doc, title, subtitle);

    doc.fillColor("#111827").fontSize(11).text(safe(agent.full_name) || "Agent", 42, 120);
    doc.fillColor("#475569").fontSize(9).text(
      `Agent ID: ${safe(agent.agent_id) || "—"}   •   Level: ${safe(agent.level) || "—"}   •   Email: ${safe(agent.email) || "—"}`,
      42,
      136
    );

    doc.y = 160;
    divider(doc);

    // Overall totals (across all selected payouts)
    const gross = (payouts || []).reduce((a, r) => a + Number(r.gross_amount || 0), 0);
    const net = (payouts || []).reduce((a, r) => a + Number(r.net_amount || 0), 0);
    const batchCount = (payouts || []).length;

    drawCardRow(doc, [
      { title: "Gross Paid", value: money(gross), note: "Settled ledger totals" },
      { title: "Net Paid", value: money(net), note: "Same as gross for now" },
      { title: "Payout Batches", value: String(batchCount), note: "Batches included" }
    ]);

    // Payout batches table (statement-like)
    const payoutRows = (payouts || []).map((p) => ({
      pay_date: safe(p.pay_date),
      batch_type: safe(p.batch_type),
      status: safe(p.status),
      payout_batch_id: safe(p.payout_batch_id),
      gross_amount: money(p.gross_amount || 0),
      net_amount: money(p.net_amount || 0)
    }));

    table(doc, {
      title: "Payout Batches",
      note: "Each row is one payout batch (from agent_payouts_view).",
      columns: [
        { key: "pay_date", label: "Pay Date", width: 90 },
        { key: "batch_type", label: "Type", width: 90 },
        { key: "status", label: "Status", width: 80 },
        { key: "gross_amount", label: "Gross", width: 85 },
        { key: "net_amount", label: "Net", width: 85 },
        { key: "payout_batch_id", label: "Batch ID", width: 98 }
      ],
      rows: payoutRows
    });

    // Helper to render a policy breakdown section
    async function renderPolicyBreakdownForBatchIds(sectionTitle, sectionNote, sectionBatchIds) {
      ensurePageSpace(doc, 160);
      doc.fillColor("#0f172a").fontSize(12).text(sectionTitle, 42);
      if (sectionNote) {
        doc.moveDown(0.4);
        doc.fillColor("#64748b").fontSize(9).text(sectionNote, 42, doc.y, { width: 528 });
      }
      doc.moveDown(0.8);

      // gather ledger rows from those batch ids
      let sectionLedger = [];
      sectionBatchIds.forEach((bid) => {
        const rows = ledgerByBatch.get(bid) || [];
        sectionLedger = sectionLedger.concat(rows);
      });

      if (!sectionLedger.length) {
        doc.fillColor("#111827").fontSize(10).text("No settled commission ledger rows found for this section.", 42);
        doc.moveDown(1);
        divider(doc);
        return;
      }

      // policy enrichment (optional)
      const policyIds = Array.from(new Set(sectionLedger.map((r) => r.policy_id).filter(Boolean))).map(String);
      const policyInfo = await fetchPoliciesForIds(policyIds);

      // attach enrichment fields to ledger rows so grouping can pick them up
      sectionLedger = sectionLedger.map((r) => {
        const pid = r.policy_id ? String(r.policy_id) : "";
        const info = policyInfo.get(pid);
        return {
          ...r,
          policyholder_name: info?.policyholder,
          carrier_name: info?.carrier,
          product_name: info?.product
        };
      });

      const grouped = groupLedgerByPolicy(sectionLedger);

      // totals
      const totals = grouped.reduce(
        (acc, r) => {
          acc.advance += r.advance;
          acc.paythru += r.paythru;
          acc.renewal += r.renewal;
          acc.override += r.override;
          acc.bonus += r.bonus;
          acc.other += r.other;
          acc.total += r.total;
          return acc;
        },
        { advance: 0, paythru: 0, renewal: 0, override: 0, bonus: 0, other: 0, total: 0 }
      );

      drawCardRow(doc, [
        { title: "Advance", value: money(totals.advance), note: "Entry type = advance" },
        { title: "Renewal/Pay-Thru", value: money(totals.renewal + totals.paythru), note: "renewal + paythru" },
        { title: "Overrides/Bonus", value: money(totals.override + totals.bonus), note: "override + bonus" }
      ]);

      const policyRows = grouped.map((r) => ({
        policy_id: r.policy_id,
        policyholder: r.policyholder,
        carrier: r.carrier,
        product: r.product,
        advance: money(r.advance),
        renewals: money(r.renewal + r.paythru),
        overrides: money(r.override),
        bonus: money(r.bonus),
        total: money(r.total)
      }));

      table(doc, {
        title: "Per-Policy Commission Breakdown",
        note: "Grouped from commission_ledger (settled rows) tied to the payout batch(es).",
        columns: [
          { key: "policyholder", label: "Policyholder", width: 110 },
          { key: "carrier", label: "Carrier", width: 95 },
          { key: "product", label: "Product", width: 85 },
          { key: "advance", label: "Advance", width: 65 },
          { key: "renewals", label: "Renew/Thru", width: 70 },
          { key: "overrides", label: "Override", width: 65 },
          { key: "bonus", label: "Bonus", width: 55 },
          { key: "total", label: "Total", width: 55 },
          { key: "policy_id", label: "Policy ID", width: 78 }
        ],
        rows: policyRows
      });
    }

    // If dates array provided: create section per pay_date
    if (dates.length) {
      for (const d of dates) {
        const datePayouts = payoutsByDate.get(d) || [];
        const dateBatchIds = Array.from(new Set(datePayouts.map((p) => p.payout_batch_id).filter(Boolean)));

        if (!dateBatchIds.length) continue;

        ensurePageSpace(doc, 180);
        doc.fillColor("#0f172a").fontSize(14).text(`Pay Date: ${d}`, 42);
        doc.moveDown(0.6);

        const dateGross = datePayouts.reduce((a, r) => a + Number(r.gross_amount || 0), 0);
        const dateNet = datePayouts.reduce((a, r) => a + Number(r.net_amount || 0), 0);

        drawCardRow(doc, [
          { title: "Gross (Date)", value: money(dateGross) },
          { title: "Net (Date)", value: money(dateNet) },
          { title: "Batches (Date)", value: String(datePayouts.length) }
        ]);

        await renderPolicyBreakdownForBatchIds(
          `Commission Detail (Pay Date ${d})`,
          "This section shows the per-policy breakdown for payout batches that paid on this date.",
          dateBatchIds
        );
      }
    } else {
      // Range mode: one combined policy breakdown across all batches in range
      if (batchIds.length) {
        await renderPolicyBreakdownForBatchIds(
          "Commission Detail (Combined)",
          "This section shows the per-policy breakdown for all payout batches in the selected date range.",
          batchIds
        );
      }
    }

    // Footer note
    ensurePageSpace(doc, 80);
    doc.fillColor("#64748b").fontSize(8).text(
      "This statement is for informational purposes and reflects settled ledger entries included in payout batches for the selected pay date(s).",
      42,
      doc.y,
      { width: 528 }
    );

    const base64 = await pdfToBase64(doc);
    const buffer = Buffer.from(base64, "base64");

    const filename = dates.length
      ? `Commission-Statement-${dates.join("_")}-${agent.id}.pdf`
      : `Commission-Statement-${startDate}_to_${endDate}-${agent.id}.pdf`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true
    };
  } catch (err) {
    return { statusCode: 500, body: `generateCommissionReport failed: ${err?.message || String(err)}` };
  }
}
