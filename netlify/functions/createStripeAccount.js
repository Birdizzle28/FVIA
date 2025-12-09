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
    // Create a Stripe CUSTOM connected account (not Express)
    const account = await stripe.accounts.create({
      type: 'custom',
      country: 'US',
      business_type: 'individual',
      metadata: { npn },

      // We only need them to RECEIVE transfers from your platform
      capabilities: {
        transfers: { requested: true }
      },

      // Tell Stripe this is a "recipient" style relationship
      tos_acceptance: {
        service_agreement: 'recipient'
      },

      business_profile: {
        product_description: 'Independent insurance agent commissions',
        // You can tweak this if Stripe support suggests a different MCC
        mcc: '6411'
      }
    });

    const refreshUrl = 'https://familyvaluesgroup.com/agent/stripe-error';
    const returnUrl  = 'https://familyvaluesgroup.com/agent/stripe-complete';

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
