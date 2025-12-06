// netlify/functions/createStripeAccount.js
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

  // 1) Look up pre-approved agent by NPN
  // Assumes table: approved_agents with columns: id, npn, email, first_name, last_name, stripe_account_id
  const { data: approved, error: approvedErr } = await supabase
    .from('approved_agents')
    .select('id, npn, email, first_name, last_name, stripe_account_id')
    .eq('npn', npn)
    .single();

  if (approvedErr || !approved) {
    return {
      statusCode: 404,
      body: JSON.stringify({
        error: 'Pre-approved agent not found for this NPN',
        details: approvedErr
      })
    };
  }

  let stripeAccountId = approved.stripe_account_id || null;

  // 2) Create Stripe Express account if not already created
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      email: approved.email || undefined,
      business_type: 'individual',
      metadata: {
        npn: approved.npn,
        approved_agent_id: approved.id
      },
      capabilities: {
        transfers: { requested: true }
      }
    });

    stripeAccountId = account.id;

    // Save account ID back to approved_agents
    const { error: updErr } = await supabase
      .from('approved_agents')
      .update({ stripe_account_id: stripeAccountId })
      .eq('id', approved.id);

    if (updErr) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to save stripe_account_id',
          details: updErr
        })
      };
    }
  }

  // 3) Create onboarding link for them to finish setup
  const refreshUrl = 'https://familyvaluesgroup.com/agent/stripe-error';    // tweak later
  const returnUrl  = 'https://familyvaluesgroup.com/agent/stripe-complete'; // tweak later

  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding'
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      npn,
      approved_agent_id: approved.id,
      stripe_account_id: stripeAccountId,
      onboarding_url: link.url
    })
  };
}
