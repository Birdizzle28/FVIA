export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Use GET to run this batch test.',
    };
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'STRIPE_SECRET_KEY is not set in Netlify environment.' }),
    };
  }

  // 🔹 Define your “test people” + scenarios here.
  // You can change these however you want.
  const scenarios = [
    {
      label: 'Test Agent 1',
      agent_name: 'Alpha Agent',
      agent_level: 'agent',
      carrier_name: 'Aetna',
      product_line: 'Final Expense',
      policy_type: 'Standard',
      ap: 800
    },
    {
      label: 'Test Agent 2',
      agent_name: 'Bravo MIT',
      agent_level: 'mit',
      carrier_name: 'Aetna',
      product_line: 'Final Expense',
      policy_type: 'Standard',
      ap: 1200
    },
    {
      label: 'Test Agent 3',
      agent_name: 'Charlie Manager',
      agent_level: 'manager',
      carrier_name: 'Aetna',
      product_line: 'Final Expense',
      policy_type: 'Standard',
      ap: 2000
    },
    {
      label: 'Test Agent 4',
      agent_name: 'Delta MGA',
      agent_level: 'mga',
      carrier_name: 'Aetna',
      product_line: 'Final Expense',
      policy_type: 'Standard',
      ap: 1500
    },
    {
      label: 'Test Agent 5',
      agent_name: 'Echo Area Manager',
      agent_level: 'area_manager',
      carrier_name: 'Aetna',
      product_line: 'Final Expense',
      policy_type: 'Standard',
      ap: 3000
    }
  ];

  const results = [];
  const errors = [];

  for (const scenario of scenarios) {
    const {
      label,
      agent_name,
      agent_level,
      carrier_name,
      product_line,
      policy_type,
      ap
    } = scenario;

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
        errors.push({
          label,
          error: 'No commission schedule found',
          supabase_error: error,
          combo: { carrier_name, product_line, policy_type, agent_level }
        });
        continue;
      }

      const baseRate = Number(schedule.base_commission_rate) || 0;
      const advRate  = Number(schedule.advance_rate) || 0;

      // 2) Advance math
      const advanceAmount = ap * baseRate * advRate;
      const advanceCents  = Math.round(advanceAmount * 100);

      if (advanceCents <= 0) {
        errors.push({
          label,
          error: 'Advance amount is <= 0, skipping Stripe.',
          advance_amount: advanceAmount
        });
        continue;
      }

      // 3) Create Stripe PaymentIntent
      const params = new URLSearchParams();
      params.append('amount', String(advanceCents));
      params.append('currency', 'usd');
      params.append('payment_method_types[]', 'card');
      params.append(
        'description',
        `Batch Test Advance - ${label} - ${carrier_name} ${product_line} (${agent_level})`
      );

      // Attach metadata for this “test person”
      params.append('metadata[label]', label);
      params.append('metadata[agent_name]', agent_name);
      params.append('metadata[agent_level]', agent_level);
      params.append('metadata[carrier_name]', carrier_name);
      params.append('metadata[product_line]', product_line);
      params.append('metadata[policy_type]', policy_type);
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
        errors.push({
          label,
          error: 'Stripe API error',
          details: stripeData,
        });
        continue;
      }

      results.push({
        label,
        agent_name,
        agent_level,
        carrier_name,
        product_line,
        policy_type,
        ap,
        advance_amount: Math.round(advanceAmount * 100) / 100,
        advance_cents: advanceCents,
        stripe_payment_intent_id: stripeData.id,
        stripe_status: stripeData.status,
        stripe_amount: stripeData.amount,
        stripe_currency: stripeData.currency
      });

    } catch (err) {
      errors.push({
        label: scenario.label,
        error: 'Unexpected error in scenario loop',
        details: String(err)
      });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ results, errors }, null, 2),
    headers: { 'Content-Type': 'application/json' },
  };
}
