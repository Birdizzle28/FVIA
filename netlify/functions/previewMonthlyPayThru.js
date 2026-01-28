// netlify/functions/previewMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getBearerToken(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

if (!supabaseUrl || !serviceKey) {
  console.warn('[previewMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

function getPayDate(event) {
  const qs = event.queryStringParameters || {};
  if (qs.pay_date) {
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) return d;
  }
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 5);
}

// ✅ Match runMonthlyPayThru: month start/end are UTC, end is EXCLUSIVE
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

// -------- Helpers copied from runMonthlyPayThru (renewals) --------

// ✅ Now based on ISSUED_AT (not created_at)
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

function getBaseRenewalRate(schedule, renewalYear) {
  if (!renewalYear || renewalYear < 1) return 0;

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
      const withinLower = renewalYear >= start;
      const withinUpper = end == null ? true : renewalYear <= end;
      if (withinLower && withinUpper) {
        return Number(band.rate || 0);
      }
    }
    return 0;
  }

  const flatRate = Number(schedule.renewal_commission_rate || 0);
  if (!flatRate) return 0;

  const startYear = schedule.renewal_start_year ?? 2;
  const endYear   = schedule.renewal_end_year;
  const withinLower = renewalYear >= startYear;
  const withinUpper = endYear == null ? true : renewalYear <= endYear;
  if (withinLower && withinUpper) return flatRate;

  return 0;
}

// ----------------------------------------------------------------

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

    // ✅ Identify the caller so we only return THEIR per-policy preview
    const token = getBearerToken(event);
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization Bearer token' }) };
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session token' }) };
    }

    const viewerId = userData.user.id;

    let paythru_total_ever_by_policy = {};
    const agentCache = new Map();
    const schedCache = new Map();

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
          'renewal_start_year, renewal_end_year, renewal_trail_rule'
        )
        .eq('carrier_name', policy.carrier_name)
        .eq('product_line', policy.product_line)
        .eq('policy_type', policy.policy_type)
        .eq('agent_level', level || 'agent')
        .single();

      if (error || !data) {
        console.warn('[previewMonthlyPayThru] No schedule for', key, error);
        schedCache.set(key, null);
        return null;
      }

      schedCache.set(key, data);
      return data;
    }

    function round2(n) {
      return Math.round((Number(n) || 0) * 100) / 100;
    }

    // Load viewer level (so schedule lookup matches their level)
    const { data: viewerAgentRow, error: viewerAgentErr } = await supabase
      .from('agents')
      .select('id, level')
      .eq('id', viewerId)
      .single();

    if (viewerAgentErr) {
      console.warn('[previewMonthlyPayThru] Could not load viewer agent level, defaulting to agent:', viewerAgentErr);
    }

    const viewerLevel = viewerAgentRow?.level || 'agent';

    // ✅ Load ALL viewer policies for fixed totals (include as_earned)
    // We do NOT require issued_at here because "fixed totals ever" should still be safe;
    // but if issued_at is missing, we still can compute fixed totals from AP + schedule.
    const { data: viewerPoliciesAll, error: viewerPolErr } = await supabase
      .from('policies')
      .select('id, premium_annual, carrier_name, product_line, policy_type, as_earned')
      .eq('agent_id', viewerId);

    if (viewerPolErr) {
      console.error('[previewMonthlyPayThru] Error loading viewer policies for fixed paythru:', viewerPolErr);
    }

    // Compute fixed totals
    paythru_total_ever_by_policy = {};
    const paythru_monthly_fixed_by_policy = {};

    for (const p of (viewerPoliciesAll || [])) {
      const ap = Number(p.premium_annual || 0);
      if (!p.id || ap <= 0) {
        paythru_total_ever_by_policy[p?.id] = 0;
        paythru_monthly_fixed_by_policy[p?.id] = 0;
        continue;
      }

      const schedule = await getSchedule(p, viewerLevel);

      if (!schedule) {
        paythru_total_ever_by_policy[p.id] = 0;
        paythru_monthly_fixed_by_policy[p.id] = 0;
        continue;
      }

      const baseRate = Number(schedule.base_commission_rate || 0);
      const advRate  = Number(schedule.advance_rate || 0);

      // ✅ as_earned override: treat advance_rate as 0 for THIS policy
      const appliedAdvanceRate = (p.as_earned === true) ? 0 : advRate;

      // Fixed total pay-thru EVER for year 1 = AP * baseRate * (1 - advanceRateApplied)
      const totalEverRaw = ap * baseRate * (1 - appliedAdvanceRate);
      const monthly = round2(totalEverRaw / 12);
      const totalEver = round2(monthly * 12);

      paythru_monthly_fixed_by_policy[p.id] = monthly;
      paythru_total_ever_by_policy[p.id] = totalEver;
    }

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    // ✅ 28-day wait is based on ISSUED_AT (not created_at)
    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffIso = cutoff.toISOString();

    console.log(
      '[previewMonthlyPayThru] pay_date =',
      payDateStr,
      'pay_month =',
      payMonthKey,
      'cutoff(issued_at) =',
      cutoffIso
    );

    // A) Already-paid this month (YEAR-AWARE like runMonthlyPayThru)
    const { data: existingPayThru, error: existingErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru')
      .eq('meta->>pay_month', payMonthKey);

    if (existingErr) {
      console.error('[previewMonthlyPayThru] Error loading existing paythru rows:', existingErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load existing paythru rows', details: existingErr }),
      };
    }

    const alreadyPaidThisMonth = new Set();
    (existingPayThru || []).forEach(row => {
      const m = row.meta || {};
      const py = m.policy_year != null ? Number(m.policy_year) : 1;
      if (row.policy_id && row.agent_id) {
        alreadyPaidThisMonth.add(`${row.policy_id}:${row.agent_id}:${py}`);
      }
    });

    // B) Prior paythru count map (YEAR-AWARE like runMonthlyPayThru)
    const { data: payThruPrior, error: priorErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru');

    if (priorErr) {
      console.error('[previewMonthlyPayThru] Error loading paythru counts:', priorErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load paythru counts', details: priorErr }),
      };
    }

    const payThruCountMap = new Map();
    (payThruPrior || []).forEach(row => {
      const m = row.meta || {};
      const py = m.policy_year != null ? Number(m.policy_year) : 1;
      const key = `${row.policy_id}:${row.agent_id}:${py}`;
      const prev = payThruCountMap.get(key) || 0;
      payThruCountMap.set(key, prev + 1);
    });

    // ✅ Eligible policies for THIS month run: viewer only, issued_at cutoff, include as_earned
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, issued_at, as_earned, status')
      .eq('agent_id', viewerId)
      .in('status', ['issued', 'in_force'])
      .not('issued_at', 'is', null)
      .lte('issued_at', cutoffIso);

    if (polErr) {
      console.error('[previewMonthlyPayThru] Error loading policies:', polErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load policies', details: polErr }),
      };
    }

    if (!policies || policies.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies eligible for THIS MONTHLY RUN (28-day wait after issued_at), but lifetime paythru totals are included.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          paythru_by_policy_preview: paythru_total_ever_by_policy || {},
        }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    // D) Caches (same fields as runMonthlyPayThru)
    async function getAgent(agentId) {
      if (!agentId) return null;
      if (agentCache.has(agentId)) return agentCache.get(agentId);

      const { data, error } = await supabase
        .from('agents')
        .select('id, full_name, level, recruiter_id')
        .eq('id', agentId)
        .single();

      if (error || !data) {
        console.warn('[previewMonthlyPayThru] Missing agent record for id:', agentId, error);
        agentCache.set(agentId, null);
        return null;
      }
      agentCache.set(agentId, data);
      return data;
    }

    // E) Build simulated NEW ledger rows (trails + renewals) exactly like runMonthlyPayThru
    const newLedgerRows = [];
    let totalNewGross = 0;

    for (const policy of policies) {
      const ap = Number(policy.premium_annual || 0);
      if (!policy.agent_id || ap <= 0) continue;
      if (!policy.issued_at) continue;

      const policyYear = getPolicyYear(policy.issued_at, payDate);
      if (!policyYear) continue;

      const policyAsEarned = policy.as_earned === true;

      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();

      // globalAdvanceRate is writing-agent schedule advance_rate normally,
      // but if policy is as-earned, force it to 0.
      let globalAdvanceRate = null;

      for (let depth = 0; depth < 10 && current; depth++) {
        if (visitedAgents.has(current.id)) break;
        visitedAgents.add(current.id);

        const level    = current.level || 'agent';
        const schedule = await getSchedule(policy, level);
        if (!schedule) break;

        const baseRate = Number(schedule.base_commission_rate || 0);
        const advRate  = Number(schedule.advance_rate || 0);

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

      let prevBaseRate = 0;
      let prevBaseRenewalRate = 0;

      for (const node of chain) {
        let effectiveRate = 0;
        let phase = 'trail';

        if (policyYear === 1) {
          const levelBaseRate = node.baseRate;
          effectiveRate = levelBaseRate - prevBaseRate;
          prevBaseRate = levelBaseRate;
          phase = 'trail';
        } else {
          const baseRenewalRate = getBaseRenewalRate(node.schedule, policyYear);
          if (!baseRenewalRate || baseRenewalRate <= 0) continue;
          effectiveRate = baseRenewalRate - prevBaseRenewalRate;
          prevBaseRenewalRate = baseRenewalRate;
          phase = 'renewal';
        }

        if (effectiveRate <= 0) continue;

        const policyAgentYearKey = `${policy.id}:${node.agent.id}:${policyYear}`;

        if (alreadyPaidThisMonth.has(policyAgentYearKey)) continue;

        const priorCount = payThruCountMap.get(policyAgentYearKey) || 0;
        if (priorCount >= 12) continue;

        let annualAmount = 0;

        // Year 1 trails reduced by (1 - advance_rate) normally.
        // If as-earned, globalAdvanceRate is forced to 0 -> no reduction.
        if (policyYear === 1) {
          annualAmount = ap * effectiveRate * (1 - globalAdvanceRate);
        } else {
          annualAmount = ap * effectiveRate;
        }

        const monthlyRaw = annualAmount / 12;
        const monthly = Math.round(monthlyRaw * 100) / 100;
        if (monthly <= 0) continue;

        payThruCountMap.set(policyAgentYearKey, priorCount + 1);
        totalNewGross += monthly;

        newLedgerRows.push({
          agent_id: node.agent.id,
          policy_id: policy.id,
          amount: monthly,
          currency: 'USD',
          entry_type: 'paythru',
          description:
            phase === 'trail'
              ? `Monthly trail on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type}) for ${payMonthKey}`
              : `Monthly renewal (year ${policyYear}) on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type}) for ${payMonthKey}`,
          period_start: monthStartIso,
          period_end: monthEndIso,
          is_settled: false,
          payout_batch_id: null,
          meta: {
            pay_month: payMonthKey,
            policy_year: policyYear,
            phase,
            carrier_name: policy.carrier_name,
            product_line: policy.product_line,
            policy_type: policy.policy_type,
            ap,
            rate_portion: effectiveRate,
            as_earned: policyAsEarned,
            advance_rate_applied: globalAdvanceRate,
            issued_at: policy.issued_at
          }
        });
      }
    }

    // F) Threshold + debt logic (preview mode)
    const { data: unpaidTrailsExisting, error: unpaidErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, policy_id, amount')
      .eq('entry_type', 'paythru')
      .eq('is_settled', false);

    if (unpaidErr) {
      console.error('[previewMonthlyPayThru] Error loading unpaid trails:', unpaidErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load unpaid trails', details: unpaidErr }),
      };
    }

    const allUnpaidTrails = [];
    (unpaidTrailsExisting || []).forEach(row => {
      allUnpaidTrails.push({
        agent_id: row.agent_id,
        policy_id: row.policy_id,
        amount: Number(row.amount || 0),
        source: 'existing',
      });
    });
    newLedgerRows.forEach(row => {
      allUnpaidTrails.push({
        agent_id: row.agent_id,
        policy_id: row.policy_id,
        amount: Number(row.amount || 0),
        source: 'simulated',
      });
    });

    if (allUnpaidTrails.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No unpaid trails/renewals to consider for $100 threshold (all caught up).',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_trails_created_preview: newLedgerRows.length,
          total_new_trails_gross_preview: Number(totalNewGross.toFixed(2)),
          agents_paid_preview: 0,
          paythru_by_policy_preview: paythru_total_ever_by_policy,
        }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    const agentTotals = {};
    for (const row of allUnpaidTrails) {
      const aid = row.agent_id;
      const amt = Number(row.amount || 0);
      if (!agentTotals[aid]) agentTotals[aid] = 0;
      agentTotals[aid] += amt;
    }

    const threshold = 100;
    const basePayableAgents = [];
    for (const [aid, sum] of Object.entries(agentTotals)) {
      if (sum >= threshold) {
        basePayableAgents.push({
          agent_id: aid,
          gross_monthly_trail: Number(sum.toFixed(2)),
        });
      }
    }

    if (basePayableAgents.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Monthly trails/renewals accrued (including new ones), but no agent reached the $100 minimum yet.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_trails_created_preview: newLedgerRows.length,
          total_new_trails_gross_preview: Number(totalNewGross.toFixed(2)),
          agents_paid_preview: 0,
          paythru_by_policy_preview: paythru_total_ever_by_policy,
        }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    const payableAgentIds = basePayableAgents.map(a => a.agent_id);

    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', payableAgentIds);

    if (debtErr) {
      console.error('[previewMonthlyPayThru] Error loading agent_total_debt:', debtErr);
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
      console.error('[previewMonthlyPayThru] Error loading agents.is_active:', agentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent active flags', details: agentErr }),
      };
    }

    const activeMap = new Map();
    (agentRows || []).forEach(a => {
      activeMap.set(a.id, a.is_active !== false);
    });

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

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Monthly pay-thru PREVIEW with $100 minimum + tiered debt withholding (trails + renewals; no DB changes).',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          cutoff: cutoffIso,
          new_paythru_rows_preview: newLedgerRows.length,
          total_new_paythru_gross_preview: Number(totalNewGross.toFixed(2)),
          agents_paid_preview: finalPayouts.length,
          total_gross_preview: batchTotalGross,
          total_debits_preview: batchTotalDebits,
          total_net_preview: batchTotalNet,
          agent_payouts_preview: finalPayouts,
          paythru_by_policy_preview: paythru_total_ever_by_policy,
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error('[previewMonthlyPayThru] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
