// netlify/functions/runMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Helper: get pay_date.
 * - Uses ?pay_date=YYYY-MM-DD if provided (for testing)
 * - Otherwise: 5th of *current* month
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
  // JS months 0-11
  return new Date(today.getFullYear(), today.getMonth(), 5);
}

/**
 * Helper: first + last day of the pay_date's month
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
    const payDate    = getPayDate(event);
    const payDateStr = payDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const payMonthKey = payDateStr.slice(0, 7);            // YYYY-MM

    // Month bounds (not strictly required for math, but nice for metadata)
    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    // 28-day wait: only pay trails for policies created_at <= pay_date - 28 days
    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffIso = cutoff.toISOString();

    console.log('[runMonthlyPayThru] pay_date =', payDateStr, 'pay_month =', payMonthKey, 'cutoff =', cutoffIso);

    // -------------------------------------------------
    // 1) Already-paid this month (so we don't double-pay)
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

    const alreadyPaidThisMonth = new Set(
      (existingPayThru || []).map(r => `${r.policy_id}:${r.agent_id}`)
    );

    // -------------------------------------------------
    // 2) Count how many pay-thru payments already exist
    //    per (policy_id, agent_id) to enforce 12-month cap
    // -------------------------------------------------
    const { data: payThruCounts, error: countErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, count(*)')
      .eq('entry_type', 'paythru')
      .group('policy_id, agent_id');

    if (countErr) {
      console.error('[runMonthlyPayThru] Error loading paythru counts:', countErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load paythru counts', details: countErr }),
      };
    }

    const payThruCountMap = new Map();
    (payThruCounts || []).forEach(row => {
      const key = `${row.policy_id}:${row.agent_id}`;
      // supabase returns count as string sometimes
      payThruCountMap.set(key, Number(row.count) || 0);
    });

    // -------------------------------------------------
    // 3) Load candidate policies for trails
    // -------------------------------------------------
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, created_at')
      .lte('created_at', cutoffIso); // 28-day wait

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
          message: 'No policies eligible for monthly trails (28-day wait) this run.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
        }),
      };
    }

    // -------------------------------------------------
    // 4) Small caches so we don't spam Supabase
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
    // 5) Build NEW pay-thru ledger rows (multi-level)
    //    For each policy:
    //      - build chain: writing → recruiter → recruiter → ...
    //      - get base_rate for each level
    //      - global advance_rate = writing agent's advance_rate
    //      - effective_rate for each level:
    //            writing: baseRateWriting
    //            direct upline: baseRateUpline - baseRateWriting
    //            next upline:   baseRateAreaMgr - baseRateUpline
    //      - monthly trail = (AP * effective_rate * (1 - advance_rate)) / 12
    //      - enforce:
    //           * not already paid this month
    //           * total paythru rows < 12 for that (policy, agent)
    // -------------------------------------------------
    const newLedgerRows = [];
    let totalNewGross = 0;

    for (const policy of policies) {
      const ap = Number(policy.premium_annual || 0);
      if (!policy.agent_id || ap <= 0) continue;

      // Build the chain
      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();
      let globalAdvanceRate = null; // from writing agent

      // Limit depth to avoid crazy loops
      for (let depth = 0; depth < 10 && current; depth++) {
        if (visitedAgents.has(current.id)) break;
        visitedAgents.add(current.id);

        const level = current.level || 'agent';
        const schedule = await getSchedule(policy, level);
        if (!schedule) break;

        const baseRate = Number(schedule.base_commission_rate) || 0;
        const advRate  = Number(schedule.advance_rate) || 0;

        if (globalAdvanceRate == null) {
          // Use writing agent's advance rate as your global advance%
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

      // For each level in chain, compute its effective portion & residual
      let prevBaseRate = 0;

      for (const node of chain) {
        const effectiveRate = node.baseRate - prevBaseRate;
        prevBaseRate = node.baseRate;

        if (effectiveRate <= 0) continue;

        // Check 12-month cap & "already paid this month"
        const policyAgentKey = `${policy.id}:${node.agent.id}`;

        // Already paid this month?
        if (alreadyPaidThisMonth.has(policyAgentKey)) {
          continue;
        }

        // Existing paythru count (all months)
        const priorCount = payThruCountMap.get(policyAgentKey) || 0;
        if (priorCount >= 12) {
          continue;
        }

        // Compute monthly residual using your formula:
        //   monthly trail = (AP * effective_rate * (1 - advance_rate)) / 12
        const annualResidual = ap * effectiveRate * (1 - globalAdvanceRate);
        const monthlyResidualRaw = annualResidual / 12;
        const monthlyResidual = Math.round(monthlyResidualRaw * 100) / 100;

        if (monthlyResidual <= 0) continue;

        // We're about to add one more month for this policy/agent
        payThruCountMap.set(policyAgentKey, priorCount + 1);

        totalNewGross += monthlyResidual;

        newLedgerRows.push({
          agent_id: node.agent.id,
          policy_id: policy.id,
          amount: monthlyResidual,
          currency: 'USD',
          entry_type: 'paythru',
          description: `Monthly trail on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type}) for ${payMonthKey}`,
          period_start: monthStartIso,
          period_end: monthEndIso,
          is_settled: false,         // <-- NEW rows start as *unpaid* accrual
          payout_batch_id: null,     // will be filled when threshold is met
          meta: {
            pay_month: payMonthKey,
            carrier_name: policy.carrier_name,
            product_line: policy.product_line,
            policy_type: policy.policy_type,
            ap,
            base_rate_portion: effectiveRate,
          }
        });
      }
    }

    // If we didn't generate any new residuals, we still might have prior accruals
    // to check against the $100 threshold. So no early return here.

    // -------------------------------------------------
    // 6) Insert NEW accrual rows (if any)
    // -------------------------------------------------
    if (newLedgerRows.length > 0) {
      const { error: insErr } = await supabase
        .from('commission_ledger')
        .insert(newLedgerRows);

      if (insErr) {
        console.error('[runMonthlyPayThru] Error inserting new paythru rows:', insErr);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to insert new paythru rows', details: insErr }),
        };
      }
    }

    // -------------------------------------------------
    // 7) $100 THRESHOLD LOGIC
    //
    // At this point, all monthly trails (new + older months that never
    // cleared $100) sit in commission_ledger as:
    //   entry_type = 'paythru'
    //   is_settled = false
    //
    // We:
    //   - load all unsettled paythru rows
    //   - group by agent
    //   - if an agent's total >= 100, we pay them NOW:
    //       * create a payout_batches row
    //       * mark their rows is_settled = true, set payout_batch_id
    //   - if < 100, we leave rows as-is (they roll forward to future months)
    // -------------------------------------------------
    const { data: unpaidTrails, error: unpaidErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount')
      .eq('entry_type', 'paythru')
      .eq('is_settled', false);

    if (unpaidErr) {
      console.error('[runMonthlyPayThru] Error loading unpaid trails:', unpaidErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load unpaid trails', details: unpaidErr }),
      };
    }

    if (!unpaidTrails || unpaidTrails.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No unpaid trails to consider for $100 threshold (all caught up).',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_trails_created: newLedgerRows.length,
          agents_paid: 0,
        }),
      };
    }

    // Group unpaid trails per agent
    const agentTotals = {};   // agent_id -> total amount
    const agentRowIds = {};   // agent_id -> [rowIds]

    for (const row of unpaidTrails) {
      const aid = row.agent_id;
      const amt = Number(row.amount || 0);
      if (!agentTotals[aid]) {
        agentTotals[aid] = 0;
        agentRowIds[aid] = [];
      }
      agentTotals[aid] += amt;
      agentRowIds[aid].push(row.id);
    }

    // Determine which agents meet the $100 minimum
    const threshold = 100;
    const payableAgents = [];
    let batchTotalGross = 0;

    for (const [aid, sum] of Object.entries(agentTotals)) {
      if (sum >= threshold) {
        payableAgents.push({
          agent_id: aid,
          amount: Number(sum.toFixed(2))
        });
        batchTotalGross += sum;
      }
    }

    if (payableAgents.length === 0) {
      // No one crossed $100 yet; everything stays as accrual
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Monthly trails accrued, but no agent reached the $100 minimum yet.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_trails_created: newLedgerRows.length,
          agents_paid: 0,
        }),
      };
    }

    batchTotalGross = Number(batchTotalGross.toFixed(2));

    // -------------------------------------------------
    // 8) Create a payout_batches row
    // -------------------------------------------------
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'paythru',
        status: 'pending',          // flip to 'paid' after Stripe etc.
        total_gross: batchTotalGross,
        total_debits: 0,
        total_net: batchTotalGross,
        note: `Monthly pay-thru payout run for ${payMonthKey} (threshold $${threshold})`,
      })
      .select('*');

    if (batchErr) {
      console.error('[runMonthlyPayThru] Error creating payout batch:', batchErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to create payout batch', details: batchErr }),
      };
    }

    const batch = batchRows && batchRows[0];

    // Collect all ledger row IDs that should be marked as paid
    const idsToSettle = [];
    for (const pa of payableAgents) {
      const rowsForAgent = agentRowIds[pa.agent_id] || [];
      rowsForAgent.forEach(id => idsToSettle.push(id));
    }

    // -------------------------------------------------
    // 9) Mark those pay-thru rows as settled + attach batch
    // -------------------------------------------------
    const { error: updErr } = await supabase
      .from('commission_ledger')
      .update({
        is_settled: true,
        payout_batch_id: batch.id,
        period_end: payDate.toISOString(),
      })
      .in('id', idsToSettle);

    if (updErr) {
      console.error('[runMonthlyPayThru] Error settling paythru rows:', updErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to mark paythru rows settled', details: updErr }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Monthly pay-thru run completed with $100 minimum threshold.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_trails_created: newLedgerRows.length,
          batch_id: batch.id,
          agents_paid: payableAgents.length,
          agent_payouts: payableAgents,
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
