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
 * Simple helper so Netlify function can reject non-POST
 */
function methodNotAllowed() {
  return {
    statusCode: 405,
    body: JSON.stringify({ error: 'Use POST for this endpoint.' }),
  };
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return methodNotAllowed();
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Optional input fields
    const asOfDate =
      body.as_of_date ||
      toDateString(new Date()); // default: today

    // For now this is a TEST number.
    // Later we'll replace this with real per-policy commission math.
    const testGross = body.test_gross_commission ?? 1000; // per-agent gross preview
    const maxDebtPct = body.max_debt_pct ?? 0.3; // max 30% of gross applied to debt

    // 1) Create a payout run row
    const { data: run, error: runErr } = await supabase
      .from('commission_payout_runs')
      .insert({
        run_type: 'advance',
        as_of_date: asOfDate,
        status: 'processing',
        notes: 'Test weekly advance run (using fixed gross_commission and agent_commission_overview)',
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

    // 2) Load active agents
    const { data: agents, error: agentsErr } = await supabase
      .from('agents')
      .select('id, full_name, is_active')
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
      // no agents = nothing to pay, but run still exists
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

    // 3) For each agent, pull balances from agent_commission_overview
    for (const agent of agents) {
      const agentId = agent.id;

      const { data: overview, error: ovErr } = await supabase
        .from('agent_commission_overview')
        .select('lead_balance, chargeback_balance, total_debt, withholding_rate')
        .eq('agent_id', agentId)
        .single();

      if (ovErr) {
        // If view row is missing or error, treat balances as 0 so we still see a payout row.
        console.warn(
          `Warning: no agent_commission_overview row for agent ${agentId}. Using zeros.`,
          ovErr.message
        );
      }

      const leadBalance = Number(overview?.lead_balance ?? 0);
      const chargebackBalance = Number(overview?.chargeback_balance ?? 0);
      const totalDebt = Number(overview?.total_debt ?? 0);
      const withholdingRate = Number(overview?.withholding_rate ?? 0);

      const gross = Number(testGross) || 0;

      // Example rule: only apply up to maxDebtPct of gross to debt
      const maxDebtThisRun = gross * Number(maxDebtPct);

      // First hit leads, then chargebacks
      const leadApplied = Math.min(leadBalance, maxDebtThisRun);
      const remainingDebtRoom = maxDebtThisRun - leadApplied;
      const chargeApplied = Math.min(chargebackBalance, remainingDebtRoom);

      // Withholding: e.g., 10% withheld from net after debt
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
          lead_balance_before: leadBalance,
          chargeback_balance_before: chargebackBalance,
          total_debt_before: totalDebt,
          max_debt_this_run: maxDebtThisRun,
          withholding_rate: withholdingRate,
        },
      });
    }

    // 4) Insert all payouts in one go
    if (payoutsToInsert.length) {
      const { error: payoutsErr } = await supabase
        .from('commission_payouts')
        .insert(payoutsToInsert);

      if (payoutsErr) {
        console.error('Error inserting commission_payouts:', payoutsErr);
        // mark run as failed
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

    // 5) Mark run as completed (Stripe wiring will update status again later)
    await supabase
      .from('commission_payout_runs')
      .update({ status: 'completed' })
      .eq('id', run.id);

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Weekly advance run created successfully.',
          run,
          payouts_inserted: payoutsToInsert.length,
          test_gross_commission_per_agent: testGross,
          max_debt_pct,
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
