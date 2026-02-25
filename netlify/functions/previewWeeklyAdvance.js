// netlify/functions/previewWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[previewWeeklyAdvance] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/* ================================
   MATCH runWeeklyAdvance WINDOW LOGIC
   America/Chicago (DST-safe enough)
   ================================ */
const PAY_TZ = 'America/Chicago';

/**
 * Helper: return YYYY-MM-DD in America/Chicago
 */
function getNextFridayYMD(fromYMD) {
  // fromYMD is YYYY-MM-DD in PAY_TZ context
  let cur = fromYMD;
  for (let i = 1; i <= 14; i++) {
    cur = addDaysYMD(cur, 1);
    const dow = getLocalDOW(new Date(`${cur}T12:00:00Z`), PAY_TZ);
    if (dow === 5) return cur; // Friday
  }
  return addDaysYMD(fromYMD, 7); // fallback
}

/**
 * ✅ MUST MATCH runWeeklyAdvance EXACTLY
 * Sun(0)-Tue(2) => NEXT Friday (one week after "this Friday")
 * Wed(3)-Sat(6) => Friday AFTER next (two weeks after "this Friday")
 *
 * NEW behavior: if issued on Friday, treat THAT as "this Friday"
 */
function computePayFridayForIssuedYMD(issuedYMD) {
  const dow = getLocalDOW(new Date(`${issuedYMD}T12:00:00Z`), PAY_TZ); // 0..6

  // ✅ Match runWeeklyAdvance:
  // if issued on Friday, count that as "this Friday"
  const thisFriday = (dow === 5) ? issuedYMD : getNextFridayYMD(issuedYMD);

  // Sun(0)-Tue(2) => NEXT Friday (one week after this Friday)
  if (dow <= 2) return addDaysYMD(thisFriday, 7);

  // Wed(3)-Sat(6) => Friday AFTER next (two weeks after this Friday)
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
 * (safe for “date math” because it operates at UTC midnight)
 */
function addDaysYMD(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Get numeric offset like "-06:00" or "-05:00" for a given date (DST-safe enough)
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
 * Convert a local America/Chicago midnight (YYYY-MM-DDT00:00:00 offset)
 * into a UTC ISO string for Supabase comparisons.
 */
function localMidnightToUtcIso(ymd, tz = PAY_TZ) {
  const offset = getOffsetForYMD(ymd, tz);
  const local = new Date(`${ymd}T00:00:00${offset}`);
  return local.toISOString();
}

/**
 * Helper: get pay_date (Friday) as YYYY-MM-DD.
 * - if ?pay_date=YYYY-MM-DD provided, use that.
 * - else: choose the NEXT Friday in America/Chicago (never “today” even if Friday)
 */
function getPayDateStr(event) {
  const qs = event.queryStringParameters || {};
  if (qs.pay_date) {
    const d = new Date(`${qs.pay_date}T12:00:00Z`);
    if (!isNaN(d.getTime())) return qs.pay_date;
  }

  const now = new Date();
  const todayYMD = getLocalYMD(now, PAY_TZ);
  const dow = getLocalDOW(now, PAY_TZ); // 0=Sun..6=Sat

  // Friday is 5. Always upcoming, not today.
  let diff = (5 - dow + 7) % 7;
  if (diff === 0) diff = 7;

  return addDaysYMD(todayYMD, diff);
}

/**
 * Repayment rate based on:
 * - totalDebt (lead + chargeback)
 * - isActive (agents.is_active)
 */
function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) return 1.0;
  if (totalDebt <= 0) return 0;
  if (totalDebt < 1000) return 0.30;
  if (totalDebt < 2000) return 0.40;
  return 0.50;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDateStr = getPayDateStr(event); // Friday YYYY-MM-DD

    // ✅ Match runWeeklyAdvance: broad window then compute per-policy due pay Friday
    const startYMD = addDaysYMD(payDateStr, -21);
    const endYMD   = addDaysYMD(payDateStr, 1); // end exclusive (next day)

    const startIso = localMidnightToUtcIso(startYMD, PAY_TZ); // inclusive
    const endIso   = localMidnightToUtcIso(endYMD, PAY_TZ);   // exclusive

    console.log(
      '[previewWeeklyAdvance] pay_date =',
      payDateStr,
      'ISSUED window =',
      startYMD,
      'to',
      endYMD,
      '(end exclusive)'
    );

    // 2) Find eligible POLICIES by issued_at window (NOT ledger created_at)
    const { data: policyRows, error: polErr } = await supabase
      .from('policies')
      .select('id, as_earned, issued_at')
      .in('status', ['issued', 'in_force'])
      .gte('issued_at', startIso)
      .lt('issued_at', endIso);

    if (polErr) {
      console.error('[previewWeeklyAdvance] Error loading eligible policies:', polErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load eligible policies', details: polErr }),
      };
    }

    const allPolicyIds = (policyRows || []).map(p => p.id);

    if (allPolicyIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies eligible for weekly advance preview in this issued_at window.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: 0,
          excluded_as_earned_policies: 0,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    // 2.2) Exclude as-earned policies from weekly advance
    const asEarnedCount = (policyRows || []).filter(p => p.as_earned === true).length;

    const duePolicyRows = (policyRows || [])
      .filter(p => p.as_earned !== true)
      .filter(p => {
        if (!p.issued_at) return false;

        const issuedYMD = getLocalYMD(new Date(p.issued_at), PAY_TZ);
        const computedPay = computePayFridayForIssuedYMD(issuedYMD);
        return computedPay === payDateStr;
      });

    const eligiblePolicyIds = duePolicyRows.map(p => p.id);

    console.log(
      '[previewWeeklyAdvance] scanned policies in window =',
      (policyRows || []).length,
      'as-earned excluded =',
      asEarnedCount,
      'due this pay_date =',
      eligiblePolicyIds.length
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
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    // 2.3) Load eligible ledger rows for those policies (ignore ledger.created_at completely)
    const { data: ledgerRowsRaw, error: ledgerErr } = await supabase
      .from('commission_ledger')
      .select('id, policy_id, agent_id, amount, entry_type, is_settled')
      .in('entry_type', ['advance', 'override'])
      .or('is_settled.is.null,is_settled.eq.false')
      .in('policy_id', eligiblePolicyIds);

    if (ledgerErr) {
      console.error('[previewWeeklyAdvance] Error loading ledger rows:', ledgerErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load ledger rows', details: ledgerErr }),
      };
    }

    const ledgerRows = ledgerRowsRaw || [];
    console.log('[previewWeeklyAdvance] eligible ledger rows (issued_at-based) =', ledgerRows.length);

    if (ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No eligible commission_ledger rows to preview for this advance run (issued_at-based).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: eligiblePolicyIds.length,
          excluded_as_earned_policies: asEarnedCount,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    // 3) Group by agent_id → gross per agent
    const agentTotals = {}; // { agent_id: { advance: x, override: y, gross: z } }

    for (const row of ledgerRows) {
      const aid = row.agent_id;
      if (!agentTotals[aid]) agentTotals[aid] = { advance: 0, override: 0, gross: 0 };

      const amt = Number(row.amount || 0);
      if (row.entry_type === 'advance') agentTotals[aid].advance += amt;
      else if (row.entry_type === 'override') agentTotals[aid].override += amt;

      agentTotals[aid].gross += amt;
    }

    const agentIds = Object.keys(agentTotals);
    if (agentIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No agents with eligible rows for this advance preview (after grouping).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: eligiblePolicyIds.length,
          excluded_as_earned_policies: asEarnedCount,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: ledgerRows.length,
        }),
      };
    }

    // 4) Load each agent's current debt (lead + chargeback)
    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', agentIds);

    if (debtErr) {
      console.error('[previewWeeklyAdvance] Error loading agent_total_debt:', debtErr);
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

    // 5) Load agent is_active flags
    const { data: agentRows, error: agentErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .in('id', agentIds);

    if (agentErr) {
      console.error('[previewWeeklyAdvance] Error loading agents.is_active:', agentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent active flags', details: agentErr }),
      };
    }

    const activeMap = new Map();
    (agentRows || []).forEach(a => {
      activeMap.set(a.id, a.is_active !== false);
    });

    // 6) Build payout summary with tiered repayment
    const payoutSummary = [];
    let totalGross = 0;
    let totalDebits = 0;

    for (const [agent_id, t] of Object.entries(agentTotals)) {
      const gross = Number(t.gross.toFixed(2));
      totalGross += gross;

      const debtInfo = debtMap.get(agent_id) || { lead: 0, chargeback: 0, total: 0 };
      const totalDebt = debtInfo.total;
      const isActive = activeMap.has(agent_id) ? activeMap.get(agent_id) : true;

      let leadRepay = 0;
      let chargebackRepay = 0;
      let net = gross;

      if (gross > 0 && totalDebt > 0) {
        const rate = getRepaymentRate(totalDebt, isActive);
        const maxRepay = Number((gross * rate).toFixed(2));
        const toRepay = Math.min(maxRepay, totalDebt);

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

    totalGross = Number(totalGross.toFixed(2));
    totalDebits = Number(totalDebits.toFixed(2));
    const totalNet = Number((totalGross - totalDebits).toFixed(2));

    // READ-ONLY preview (no inserts/updates)
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          message: 'Weekly advance PREVIEW (issued_at-window; no DB changes performed).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          total_gross: totalGross,
          total_debits: totalDebits,
          total_net: totalNet,
          agent_payouts: payoutSummary,
          ledger_row_count: ledgerRows.length,
          eligible_policy_count: eligiblePolicyIds.length,
          excluded_as_earned_policies: asEarnedCount,
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error('[previewWeeklyAdvance] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
