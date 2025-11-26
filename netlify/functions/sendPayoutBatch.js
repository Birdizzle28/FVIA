// netlify/functions/sendPayoutBatch.js
import { createClient } from '@supabase/supabase-js';
// import Stripe from 'stripe';  // we'll uncomment when you're ready to actually send money

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
// const stripeSecret = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[sendPayoutBatch] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

// const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
const supabase = createClient(supabaseUrl, serviceKey);

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST with JSON { "batch_id": "..." }',
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const batch_id = body.batch_id;
  if (!batch_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'batch_id is required' }),
    };
  }

  try {
    // 1) Load the batch
    const { data: batch, error: batchErr } = await supabase
      .from('payout_batches')
      .select('*')
      .eq('id', batch_id)
      .single();

    if (batchErr || !batch) {
      console.error('[sendPayoutBatch] Batch not found:', batchErr);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Batch not found', batch_id }),
      };
    }

    if (batch.status !== 'pending') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `Batch is already ${batch.status}`, batch_id }),
      };
    }

    // 2) Get what each agent should receive in this batch
    //    This assumes agent_payouts_view has one row per (batch, agent)
    const { data: payouts, error: payErr } = await supabase
      .from('agent_payouts_view')
      .select('agent_id, payout_batch_id, net_amount')
      .eq('payout_batch_id', batch_id);

    if (payErr) {
      console.error('[sendPayoutBatch] Error loading agent_payouts_view:', payErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent payouts for batch', details: payErr }),
      };
    }

    if (!payouts || payouts.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No agent payouts found for this batch', batch_id }),
      };
    }

    // 3) Look up each agent’s stripe_account_id (for later real payouts)
    const agentIds = [...new Set(payouts.map(p => p.agent_id))];

    const { data: agents, error: agentsErr } = await supabase
      .from('agents')
      .select('id, full_name, stripe_account_id')
      .in('id', agentIds);

    if (agentsErr) {
      console.error('[sendPayoutBatch] Error loading agents:', agentsErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agents for batch', details: agentsErr }),
      };
    }

    const agentMap = new Map();
    (agents || []).forEach(a => agentMap.set(a.id, a));

    // 4) BUILD A DRY-RUN PLAN (no Stripe calls yet)
    const payoutPlan = payouts.map(p => {
      const agent = agentMap.get(p.agent_id) || {};
      const amount = Number(p.net_amount || 0);
      return {
        agent_id: p.agent_id,
        agent_name: agent.full_name || 'Unknown',
        stripe_account_id: agent.stripe_account_id || null,
        amount,
      };
    });

    // When you're ready, THIS is where we'd loop payoutPlan and call stripe.transfers.create(...)
    // For now, we just mark the batch as "calculated" so you can see it's ready.

    const { error: updErr } = await supabase
      .from('payout_batches')
      .update({
        status: 'calculated', // later: 'sent' or 'paid' once Stripe succeeds
      })
      .eq('id', batch_id);

    if (updErr) {
      console.error('[sendPayoutBatch] Error updating batch status:', updErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to update batch status', details: updErr }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Payout batch read successfully (dry run – no Stripe calls yet).',
          batch: {
            id: batch.id,
            pay_date: batch.pay_date,
            batch_type: batch.batch_type,
            total_net: batch.total_net,
            status: 'calculated',
          },
          payout_plan: payoutPlan,
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error('[sendPayoutBatch] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
