// netlify/functions/runMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Helper: get the pay_date (end-of-month by default) or from ?pay_date=YYYY-MM-DD
 */
function getPayDate(event) {
  const qs = event.queryStringParameters || {};

  if (qs.pay_date) {
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  // Default: last day of the current month
  const today = new Date();
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return lastDay;
}

/**
 * Helper: first + last day of a month from a given pay_date.
 */
function getMonthBounds(payDate) {
  const year = payDate.getFullYear();
  const month = payDate.getMonth(); // 0-based

  const start = new Date(year, month, 1);
  const end   = new Date(year, month + 1, 0); // last day of month

  return { start, end };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDate = getPayDate(event);
    const payDateStr = payDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const payMonthKey = payDateStr.slice(0, 7);            // YYYY-MM

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    console.log('[runMonthlyPayThru] pay_date =', payDateStr, 'pay_month =', payMonthKey);

    // -------------------------------------------------
    // 1) Find any pay-thru rows already created for this month,
    //    so we don’t double-pay the same policy/agent twice.
    // -------------------------------------------------
    const { data: existingPayThru, error: existingErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru')
      .eq('meta->>pay_month', payMonthKey);

    if (existingErr) {
      console.error('[runMonthlyPayThru] Error loading existing paythru rows:', existingErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load existing paythru rows', details: existingErr }),
      };
    }

    const alreadyPaid = new Set(
      (existingPayThru || []).map(r => `${r.policy_id}:${r.agent_id}`)
    );

    // -------------------------------------------------
    // 2) Load candidate policies for trails.
    //    For now: any policy with premium_annual > 0 and agent_id set.
    //    We also enforce created_at <= end-of-month so we don’t pay trails
    //    on future policies.
    // -------------------------------------------------
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, created_at')
      .lte('created_at', monthEndIso);

    if (polErr) {
      console.error('[runMonthlyPayThru] Error loading policies:', polErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load policies', details: polErr }),
      };
    }

    if (!policies || policies.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies eligible for monthly pay-thru this run.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
        }),
      };
    }

    // -------------------------------------------------
    // 3) Small in-memory caches so we don’t spam Supabase
    //    for the same agent / schedule repeatedly
    // -------------------------------------------------
    const agentCache = new Map();    // agent_id -> { id, full_name, level, recruiter_id }
    const schedCache = new Map();    // key = carrier|product_line|policy_type|level -> { base_commission_rate, advance_rate }

    async function getAgent(agentId) {
      if (!agentId) return null;
      if (agentCache.has(agentId)) return agentCache.get(agentId);

      const { data, error } = await supabase
        .from('agents')
        .select('id, full_name, level, recruiter_id')
        .eq('id', agentId)
        .single();

      if (error || !data) {
        console.warn('[runMonthlyPayThru] Missing agent record for id:', agentId, error);
        agentCache.set(agentId, null);
        return null;
      }
      agentCache.set(agentId, data);
      return data;
    }

    async function getSchedule(policy, level) {
      const key = [
        policy.carrier_name || '',
        policy.product_line || '',
        policy.policy_type || '',
        level || 'agent',
      ].join('|');

      if (schedCache.has(key)) return schedCache.get(key);

      const { data, error } = await supabase
        .from('commission_schedules')
        .select('base_commission_rate, advance_rate')
        .eq('carrier_name', policy.carrier_name)
        .eq('product_line', policy.product_line)
        .eq('policy_type', policy.policy_type)
        .eq('agent_level', level || 'agent')
        .single();

      if (error || !data) {
        console.warn('[runMonthlyPayThru] No schedule for', key, error);
        schedCache.set(key, null);
        return null;
      }

      schedCache.set(key, data);
      return data;
    }

    // -------------------------------------------------
    // 4) Build pay-thru ledger rows:
    //    - Walk the agent->recruiter chain for each policy
    //    - Use your formula: monthly trail = (AP * effective_rate * (1 - advance_rate)) / 12
    //    - effective_rate is:
    //         writing: baseRateWriting
    //         direct upline: baseRateUpline - baseRateWriting
    //         next upline:   baseRateAreaManager - baseRateUpline
    //         ...
    // -------------------------------------------------
    const ledgerRows = [];
    let totalGross = 0;

    for (const policy of policies) {
      const ap = Number(policy.premium_annual || 0);
      if (!policy.agent_id || ap <= 0) continue;

      // 4a) Build the chain: writing agent → recruiter → recruiter → ...
      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();
      let globalAdvanceRate = null; // we’ll take it from the writing agent schedule

      // Limit to, say, 10 levels so a bad loop doesn’t lock everything
      for (let depth = 0; depth < 10 && current; depth++) {
        if (visitedAgents.has(current.id)) break;
        visitedAgents.add(current.id);

        const level = current.level || 'agent';
        const schedule = await getSchedule(policy, level);
        if (!schedule) break; // no schedule = can’t calc this level, stop chain

        const baseRate = Number(schedule.base_commission_rate) || 0;
        const advRate  = Number(schedule.advance_rate) || 0;

        if (globalAdvanceRate == null) {
          // Use the writing agent’s advance_rate as the overall advance %.
          globalAdvanceRate = advRate;
        }

        chain.push({
          agent: current,
          baseRate
        });

        if (!current.recruiter_id) break;
        current = await getAgent(current.recruiter_id);
      }

      if (!chain.length || globalAdvanceRate == null) continue;

      // 4b) For each level, compute effective_rate and monthly residual
      let prevBaseRate = 0;

      for (const node of chain) {
        const effectiveRate = node.baseRate - prevBaseRate;
        prevBaseRate = node.baseRate;

        if (effectiveRate <= 0) continue;

        // annual residual for this level
        const annualResidual = ap * effectiveRate * (1 - globalAdvanceRate);
        const monthlyResidualRaw = annualResidual / 12;
        const monthlyResidual = Math.round(monthlyResidualRaw * 100) / 100;

        if (monthlyResidual <= 0) continue;

        const key = `${policy.id}:${node.agent.id}`;
        if (alreadyPaid.has(key)) {
          // We’ve already created a pay-thru for this policy/agent for this month
          continue;
        }

        totalGross += monthlyResidual;

        ledgerRows.push({
          agent_id: node.agent.id,
          policy_id: policy.id,
          amount: monthlyResidual,
          currency: 'USD',
          entry_type: 'paythru',
          description: `Monthly trail on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type}) for ${payMonthKey}`,
          period_start: monthStartIso,
          period_end: monthEndIso,
          is_settled: true,         // we consider this run as PAYING them
          payout_batch_id: null,    // we’ll fill after we create batch
          meta: {
            pay_month: payMonthKey,
            carrier_name: policy.carrier_name,
            product_line: policy.product_line,
            policy_type: policy.policy_type,
            ap,
            base_rate_portion: effectiveRate
          }
        });
      }
    }

    if (!ledgerRows.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No new monthly trails to pay for this run (nothing eligible or already paid for this month).',
          pay_date: payDateStr,
          pay_month: payMonthKey,
        }),
      };
    }

    // -------------------------------------------------
    // 5) Aggregate per agent (so you can see what each person is getting)
    // -------------------------------------------------
    const agentTotals = {};
    for (const row of ledgerRows) {
      const aid = row.agent_id;
      if (!agentTotals[aid]) {
        agentTotals[aid] = 0;
      }
      agentTotals[aid] += row.amount;
    }

    const agentPayouts = Object.entries(agentTotals).map(([agent_id, amt]) => ({
      agent_id,
      monthly_trail: Number(amt.toFixed(2))
    }));

    totalGross = Number(totalGross.toFixed(2));

    // -------------------------------------------------
    // 6) Create a payout_batches row for this monthly pay-thru
    // -------------------------------------------------
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'paythru',
        status: 'pending',          // you can flip to 'sent' or 'paid' after Stripe payout
        total_gross: totalGross,
        total_debits: 0,
        total_net: totalGross,
        note: `Monthly pay-thru run for ${payMonthKey}`,
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

    // -------------------------------------------------
    // 7) Insert pay-thru ledger rows, tying them to the batch
    // -------------------------------------------------
    const rowsToInsert = ledgerRows.map(r => ({
      ...r,
      payout_batch_id: batch.id
    }));

    const { data: inserted, error: insErr } = await supabase
      .from('commission_ledger')
      .insert(rowsToInsert)
      .select('*');

    if (insErr) {
      console.error('[runMonthlyPayThru] Error inserting paythru ledger rows:', insErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to insert paythru ledger rows', details: insErr }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Monthly pay-thru run completed.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          batch_id: batch.id,
          agent_payouts: agentPayouts,
          ledger_row_count: inserted.length
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
