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

/**
 * Same tiers as weekly:
 *   - if agent inactive => 100% of this check (up to remaining debt)
 *   - if active:
 *        < 1000         => 30%
 *        1000–1999.99   => 40%
 *        >= 2000        => 50%
 */
function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) return 1.0;
  if (totalDebt <= 0) return 0;
  if (totalDebt < 1000) return 0.30;
  if (totalDebt < 2000) return 0.40;
  return 0.50;
}

/**
 * Apply repayments to chargebacks + lead_debts, oldest first.
 * NOTE: same pattern as in runWeeklyAdvance, no run_id set for now.
 */
async function applyRepayments(agent_id, chargebackRepay, leadRepay) {
  // 1) Chargebacks first
  if (chargebackRepay > 0) {
    let remaining = chargebackRepay;

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

        await supabase.from('chargeback_payments').insert({
          agent_id,
          chargeback_id: cb.id,
          amount: pay
        });

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

  // 2) Leads second
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

        await supabase.from('lead_debt_payments').insert({
          lead_debt_id: ld.id,
          agent_id,
          amount: pay
        });

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
    const payDate     = getPayDate(event);
    const payDateStr  = payDate.toISOString().slice(0, 10); // YYYY-MM-DD
    const payMonthKey = payDateStr.slice(0, 7);             // YYYY-MM

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    // 28-day wait: only pay trails for policies created_at <= pay_date - 28 days
    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffIso = cutoff.toISOString();

    console.log(
      '[runMonthlyPayThru] pay_date =',
      payDateStr,
      'pay_month =',
      payMonthKey,
      'cutoff =',
      cutoffIso
    );

    // 1) Already-paid this month
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

    // 2) Count prior paythru per policy/agent (for 12-month cap)
    const { data: payThruPrior, error: priorErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id')
      .eq('entry_type', 'paythru');

    if (priorErr) {
      console.error('[runMonthlyPayThru] Error loading prior paythru rows:', priorErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load paythru counts', details: priorErr }),
      };
    }

    const payThruCountMap = new Map();
    (payThruPrior || []).forEach(row => {
      const key = `${row.policy_id}:${row.agent_id}`;
      const prev = payThruCountMap.get(key) || 0;
      payThruCountMap.set(key, prev + 1);
    });

    // 3) Eligible policies
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, created_at')
      .lte('created_at', cutoffIso);

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

    // 4) Caches
    const agentCache = new Map();
    const schedCache = new Map();

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

    // 5) Build NEW pay-thru accrual rows
    const newLedgerRows = [];
    let totalNewGross = 0;

    for (const policy of policies) {
      const ap = Number(policy.premium_annual || 0);
      if (!policy.agent_id || ap <= 0) continue;

      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();
      let globalAdvanceRate = null;

      for (let depth = 0; depth < 10 && current; depth++) {
        if (visitedAgents.has(current.id)) break;
        visitedAgents.add(current.id);

        const level    = current.level || 'agent';
        const schedule = await getSchedule(policy, level);
        if (!schedule) break;

        const baseRate = Number(schedule.base_commission_rate) || 0;
        const advRate  = Number(schedule.advance_rate) || 0;

        if (globalAdvanceRate == null) {
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

      let prevBaseRate = 0;

      for (const node of chain) {
        const effectiveRate = node.baseRate - prevBaseRate;
        prevBaseRate = node.baseRate;

        if (effectiveRate <= 0) continue;

        const policyAgentKey = `${policy.id}:${node.agent.id}`;

        if (alreadyPaidThisMonth.has(policyAgentKey)) continue;

        const priorCount = payThruCountMap.get(policyAgentKey) || 0;
        if (priorCount >= 12) continue;

        const annualResidual      = ap * effectiveRate * (1 - globalAdvanceRate);
        const monthlyResidualRaw  = annualResidual / 12;
        const monthlyResidual     = Math.round(monthlyResidualRaw * 100) / 100;

        if (monthlyResidual <= 0) continue;

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
          is_settled: false,
          payout_batch_id: null,
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

    // 7) Threshold + debt logic
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

    const agentTotals = {};
    const agentRowIds = {};

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

    const threshold = 100;
    const basePayableAgents = []; // before debt withholding

    for (const [aid, sum] of Object.entries(agentTotals)) {
      if (sum >= threshold) {
        const rounded = Number(sum.toFixed(2));
        basePayableAgents.push({
          agent_id: aid,
          gross_monthly_trail: rounded,
        });
      }
    }

    if (basePayableAgents.length === 0) {
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

    // 8) Load debts + is_active
    const payableAgentIds = basePayableAgents.map(a => a.agent_id);

    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', payableAgentIds);

    if (debtErr) {
      console.error('[runMonthlyPayThru] Error loading agent_total_debt:', debtErr);
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

    const { data: agentRows, error: agentErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .in('id', payableAgentIds);

    if (agentErr) {
      console.error('[runMonthlyPayThru] Error loading agents.is_active:', agentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent active flags', details: agentErr }),
      };
    }

    const activeMap = new Map();
    (agentRows || []).forEach(a => {
      activeMap.set(a.id, a.is_active !== false);
    });

    // 9) Apply tiers to these monthly trails
    const finalPayouts = [];
    let batchTotalGross = 0;
    let batchTotalDebits = 0;

    for (const pa of basePayableAgents) {
      const agent_id = pa.agent_id;
      const gross    = Number(pa.gross_monthly_trail.toFixed(2));
      batchTotalGross += gross;

      const debtInfo = debtMap.get(agent_id) || { lead: 0, chargeback: 0, total: 0 };
      const totalDebt = debtInfo.total;
      const isActive  = activeMap.has(agent_id) ? activeMap.get(agent_id) : true;

      let leadRepay = 0;
      let chargebackRepay = 0;
      let net = gross;

      if (gross > 0 && totalDebt > 0) {
        const rate     = getRepaymentRate(totalDebt, isActive);
        const maxRepay = Number((gross * rate).toFixed(2));
        const toRepay  = Math.min(maxRepay, totalDebt);

        let remaining = toRepay;

        const cbOutstanding = debtInfo.chargeback;
        if (cbOutstanding > 0 && remaining > 0) {
          chargebackRepay = Math.min(remaining, cbOutstanding);
          remaining -= chargebackRepay;
        }

        const leadOutstanding = debtInfo.lead;
        if (leadOutstanding > 0 && remaining > 0) {
          leadRepay = Math.min(remaining, leadOutstanding);
          remaining -= leadRepay;
        }

        const actualRepay = chargebackRepay + leadRepay;
        net = Number((gross - actualRepay).toFixed(2));
        batchTotalDebits += actualRepay;
      }

      finalPayouts.push({
        agent_id,
        gross_monthly_trail: gross,
        net_payout: net,
        lead_repayment: Number(leadRepay.toFixed(2)),
        chargeback_repayment: Number(chargebackRepay.toFixed(2)),
      });
    }

    batchTotalGross  = Number(batchTotalGross.toFixed(2));
    batchTotalDebits = Number(batchTotalDebits.toFixed(2));
    const batchTotalNet = Number((batchTotalGross - batchTotalDebits).toFixed(2));

    // 10) Create payout_batches row
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'paythru',
        status: 'pending',
        total_gross: batchTotalGross,
        total_debits: batchTotalDebits,
        total_net: batchTotalNet,
        note: `Monthly pay-thru payout run for ${payMonthKey} (threshold $${threshold}, 30/40/50 tiers)`,
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

    // 11) Mark those pay-thru rows as settled + attach batch
    const idsToSettle = [];
    for (const pa of basePayableAgents) {
      const rowsForAgent = agentRowIds[pa.agent_id] || [];
      rowsForAgent.forEach(id => idsToSettle.push(id));
    }

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

    // 12) Apply repayments to debt tables
    for (const fp of finalPayouts) {
      const cbRepay = fp.chargeback_repayment || 0;
      const ldRepay = fp.lead_repayment || 0;
      if (cbRepay > 0 || ldRepay > 0) {
        await applyRepayments(fp.agent_id, cbRepay, ldRepay);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Monthly pay-thru run completed with $100 minimum + tiered debt withholding.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_trails_created: newLedgerRows.length,
          batch_id: batch.id,
          agents_paid: finalPayouts.length,
          total_gross: batchTotalGross,
          total_debits: batchTotalDebits,
          total_net: batchTotalNet,
          agent_payouts: finalPayouts,
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
