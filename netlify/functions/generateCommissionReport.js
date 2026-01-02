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

  // NOTE: keep notes agent-friendly; pass null/undefined to hide
  if (note) {
    doc.moveDown(0.4);
    doc.fillColor("#64748b").fontSize(9).text(note, 42, doc.y, { width: 528 });
  }
  doc.moveDown(0.8);

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

  const maxRows = 60;
  const showRows = (rows || []).slice(0, maxRows);

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

  if ((rows || []).length > maxRows) {
    doc.fillColor("#64748b").fontSize(9).text(`(Showing ${maxRows} of ${(rows || []).length})`, 42);
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

    if (r.policyholder_name) row.policyholder = r.policyholder_name;
    if (r.carrier_name) row.carrier = r.carrier_name;
    if (r.product_name) row.product = r.product_name;
  }

  return Array.from(out.values()).sort((a, b) => (b.total || 0) - (a.total || 0));
}

/**
 * IMPORTANT:
 * Your policies table has: contact_id, carrier_name, policy_type, product_line [oai_citation:2‡text.txt](file-service://file-Tg7z3nxHpZGxaFPE1PUDpT)
 * So we enrich from those fields and join contacts through the FK.
 */
async function fetchPoliciesForIds(policyIds) {
  if (!policyIds.length) return new Map();

  const chunks = [];
  for (let i = 0; i < policyIds.length; i += 200) chunks.push(policyIds.slice(i, i + 200));

  const map = new Map();

  for (const chunk of chunks) {
    // Explicit FK join name is the safest way to make Supabase do the right join.
    // If your FK name differs, update it to your actual constraint name.
    // From your schema: policies_contact_id_fkey [oai_citation:3‡text.txt](file-service://file-Tg7z3nxHpZGxaFPE1PUDpT)
    const { data, error } = await supabaseAdmin
      .from("policies")
      .select(`
        id,
        carrier_name,
        policy_type,
        product_line,
        contacts!policies_contact_id_fkey (
          first_name,
          last_name
        )
      `)
      .in("id", chunk);

    if (error || !data) continue;

    for (const p of data) {
      const c = p.contacts || {};
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim() || "—";

      const product = safe(p.product_line) || safe(p.policy_type) || "—";

      map.set(String(p.id), {
        policyholder: name,
        carrier: safe(p.carrier_name) || "—",
        product
      });
    }
  }

  return map;
}

// Try multiple possible debt column names without breaking
async function fetchDebtPaymentsByBatch(agentId, batchIds) {
  const out = new Map(); // batch_id -> { lead: 0, chargeback: 0, total: 0 }

  function ensure(batchId) {
    const k = String(batchId);
    if (!out.has(k)) out.set(k, { lead: 0, chargeback: 0, total: 0 });
    return out.get(k);
  }

  if (!batchIds?.length) return out;

  // ---- chargeback payments ----
  {
    const { data, error } = await supabaseAdmin
      .from("chargeback_payments")
      .select("payout_batch_id, amount")
      .eq("agent_id", agentId)
      .in("payout_batch_id", batchIds);

    if (error) throw new Error(`Error loading chargeback_payments: ${error.message}`);

    (data || []).forEach((r) => {
      if (!r.payout_batch_id) return;
      const row = ensure(r.payout_batch_id);
      const amt = Number(r.amount || 0);
      row.chargeback += amt;
      row.total += amt;
    });
  }

  // ---- lead debt payments ----
  {
    const { data, error } = await supabaseAdmin
      .from("lead_debt_payments")
      .select("payout_batch_id, amount")
      .eq("agent_id", agentId)
      .in("payout_batch_id", batchIds);

    if (error) throw new Error(`Error loading lead_debt_payments: ${error.message}`);

    (data || []).forEach((r) => {
      if (!r.payout_batch_id) return;
      const row = ensure(r.payout_batch_id);
      const amt = Number(r.amount || 0);
      row.lead += amt;
      row.total += amt;
    });
  }

  // normalize to 2 decimals
  for (const v of out.values()) {
    v.lead = Math.round(v.lead * 100) / 100;
    v.chargeback = Math.round(v.chargeback * 100) / 100;
    v.total = Math.round(v.total * 100) / 100;
  }

  return out;
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
    const agentId = requestedAgentId || requesterId;

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

    const batchIds = Array.from(
      new Set((payouts || []).map((p) => p.payout_batch_id).filter(Boolean))
    );
    
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

    const payoutsByDate = new Map();
    (payouts || []).forEach((p) => {
      const d = safe(p.pay_date);
      if (!payoutsByDate.has(d)) payoutsByDate.set(d, []);
      payoutsByDate.get(d).push(p);
    });

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

    // IMPORTANT: ASCII-only subtitle (fixes the weird !’ issue from special glyphs)
    const subtitle = dates.length
      ? `Pay Dates: ${dates.join(", ")}`
      : (startDate === endDate ? `Pay Date: ${startDate}` : `Pay Date Range: ${startDate} to ${endDate}`);

    drawHeader(doc, title, subtitle);

    doc.fillColor("#111827").fontSize(11).text(safe(agent.full_name) || "Agent", 42, 120);

    // ASCII-only separators
    doc.fillColor("#475569").fontSize(9).text(
      `Agent ID: ${safe(agent.agent_id) || "-"}  -  Level: ${safe(agent.level) || "-"}  -  Email: ${safe(agent.email) || "-"}`,
      42,
      136
    );

    doc.y = 160;
    divider(doc);

    // Totals
    const netPaid = (payouts || []).reduce((a, r) => a + Number(r.net_amount || 0), 0);
    const debtsWithheld = batchIds.reduce((sum, bid) => {
      const d = debtByBatch.get(String(bid));
      return sum + Number(d?.total || 0);
    }, 0);
    // You said: Gross = debts + net (because payouts already have debts subtracted)
    const grossBeforeDebts = netPaid + debtsWithheld;

    const batchCount = (payouts || []).length;

    drawCardRow(doc, [
      { title: "Gross (Before Debts)", value: money(grossBeforeDebts) },
      { title: "Debts Withheld", value: money(debtsWithheld) },
      { title: "Net Paid", value: money(netPaid) }
    ]);

    // Payout batches table (agent friendly)
    const payoutRows = (payouts || []).map((p) => {
      const bid = String(p.payout_batch_id || "");
      const d = bid ? debtByBatch.get(bid) : null;
      const debts = Number(d?.total || 0);
      const net = Number(p.net_amount || 0);
    
      return {
        pay_date: safe(p.pay_date),
        type: safe(p.batch_type),
        status: safe(p.status),
        gross: money(net + debts),
        debts: money(debts),
        net: money(net)
      };
    });

    table(doc, {
      title: "Payments Included",
      note: null,
      columns: [
        { key: "pay_date", label: "Pay Date", width: 92 },
        { key: "type", label: "Type", width: 95 },
        { key: "status", label: "Status", width: 82 },
        { key: "gross", label: "Gross", width: 88 },
        { key: "debts", label: "Debts", width: 78 },
        { key: "net", label: "Net", width: 88 }
      ],
      rows: payoutRows
    });

    async function renderPolicyBreakdownForBatchIds(sectionTitle, sectionBatchIds) {
      ensurePageSpace(doc, 160);
      doc.fillColor("#0f172a").fontSize(12).text(sectionTitle, 42);
      doc.moveDown(0.8);

      let sectionLedger = [];
      sectionBatchIds.forEach((bid) => {
        const rows = ledgerByBatch.get(bid) || [];
        sectionLedger = sectionLedger.concat(rows);
      });

      if (!sectionLedger.length) {
        doc.fillColor("#111827").fontSize(10).text("No commissions were settled for this pay period.", 42);
        doc.moveDown(1);
        divider(doc);
        return;
      }

      const policyIds = Array.from(new Set(sectionLedger.map((r) => r.policy_id).filter(Boolean))).map(String);
      const policyInfo = await fetchPoliciesForIds(policyIds);

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
        { title: "Advance", value: money(totals.advance) },
        { title: "Renewals / Pay-thru", value: money(totals.renewal + totals.paythru) },
        { title: "Overrides / Bonus", value: money(totals.override + totals.bonus) }
      ]);

      const policyRows = grouped.map((r) => ({
        policyholder: r.policyholder,
        carrier: r.carrier,
        product: r.product,
        advance: money(r.advance),
        renewals: money(r.renewal + r.paythru),
        overrides: money(r.override),
        bonus: money(r.bonus),
        total: money(r.total),
        policy_id: r.policy_id
      }));

      table(doc, {
        title: "Commission Detail by Policy",
        note: null,
        columns: [
          { key: "policyholder", label: "Client", width: 120 },
          { key: "carrier", label: "Carrier", width: 100 },
          { key: "product", label: "Product", width: 95 },
          { key: "advance", label: "Advance", width: 65 },
          { key: "renewals", label: "Renew/Thru", width: 72 },
          { key: "overrides", label: "Override", width: 68 },
          { key: "bonus", label: "Bonus", width: 55 },
          { key: "total", label: "Total", width: 55 },
          { key: "policy_id", label: "Policy ID", width: 78 }
        ],
        rows: policyRows
      });
    }

    if (dates.length) {
      for (const d of dates) {
        const datePayouts = payoutsByDate.get(d) || [];
        const dateBatchIds = Array.from(new Set(datePayouts.map((p) => p.payout_batch_id).filter(Boolean)));
        if (!dateBatchIds.length) continue;

        ensurePageSpace(doc, 180);
        doc.fillColor("#0f172a").fontSize(14).text(`Pay Date: ${d}`, 42);
        doc.moveDown(0.6);

        const dateNet = datePayouts.reduce((a, r) => a + Number(r.net_amount || 0), 0);
        const dateDebts = dateBatchIds.reduce((sum, bid) => {
          const d = debtByBatch.get(String(bid));
          return sum + Number(d?.total || 0);
        }, 0);
        const dateGross = dateNet + dateDebts;

        drawCardRow(doc, [
          { title: "Gross (Before Debts)", value: money(dateGross) },
          { title: "Debts Withheld", value: money(dateDebts) },
          { title: "Net Paid", value: money(dateNet) }
        ]);

        await renderPolicyBreakdownForBatchIds("Commission Detail", dateBatchIds);
      }
    } else {
      if (batchIds.length) {
        await renderPolicyBreakdownForBatchIds("Commission Detail", batchIds);
      }
    }

    ensurePageSpace(doc, 60);
    doc.fillColor("#64748b").fontSize(8).text(
      "Statement reflects commissions that were included in settled payments for the selected pay date(s).",
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
