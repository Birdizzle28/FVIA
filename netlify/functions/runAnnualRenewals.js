// netlify/functions/runAnnualRenewals.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runAnnualRenewals] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Helper: get run_date.
 * - Uses ?run_date=YYYY-MM-DD if provided (for testing)
 * - Otherwise: today
 */
function getRunDate(event) {
  const qs = event.queryStringParameters || {};
  if (qs.run_date) {
    const d = new Date(qs.run_date);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

/**
 * Helper: round to 2 decimals
 */
function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

/**
 * Compute policy year as of runDate.
 * Year 1 = from issue date up to, but not including, first anniversary.
 * Year 2 = after 1 full year, etc.
 */
function getPolicyYear(policyCreatedAt, runDate) {
  const start = new Date(policyCreatedAt);
  if (isNaN(start.getTime())) return null;

  let years = runDate.getFullYear() - start.getFullYear();
  const annivThisYear = new Date(
    runDate.getFullYear(),
    start.getMonth(),
    start.getDate()
  );

  if (runDate < annivThisYear) {
    years -= 1;
  }

  const policyYear = years + 1; // year count starting at 1
  return policyYear < 1 ? 1 : policyYear;
}

/**
 * Get the base renewal rate for THIS agent level + THIS renewalYear.
 * Prefers renewal_trail_rule JSON bands; falls back to
 * renewal_commission_rate + start/end years.
 */
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

  // 1) JSON bands (preferred)
  if (rule && Array.isArray(rule.bands)) {
    for (const band of rule.bands) {
      // if band.start_year is missing, fall back to schedule.renewal_start_year or 2
      const start = band.start_year ?? (schedule.renewal_start_year ?? 2);
      const end   = band.end_year; // null = open-ended

      const withinLower = renewalYear >= start;
      const withinUpper = end == null ? true : renewalYear <= end;

      if (withinLower && withinUpper) {
        return Number(band.rate || 0);
      }
    }
    // bands exist but no match
    return 0;
  }

  // 2) Flat renewal_commission_rate with start/end year bounds
  const flatRate = Number(schedule.renewal_commission_rate || 0);
  if (!flatRate) return 0;

  const startYear = schedule.renewal_start_year ?? 2; // you can set this to 1 in DB for P&C
  const endYear   = schedule.renewal_end_year;        // null = open-ended

  const withinLower = renewalYear >= startYear;
  const withinUpper = endYear == null ? true : renewalYear <= endYear;

  if (withinLower && withinUpper) {
    return flatRate;
  }

  return 0;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?run_date=YYYY-MM-DD',
    };
  }

  try {
    const runDate   = getRunDate(event);
    const runDateStr = runDate.toISOString().slice(0, 10);

    console.log('[runAnnualRenewals] run_date =', runDateStr);

    // -------------------------------------------------
    // 1) Load existing renewal rows so we don't double-pay a year
    //    Key: policy_id:agent_id:renewal_year
    // -------------------------------------------------
    const { data: priorRenewals, error: priorErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'renewal');

    if (priorErr) {
      console.error('[runAnnualRenewals] Error loading prior renewals:', priorErr);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to load prior renewals',
          details: priorErr,
        }),
      };
    }

    const alreadyPaid = new Set();
    (priorRenewals || []).forEach(row => {
      let yr = null;
      const m = row.meta || {};
      if (m.renewal_year != null) {
        yr = Number(m.renewal_year);
      } else if (m.policy_year != null) {
        yr = Number(m.policy_year);
      }
      if (row.policy_id && row.agent_id && yr) {
        alreadyPaid.add(`${row.policy_id}:${row.agent_id}:${yr}`);
      }
    });

    // -------------------------------------------------
    // 2) Load candidate policies (inforce, at least 1 year old)
    //    For now we assume policies.created_at is the issue date.
    // -------------------------------------------------
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select(
        'id, agent_id, carrier_name, product_line, policy_type, premium_annual, created_at'
      )
      .lte('created_at', runDate.toISOString()); // can't renew before it's written

    if (polErr) {
      console.error('[runAnnualRenewals] Error loading policies:', polErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load policies', details: polErr }),
      };
    }

    if (!policies || policies.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies found to evaluate for renewals.',
          run_date: runDateStr,
          renewals_created: 0,
        }),
      };
    }

    // -------------------------------------------------
    // 3) Caches for agents + schedules
    // -------------------------------------------------
    const agentCache = new Map(); // agent_id -> { id, full_name, level, recruiter_id }
    const schedCache = new Map(); // key -> full schedule row

    async function getAgent(agentId) {
      if (!agentId) return null;
      if (agentCache.has(agentId)) return agentCache.get(agentId);

      const { data, error } = await supabase
        .from('agents')
        .select('id, full_name, level, recruiter_id')
        .eq('id', agentId)
        .single();

      if (error || !data) {
        console.warn('[runAnnualRenewals] Missing agent record for id:', agentId, error);
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
        console.warn('[runAnnualRenewals] No schedule for', key, error);
        schedCache.set(key, null);
        return null;
      }

      schedCache.set(key, data);
      return data;
    }

    // -------------------------------------------------
    // 4) Build renewal ledger rows
    // -------------------------------------------------
    const newLedgerRows = [];
    let totalRenewalGross = 0;
    let policiesWithRenewals = 0;

    for (const policy of policies) {
      const ap = Number(policy.premium_annual || 0);
      if (!policy.agent_id || ap <= 0 || !policy.created_at) continue;

      const policyYear = getPolicyYear(policy.created_at, runDate);
      if (!policyYear || policyYear < 2) {
        // No renewals in year 1
        continue;
      }

      let anyForThisPolicy = false;

      // Build upline chain
      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();

      for (let depth = 0; depth < 10 && current; depth++) {
        if (visitedAgents.has(current.id)) break;
        visitedAgents.add(current.id);

        const level    = current.level || 'agent';
        const schedule = await getSchedule(policy, level);
        if (!schedule) break;

        chain.push({ agent: current, schedule });

        if (!current.recruiter_id) break;
        current = await getAgent(current.recruiter_id);
      }

      if (!chain.length) continue;

      // Stacked renewal rates
      let prevBaseRenewalRate = 0;

      for (const node of chain) {
        const baseRenewalRate = getBaseRenewalRate(node.schedule, policyYear);
        if (!baseRenewalRate || baseRenewalRate <= 0) continue;

        const effectiveRate = baseRenewalRate - prevBaseRenewalRate;
        prevBaseRenewalRate = baseRenewalRate;

        if (effectiveRate <= 0) continue;

        const key = `${policy.id}:${node.agent.id}:${policyYear}`;
        if (alreadyPaid.has(key)) {
          // This policy/agent/year already has a renewal row – skip
          continue;
        }

        const amount = round2(ap * effectiveRate);
        if (amount <= 0) continue;

        alreadyPaid.add(key);
        anyForThisPolicy = true;
        totalRenewalGross += amount;

        newLedgerRows.push({
          agent_id: node.agent.id,
          policy_id: policy.id,
          amount,
          currency: 'USD',
          entry_type: 'renewal',
          description: `Annual renewal (year ${policyYear}) on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type})`,
          is_settled: false,
          payout_batch_id: null,
          period_start: null,
          period_end: null,
          meta: {
            renewal_year: policyYear,
            policy_year: policyYear,
            carrier_name: policy.carrier_name,
            product_line: policy.product_line,
            policy_type: policy.policy_type,
            ap,
            base_renewal_rate_level: baseRenewalRate,
            effective_rate: effectiveRate,
          },
        });
      }

      if (anyForThisPolicy) {
        policiesWithRenewals += 1;
      }
    }

    // -------------------------------------------------
    // 5) Insert new rows
    // -------------------------------------------------
    if (newLedgerRows.length > 0) {
      const { error: insErr } = await supabase
        .from('commission_ledger')
        .insert(newLedgerRows);

      if (insErr) {
        console.error('[runAnnualRenewals] Error inserting renewal rows:', insErr);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: 'Failed to insert renewal rows',
            details: insErr,
          }),
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Annual renewals run completed.',
          run_date: runDateStr,
          renewals_created: newLedgerRows.length,
          policies_with_renewals: policiesWithRenewals,
          total_renewal_gross: round2(totalRenewalGross),
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error('[runAnnualRenewals] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
