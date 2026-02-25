// netlify/functions/runMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

function monthIndexUTC(d) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth(); // 0-based month
}

function getPayDate(event) {
  const qs = event.queryStringParameters || {};
  if (qs.pay_date) {
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) return d;
  }

  const today = new Date();
  const thisMonth5 = new Date(today.getFullYear(), today.getMonth(), 5);

  // if we already passed the 5th, default to NEXT month’s 5th
  if (today > thisMonth5) {
    return new Date(today.getFullYear(), today.getMonth() + 1, 5);
  }
  return thisMonth5;
}

function getMonthBounds(payDate) {
  const year  = payDate.getFullYear();
  const month = payDate.getMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end   = new Date(Date.UTC(year, month + 1, 1)); // EXCLUSIVE
  return { start, end };
}

function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) return 1.0;
  if (totalDebt <= 0) return 0;
  if (totalDebt < 1000) return 0.30;
  if (totalDebt < 2000) return 0.40;
  return 0.50;
}

/* ---------------------------
   TIME / TERM HELPERS
   --------------------------- */

function getPolicyYear(policyIssuedAt, asOfDate) {
  const start = new Date(policyIssuedAt);
  if (isNaN(start.getTime())) return null;

  let years = asOfDate.getFullYear() - start.getFullYear();
  const annivThisYear = new Date(
    asOfDate.getFullYear(),
    start.getMonth(),
    start.getDate()
  );

  if (asOfDate < annivThisYear) {
    years -= 1;
  }

  const policyYear = years + 1;
  return policyYear < 1 ? 1 : policyYear;
}

function getTermNumberByMonths(policyIssuedAt, payMonthStartUTC, termLengthMonths) {
  const issuedAt = new Date(policyIssuedAt);
  if (isNaN(issuedAt.getTime())) return null;

  const issuedMonth = monthIndexUTC(issuedAt);
  const payMonth    = monthIndexUTC(payMonthStartUTC);

  const monthsElapsed = payMonth - issuedMonth;
  if (monthsElapsed < 0) return 1;

  const termLen = Number(termLengthMonths || 0);
  if (termLen <= 0) return 1;

  // term 1 = months 0..termLen-1, term 2 = termLen..2*termLen-1, etc.
  return Math.floor(monthsElapsed / termLen) + 1;
}

/* ---------------------------
   RENEWAL/TRAIL RATE HELPERS
   --------------------------- */

function getBaseRenewalRate(schedule, renewalIndex) {
  // NOTE: "renewalIndex" means:
  // - If term_length_months is NULL (12-month world): policyYear (2+)
  // - If term_length_months is set (term world): termNumber (2+)
  if (!renewalIndex || renewalIndex < 1) return 0;

  let rule = schedule.renewal_trail_rule;
  if (rule && typeof rule === 'string') {
    try {
      rule = JSON.parse(rule);
    } catch {
      rule = null;
    }
  }

  if (rule && Array.isArray(rule.bands)) {
    for (const band of rule.bands) {
      const start = band.start_year ?? (schedule.renewal_start_year ?? 2);
      const end   = band.end_year;
      const withinLower = renewalIndex >= start;
      const withinUpper = end == null ? true : renewalIndex <= end;
      if (withinLower && withinUpper) {
        return Number(band.rate || 0);
      }
    }
    return 0;
  }

  const flatRate = Number(schedule.renewal_commission_rate || 0);
  if (!flatRate) return 0;

  const startIdx = schedule.renewal_start_year ?? 2;
  const endIdx   = schedule.renewal_end_year;
  const withinLower = renewalIndex >= startIdx;
  const withinUpper = endIdx == null ? true : renewalIndex <= endIdx;
  if (withinLower && withinUpper) return flatRate;

  return 0;
}

/* ---------------------------
   PREMIUM BASIS HELPERS
   --------------------------- */

// Returns premium for ONE term (not annual), then monthly payout spreads over term months.
// For 12-month world, term premium == annual premium.
function resolveTermPremium({ policy, termRow, termLengthMonths }) {
  const termLen = Number(termLengthMonths || 12);

  // 1) If policy_terms has term_premium, prefer it (this is the cleanest for term carriers)
  if (termRow) {
    const tp = Number(termRow.term_premium || 0);
    if (tp > 0) return tp;

    // If only annualized_premium exists, convert to term premium
    const ap = Number(termRow.annualized_premium || 0);
    if (ap > 0) return ap * (termLen / 12);
  }

  // 2) policies.premium_annual (annual) -> convert to term premium if termLen != 12
  const pa = Number(policy.premium_annual || 0);
  if (pa > 0) return pa * (termLen / 12);

  // 3) policies.premium_modal (monthly) -> term premium = modal * termLen
  const pm = Number(policy.premium_modal || 0);
  if (pm > 0) return pm * termLen;

  return 0;
}

/* ---------------------------
   DEBT REPAYMENTS
   --------------------------- */

async function applyRepayments(agent_id, chargebackRepay, leadRepay, payout_batch_id) {
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
          amount: pay,
          payout_batch_id
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
          amount: pay,
          payout_batch_id
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

/* ---------------------------
   MAIN HANDLER
   --------------------------- */

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDate     = getPayDate(event);
    const payDateStr  = payDate.toISOString().slice(0, 10);
    const payMonthKey = payDateStr.slice(0, 7);

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    // Build a map: policy_id -> most recent overlapping policy_terms row for THIS pay month
    async function loadMonthlyTermRowMap(policyIds) {
      if (!policyIds.length) return new Map();

      const monthStartYMD = monthStartIso.slice(0, 10);
      const monthEndYMD   = monthEndIso.slice(0, 10);

      const { data, error } = await supabase
        .from('policy_terms')
        .select('policy_id, term_premium, annualized_premium, term_months, term_start, term_end')
        .in('policy_id', policyIds)
        .lt('term_start', monthEndYMD)
        .or(`term_end.is.null,term_end.gte.${monthStartYMD}`)
        .order('term_start', { ascending: false });

      if (error) {
        console.warn('[runMonthlyPayThru] Could not load policy_terms; falling back to policy premiums', error);
        return new Map();
      }

      const map = new Map();
      for (const row of data || []) {
        const start = row.term_start;
        const end   = row.term_end;

        const overlaps = start < monthEndYMD && (end == null || end >= monthStartYMD);
        if (!overlaps) continue;

        if (!map.has(row.policy_id)) map.set(row.policy_id, row);
      }
      return map;
    }

    // ✅ 28-day wait based on ISSUED_AT
    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffIso = cutoff.toISOString();

    console.log(
      '[runMonthlyPayThru] pay_date =',
      payDateStr,
      'pay_month =',
      payMonthKey,
      'cutoff(issued_at) =',
      cutoffIso
    );

    // Prevent duplicates for this pay_month
    const { data: existingPayThru, error: existingErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru')
      .eq('meta->>pay_month', payMonthKey);

    if (existingErr) {
      console.error('[runMonthlyPayThru] Error loading existing paythru rows:', existingErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load existing paythru rows', details: existingErr }) };
    }

    const alreadyPaidThisMonth = new Set();
    (existingPayThru || []).forEach(row => {
      const m = row.meta || {};
      const idx = m.cycle_index != null ? Number(m.cycle_index) : (m.policy_year != null ? Number(m.policy_year) : 1);
      if (row.policy_id && row.agent_id) {
        alreadyPaidThisMonth.add(`${row.policy_id}:${row.agent_id}:${idx}`);
      }
    });

    // Cap count per cycle per agent (cycle = policyYear or termNumber)
    const { data: payThruPrior, error: priorErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru');

    if (priorErr) {
      console.error('[runMonthlyPayThru] Error loading prior paythru rows:', priorErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load paythru counts', details: priorErr }) };
    }

    const payThruCountMap = new Map();
    (payThruPrior || []).forEach(row => {
      const m = row.meta || {};
      const idx = m.cycle_index != null ? Number(m.cycle_index) : (m.policy_year != null ? Number(m.policy_year) : 1);
      const key = `${row.policy_id}:${row.agent_id}:${idx}`;
      payThruCountMap.set(key, (payThruCountMap.get(key) || 0) + 1);
    });

    // Load eligible policies by issued_at cutoff
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, premium_modal, issued_at, as_earned, status')
      .in('status', ['issued', 'in_force'])
      .not('issued_at', 'is', null)
      .lte('issued_at', cutoffIso);

    if (polErr) {
      console.error('[runMonthlyPayThru] Error loading policies:', polErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load policies', details: polErr }) };
    }

    if (!policies || policies.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies eligible for monthly pay-thru (28-day wait after issued_at) this run.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
        }),
      };
    }

    const termRowMap = await loadMonthlyTermRowMap(policies.map(p => p.id));

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
        .select(
          'base_commission_rate, advance_rate, renewal_commission_rate, ' +
          'renewal_start_year, renewal_end_year, renewal_trail_rule, term_length_months'
        )
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

    const newLedgerRows = [];

    for (const policy of policies) {
      if (!policy.agent_id) continue;
      if (!policy.issued_at) continue;

      const policyAsEarned = policy.as_earned === true;

      // Build chain (and capture writing-agent schedule first)
      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();

      let globalAdvanceRate = null;
      let writingTermLenMonths = 12;

      for (let depth = 0; depth < 10 && current; depth++) {
        if (visitedAgents.has(current.id)) break;
        visitedAgents.add(current.id);

        const level    = current.level || 'agent';
        const schedule = await getSchedule(policy, level);
        if (!schedule) break;

        const baseRate = Number(schedule.base_commission_rate || 0);
        const advRate  = Number(schedule.advance_rate || 0);

        if (depth === 0) {
          const t = schedule.term_length_months;
          writingTermLenMonths = (t == null ? 12 : Number(t || 12));
          if (!writingTermLenMonths || writingTermLenMonths <= 0) writingTermLenMonths = 12;
        }

        if (globalAdvanceRate == null) {
          globalAdvanceRate = policyAsEarned ? 0 : advRate;
        }

        chain.push({
          agent: current,
          schedule,
          baseRate
        });

        if (!current.recruiter_id) break;
        current = await getAgent(current.recruiter_id);
      }

      if (!chain.length || globalAdvanceRate == null) continue;

      // Determine time index:
      // - 12-month world => policyYear
      // - term world => termNumber
      const isTermWorld = writingTermLenMonths !== 12;

      const cycleIndex = isTermWorld
        ? getTermNumberByMonths(policy.issued_at, monthStart, writingTermLenMonths)
        : getPolicyYear(policy.issued_at, payDate);

      if (!cycleIndex) continue;

      // Term premium basis (one term)
      const termRow = termRowMap.get(policy.id) || null;
      const termPremium = resolveTermPremium({
        policy,
        termRow,
        termLengthMonths: writingTermLenMonths
      });

      if (termPremium <= 0) continue;

      // months in this cycle for monthly spreading
      const cycleMonths = isTermWorld ? writingTermLenMonths : 12;

      let prevBaseRate = 0;
      let prevBaseRenewalRate = 0;

      for (const node of chain) {
        let effectiveRate = 0;
        let phase = 'trail';

        if (cycleIndex === 1) {
          const levelBaseRate = node.baseRate;
          effectiveRate = levelBaseRate - prevBaseRate;
          prevBaseRate = levelBaseRate;
          phase = 'trail';
        } else {
          const baseRenewalRate = getBaseRenewalRate(node.schedule, cycleIndex);
          if (!baseRenewalRate || baseRenewalRate <= 0) continue;
          effectiveRate = baseRenewalRate - prevBaseRenewalRate;
          prevBaseRenewalRate = baseRenewalRate;
          phase = 'renewal';
        }

        if (effectiveRate <= 0) continue;

        const key = `${policy.id}:${node.agent.id}:${cycleIndex}`;

        // Already paid this month for this policy/agent/cycle
        if (alreadyPaidThisMonth.has(key)) continue;

        const priorCount = payThruCountMap.get(key) || 0;

        // Cap: you can only create up to cycleMonths ledger rows per cycle
        if (priorCount >= cycleMonths) continue;

        // Advance logic ONLY applies in 12-month world (life-style advance months)
        let monthsAdvanced = 0;
        if (!isTermWorld && cycleIndex === 1) {
          monthsAdvanced = policyAsEarned ? 0 : Math.floor((globalAdvanceRate || 0) * 12);

          // Delay start until advanced months are "earned back"
          const issuedAt = new Date(policy.issued_at);
          const issuedMonth = monthIndexUTC(issuedAt);
          const payMonth = monthIndexUTC(monthStart);
          const monthsElapsed = payMonth - issuedMonth;

          if (monthsElapsed < monthsAdvanced) continue;
        }

        // Commission for ONE term (or one year in 12-month world)
        const cycleCommission = termPremium * effectiveRate;

        // Monthly spread:
        // - term world: spread over 6 months (or whatever term_length_months is)
        // - 12-month world:
        //   - normal: spread over 12
        //   - if monthsAdvanced: compress remaining payout into remaining months (your “compressed paythru”)
        const divisorMonths = (!isTermWorld && cycleIndex === 1)
          ? Math.max(1, 12 - monthsAdvanced)
          : cycleMonths;

        const monthlyRaw = cycleCommission / divisorMonths;
        const monthly = Math.round(monthlyRaw * 100) / 100;
        if (monthly <= 0) continue;

        payThruCountMap.set(key, priorCount + 1);

        newLedgerRows.push({
          agent_id: node.agent.id,
          policy_id: policy.id,
          amount: monthly,
          currency: 'USD',
          entry_type: 'paythru',
          description:
            phase === 'trail'
              ? `Monthly pay-thru (cycle 1) on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type}) for ${payMonthKey}`
              : `Monthly renewal pay-thru (cycle ${cycleIndex}) on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type}) for ${payMonthKey}`,
          period_start: monthStartIso,
          period_end: monthEndIso,
          is_settled: false,
          payout_batch_id: null,
          meta: {
            pay_month: payMonthKey,
            cycle_index: cycleIndex,        // ✅ unified index (policyYear OR termNumber)
            phase,
            carrier_name: policy.carrier_name,
            product_line: policy.product_line,
            policy_type: policy.policy_type,
            term_length_months: writingTermLenMonths,
            term_premium_used: termPremium,
            rate_portion: effectiveRate,
            as_earned: policyAsEarned,
            advance_rate_applied: globalAdvanceRate,
            months_advanced: monthsAdvanced,
            divisor_months: divisorMonths,
            issued_at: policy.issued_at
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
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to insert new paythru rows', details: insErr }) };
      }
    }

    // Now select unpaid paythru rows through this pay month and apply $100 threshold
    const { data: unpaidTrails, error: unpaidErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount')
      .eq('entry_type', 'paythru')
      .eq('is_settled', false)
      .lte('meta->>pay_month', payMonthKey);

    if (unpaidErr) {
      console.error('[runMonthlyPayThru] Error loading unpaid paythru:', unpaidErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load unpaid paythru', details: unpaidErr }) };
    }

    if (!unpaidTrails || unpaidTrails.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No unpaid paythru rows to consider for $100 threshold (all caught up).',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_rows_created: newLedgerRows.length,
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
    const basePayableAgents = [];

    for (const [aid, sum] of Object.entries(agentTotals)) {
      if (sum >= threshold) {
        basePayableAgents.push({ agent_id: aid, gross_monthly_trail: Number(sum.toFixed(2)) });
      }
    }

    if (basePayableAgents.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Paythru accrued, but no agent reached the $100 minimum yet.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_rows_created: newLedgerRows.length,
          agents_paid: 0,
        }),
      };
    }

    const payableAgentIds = basePayableAgents.map(a => a.agent_id);

    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', payableAgentIds);

    if (debtErr) {
      console.error('[runMonthlyPayThru] Error loading agent_total_debt:', debtErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agent_total_debt', details: debtErr }) };
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
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agent active flags', details: agentErr }) };
    }

    const activeMap = new Map();
    (agentRows || []).forEach(a => activeMap.set(a.id, a.is_active !== false));

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

        if (debtInfo.chargeback > 0 && remaining > 0) {
          chargebackRepay = Math.min(remaining, debtInfo.chargeback);
          remaining -= chargebackRepay;
        }

        if (debtInfo.lead > 0 && remaining > 0) {
          leadRepay = Math.min(remaining, debtInfo.lead);
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

    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'paythru',
        status: 'pending',
        total_gross: batchTotalGross,
        total_debits: batchTotalDebits,
        total_net: batchTotalNet,
        note: `Monthly pay-thru run for ${payMonthKey} (threshold $${threshold}, debt tiers 30/40/50)`,
      })
      .select('*');

    if (batchErr) {
      console.error('[runMonthlyPayThru] Error creating payout batch:', batchErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create payout batch', details: batchErr }) };
    }

    const batch = batchRows && batchRows[0];

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
        period_start: monthStartIso,
        period_end: monthEndIso,
      })
      .in('id', idsToSettle);

    if (updErr) {
      console.error('[runMonthlyPayThru] Error settling paythru rows:', updErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to mark paythru rows settled', details: updErr }) };
    }

    for (const fp of finalPayouts) {
      const cbRepay = fp.chargeback_repayment || 0;
      const ldRepay = fp.lead_repayment || 0;
      if (cbRepay > 0 || ldRepay > 0) {
        await applyRepayments(fp.agent_id, cbRepay, ldRepay, batch.id);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          message: 'Monthly pay-thru run completed.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_rows_created: newLedgerRows.length,
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
    };
  } catch (err) {
    console.error('[runMonthlyPayThru] Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected error', details: String(err) }) };
  }
}
