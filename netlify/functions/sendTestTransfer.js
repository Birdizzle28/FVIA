// netlify/functions/sendTestTransfer.js
import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST with JSON.' };
  }
  if (!stripe) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing STRIPE_SECRET_KEY' })
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const destination = String(body.destination_account_id || '').trim();
  const amount = Number(body.amount || 0);
  const forcePayout = !!body.force_payout;

  if (!destination.startsWith('acct_')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'destination_account_id must be acct_...' }) };
  }
  if (!(amount > 0)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'amount must be > 0' }) };
  }

  try {
    // 1) Platform ➜ Connected Account
    const transfer = await stripe.transfers.create({
      amount: Math.round(amount * 100),
      currency: 'usd',
      destination,
      description: `Manual test transfer ($${amount.toFixed(2)})`,
    });

    let payout = null;

    // 2) Optional: Connected ➜ Bank (forces a payout creation)
    if (forcePayout) {
      payout = await stripe.payouts.create(
        { amount: Math.round(amount * 100), currency: 'usd' },
        { stripeAccount: destination }
      );
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, transfer, payout }, null, 2)
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Stripe error', details: String(err) }, null, 2)
    };
  }
}
