// netlify/functions/previewWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[previewWeeklyAdvance] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Helper: get the pay_date (Friday) either from query param or "next Friday from today"
 */
function getPayDate(event) {
  const qs = event.queryStringParameters || {};

  if (qs.pay_date) {
    // Allow override like ?pay_date=2025-12-05 for testing
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  // Default: today → next Friday (always upcoming, not today)
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 5=Fri
  let diff = (5 - day + 7) % 7;
  if (diff === 0) diff = 7;
  const nextFriday = new Date(today);
  nextFriday.setDate(today.getDate() + diff);
  return nextFriday;
}

/**
 * Repayment rate based on:
 * - totalDebt (lead + chargeback)
 * - isActive (agents.is_active)
 *
 * Rules:
 *   - if not active → 100% of this check (up to remaining debt)
 *   - if active:
 *        < 1000         => 30%
 *        1000–1999.99   => 40%
 *        >= 2000        => 50%
 */
function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) {
    return 1.0; // 100%
  }
  if (totalDebt <= 0) {
    return 0;
  }
  if (totalDebt < 1000) {
    return 0.30;
  }
  if (totalDebt < 2000) {
    return 0.40;
  }
  return 0.50; // 2000+
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDate    = getPayDate(event);                    // JS Date
    const payDateStr = payDate.toISOString().slice(0, 10);   // YYYY-MM-DD

    // 1) cutoff = pay_date - 14 days
    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffIso = cutoff.toISOString();

    console.log('[previewWeeklyAdvance] pay_date =', payDateStr, 'cutoff =', cutoffIso);

    // 2) Find all eligible ledger rows (advances + overrides not yet settled)
    const { data: ledgerRows, error: ledgerErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, entry_type, created_at, is_settled')
      .in('entry_type', ['advance', 'override'])
      // treat NULL as not settled too
      .or('is_settled.is.null,is_settled.eq.false')
      .lte('created_at', cutoffIso);

    if (ledgerErr) {
      console.error('[previewWeeklyAdvance] Error loading ledger rows:', ledgerErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load ledger rows', details: ledgerErr }),
      };
    }

    console.log('[previewWeeklyAdvance] eligible ledger rows =', ledgerRows.length);

    if (!ledgerRows || ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No eligible commission_ledger rows to pay for this advance preview.',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    // 3) Group by agent_id → gross per agent
    const agentTotals = {}; // { agent_id: { advance: x, override: y, gross: z } }

    for (const row of ledgerRows) {
      const aid = row.agent_id;
      if (!agentTotals[aid]) {
        agentTotals[aid] = { advance: 0, override: 0, gross: 0 };
      }
      const amt = Number(row.amount || 0);
      if (row.entry_type === 'advance') {
        agentTotals[aid].advance += amt;
      } else if (row.entry_type === 'override') {
        agentTotals[aid].override += amt;
      }
      agentTotals[aid].gross += amt;
    }

    const agentIds = Object.keys(agentTotals);
    if (agentIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No agents with eligible rows for this advance preview (after grouping).',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: ledgerRows.length,
        }),
      };
    }

    // 4) Load each agent's current debt (lead + chargeback)
    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', agentIds);

    if (debtErr) {
      console.error('[previewWeeklyAdvance] Error loading agent_total_debt:', debtErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent_total_debt', details: debtErr }),
      };
    }

    const debtMap = new Map();
    (debtRows || []).forEach(r => {
      debtMap.set(r.agent_id, {
        lead: Number(r.lead_debt_total || 0),
        chargeback: Number(r.chargeback_total || 0),
        total: Number(r.total_debt || 0),
      });
    });

    // 5) Load agent is_active flags
    const { data: agentRows, error: agentErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .in('id', agentIds);

    if (agentErr) {
      console.error('[previewWeeklyAdvance] Error loading agents.is_active:', agentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent active flags', details: agentErr }),
      };
    }

    const activeMap = new Map();
    (agentRows || []).forEach(a => {
      // treat null as active by default
      activeMap.set(a.id, a.is_active !== false);
    });

    // 6) Build payout summary with tiered repayment (30/40/50 or 100% if inactive)
    const payoutSummary = [];
    let totalGross  = 0;
    let totalDebits = 0;

    for (const [agent_id, t] of Object.entries(agentTotals)) {
      const gross = Number(t.gross.toFixed(2));
      totalGross += gross;

      const debtInfo = debtMap.get(agent_id) || { lead: 0, chargeback: 0, total: 0 };
      const totalDebt = debtInfo.total;
      const isActive  = activeMap.has(agent_id) ? activeMap.get(agent_id) : true;

      let leadRepay = 0;
      let chargebackRepay = 0;
      let net = gross;

      if (gross > 0 && totalDebt > 0) {
        const rate       = getRepaymentRate(totalDebt, isActive);
        const maxRepay   = Number((gross * rate).toFixed(2));   // tiered % of this check
        const toRepay    = Math.min(maxRepay, totalDebt);       // but never more than they owe

        // PRIORITY: chargebacks first, then leads
        let remaining = toRepay;

        const chargebackOutstanding = debtInfo.chargeback;
        if (chargebackOutstanding > 0 && remaining > 0) {
          chargebackRepay = Math.min(remaining, chargebackOutstanding);
          remaining -= chargebackRepay;
        }

        const leadOutstanding = debtInfo.lead;
        if (leadOutstanding > 0 && remaining > 0) {
          leadRepay = Math.min(remaining, leadOutstanding);
          remaining -= leadRepay;
        }

        const actualRepay = chargebackRepay + leadRepay;
        net = Number((gross - actualRepay).toFixed(2));
        totalDebits += actualRepay;
      }

      payoutSummary.push({
        agent_id,
        advance_gross: Number(t.advance.toFixed(2)),
        override_gross: Number(t.override.toFixed(2)),
        gross_payout: gross,
        net_payout: net,
        lead_repayment: Number(leadRepay.toFixed(2)),
        chargeback_repayment: Number(chargebackRepay.toFixed(2)),
      });
    }

    totalGross  = Number(totalGross.toFixed(2));
    totalDebits = Number(totalDebits.toFixed(2));
    const totalNet = Number((totalGross - totalDebits).toFixed(2));

    // *** IMPORTANT DIFFERENCE FROM runWeeklyAdvance ***
    // No insert into payout_batches
    // No update of commission_ledger
    // No applyRepayments()
    // This is a READ-ONLY preview.

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Weekly advance PREVIEW (no DB changes performed).',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
          total_gross: totalGross,
          total_debits: totalDebits,
          total_net: totalNet,
          agent_payouts: payoutSummary,
          ledger_row_count: ledgerRows.length,
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error('[previewWeeklyAdvance] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
