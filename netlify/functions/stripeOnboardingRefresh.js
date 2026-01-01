import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

const RETURN_URL =
  process.env.STRIPE_ONBOARDING_RETURN_URL || 'https://familyvaluesgroup.com/test-commission.html';

export async function handler(event) {
  // Expect: /.netlify/functions/stripeOnboardingRefresh?account_id=acct_...
  const params = event.queryStringParameters || {};
  const accountId = String(params.account_id || '').trim();

  if (!accountId.startsWith('acct_')) {
    return { statusCode: 400, body: 'Missing/invalid account_id' };
  }

  try {
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `https://familyvaluesgroup.com/.netlify/functions/stripeOnboardingRefresh?account_id=${encodeURIComponent(accountId)}`,
      return_url: RETURN_URL,
      type: 'account_onboarding',
      collection_options: { fields: 'eventually_due' },
    });

    return {
      statusCode: 302,
      headers: { Location: link.url },
      body: 'Redirecting…',
    };
  } catch (err) {
    return { statusCode: 500, body: `Stripe error: ${err.message}` };
  }
}
