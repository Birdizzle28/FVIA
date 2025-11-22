// netlify/functions/testCommissionLogic.js
import { createClient } from '@supabase/supabase-js';

// Using your anon key for read-only testing
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQzOb3SXV5TDT5Ho'
);

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Use GET with query params to test commission logic.',
    };
  }

  const qp = event.queryStringParameters || {};

  // Defaults so you can hit the URL with no params
  const carrier_name = qp.carrier_name || 'Aetna';
  const product_line = qp.product_line || 'Final Expense';
  const policy_type  = qp.policy_type  || 'Standard';
  const agent_level  = qp.agent_level  || 'agent';  // agent | mit | manager | mga | area_manager
  const ap           = Number(qp.ap || '1000');     // Annualized premium

  try {
    // 1) Load the commission schedule row
    const { data: schedule, error } = await supabase
      .from('commission_schedules')
      .select('carrier_name, product_line, policy_type, agent_level, base_commission_rate, advance_rate, renewal_trail_rule')
      .eq('carrier_name', carrier_name)
      .eq('product_line', product_line)
      .eq('policy_type', policy_type)
      .eq('agent_level', agent_level)
      .single();

    if (error || !schedule) {
  console.error('Error loading commission schedule:', error);

  // NEW: load all rows so we can see EXACTLY what’s stored in Supabase
  const { data: allRows, error: allErr } = await supabase
    .from('commission_schedules')
    .select('carrier_name, product_line, policy_type, agent_level, base_commission_rate, advance_rate, renewal_trail_rule');

    return {
      statusCode: 404,
      body: JSON.stringify(
        {
          error: 'No commission schedule found for that combo.',
          tried: { carrier_name, product_line, policy_type, agent_level },
          supabase_error: error,
          all_rows_sample: allErr ? `Error loading rows: ${allErr.message}` : allRows
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' },
    };
  }

    const baseRate = Number(schedule.base_commission_rate) || 0;
    const advRate  = Number(schedule.advance_rate) || 0;

    // === COMMISSION MATH ===

    // Advance = AP * baseRate * advanceRate
    const advanceAmount = ap * baseRate * advRate;

    // Parse renewal bands from JSON
    let trailRule = schedule.renewal_trail_rule || {};
    if (typeof trailRule === 'string') {
      try {
        trailRule = JSON.parse(trailRule);
      } catch (e) {
        console.error('Error parsing renewal_trail_rule JSON:', e);
        trailRule = {};
      }
    }

    const bands = Array.isArray(trailRule.bands) ? trailRule.bands : [];

    const renewalBands = bands.map(band => {
      const rate = Number(band.rate) || 0;
      const yearlyAmount = ap * rate; // currently % of premium
      return {
        start_year: band.start_year ?? null,
        end_year: band.end_year ?? null,
        rate,
        rate_percent: rate * 100,
        yearly_amount: yearlyAmount,
      };
    });

    // Approximate renewals in first 10 policy years (just for preview)
    let approxFirst10YearsRenewals = 0;
    renewalBands.forEach(b => {
      const start = b.start_year ?? 1;
      const end   = b.end_year ?? 10;
      const cappedEnd = Math.min(end ?? 10, 10);
      if (cappedEnd >= start) {
        const years = cappedEnd - start + 1;
        approxFirst10YearsRenewals += years * b.yearly_amount;
      }
    });

    // === DEBT / OVERRIDES / GOOD STANDING PREVIEW ===
    // For now these are FAKE values so you can see the shape.
    // Later we will replace with real Supabase queries.

    const fakeLeadBalance       = 320.00;  // what the agent owes for leads
    const fakeChargebackBalance = 180.00;  // what they owe for chargebacks
    const fakeOverridesLast30   = 540.00;  // what they made in overrides last 30 days

    const totalDebt = fakeLeadBalance + fakeChargebackBalance;

    // Simple example rule for standing:
    // - Good if agent's total debt <= $500
    // - Not in good standing if debt > $500
    const goodStanding = totalDebt <= 500;

    const standingReasons = [];
    if (!goodStanding) {
      standingReasons.push('high_debt');
    }
    // In the future we can also push reasons like:
    // - 'inactive_agent' (if agents.is_active = false)
    // - 'compliance_hold' (if we add a compliance flag)
    // - 'stopped_receiving_leads' (if receiving_leads = false)

    const result = {
      input: {
        carrier_name,
        product_line,
        policy_type,
        agent_level,
        ap,
      },
      schedule: {
        base_commission_rate: baseRate,
        advance_rate: advRate,
        renewal_trail_rule: trailRule,
      },
      calculations: {
        // direct commission preview
        advance_amount: advanceAmount,
        advance_amount_rounded: Math.round(advanceAmount * 100) / 100,
        renewal_bands: renewalBands,
        approx_first_10_years_renewals: Math.round(approxFirst10YearsRenewals * 100) / 100,

        // NEW: debt & overrides preview
        lead_balance: fakeLeadBalance,
        chargeback_balance: fakeChargebackBalance,
        total_balance: totalDebt,
        overrides_preview_last_30_days: fakeOverridesLast30,

        // NEW: standing logic
        standing: {
          good_standing: goodStanding,
          reasons: standingReasons
        }
      },
    };

    return {
      statusCode: 200,
      body: JSON.stringify(result, null, 2),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error('Unexpected error in testCommissionLogic:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
