// netlify/functions/createTestStripeConnectedAccount.js
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

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

  if (!agent_id) {
    return { statusCode: 400, body: 'agent_id is required (can be any identifier)' };
  }

  try {
    const account = await stripe.accounts.create({
      type: 'custom',
      country: 'US',
      business_type: 'individual',

      metadata: {
        agent_id,
        source: 'test-commission',
      },

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

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        stripe_account_id: account.id,
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
