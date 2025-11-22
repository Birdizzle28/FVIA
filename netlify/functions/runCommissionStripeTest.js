// netlify/functions/runCommissionStripeTest.js

import { createClient } from '@supabase/supabase-js';

// Supabase client (read-only, using same anon key as your frontend)
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Use GET with query params to run this test.',
    };
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'STRIPE_SECRET_KEY is not set in Netlify environment.' }),
    };
  }

  const qp = event.queryStringParameters || {};

  // Defaults so you can hit it with no query first
  const carrier_name = qp.carrier_name || 'Aetna';
  const product_line = qp.product_line || 'Final Expense';
  const policy_type  = qp.policy_type  || 'Standard';
  const agent_level  = qp.agent_level  || 'agent';  // agent | mit | manager | mga | area_manager
  const ap           = Number(qp.ap || '1000');     // Annualized premium

  try {
    // 1) Load commission schedule for this combo
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
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'No commission schedule found for that combo.',
          tried: { carrier_name, product_line, policy_type, agent_level },
          supabase_error: error
        }),
      };
    }

    const baseRate = Number(schedule.base_commission_rate) || 0;
    const advRate  = Number(schedule.advance_rate) || 0;

    // 2) Commission math (same as testCommissionLogic for advance)
    const advanceAmount = ap * baseRate * advRate;
    const advanceCents  = Math.round(advanceAmount * 100);

    // Parse renewal bands (still just for preview / info)
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
      const yearlyAmount = ap * rate;
      return {
        start_year: band.start_year ?? null,
        end_year: band.end_year ?? null,
        rate,
        rate_percent: rate * 100,
        yearly_amount: yearlyAmount,
      };
    });

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
    approxFirst10YearsRenewals = Math.round(approxFirst10YearsRenewals * 100) / 100;

    if (advanceCents <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Advance amount is <= 0, nothing to send to Stripe.',
          advance_amount: advanceAmount,
        }),
      };
    }

    // 3) Create a Stripe PaymentIntent for the calculated advance
    const params = new URLSearchParams();
    params.append('amount', String(advanceCents));
    params.append('currency', 'usd');
    params.append('payment_method_types[]', 'card');
    params.append('description', `Test Advance Payout - ${carrier_name} ${product_line} (${agent_level})`);

    // Attach metadata so you can see context inside Stripe
    params.append('metadata[carrier_name]', carrier_name);
    params.append('metadata[product_line]', product_line);
    params.append('metadata[policy_type]', policy_type);
    params.append('metadata[agent_level]', agent_level);
    params.append('metadata[ap]', String(ap));
    params.append('metadata[base_commission_rate]', String(baseRate));
    params.append('metadata[advance_rate]', String(advRate));

    const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeSecret}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const stripeData = await stripeRes.json();
    if (!stripeRes.ok) {
      console.error('Stripe API error:', stripeData);
      return {
        statusCode: stripeRes.status,
        body: JSON.stringify({
          error: 'Stripe API error',
          details: stripeData,
        }),
      };
    }

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
        advance_amount: advanceAmount,
        advance_amount_rounded: Math.round(advanceAmount * 100) / 100,
        advance_amount_cents: advanceCents,
        renewal_bands: renewalBands,
        approx_first_10_years_renewals: approxFirst10YearsRenewals,
      },
      stripe: {
        payment_intent_id: stripeData.id,
        status: stripeData.status,
        amount: stripeData.amount,
        currency: stripeData.currency,
      },
    };

    return {
      statusCode: 200,
      body: JSON.stringify(result, null, 2),
      headers: { 'Content-Type': 'application/json' },
    };

  } catch (err) {
    console.error('Unexpected error in runCommissionStripeTest:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
