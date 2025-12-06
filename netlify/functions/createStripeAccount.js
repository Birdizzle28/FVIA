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

  const { agent_id } = body;
  if (!agent_id) {
    return { statusCode: 400, body: 'agent_id is required' };
  }

  // 1) Load agent info (email + name)
  const { data: agent, error: agentErr } = await supabase
    .from('agents')
    .select('id, email, full_name, stripe_account_id')
    .eq('id', agent_id)
    .single();

  if (agentErr || !agent) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Agent not found', details: agentErr })
    };
  }

  // If they already have an account, just make a new onboarding link
  let stripeAccountId = agent.stripe_account_id;

  if (!stripeAccountId) {
    // 2) Create Stripe connected account for this agent
    const account = await stripe.accounts.create({
      type: 'express',
      email: agent.email || undefined,
      business_type: 'individual',
      metadata: { agent_id: agent.id },
      capabilities: {
        transfers: { requested: true }
      }
    });

    stripeAccountId = account.id;

    // 3) Save it on the agent row
    const { error: updErr } = await supabase
      .from('agents')
      .update({ stripe_account_id: stripeAccountId })
      .eq('id', agent.id);

    if (updErr) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to save stripe_account_id', details: updErr })
      };
    }
  }

  // 4) Create onboarding link for Amanda to finish setup
  const refreshUrl = 'https://familyvaluesgroup.com/agent/stripe-error';   // change these
  const returnUrl  = 'https://familyvaluesgroup.com/agent/stripe-complete';

  const link = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding'
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      agent_id: agent.id,
      stripe_account_id: stripeAccountId,
      onboarding_url: link.url
    })
  };
}
