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
    // Create a Stripe CUSTOM connected account
    const account = await stripe.accounts.create({
      type: 'custom',
      country: 'US',
      business_type: 'individual',
      metadata: { npn },

      // This makes it a full platform ToS, not the old “recipient” ToS
      tos_acceptance: {
        service_agreement: 'full',
      },

      // Tell Stripe what this account is for (insurance payouts)
      business_profile: {
        mcc: '6300', // ✅ valid insurance MCC
        url: 'https://familyvaluesgroup.com',
        product_description: 'This account is created for the purpose of recieving payment in the form of commissions and overrides from Family Values Group and nothing more.',
      },

      // Capabilities: we allow card_payments + transfers
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    const refreshUrl = 'https://familyvaluesgroup.com/agent/stripe-error';
    const returnUrl = 'https://familyvaluesgroup.com/agent/stripe-complete';

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
