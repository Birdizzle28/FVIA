// netlify/functions/runWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runWeeklyAdvance] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
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
 * For now: single-stage 30% repayment cap.
 * Later we can turn this into your 30/40/50 system using totalDebt.
 */
function getRepaymentRate(totalDebt) {
  // totalDebt is available if we want tiers later
  return 0.30; // 30% of this week’s gross max
}

/**
 * NEW — record actual repayment events into DB
 * - chargebackRepay is what we decided to take for chargebacks for this agent this week
 * - leadRepay       is what we decided to take for leads for this agent this week
 */
async function applyRepayments(agent_id, chargebackRepay, leadRepay, batchId) {
  /* ------------------------------
     1. Apply chargeback repayments
     ------------------------------ */
  if (chargebackRepay > 0) {
    let remaining = chargebackRepay;

    // Load open chargebacks oldest → newest
    const { data: cbRows, error: cbErr } = await supabase
      .from('policy_chargebacks')
      .select('id, amount, status')
      .eq('agent_id', agent_id)
      .in('status', ['open', 'in_repayment'])
      .order('created_at', { ascending: true });

    if (!cbErr) {
      for (const cb of cbRows || []) {
        if (remaining <= 0) break;

        const outstanding = Number(cb.amount);
        if (outstanding <= 0) continue;

        const pay = Math.min(outstanding, remaining);
        remaining -= pay;

        // insert a payment row
        await supabase.from('chargeback_payments').insert({
          agent_id,
          chargeback_id: cb.id,
          amount: pay,
          run_id: batchId
        });

        // update chargeback status + remaining amount
        if (pay === outstanding) {
          await supabase
            .from('policy_chargebacks')
            .update({ status: 'paid', amount: 0 })
            .eq('id', cb.id);
        } else {
          await supabase
            .from('policy_chargebacks')
            .update({
              status: 'in_repayment',
              amount: outstanding - pay
            })
            .eq('id', cb.id);
        }
      }
    }
  }

  /* ------------------------------
     2. Apply lead debt repayments
     ------------------------------ */
  if (leadRepay > 0) {
    let remaining = leadRepay;

    const { data: ldRows, error: ldErr } = await supabase
      .from('lead_debts')
      .select('id, amount, status')
      .eq('agent_id', agent_id)
      .in('status', ['open', 'in_repayment'])
      .order('created_at', { ascending: true });

    if (!ldErr) {
      for (const ld of ldRows || []) {
        if (remaining <= 0) break;

        const outstanding = Number(ld.amount);
        if (outstanding <= 0) continue;

        const pay = Math.min(outstanding, remaining);
        remaining -= pay;

        // insert a payment row
        await supabase.from('lead_debt_payments').insert({
          lead_debt_id: ld.id,
          agent_id,
          amount: pay,
          run_id: batchId
        });

        // update lead debt status + remaining amount
        if (pay === outstanding) {
          await supabase
            .from('lead_debts')
            .update({ status: 'paid', amount: 0 })
            .eq('id', ld.id);
        } else {
          await supabase
            .from('lead_debts')
            .update({
              status: 'in_repayment',
              amount: outstanding - pay
            })
            .eq('id', ld.id);
        }
      }
    }
  }
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

    console.log('[runWeeklyAdvance] pay_date =', payDateStr, 'cutoff =', cutoffIso);

    // 2) Find all eligible ledger rows (advances + overrides not yet settled)
    const { data: ledgerRows, error: ledgerErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, entry_type, created_at, is_settled')
      .in('entry_type', ['advance', 'override'])
      // treat NULL as not settled too
      .or('is_settled.is.null,is_settled.eq.false')
      .lte('created_at', cutoffIso);

    if (ledgerErr) {
      console.error('[runWeeklyAdvance] Error loading ledger rows:', ledgerErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load ledger rows', details: ledgerErr }),
      };
    }

    console.log('[runWeeklyAdvance] eligible ledger rows =', ledgerRows.length);

    if (!ledgerRows || ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No eligible commission_ledger rows to pay for this advance run.',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
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
          message: 'No agents with eligible rows for this run (after grouping).',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
        }),
      };
    }

    // 4) Load each agent's current debt (lead + chargeback)
    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', agentIds);

    if (debtErr) {
      console.error('[runWeeklyAdvance] Error loading agent_total_debt:', debtErr);
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

    // 5) Build payout summary with capped repayment (30% max, but never more than outstanding)
    const payoutSummary = [];
    let totalGross  = 0;
    let totalDebits = 0;

    for (const [agent_id, t] of Object.entries(agentTotals)) {
      const gross = Number(t.gross.toFixed(2));
      totalGross += gross;

      const debtInfo = debtMap.get(agent_id) || { lead: 0, chargeback: 0, total: 0 };
      const totalDebt = debtInfo.total;

      let leadRepay = 0;
      let chargebackRepay = 0;
      let net = gross;

      if (gross > 0 && totalDebt > 0) {
        const rate       = getRepaymentRate(totalDebt);
        const maxRepay   = Number((gross * rate).toFixed(2));   // 30% of this check
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

    // 6) Create a payout batch row in payout_batches
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'advance',
        status: 'pending',
        total_gross: totalGross,
        total_debits: totalDebits,
        total_net: totalNet,
        note: 'Weekly advance run with 30% debt withholding (capped at outstanding)',
      })
      .select('*');

    if (batchErr) {
      console.error('[runWeeklyAdvance] Error inserting payout batch:', batchErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create payout batch', details: batchErr }),
      };
    }

    const batch = batchRows && batchRows[0];

    // 7) Mark all those ledger rows as settled + attach batch_id
    const ledgerIds = ledgerRows.map(r => r.id);

    const { error: updErr } = await supabase
      .from('commission_ledger')
      .update({
        is_settled: true,
        payout_batch_id: batch.id,
        period_start: cutoffIso,
        period_end: payDate.toISOString(),
      })
      .in('id', ledgerIds);

    if (updErr) {
      console.error('[runWeeklyAdvance] Error updating ledger rows:', updErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to mark ledger rows settled', details: updErr }),
      };
    }

    // 8) Apply repayments (chargebacks + leads) per agent based on what we calculated
    for (const ps of payoutSummary) {
      const cbRepay  = ps.chargeback_repayment || 0;
      const ldRepay  = ps.lead_repayment || 0;
      if (cbRepay > 0 || ldRepay > 0) {
        await applyRepayments(ps.agent_id, cbRepay, ldRepay, batch.id);
      }
    }

    // 9) Return a clean summary
    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Weekly advance run completed (with capped debt withholding + repayment records).',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
          batch_id: batch.id,
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
    console.error('[runWeeklyAdvance] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
