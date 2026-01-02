// netlify/functions/runWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runWeeklyAdvance] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/**
 * Helper: get the pay_date (Friday) either from query param or "next Friday from today"
 */
const PAY_TZ = 'America/Chicago';

/**
 * Helper: return YYYY-MM-DD in America/Chicago
 */
function getLocalYMD(date = new Date(), tz = PAY_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
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
  // use a midday probe to avoid DST edge-hour weirdness
  const probe = new Date(`${ymd}T12:00:00Z`);
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).format(probe);

  // s often contains something like "GMT-6" or "GMT-05:00"
  const match = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return '-06:00';

  const signHours = parseInt(match[1], 10); // includes sign
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
 *
 * Rules:
 *   - if not active → 100% of this check (up to remaining debt)
 *   - if active:
 *        < 1000         => 30%
 *        1000–1999.99   => 40%
 *        >= 2000        => 50%
 */
function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) {
    return 1.0; // 100%
  }
  if (totalDebt <= 0) {
    return 0;
  }
  if (totalDebt < 1000) {
    return 0.30;
  }
  if (totalDebt < 2000) {
    return 0.40;
  }
  return 0.50; // 2000+
}

/**
 * Record actual repayment events into DB
 * - chargebackRepay is what we decided to take for chargebacks for this agent this week
 * - leadRepay       is what we decided to take for leads for this agent this week
 *
 * NOTE: we do NOT set run_id here, because run_id on lead_debt_payments
 *       points to commission_runs, not payout_batches.
 */
async function applyRepayments(agent_id, chargebackRepay, leadRepay) {
  /* ------------------------------
     1. Apply chargeback repayments
     ------------------------------ */
  if (chargebackRepay > 0) {
    let remaining = chargebackRepay;

    // Load open chargebacks oldest → newest
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

        // Insert a payment row
        await supabase.from('chargeback_payments').insert({
          agent_id,
          chargeback_id: cb.id,
          amount: pay,
          payout_batch_id
        });

        // Update chargeback status + remaining amount
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

  /* ------------------------------
     2. Apply lead debt repayments
     ------------------------------ */
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

        // Insert a payment row
        await supabase.from('lead_debt_payments').insert({
          lead_debt_id: ld.id,
          agent_id,
          amount: pay
        });

        // Update lead debt status + remaining amount
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
    const payDateStr = getPayDateStr(event); // YYYY-MM-DD (Friday)

    // NEW RULE WINDOW:
    // Eligible sales are from (payFriday - 9 days) through (payFriday - 2 days) exclusive
    const startYMD = addDaysYMD(payDateStr, -5); // Sunday
    const endYMD   = addDaysYMD(payDateStr, -2); // Wednesday (exclusive)
    
    const startIso = localMidnightToUtcIso(startYMD, PAY_TZ); // inclusive
    const endIso   = localMidnightToUtcIso(endYMD, PAY_TZ);   // exclusive
    
    console.log('[runWeeklyAdvance] pay_date =', payDateStr, 'window =', startYMD, 'to', endYMD, '(end exclusive)');

    // 2) Find all eligible ledger rows (advances + overrides not yet settled)
    const { data: ledgerRows, error: ledgerErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, entry_type, created_at, is_settled')
      .in('entry_type', ['advance', 'override'])
      // treat NULL as not settled too
      .or('is_settled.is.null,is_settled.eq.false')
      .gte('created_at', startIso)
      .lt('created_at', endIso);

    if (ledgerErr) {
      console.error('[runWeeklyAdvance] Error loading ledger rows:', ledgerErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load ledger rows', details: ledgerErr }),
      };
    }

    console.log('[runWeeklyAdvance] eligible ledger rows =', ledgerRows.length);

    if (!ledgerRows || ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No eligible commission_ledger rows to pay for this advance run.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
        }),
      };
    }

    // 3) Group by agent_id → gross per agent
    const agentTotals = {}; // { agent_id: { advance: x, override: y, gross: z } }

    for (const row of ledgerRows) {
      const aid = row.agent_id;
      if (!agentTotals[aid]) {
        agentTotals[aid] = { advance: 0, override: 0, gross: 0 };
      }
      const amt = Number(row.amount || 0);
      if (row.entry_type === 'advance') {
        agentTotals[aid].advance += amt;
      } else if (row.entry_type === 'override') {
        agentTotals[aid].override += amt;
      }
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
        }),
      };
    }

    // 4) Load each agent's current debt (lead + chargeback)
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

    // 5) Load agent is_active flags
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
      // treat null as active by default
      activeMap.set(a.id, a.is_active !== false);
    });

    // 6) Build payout summary with tiered repayment (30/40/50 or 100% if inactive)
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
        const rate       = getRepaymentRate(totalDebt, isActive);
        const maxRepay   = Number((gross * rate).toFixed(2));   // tiered % of this check
        const toRepay    = Math.min(maxRepay, totalDebt);       // but never more than they owe

        // PRIORITY: chargebacks first, then leads
        let remaining = toRepay;

        const chargebackOutstanding = debtInfo.chargeback;
        if (chargebackOutstanding > 0 && remaining > 0) {
          chargebackRepay = Math.min(remaining, chargebackOutstanding);
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

    // 7) Create a payout batch row in payout_batches
    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'advance',
        status: 'pending',
        total_gross: totalGross,
        total_debits: totalDebits,
        total_net: totalNet,
        note: 'Weekly advance run with tiered debt withholding (30/40/50 or 100% inactive)',
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

    // 8) Mark all those ledger rows as settled + attach batch_id
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

    // 9) Apply repayments (chargebacks + leads) per agent based on what we calculated
    for (const ps of payoutSummary) {
      const cbRepay  = ps.chargeback_repayment || 0;
      const ldRepay  = ps.lead_repayment || 0;
      if (cbRepay > 0 || ldRepay > 0) {
        await applyRepayments(ps.agent_id, cbRepay, ldRepay);
      }
    }

    // 10) Return a clean summary
    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Weekly advance run completed (with tiered debt withholding + repayment records).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          batch_id: batch.id,
          total_gross: totalGross,
          total_debits: totalDebits,
          total_net: totalNet,
          agent_payouts: payoutSummary,
          ledger_row_count: ledgerRows.length,
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
