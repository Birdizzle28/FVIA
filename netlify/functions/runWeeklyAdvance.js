// netlify/functions/runWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runWeeklyAdvance] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

const PAY_TZ = 'America/Chicago';

/**
 * Helper: return YYYY-MM-DD in America/Chicago
 */
function getNextFridayYMD(fromYMD) {
  let cur = fromYMD;
  for (let i = 1; i <= 14; i++) {
    cur = addDaysYMD(cur, 1);
    const dow = getLocalDOW(new Date(`${cur}T12:00:00Z`), PAY_TZ);
    if (dow === 5) return cur;
  }
  return addDaysYMD(fromYMD, 7);
}

function computePayFridayForIssuedYMD(issuedYMD) {
  const dow = getLocalDOW(new Date(`${issuedYMD}T12:00:00Z`), PAY_TZ);

  const thisFriday = (dow === 5) ? issuedYMD : getNextFridayYMD(issuedYMD);

  if (dow <= 2) return addDaysYMD(thisFriday, 7);

  return addDaysYMD(thisFriday, 14);
}

function getLocalYMD(date = new Date(), tz = PAY_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/**
 * Helper: day-of-week number in America/Chicago (0=Sun .. 6=Sat)
 */
function getLocalDOW(date = new Date(), tz = PAY_TZ) {
  const dowStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(date);

  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dowStr] ?? date.getDay();
}

/**
 * Add days to a YYYY-MM-DD string and return YYYY-MM-DD
 */
function addDaysYMD(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Get numeric offset like "-06:00" or "-05:00" for a given date
 */
function getOffsetForYMD(ymd, tz = PAY_TZ) {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).format(probe);

  const match = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return '-06:00';

  const signHours = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;

  const sign = signHours < 0 ? '-' : '+';
  const absH = String(Math.abs(signHours)).padStart(2, '0');
  const absM = String(Math.abs(mins)).padStart(2, '0');
  return `${sign}${absH}:${absM}`;
}

/**
 * Convert local midnight to UTC ISO for Supabase comparisons.
 */
function localMidnightToUtcIso(ymd, tz = PAY_TZ) {
  const offset = getOffsetForYMD(ymd, tz);
  const local = new Date(`${ymd}T00:00:00${offset}`);
  return local.toISOString();
}

/**
 * Helper: get pay_date (Friday) as YYYY-MM-DD.
 */
function getPayDateStr(event) {
  const qs = event.queryStringParameters || {};
  if (qs.pay_date) {
    const d = new Date(`${qs.pay_date}T12:00:00Z`);
    if (!isNaN(d.getTime())) return qs.pay_date;
  }

  const now = new Date();
  const todayYMD = getLocalYMD(now, PAY_TZ);
  const dow = getLocalDOW(now, PAY_TZ);

  let diff = (5 - dow + 7) % 7;
  if (diff === 0) diff = 7;

  return addDaysYMD(todayYMD, diff);
}

/**
 * Repayment rate rules
 */
function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) return 1.0;
  if (totalDebt <= 0) return 0;
  if (totalDebt < 1000) return 0.30;
  if (totalDebt < 2000) return 0.40;
  return 0.50;
}

function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizePolicyType(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeState(v) {
  return String(v || '').trim().toUpperCase();
}

function normalizeLoaText(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLagWeeksForPolicy(policy, scheduleRows) {
  if (!policy || !policy.issued_at) return 0;

  const issuedYMD = getLocalYMD(new Date(policy.issued_at), PAY_TZ);

  const carrier = normalizeText(policy.carrier_name);
  const line = normalizeText(policy.product_line);
  const type = normalizePolicyType(policy.policy_type);

  const matches = (scheduleRows || []).filter(s => {
    const sameCarrier = normalizeText(s.carrier_name) === carrier;
    const sameLine = normalizeText(s.product_line) === line;

    const schedType = normalizePolicyType(s.policy_type);
    const sameType = schedType === type;

    const startsOk = !s.effective_from || s.effective_from <= issuedYMD;
    const endsOk = !s.effective_to || s.effective_to >= issuedYMD;

    return sameCarrier && sameLine && sameType && startsOk && endsOk;
  });

  if (!matches.length) return 0;

  matches.sort((a, b) => {
    const aDate = a.effective_from || '0000-00-00';
    const bDate = b.effective_from || '0000-00-00';
    return bDate.localeCompare(aDate);
  });

  const lag = Number(matches[0].lag_time_weeks || 0);
  return Number.isFinite(lag) && lag > 0 ? lag : 0;
}

function computePayFridayForIssuedYMDWithLag(issuedYMD, lagWeeks = 0) {
  const basePay = computePayFridayForIssuedYMD(issuedYMD);
  return addDaysYMD(basePay, lagWeeks * 7);
}

/**
 * NEW: find the exact commission schedule row for a policy as of issue date.
 * This is now also the source of truth for required_loas.
 */
function getMatchingScheduleForPolicy(policy, scheduleRows) {
  if (!policy || !policy.issued_at) return null;

  const issuedYMD = getLocalYMD(new Date(policy.issued_at), PAY_TZ);
  const carrier = normalizeText(policy.carrier_name);
  const line = normalizeText(policy.product_line);
  const type = normalizePolicyType(policy.policy_type);

  const matches = (scheduleRows || []).filter(s => {
    const sameCarrier = normalizeText(s.carrier_name) === carrier;
    const sameLine = normalizeText(s.product_line) === line;
    const sameType = normalizePolicyType(s.policy_type) === type;

    const startsOk = !s.effective_from || s.effective_from <= issuedYMD;
    const endsOk = !s.effective_to || s.effective_to >= issuedYMD;

    return sameCarrier && sameLine && sameType && startsOk && endsOk;
  });

  if (!matches.length) return null;

  matches.sort((a, b) => {
    const aDate = a.effective_from || '0000-00-00';
    const bDate = b.effective_from || '0000-00-00';
    return bDate.localeCompare(aDate);
  });

  return matches[0];
}

/**
 * NEW: Does this license row satisfy the policy at issue time?
 * Rule used here: agent must satisfy ALL required_loas.
 */
function licenseRowQualifiesForPolicy(licenseRow, state, requiredLoas, issueYMD) {
  if (!licenseRow) return false;
  if (licenseRow.active !== true) return false;

  const licState = normalizeState(licenseRow.state);
  if (!licState || licState !== normalizeState(state)) return false;

  if (licenseRow.date_issue_orig && issueYMD < licenseRow.date_issue_orig) return false;
  if (licenseRow.date_expire && issueYMD > licenseRow.date_expire) return false;

  if (!requiredLoas.length) return false;

  const loaNames = Array.isArray(licenseRow.loa_names) ? licenseRow.loa_names : [];
  const normalizedNames = loaNames.map(normalizeLoaText);

  return requiredLoas.every(req => {
    const target = normalizeLoaText(req);
    return normalizedNames.some(name =>
      name === target ||
      name.includes(target) ||
      target.includes(name)
    );
  });
}

/**
 * NEW: Determine whether an agent is eligible for override on this policy.
 * Uses commission_schedules.required_loas as the source of truth.
 */
function agentQualifiesForPolicy(agent, policy, policyState, scheduleRows, licensesByExternalAgentId) {
  if (!agent) return false;
  if (agent.is_active === false) return false;
  if (!policy?.issued_at) return false;
  if (!policyState) return false;

  const externalAgentId = agent.agent_id;
  if (!externalAgentId) return false;

  const schedule = getMatchingScheduleForPolicy(policy, scheduleRows);
  const requiredLoasRaw = Array.isArray(schedule?.required_loas) ? schedule.required_loas : [];
  const requiredLoas = requiredLoasRaw
    .map(normalizeLoaText)
    .filter(Boolean);

  if (!requiredLoas.length) return false;

  const issueYMD = getLocalYMD(new Date(policy.issued_at), PAY_TZ);
  const licenseRows = licensesByExternalAgentId.get(externalAgentId) || [];

  return licenseRows.some(row =>
    licenseRowQualifiesForPolicy(row, policyState, requiredLoas, issueYMD)
  );
}

/**
 * NEW: Walk up the chain starting from the CURRENT override recipient.
 * If they don't qualify, keep going up recruiter_id until someone does.
 */
function findNearestEligibleUplineFromAgent(startAgentId, policy, policyState, scheduleRows, agentsById, licensesByExternalAgentId) {
  const visited = new Set();
  let currentId = startAgentId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const currentAgent = agentsById.get(currentId);
    if (!currentAgent) return null;

    if (agentQualifiesForPolicy(currentAgent, policy, policyState, scheduleRows, licensesByExternalAgentId)) {
      return currentAgent.id;
    }

    currentId = currentAgent.recruiter_id || null;
  }

  return null;
}

/**
 * Record actual repayment events into DB
 */
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

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDateStr = getPayDateStr(event);

    const startYMD = addDaysYMD(payDateStr, -21);
    const endYMD   = addDaysYMD(payDateStr, 1);

    const startIso = localMidnightToUtcIso(startYMD, PAY_TZ);
    const endIso   = localMidnightToUtcIso(endYMD, PAY_TZ);

    console.log(
      '[runWeeklyAdvance] pay_date =',
      payDateStr,
      'ISSUED window =',
      startYMD,
      'to',
      endYMD,
      '(end exclusive)'
    );

    // Pull policies in window
    const { data: policyRows, error: polErr } = await supabase
      .from('policies')
      .select('id, as_earned, issued_at, carrier_name, product_line, policy_type, agent_id, contact_id')
      .in('status', ['issued', 'in_force'])
      .gte('issued_at', startIso)
      .lt('issued_at', endIso);

    if (polErr) {
      console.error('[runWeeklyAdvance] Error loading eligible policies:', polErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load eligible policies', details: polErr }),
      };
    }

    const carrierNames = [...new Set((policyRows || []).map(p => p.carrier_name).filter(Boolean))];

    let scheduleRows = [];
    if (carrierNames.length) {
      const { data: schedData, error: schedErr } = await supabase
        .from('commission_schedules')
        .select('carrier_name, product_line, policy_type, effective_from, effective_to, lag_time_weeks, required_loas')
        .in('carrier_name', carrierNames);

      if (schedErr) {
        console.error('[runWeeklyAdvance] Error loading commission schedules for lag lookup:', schedErr);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to load commission schedules', details: schedErr }),
        };
      }

      scheduleRows = schedData || [];
    }

    const allPolicyIds = (policyRows || []).map(p => p.id);
    if (allPolicyIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies eligible for weekly advances in this issued_at window.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: 0,
        }),
      };
    }

    const asEarnedCount = (policyRows || []).filter(p => p.as_earned === true).length;

    const duePolicyRows = (policyRows || [])
      .filter(p => p.as_earned !== true)
      .filter(p => {
        if (!p.issued_at) return false;

        const issuedYMD = getLocalYMD(new Date(p.issued_at), PAY_TZ);
        const lagWeeks = getLagWeeksForPolicy(p, scheduleRows);
        const computedPay = computePayFridayForIssuedYMDWithLag(issuedYMD, lagWeeks);

        return computedPay === payDateStr;
      });

    const eligiblePolicyIds = duePolicyRows.map(p => p.id);

    console.log(
      '[runWeeklyAdvance] scanned policies in window =',
      (policyRows || []).length,
      'as-earned excluded =',
      asEarnedCount,
      'due this pay_date =',
      eligiblePolicyIds.length,
      'schedules loaded =',
      scheduleRows.length
    );

    if (eligiblePolicyIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No non-as-earned policies are due to be paid on this pay_date based on the Sun–Tue / Wed–Sat rule.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          excluded_as_earned_policies: asEarnedCount,
          due_policies_for_pay_date: 0,
          scanned_policies_in_window: (policyRows || []).length,
        }),
      };
    }

    // Load ledger rows
    const { data: ledgerRowsRaw, error: ledgerErr } = await supabase
      .from('commission_ledger')
      .select('id, policy_id, agent_id, amount, entry_type, is_settled')
      .in('entry_type', ['advance', 'override'])
      .or('is_settled.is.null,is_settled.eq.false')
      .in('policy_id', eligiblePolicyIds);

    if (ledgerErr) {
      console.error('[runWeeklyAdvance] Error loading ledger rows:', ledgerErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load ledger rows', details: ledgerErr }),
      };
    }

    let ledgerRows = ledgerRowsRaw || [];
    console.log('[runWeeklyAdvance] eligible ledger rows (issued_at-based) =', ledgerRows.length);

    if (ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No eligible commission_ledger rows to pay for this advance run (issued_at-based).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: eligiblePolicyIds.length,
          excluded_as_earned_policies: asEarnedCount,
        }),
      };
    }

    // =========================
    // Override license / state / active validation
    // =========================

    const policyMap = new Map(duePolicyRows.map(p => [p.id, p]));

    const contactIds = [...new Set(duePolicyRows.map(p => p.contact_id).filter(Boolean))];
    let contactStateMap = new Map();

    if (contactIds.length) {
      const { data: contactRows, error: contactErr } = await supabase
        .from('contacts')
        .select('id, state')
        .in('id', contactIds);

      if (contactErr) {
        console.error('[runWeeklyAdvance] Error loading contact states for override validation:', contactErr);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: 'Failed to load contact states for override validation',
            details: contactErr
          }),
        };
      }

      contactStateMap = new Map((contactRows || []).map(c => [c.id, normalizeState(c.state)]));
    }

    const { data: allAgentRows, error: allAgentErr } = await supabase
      .from('agents')
      .select('id, agent_id, recruiter_id, is_active');

    if (allAgentErr) {
      console.error('[runWeeklyAdvance] Error loading agents for override validation:', allAgentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to load agents for override validation',
          details: allAgentErr
        }),
      };
    }

    const agentsById = new Map((allAgentRows || []).map(a => [a.id, a]));
    const externalAgentIds = [...new Set((allAgentRows || []).map(a => a.agent_id).filter(Boolean))];

    let licensesByExternalAgentId = new Map();
    if (externalAgentIds.length) {
      const { data: licenseRows, error: licenseErr } = await supabase
        .from('agent_nipr_licenses')
        .select('agent_id, state, active, date_issue_orig, date_expire, loa_names')
        .eq('active', true)
        .in('agent_id', externalAgentIds);

      if (licenseErr) {
        console.error('[runWeeklyAdvance] Error loading licenses for override validation:', licenseErr);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: 'Failed to load licenses for override validation',
            details: licenseErr
          }),
        };
      }

      licensesByExternalAgentId = new Map();
      for (const row of (licenseRows || [])) {
        const key = row.agent_id;
        if (!licensesByExternalAgentId.has(key)) licensesByExternalAgentId.set(key, []);
        licensesByExternalAgentId.get(key).push(row);
      }
    }

    const payableLedgerRows = [];
    const skippedOverrideRows = [];
    const reroutedOverrideRows = [];

    for (const row of ledgerRows) {
      if (row.entry_type !== 'override') {
        payableLedgerRows.push(row);
        continue;
      }

      const policy = policyMap.get(row.policy_id);
      if (!policy) {
        skippedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          reason: 'missing_policy_context'
        });
        continue;
      }

      const matchingSchedule = getMatchingScheduleForPolicy(policy, scheduleRows);
      const requiredLoas = Array.isArray(matchingSchedule?.required_loas)
        ? matchingSchedule.required_loas.filter(Boolean)
        : [];

      if (!matchingSchedule || !requiredLoas.length) {
        skippedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          original_agent_id: row.agent_id,
          reason: 'missing_schedule_or_required_loas'
        });
        continue;
      }

      const policyState = contactStateMap.get(policy.contact_id);
      if (!policyState) {
        skippedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          reason: 'missing_policy_state'
        });
        continue;
      }

      const resolvedAgentId = findNearestEligibleUplineFromAgent(
        row.agent_id,
        policy,
        policyState,
        scheduleRows,
        agentsById,
        licensesByExternalAgentId
      );

      if (!resolvedAgentId) {
        skippedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          original_agent_id: row.agent_id,
          required_loas: requiredLoas,
          reason: 'no_eligible_upline_found'
        });
        continue;
      }

      if (resolvedAgentId !== row.agent_id) {
        const { error: rerouteErr } = await supabase
          .from('commission_ledger')
          .update({ agent_id: resolvedAgentId })
          .eq('id', row.id);

        if (rerouteErr) {
          console.error('[runWeeklyAdvance] Error rerouting override row:', rerouteErr, 'ledger_id=', row.id);
          return {
            statusCode: 500,
            body: JSON.stringify({
              error: 'Failed to reroute override ledger row',
              details: rerouteErr,
              ledger_id: row.id
            }),
          };
        }

        reroutedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          from_agent_id: row.agent_id,
          to_agent_id: resolvedAgentId,
          required_loas: requiredLoas
        });

        row.agent_id = resolvedAgentId;
      }

      payableLedgerRows.push(row);
    }

    ledgerRows = payableLedgerRows;

    console.log(
      '[runWeeklyAdvance] override validation complete:',
      'rerouted =', reroutedOverrideRows.length,
      'skipped =', skippedOverrideRows.length,
      'payable rows =', ledgerRows.length
    );

    if (ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No payable commission_ledger rows remained after override license validation.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: eligiblePolicyIds.length,
          excluded_as_earned_policies: asEarnedCount,
          skipped_override_rows: skippedOverrideRows
        }),
      };
    }

    // Group by agent_id
    const agentTotals = {};

    for (const row of ledgerRows) {
      const aid = row.agent_id;
      if (!agentTotals[aid]) {
        agentTotals[aid] = { advance: 0, override: 0, gross: 0 };
      }
      const amt = Number(row.amount || 0);
      if (row.entry_type === 'advance') agentTotals[aid].advance += amt;
      if (row.entry_type === 'override') agentTotals[aid].override += amt;
      agentTotals[aid].gross += amt;
    }

    const agentIds = Object.keys(agentTotals);
    if (agentIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No agents with eligible rows for this run (after grouping).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          excluded_as_earned_policies: asEarnedCount,
          skipped_override_rows: skippedOverrideRows
        }),
      };
    }

    // Load debt
    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', agentIds);

    if (debtErr) {
      console.error('[runWeeklyAdvance] Error loading agent_total_debt:', debtErr);
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

    // Load agent is_active flags
    const { data: agentRows, error: agentErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .in('id', agentIds);

    if (agentErr) {
      console.error('[runWeeklyAdvance] Error loading agents.is_active:', agentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent active flags', details: agentErr }),
      };
    }

    const activeMap = new Map();
    (agentRows || []).forEach(a => {
      activeMap.set(a.id, a.is_active !== false);
    });

    // Build payout summary
    const payoutSummary = [];
    let totalGross  = 0;
    let totalDebits = 0;

    for (const [agent_id, t] of Object.entries(agentTotals)) {
      const gross = Number(t.gross.toFixed(2));
      totalGross += gross;

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
        totalDebits += actualRepay;
      }

      payoutSummary.push({
        agent_id,
        advance_gross: Number(t.advance.toFixed(2)),
        override_gross: Number(t.override.toFixed(2)),
        gross_payout: gross,
        net_payout: net,
        lead_repayment: Number(leadRepay.toFixed(2)),
        chargeback_repayment: Number(chargebackRepay.toFixed(2)),
      });
    }

    totalGross  = Number(totalGross.toFixed(2));
    totalDebits = Number(totalDebits.toFixed(2));
    const totalNet = Number((totalGross - totalDebits).toFixed(2));

    // Create payout batch
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'advance',
        status: 'pending',
        total_gross: totalGross,
        total_debits: totalDebits,
        total_net: totalNet,
        note: 'Weekly advance run (issued_at-window) with tiered debt withholding (30/40/50 or 100% inactive)',
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

    // Mark only PAYABLE ledger rows as settled
    const ledgerIds = ledgerRows.map(r => r.id);

    const { error: updErr } = await supabase
      .from('commission_ledger')
      .update({
        is_settled: true,
        payout_batch_id: batch.id,
        period_start: startIso,
        period_end: endIso,
      })
      .in('id', ledgerIds);

    if (updErr) {
      console.error('[runWeeklyAdvance] Error updating ledger rows:', updErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to mark ledger rows settled', details: updErr }),
      };
    }

    // Apply repayments
    for (const ps of payoutSummary) {
      const cbRepay = ps.chargeback_repayment || 0;
      const ldRepay = ps.lead_repayment || 0;
      if (cbRepay > 0 || ldRepay > 0) {
        await applyRepayments(ps.agent_id, cbRepay, ldRepay, batch.id);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Weekly advance run completed (issued_at-window) with tiered debt withholding + repayment records.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          batch_id: batch.id,
          total_gross: totalGross,
          total_debits: totalDebits,
          total_net: totalNet,
          agent_payouts: payoutSummary,
          ledger_row_count: ledgerRows.length,
          eligible_policy_count: eligiblePolicyIds.length,
          excluded_as_earned_policies: asEarnedCount,
          rerouted_override_rows: reroutedOverrideRows,
          skipped_override_rows: skippedOverrideRows
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
