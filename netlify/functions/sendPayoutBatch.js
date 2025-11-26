// netlify/functions/sendPayoutBatch.js
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const supabaseUrl     = process.env.SUPABASE_URL;
const serviceKey      = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[sendPayoutBatch] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}
if (!stripeSecretKey) {
  console.warn('[sendPayoutBatch] Missing STRIPE_SECRET_KEY env var');
}

const supabase = createClient(supabaseUrl, serviceKey);
const stripe   = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST with JSON { "batch_id": "..." }',
    };
  }

  if (!stripe) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Stripe client not configured. Set STRIPE_SECRET_KEY in Netlify env vars.',
      }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    };
  }

  const batch_id = body.batch_id;
  if (!batch_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'batch_id is required' }),
    };
  }

  try {
    // 1) Load the payout_batches row
    const { data: batch, error: batchErr } = await supabase
      .from('payout_batches')
      .select('id, pay_date, batch_type, status, total_net')
      .eq('id', batch_id)
      .single();

    if (batchErr || !batch) {
      console.error('[sendPayoutBatch] Batch not found:', batchErr);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'payout_batch not found', batch_id }),
      };
    }

    if (batch.status !== 'pending') {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Batch status must be 'pending' to send. Current status: ${batch.status}`,
          batch_id,
        }),
      };
    }

    // 2) Load per-agent payouts from your agent_payouts_view
    const { data: payouts, error: payoutsErr } = await supabase
      .from('agent_payouts_view')
      .select('agent_id, payout_batch_id, batch_type, status, gross_amount, net_amount')
      .eq('payout_batch_id', batch_id);

    if (payoutsErr) {
      console.error('[sendPayoutBatch] Error loading agent_payouts_view:', payoutsErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent payouts', details: payoutsErr }),
      };
    }

    if (!payouts || payouts.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'No agent payouts found for this batch_id in agent_payouts_view',
          batch_id,
        }),
      };
    }

    // 3) Load agents so we can get full_name + stripe_account_id
    const agentIds = [...new Set(payouts.map(p => p.agent_id))];

    const { data: agents, error: agentsErr } = await supabase
      .from('agents')
      .select('id, full_name, stripe_account_id')
      .in('id', agentIds);

    if (agentsErr) {
      console.error('[sendPayoutBatch] Error loading agents:', agentsErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agents for payouts', details: agentsErr }),
      };
    }

    const agentMap = new Map();
    (agents || []).forEach(a => agentMap.set(a.id, a));

    // 4) Build payout plan: one transfer per agent with a positive amount
    const payoutPlan = payouts.map(p => {
      const agent  = agentMap.get(p.agent_id) || {};
      const amount = Number(p.net_amount || p.gross_amount || 0);

      return {
        agent_id: p.agent_id,
        agent_name: agent.full_name || 'Unknown agent',
        stripe_account_id: agent.stripe_account_id || null,
        amount,
      };
    }).filter(p => p.amount > 0);

    if (!payoutPlan.length) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No positive amounts to pay for this batch.',
          batch_id,
          payout_plan: payoutPlan,
        }),
      };
    }

    // 5) Actually call Stripe (this runs in TEST or LIVE depending on your key)
    const results = [];

    for (const item of payoutPlan) {
      if (!item.stripe_account_id) {
        // Skip agents who don't have a connected account yet
        results.push({
          agent_id: item.agent_id,
          agent_name: item.agent_name,
          status: 'skipped_no_stripe_account',
          amount: item.amount,
        });
        continue;
      }

      try {
        const transfer = await stripe.transfers.create({
          amount: Math.round(item.amount * 100), // convert dollars → cents
          currency: 'usd',
          destination: item.stripe_account_id,
          description: `Payout batch ${batch_id} (${batch.batch_type})`,
        });

        results.push({
          agent_id: item.agent_id,
          agent_name: item.agent_name,
          status: 'sent',
          amount: item.amount,
          stripe_account_id: item.stripe_account_id,
          stripe_transfer_id: transfer.id,
        });
      } catch (err) {
        console.error(
          `[sendPayoutBatch] Stripe transfer failed for agent ${item.agent_id}:`,
          err
        );
        results.push({
          agent_id: item.agent_id,
          agent_name: item.agent_name,
          status: 'stripe_error',
          amount: item.amount,
          stripe_account_id: item.stripe_account_id,
          error: String(err),
        });
      }
    }

    // 6) Update batch status → 'sent' (even if some individual transfers failed)
    const { error: updErr } = await supabase
      .from('payout_batches')
      .update({ status: 'sent' })
      .eq('id', batch_id);

    if (updErr) {
      console.error('[sendPayoutBatch] Error updating payout_batches status:', updErr);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Stripe transfers were attempted, but failed to update payout_batches status.',
          details: updErr,
          results,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Stripe payout batch processed (using your Stripe key: test or live).',
          batch_id,
          batch_type: batch.batch_type,
          pay_date: batch.pay_date,
          results,
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
