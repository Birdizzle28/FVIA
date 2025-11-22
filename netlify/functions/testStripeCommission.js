// netlify/functions/testStripeCommission.js

// This uses Stripe's HTTP API directly via fetch,
// so you DON'T need to install the stripe npm package.

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      body: 'Use GET for this test endpoint.',
    };
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    console.error('STRIPE_SECRET_KEY is missing');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Stripe key not configured' }),
    };
  }

  try {
    // For this first test, just charge $1.00 (100 cents) in TEST mode.
    const params = new URLSearchParams();
    params.append('amount', '100');                 // = $1.00
    params.append('currency', 'usd');
    params.append('payment_method_types[]', 'card');
    params.append('description', 'Test commission payment (Stripe sandbox)');

    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Stripe API error:', data);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: 'Stripe API error', details: data }),
      };
    }

    // Return some info so you can see it in the browser
    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          ok: true,
          message: 'Test PaymentIntent created in Stripe (TEST mode).',
          payment_intent_id: data.id,
          amount: data.amount,
          currency: data.currency,
          status: data.status,
        },
        null,
        2
      ),
      headers: {
        'Content-Type': 'application/json',
      },
    };
  } catch (err) {
    console.error('Unexpected error creating PaymentIntent:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
