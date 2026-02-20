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

/* ---------------------------
   MATCH runMonthlyPayThru
   --------------------------- */

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

// month start/end are UTC, end is EXCLUSIVE
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
   PAY-THRU / RENEWAL HELPERS
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

  if (asOfDate < annivThisYear) years -= 1;

  const policyYear = years + 1;
  return policyYear < 1 ? 1 : policyYear;
}

function getBaseRenewalRate(schedule, renewalYear) {
  if (!renewalYear || renewalYear < 1) return 0;

  let rule = schedule.renewal_trail_rule;
  if (rule && typeof rule === 'string') {
    try { rule = JSON.parse(rule); } catch { rule = null; }
  }

  if (rule && Array.isArray(rule.bands)) {
    for (const band of rule.bands) {
      const start = band.start_year ?? (schedule.renewal_start_year ?? 2);
      const end   = band.end_year;
      const withinLower = renewalYear >= start;
      const withinUpper = end == null ? true : renewalYear <= end;
      if (withinLower && withinUpper) return Number(band.rate || 0);
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

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    // Identify caller (viewer)
    const token = getBearerToken(event);
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization Bearer token' }) };
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session token' }) };
    }

    const viewerId = userData.user.id;

    const payDate     = getPayDate(event);
    const payDateStr  = payDate.toISOString().slice(0, 10);
    const payMonthKey = payDateStr.slice(0, 7);

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    // 28-day wait based on issued_at
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

    // Caches
    const agentCache = new Map();
    const schedCache = new Map();

    async function getAgent(agentId) {
      if (!agentId) return null;
      if (agentCache.has(agentId)) return agentCache.get(agentId);

      const { data, error } = await supabase
        .from('agents')
        .select('id, full_name, level, recruiter_id, is_active')
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

    // Already-paid this month (policy_year aware)
    const { data: existingPayThru, error: existingErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru')
      .eq('meta->>pay_month', payMonthKey);

    if (existingErr) {
      console.error('[previewMonthlyPayThru] Error loading existing paythru rows:', existingErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load existing paythru rows', details: existingErr }) };
    }

    const alreadyPaidThisMonth = new Set();
    (existingPayThru || []).forEach(row => {
      const m = row.meta || {};
      const py = m.policy_year != null ? Number(m.policy_year) : 1;
      if (row.policy_id && row.agent_id) {
        alreadyPaidThisMonth.add(`${row.policy_id}:${row.agent_id}:${py}`);
      }
    });

    // Prior paythru counts (policy_year aware)
    const { data: payThruPrior, error: priorErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru');

    if (priorErr) {
      console.error('[previewMonthlyPayThru] Error loading paythru counts:', priorErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load paythru counts', details: priorErr }) };
    }

    const payThruCountMap = new Map();
    (payThruPrior || []).forEach(row => {
      const m = row.meta || {};
      const py = m.policy_year != null ? Number(m.policy_year) : 1;
      const key = `${row.policy_id}:${row.agent_id}:${py}`;
      const prev = payThruCountMap.get(key) || 0;
      payThruCountMap.set(key, prev + 1);
    });

    // Eligible policies for THIS month run (viewer only)
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, issued_at, as_earned, status')
      .eq('agent_id', viewerId)
      .in('status', ['issued', 'in_force'])
      .not('issued_at', 'is', null)
      .lte('issued_at', cutoffIso);

    if (polErr) {
      console.error('[previewMonthlyPayThru] Error loading policies:', polErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load policies', details: polErr }) };
    }

    // Simulated NEW ledger rows (exact runMonthlyPayThru math)
    const newLedgerRows = [];
    let totalNewGross = 0;

    for (const policy of (policies || [])) {
      const ap = Number(policy.premium_annual || 0);
      if (!policy.agent_id || ap <= 0) continue;
      if (!policy.issued_at) continue;

      const policyYear = getPolicyYear(policy.issued_at, payDate);
      if (!policyYear) continue;

      const policyAsEarned = policy.as_earned === true;

      // Build upline chain (same as run)
      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();

      let globalAdvanceRate = null; // writing-agent advance_rate, forced to 0 if as_earned

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

        chain.push({ agent: current, schedule, baseRate });

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

        const key = `${policy.id}:${node.agent.id}:${policyYear}`;
        if (alreadyPaidThisMonth.has(key)) continue;

        const priorCount = payThruCountMap.get(key) || 0;

        // ✅ Match runMonthlyPayThru caps:
        let monthsAdvanced = 0;
        if (policyYear === 1) {
          monthsAdvanced = policyAsEarned ? 0 : Math.floor((globalAdvanceRate || 0) * 12);
          const remainingMonths = Math.max(0, 12 - monthsAdvanced);
          if (priorCount >= remainingMonths) continue;
        } else {
          if (priorCount >= 12) continue;
        }

        let annualAmount = 0;

        // ✅ Match runMonthlyPayThru NEW behavior:
        // delay year-1 paythru until advanced months are "earned back"
        if (policyYear === 1) {
          const issuedAt = new Date(policy.issued_at);
          const issuedMonth = monthIndexUTC(issuedAt);
          const payMonth = monthIndexUTC(monthStart);
          const monthsElapsed = payMonth - issuedMonth;

          if (monthsElapsed < monthsAdvanced) continue;

          annualAmount = ap * effectiveRate; // full monthly trail once it begins
        } else {
          annualAmount = ap * effectiveRate;
        }

        const monthly = round2(annualAmount / 12);
        if (monthly <= 0) continue;

        payThruCountMap.set(key, priorCount + 1);
        totalNewGross += monthly;

        newLedgerRows.push({
          agent_id: node.agent.id,
          policy_id: policy.id,
          amount: monthly,
          entry_type: 'paythru',
          phase,
          policy_year: policyYear,
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

    // Existing unpaid trails to consider for threshold (match run: <= payMonthKey, viewer only)
    const { data: unpaidExisting, error: unpaidErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount')
      .eq('entry_type', 'paythru')
      .eq('is_settled', false)
      .eq('agent_id', viewerId)
      .lte('meta->>pay_month', payMonthKey);

    if (unpaidErr) {
      console.error('[previewMonthlyPayThru] Error loading unpaid trails:', unpaidErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load unpaid trails', details: unpaidErr }) };
    }

    // Combine existing unpaid + simulated new for threshold calc
    let viewerGross = 0;
    for (const row of (unpaidExisting || [])) viewerGross += Number(row.amount || 0);
    for (const row of newLedgerRows) viewerGross += Number(row.amount || 0);
    viewerGross = round2(viewerGross);

    const threshold = 100;

    // If under threshold, no payout (matches run behavior)
    if (viewerGross < threshold) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Monthly trails/renewals accrued (including simulated new ones), but you did not reach the $100 minimum yet.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          cutoff: cutoffIso,
          new_paythru_rows_preview: newLedgerRows.length,
          total_new_paythru_gross_preview: round2(totalNewGross),
          gross_accrued_toward_threshold_preview: viewerGross,
          threshold,
          agents_paid_preview: 0,
        }, null, 2),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    // Debt tiers (viewer only)
    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .eq('agent_id', viewerId)
      .maybeSingle();

    if (debtErr) {
      console.error('[previewMonthlyPayThru] Error loading agent_total_debt:', debtErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agent_total_debt', details: debtErr }) };
    }

    const { data: viewerAgent, error: viewerAgentErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .eq('id', viewerId)
      .single();

    if (viewerAgentErr) {
      console.error('[previewMonthlyPayThru] Error loading viewer agent active flag:', viewerAgentErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agent active flags', details: viewerAgentErr }) };
    }

    const totalDebt = Number(debtRows?.total_debt || 0);
    const cbOutstanding = Number(debtRows?.chargeback_total || 0);
    const leadOutstanding = Number(debtRows?.lead_debt_total || 0);
    const isActive = viewerAgent?.is_active !== false;

    let leadRepay = 0;
    let chargebackRepay = 0;
    let net = viewerGross;

    if (viewerGross > 0 && totalDebt > 0) {
      const rate = getRepaymentRate(totalDebt, isActive);
      const maxRepay = round2(viewerGross * rate);
      const toRepay = Math.min(maxRepay, totalDebt);

      let remaining = toRepay;

      if (cbOutstanding > 0 && remaining > 0) {
        chargebackRepay = Math.min(remaining, cbOutstanding);
        remaining -= chargebackRepay;
      }
      if (leadOutstanding > 0 && remaining > 0) {
        leadRepay = Math.min(remaining, leadOutstanding);
        remaining -= leadRepay;
      }

      net = round2(viewerGross - (chargebackRepay + leadRepay));
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Monthly pay-thru PREVIEW equivalent to runMonthlyPayThru (viewer-only; no DB writes).',
        pay_date: payDateStr,
        pay_month: payMonthKey,
        cutoff: cutoffIso,
        threshold,
        new_paythru_rows_preview: newLedgerRows.length,
        total_new_paythru_gross_preview: round2(totalNewGross),
        gross_accrued_toward_threshold_preview: viewerGross,
        gross_monthly_trail_preview: viewerGross,
        net_payout_preview: net,
        lead_repayment_preview: round2(leadRepay),
        chargeback_repayment_preview: round2(chargebackRepay),
        details_preview: {
          existing_unpaid_rows_count: (unpaidExisting || []).length,
          simulated_new_rows: newLedgerRows, // keep or remove if too verbose
        }
      }, null, 2),
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
