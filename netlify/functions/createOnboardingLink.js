// netlify/functions/createOnboardingLink.js
import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

// Defaults if you don’t pass return_url / refresh_url from the tester page
const DEFAULT_RETURN_URL  = process.env.STRIPE_ONBOARDING_RETURN_URL  || 'https://fv-ia.com/commissions.html';
const DEFAULT_REFRESH_URL = process.env.STRIPE_ONBOARDING_REFRESH_URL || 'https://fv-ia.com/commissions.html';

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  if (!stripeSecretKey) {
    return { statusCode: 500, body: 'Missing STRIPE_SECRET_KEY env var' };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON body' };
  }

  const accountId = String(body.account_id || '').trim();
  const returnUrl = String(body.return_url || '').trim() || DEFAULT_RETURN_URL;
  const refreshUrl = String(body.refresh_url || '').trim() || DEFAULT_REFRESH_URL;

  if (!accountId.startsWith('acct_')) {
    return { statusCode: 400, body: 'account_id must be a connected account id (acct_...)' };
  }

  try {
    const stripe = new Stripe(stripeSecretKey, { apiVersion: '2024-06-20' });

    // Create a single-use onboarding link for the connected account
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        account_id: accountId,
        url: link.url,
        expires_at: link.expires_at
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: false,
        message: err?.message || 'Stripe error',
        type: err?.type,
        code: err?.code
      })
    };
  }
}
