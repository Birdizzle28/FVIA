// netlify/functions/runMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceKey);

/* -----------------------------------------
   1) PAY DATE = 5th OF THE MONTH
   ----------------------------------------- */
function getPayDate(event) {
  const qs = event.queryStringParameters || {};

  // Allow manual override for testing
  if (qs.pay_date) {
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) return d;
  }

  const today = new Date();
  let y = today.getFullYear();
  let m = today.getMonth(); // 0-11

  // If today is past the 5th → next month
  if (today.getDate() > 5) {
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }

  return new Date(y, m, 5);
}

/* -----------------------------------------
   2) GET FIRST + LAST DAY OF PAY MONTH
   ----------------------------------------- */
function getMonthBounds(payDate) {
  const y = payDate.getFullYear();
  const m = payDate.getMonth();

  return {
    start: new Date(y, m, 1),
    end:   new Date(y, m + 1, 0)
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  try {
    /* -----------------------------------------
       CALCULATE PAY DATE + PAY MONTH
       ----------------------------------------- */
    const payDate = getPayDate(event);
    const payDateStr = payDate.toISOString().slice(0,10);
    const payMonthKey = payDateStr.slice(0,7);

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    /* -----------------------------------------
       3) 28-DAY RULE
       ----------------------------------------- */
    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffIso = cutoff.toISOString();

    /* -----------------------------------------
       4) PREVENT DOUBLE-PAY FOR THIS MONTH
       ----------------------------------------- */
    const { data: existingPay, error: exErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id')
      .eq('entry_type', 'paythru')
      .eq('meta->>pay_month', payMonthKey);

    if (exErr) {
      console.error(exErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed loading existing' }) };
    }

    const alreadyPaid = new Set(
      (existingPay || []).map(r => `${r.policy_id}:${r.agent_id}`)
    );

    /* -----------------------------------------
       5) LOAD POLICY COMMISSIONS
          (we never do trails from raw policies)
       ----------------------------------------- */
    const { data: pcRows, error: pcErr } = await supabase
      .from('policy_commissions')
      .select('id, policy_id, agent_id, ap, base_commission_rate, advance_rate, created_at')
      .lte('created_at', cutoffIso);

    if (pcErr) {
      console.error(pcErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed loading policy_commissions' }) };
    }

    if (!pcRows.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policy_commissions older than 28 days',
          pay_date: payDateStr
        })
      };
    }

    /* -----------------------------------------
       6) ENFORCE 12-MONTH CAP PER POLICY
       ----------------------------------------- */
    async function countPayThru(policy_id) {
      const { count, error } = await supabase
        .from('commission_ledger')
        .select('id', { count: 'exact', head: true })
        .eq('entry_type', 'paythru')
        .eq('policy_id', policy_id);

      if (error) return 999; // treat as full to avoid mistakes
      return count ?? 0;
    }

    /* -----------------------------------------
       7) BUILD PAYTHRU ROWS
       ----------------------------------------- */
    const ledgerRows = [];
    const totals = {}; // agent totals

    for (const pc of pcRows) {
      const paidCount = await countPayThru(pc.policy_id);
      if (paidCount >= 12) continue;   // STOP after 12 payments

      const ap = Number(pc.ap || 0);
      const base = Number(pc.base_commission_rate || 0);
      const adv = Number(pc.advance_rate || 0);

      if (ap <= 0 || base <= 0) continue;

      /* -----------------------------------------
         YOUR FORMULA:
         ((1 - adv%) * (ap * base%)) / 12
         ----------------------------------------- */
      const annualResidual = ap * base * (1 - adv);
      const monthlyResidual = Math.round((annualResidual / 12) * 100) / 100;
      if (monthlyResidual <= 0) continue;

      const key = `${pc.policy_id}:${pc.agent_id}`;
      if (alreadyPaid.has(key)) continue;

      ledgerRows.push({
        agent_id: pc.agent_id,
        policy_id: pc.policy_id,
        amount: monthlyResidual,
        currency: 'USD',
        entry_type: 'paythru',
        description: `Monthly trail for ${payMonthKey}`,
        period_start: monthStartIso,
        period_end: monthEndIso,
        is_settled: true,
        payout_batch_id: null,
        meta: {
          pay_month: payMonthKey,
          ap,
          base_commission_rate: base,
          advance_rate: adv
        }
      });

      totals[pc.agent_id] = (totals[pc.agent_id] || 0) + monthlyResidual;
    }

    if (!ledgerRows.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Nothing new to pay this month',
          pay_date: payDateStr
        })
      };
    }

    /* -----------------------------------------
       8) CREATE payout_batches ROW
       ----------------------------------------- */
    const totalGross = Object.values(totals)
      .reduce((s,v)=>s+v,0);

    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'paythru',
        status: 'pending',
        total_gross: totalGross,
        total_debits: 0,
        total_net: totalGross,
        note: `Monthly pay-thru ${payMonthKey}`
      })
      .select('*');

    if (batchErr) {
      console.error(batchErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed creating batch' }) };
    }

    const batch = batchRows[0];

    /* -----------------------------------------
       9) INSERT LEDGER ROWS WITH BATCH ID
       ----------------------------------------- */
    const rowsToInsert = ledgerRows.map(r => ({
      ...r,
      payout_batch_id: batch.id
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('commission_ledger')
      .insert(rowsToInsert)
      .select('*');

    if (insErr) {
      console.error(insErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed inserting ledger' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Monthly pay-thru completed.',
        pay_date: payDateStr,
        pay_month: payMonthKey,
        batch_id: batch.id,
        agent_payouts: totals,
        ledger_row_count: inserted.length
      }, null, 2),
      headers: { 'Content-Type': 'application/json' }
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected error', details: err.toString() }) };
  }
}
