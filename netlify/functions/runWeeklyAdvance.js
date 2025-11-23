// netlify/functions/runWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Helper to get YYYY-MM-DD from a Date object
 */
function toDateString(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the weekly period [start, end] (last 7 days ending as_of_date)
 */
function computeWeeklyRange(asOfDateStr) {
  const end = new Date(asOfDateStr + 'T23:59:59Z');
  const start = new Date(end);
  start.setDate(end.getDate() - 6); // 7-day window: start..end

  return {
    start: toDateString(start),
    end: toDateString(end),
  };
}

function methodNotAllowed() {
  return {
    statusCode: 405,
    body: JSON.stringify({ error: 'Use POST for this endpoint.' }),
  };
}

/**
 * Get all policies for one agent within the weekly range that should count for advance.
 * For now:
 *   - status in ('issued','in_force')
 *   - filter by issued_at between start & end
 */
async function loadAgentPoliciesForAdvance(agentId, periodStart, periodEnd) {
  const { data, error } = await supabase
    .from('policies')
    .select(
      'id, carrier_name, policy_type, product_line, premium_annual, premium_modal, issued_at'
    )
    .eq('agent_id', agentId)
    .in('status', ['issued', 'in_force'])
    .gte('issued_at', periodStart)
    .lte('issued_at', periodEnd);

  if (error) {
    console.error('Error loading policies for advance:', error);
    return [];
  }

  return data || [];
}

/**
 * Compute annualized premium (AP) from a policy row.
 * Prefer premium_annual; fall back to modal * 12 if needed.
 */
function getAnnualizedPremium(policy) {
  const annual = Number(policy.premium_annual);
  if (!Number.isNaN(annual) && annual > 0) return annual;

  const modal = Number(policy.premium_modal);
  if (!Number.isNaN(modal) && modal > 0) {
    return modal * 12;
  }

  return 0;
}

/**
 * Load the commission schedule row for a given policy + agent_level.
 * We assume commission_schedules has:
 *   carrier_name, product_line, policy_type, agent_level,
 *   base_commission_rate, advance_rate, renewal_trail_rule, notes
 */
async function loadScheduleForPolicy(policy, agentLevel) {
  const { carrier_name, product_line, policy_type } = policy;

  const { data, error } = await supabase
    .from('commission_schedules')
    .select(
      'carrier_name, product_line, policy_type, agent_level, base_commission_rate, advance_rate'
    )
    .eq('carrier_name', carrier_name)
    .eq('product_line', product_line)
    .eq('policy_type', policy_type)
    .eq('agent_level', agentLevel || 'agent')
    .single();

  if (error) {
    console.warn(
      'No matching commission schedule for policy:',
      { carrier_name, product_line, policy_type, agentLevel },
      error.message
    );
    return null;
  }

  return data;
}

/**
 * Compute total weekly gross advance commission for one agent
 * by looking at each qualifying policy and using commission_schedules.
 */
async function computeAgentWeeklyAdvance(agent, periodStart, periodEnd) {
  const agentId = agent.id;
  const agentLevel = agent.level || 'agent';

  const policies = await loadAgentPoliciesForAdvance(agentId, periodStart, periodEnd);
  if (!policies.length) {
    return {
      gross: 0,
      policy_details: [],
    };
  }

  let gross = 0;
  const policyDetails = [];

  for (const policy of policies) {
    const ap = getAnnualizedPremium(policy);
    if (ap <= 0) {
      policyDetails.push({
        policy_id: policy.id,
        reason: 'no_ap',
        ap,
        advance: 0,
      });
      continue;
    }

    const schedule = await loadScheduleForPolicy(policy, agentLevel);
    if (!schedule) {
      policyDetails.push({
        policy_id: policy.id,
        reason: 'no_schedule',
        ap,
        advance: 0,
      });
      continue;
    }

    const baseRate = Number(schedule.base_commission_rate) || 0;
    const advRate = Number(schedule.advance_rate) || 0;

    const advanceAmount = ap * baseRate * advRate;
    gross += advanceAmount;

    policyDetails.push({
      policy_id: policy.id,
      ap,
      base_rate: baseRate,
      advance_rate: advRate,
      advance_amount: advanceAmount,
      carrier_name: policy.carrier_name,
      product_line: policy.product_line,
      policy_type: policy.policy_type,
    });
  }

  return {
    gross,
    policy_details: policyDetails,
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return methodNotAllowed();
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const asOfDate = body.as_of_date || toDateString(new Date());
    const { start: periodStart, end: periodEnd } = computeWeeklyRange(asOfDate);

    // Allow override for testing (e.g., set max_debt_pct in body)
    const maxDebtPct = body.max_debt_pct ?? 0.3; // 30% max of gross for debt

    // 1) Create a payout run row
    const { data: run, error: runErr } = await supabase
      .from('commission_payout_runs')
      .insert({
        run_type: 'advance',
        as_of_date: asOfDate,
        status: 'processing',
        notes: `Weekly advance run for ${periodStart} to ${periodEnd}`,
      })
      .select('*')
      .single();

    if (runErr) {
      console.error('Error creating commission_payout_runs row:', runErr);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to create payout run row.',
          details: runErr.message,
        }),
      };
    }

    // 2) Load active agents (include level now)
    const { data: agents, error: agentsErr } = await supabase
      .from('agents')
      .select('id, full_name, is_active, level')
      .eq('is_active', true);

    if (agentsErr) {
      console.error('Error loading agents:', agentsErr);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to load agents.',
          details: agentsErr.message,
        }),
      };
    }

    if (!agents || !agents.length) {
      await supabase
        .from('commission_payout_runs')
        .update({ status: 'completed', notes: 'No active agents found.' })
        .eq('id', run.id);

      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No active agents. Run completed with no payouts.',
          run,
        }),
      };
    }

    const payoutsToInsert = [];
    const debugAgents = [];

    for (const agent of agents) {
      const agentId = agent.id;

      // 3) Compute this agent's weekly gross from policies + schedules
      const weekly = await computeAgentWeeklyAdvance(agent, periodStart, periodEnd);
      const gross = weekly.gross || 0;

      // 4) Pull balances from agent_commission_overview
      const { data: overview, error: ovErr } = await supabase
        .from('agent_commission_overview')
        .select('lead_balance, chargeback_balance, total_debt, withholding_rate')
        .eq('agent_id', agentId)
        .single();

      if (ovErr) {
        console.warn(
          `Warning: no agent_commission_overview row for agent ${agentId}. Using zeros.`,
          ovErr.message
        );
      }

      const leadBalance = Number(overview?.lead_balance ?? 0);
      const chargebackBalance = Number(overview?.chargeback_balance ?? 0);
      const totalDebt = Number(overview?.total_debt ?? 0);
      const withholdingRate = Number(overview?.withholding_rate ?? 0);

      // If no gross for this period, we still record a row (helps debugging),
      // but net_payout may be zero.
      const maxDebtThisRun = gross * Number(maxDebtPct);

      const leadApplied = Math.min(leadBalance, maxDebtThisRun);
      const remainingDebtRoom = maxDebtThisRun - leadApplied;
      const chargeApplied = Math.min(chargebackBalance, remainingDebtRoom);

      const afterDebt = gross - leadApplied - chargeApplied;
      const withholdingAmount = afterDebt * (withholdingRate || 0);
      const netPayout = afterDebt - withholdingAmount;

      payoutsToInsert.push({
        run_id: run.id,
        agent_id: agentId,
        payout_type: 'advance',
        gross_commission: gross,
        lead_balance_applied: leadApplied,
        chargeback_balance_applied: chargeApplied,
        other_adjustments: -withholdingAmount,
        net_payout: netPayout,
        status: 'pending',
        currency: 'USD',
        metadata: {
          as_of_date: asOfDate,
          period_start: periodStart,
          period_end: periodEnd,
          lead_balance_before: leadBalance,
          chargeback_balance_before: chargebackBalance,
          total_debt_before: totalDebt,
          max_debt_this_run: maxDebtThisRun,
          withholding_rate: withholdingRate,
          policies_used: weekly.policy_details,
        },
      });

      debugAgents.push({
        agent_id: agentId,
        full_name: agent.full_name,
        level: agent.level,
        gross,
        net_payout: netPayout,
      });
    }

    if (payoutsToInsert.length) {
      const { error: payoutsErr } = await supabase
        .from('commission_payouts')
        .insert(payoutsToInsert);

      if (payoutsErr) {
        console.error('Error inserting commission_payouts:', payoutsErr);
        await supabase
          .from('commission_payout_runs')
          .update({ status: 'failed', notes: 'Failed inserting payouts.' })
          .eq('id', run.id);

        return {
          statusCode: 500,
          body: JSON.stringify({
            error: 'Failed inserting payouts.',
            details: payoutsErr.message,
          }),
        };
      }
    }

    await supabase
      .from('commission_payout_runs')
      .update({ status: 'completed' })
      .eq('id', run.id);

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Weekly advance run (real policy math) completed.',
          run,
          period: { start: periodStart, end: periodEnd },
          payouts_inserted: payoutsToInsert.length,
          agents_preview: debugAgents,
        },
        null,
        2
      ),
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (err) {
    console.error('Unexpected error in runWeeklyAdvance:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Unexpected error',
        details: String(err),
      }),
    };
  }
}
