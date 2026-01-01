// netlify/functions/createTestStripeConnectedAccount.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

const DEFAULT_RETURN_URL  =
  process.env.STRIPE_ONBOARDING_RETURN_URL  || 'https://familyvaluesgroup.com';
const DEFAULT_REFRESH_URL =
  process.env.STRIPE_ONBOARDING_REFRESH_URL || 'https://familyvaluesgroup.com';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, body: 'Missing STRIPE_SECRET_KEY env var' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const agent_id = String(body.agent_id || '').trim();
  const return_url = String(body.return_url || '').trim() || DEFAULT_RETURN_URL;
  const refresh_url = `https://familyvaluesgroup.com/.netlify/functions/stripeOnboardingRefresh?account_id=${encodeURIComponent(account.id)}`;

  if (!agent_id) {
    return { statusCode: 400, body: 'agent_id is required (can be any identifier)' };
  }

  try {
    // 1) Create connected account exactly as you specified
    const account = await stripe.accounts.create({
      type: 'custom',
      country: 'US',
      business_type: 'individual',
      metadata: { agent_id, source: 'test-commission' },

      tos_acceptance: {
        service_agreement: 'full',
      },

      business_profile: {
        mcc: '6300',
        url: 'https://familyvaluesgroup.com',
        product_description:
          'This account is created for the purpose of receiving payment in the form of commissions and overrides from Family Values Group and nothing more.',
      },

      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    // 2) Immediately generate onboarding link (single-use)
    const link = await stripe.accountLinks.create({
      account: account.id,
      refresh_url,
      return_url,
      type: 'account_onboarding',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        stripe_account_id: account.id,
        onboarding_url: link.url,
        expires_at: link.expires_at,
        account,
      }, null, 2),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        message: err.message,
        type: err.type,
        code: err.code,
      }, null, 2),
    };
  }
}
