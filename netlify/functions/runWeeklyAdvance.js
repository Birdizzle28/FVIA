// netlify/functions/runWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runWeeklyAdvance] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

// Helper: get the pay_date (Friday) either from query param or "next Friday from today"
function getPayDate(event) {
  const qs = event.queryStringParameters || {};

  if (qs.pay_date) {
    // Allow override like ?pay_date=2025-12-05 for testing
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  // Default: today → next Friday (or today if already Friday)
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 5=Fri
  let diff = (5 - day + 7) % 7;
  if (diff === 0) diff = 7; // always "upcoming" Friday, not today
  const nextFriday = new Date(today);
  nextFriday.setDate(today.getDate() + diff);
  return nextFriday;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDate = getPayDate(event); // a JS Date object
    const payDateStr = payDate.toISOString().slice(0, 10); // YYYY-MM-DD

    // 1) Compute cutoff date = pay_date - 14 days
    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 14);
    const cutoffIso = cutoff.toISOString();

    console.log('[runWeeklyAdvance] pay_date =', payDateStr, 'cutoff =', cutoffIso);

    // 2) Find all eligible ledger rows
    const { data: ledgerRows, error: ledgerErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, entry_type, created_at')
      .in('entry_type', ['advance', 'override'])
      .eq('is_settled', false)
      .lte('created_at', cutoffIso);

    if (ledgerErr) {
      console.error('[runWeeklyAdvance] Error loading ledger rows:', ledgerErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load ledger rows', details: ledgerErr }),
      };
    }

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

    // 4) (Option B skeleton) – for now, no automatic debt/chargeback withholding.
    //    Net = Gross. Later we’ll adjust here to subtract lead_debts and chargebacks.
    const payoutSummary = Object.entries(agentTotals).map(([agent_id, t]) => {
      const gross = t.gross;
      const net = gross; // TODO later: net = gross - leadRepayment - chargebackRepayment

      return {
        agent_id,
        advance_gross: Number(t.advance.toFixed(2)),
        override_gross: Number(t.override.toFixed(2)),
        gross_payout: Number(gross.toFixed(2)),
        net_payout: Number(net.toFixed(2)),
        lead_repayment: 0,
        chargeback_repayment: 0,
      };
    });

    // 5) Create a payout batch row
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'advance',
        note: 'Weekly advance run',
        meta: {
          cutoff_date: cutoffIso,
          agent_count: payoutSummary.length,
          ledger_row_count: ledgerRows.length,
        },
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

    // 6) Mark all those ledger rows as settled + attach batch_id
    const ledgerIds = ledgerRows.map(r => r.id);

    const { error: updErr } = await supabase
      .from('commission_ledger')
      .update({
        is_settled: true,
        payout_batch_id: batch.id,
        period_start: cutoffIso,     // optional: mark statement period
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

    // 7) Return a clean summary for you to eyeball
    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Weekly advance run completed.',
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
    console.error('[runWeeklyAdvance] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
