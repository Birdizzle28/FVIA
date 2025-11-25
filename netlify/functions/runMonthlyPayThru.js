// netlify/functions/runMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

// Use the same env vars as runWeeklyAdvance
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Get the pay_date for this monthly pay-thru run.
 * - If ?pay_date=YYYY-MM-DD is provided, use that.
 * - Otherwise, default to the LAST DAY of the current month.
 */
function getPayDate(event) {
  const qs = event.queryStringParameters || {};

  if (qs.pay_date) {
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  const today = new Date();
  // last day of this month
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return lastDay;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDate   = getPayDate(event);               // JS Date
    const payDateStr = payDate.toISOString().slice(0, 10); // YYYY-MM-DD

    // For monthly pay-thru, we’ll pay everything created up to the END of that day
    const cutoff = new Date(payDate);
    cutoff.setHours(23, 59, 59, 999);
    const cutoffIso = cutoff.toISOString();

    console.log('[runMonthlyPayThru] pay_date =', payDateStr, 'cutoff =', cutoffIso);

    // 1) Find all eligible pay-thru / renewal ledger rows
    const { data: ledgerRows, error: ledgerErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, entry_type, created_at')
      .in('entry_type', ['paythru', 'renewal'])
      .eq('is_settled', false)
      .lte('created_at', cutoffIso);

    if (ledgerErr) {
      console.error('[runMonthlyPayThru] Error loading ledger rows:', ledgerErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load ledger rows', details: ledgerErr }),
      };
    }

    if (!ledgerRows || ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No eligible pay-thru ledger rows to pay for this monthly run.',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
        }),
      };
    }

    // 2) Group by agent_id → totals
    const agentTotals = {}; // { agent_id: { paythru: x, gross: x } }

    for (const row of ledgerRows) {
      const aid = row.agent_id;
      if (!agentTotals[aid]) {
        agentTotals[aid] = { paythru: 0, gross: 0 };
      }
      const amt = Number(row.amount || 0);
      agentTotals[aid].paythru += amt;
      agentTotals[aid].gross   += amt;
    }

    // 3) Option B: right now, NO automatic debt/chargeback withholding.
    //    Net = Gross. Later we’ll subtract lead_debts + chargebacks here.
    const payoutSummary = Object.entries(agentTotals).map(([agent_id, t]) => {
      const gross = t.gross;
      const net   = gross; // TODO later: net = gross - leadRepayment - chargebackRepayment

      return {
        agent_id,
        paythru_gross: Number(t.paythru.toFixed(2)),
        gross_payout:  Number(gross.toFixed(2)),
        net_payout:    Number(net.toFixed(2)),
        lead_repayment: 0,
        chargeback_repayment: 0,
      };
    });

    // 4) Create a payout batch in payout_batches
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date:   payDateStr,
        batch_type: 'paythru',
        // status default = 'pending'
        // totals default = 0 for now; we’ll wire real totals later
        note: 'Monthly pay-thru run',
      })
      .select('*');

    if (batchErr) {
      console.error('[runMonthlyPayThru] Error inserting payout batch:', batchErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create payout batch', details: batchErr }),
      };
    }

    const batch = batchRows && batchRows[0];

    // 5) Mark all those ledger rows as settled + attach batch_id
    const ledgerIds = ledgerRows.map(r => r.id);

    const { error: updErr } = await supabase
      .from('commission_ledger')
      .update({
        is_settled: true,
        payout_batch_id: batch.id,
        period_start: null,                 // you can set a "month start" later if you want
        period_end: payDate.toISOString(),  // end of the pay-thru period
      })
      .in('id', ledgerIds);

    if (updErr) {
      console.error('[runMonthlyPayThru] Error updating ledger rows:', updErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to mark ledger rows settled', details: updErr }),
      };
    }

    // 6) Return summary so you can eyeball it in the tester
    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Monthly pay-thru run completed.',
          pay_date: payDateStr,
          cutoff_date: cutoffIso,
          batch_id: batch.id,
          agent_payouts: payoutSummary,
          ledger_row_count: ledgerRows.length,
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error('[runMonthlyPayThru] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
