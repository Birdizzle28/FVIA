// netlify/functions/createStripeAccount.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST',
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON' }),
    };
  }

  const { npn } = body;
  if (!npn) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'npn is required' }),
    };
  }

  try {
    // Create a Stripe **Custom** connected account, transfer-only
    const account = await stripe.accounts.create({
      type: 'custom',           // ⬅️ changed from 'express' to 'custom'
      country: 'US',
      business_type: 'individual',
      metadata: { npn },

      // This is the key part: move away from the old “recipient” agreement
      tos_acceptance: {
        service_agreement: 'full', // ⬅️ avoids the "recipient ToS" error
      },

      capabilities: {
        "card_payments": { "requested": true },
        "transfers": { "requested": true }
        // card_payments is not requested because agents won’t be charging customers
      },
    });

    const refreshUrl = 'https://familyvaluesgroup.com/agent/stripe-error';
    const returnUrl  = 'https://familyvaluesgroup.com/agent/stripe-complete';

    // Onboarding link still works for Custom accounts
    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        npn,
        stripe_account_id: account.id,
        onboarding_url: link.url,
      }),
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Stripe account creation failed',
        message: err.message,
      }),
    };
  }
}
