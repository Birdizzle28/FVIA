// netlify/functions/createStripeAccount.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { npn } = body;
  if (!npn) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'npn is required' })
    };
  }

  try {
    // 1) Create a Stripe Express connected account for this NPN
    const account = await stripe.accounts.create({
      type: 'express',
      business_type: 'individual',
      // we can let Stripe collect email/name during onboarding,
      // but we still tag it with NPN for later matching
      metadata: {
        npn
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true }
      }
    });

    // 2) Create onboarding link
    const refreshUrl = 'https://familyvaluesgroup.com/agent/stripe-error';    // adjust later
    const returnUrl  = 'https://familyvaluesgroup.com/agent/stripe-complete'; // adjust later

    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding'
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        npn,
        stripe_account_id: account.id,
        onboarding_url: link.url
      })
    };
  } catch (err) {
    console.error('Stripe error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Stripe account creation failed',
        message: err.message
      })
    };
  }
}
