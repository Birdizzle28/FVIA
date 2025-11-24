// netlify/functions/processPolicyCommission.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for processPolicyCommission');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST with JSON { "policy_id": "..." }',
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

  const policy_id = body.policy_id;
  if (!policy_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'policy_id is required' }),
    };
  }

  try {
    // 1) Load policy + basic info
    const { data: policy, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, lead_id')
      .eq('id', policy_id)
      .single();

    if (polErr || !policy) {
      console.error('Policy not found:', polErr);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Policy not found', policy_id }),
      };
    }

    if (!policy.agent_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Policy has no agent_id set yet.' }),
      };
    }

    // 2) Load writing agent (downline)
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .select('id, full_name, level, recruiter_id')
      .eq('id', policy.agent_id)
      .single();

    if (agentErr || !agent) {
      console.error('Agent not found:', agentErr);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Agent not found', agent_id: policy.agent_id }),
      };
    }

    const agent_level = agent.level || 'agent';

    // 3) Load commission schedule for writing agent
    const { data: scheduleAgent, error: scheduleErrAgent } = await supabase
      .from('commission_schedules')
      .select('base_commission_rate, advance_rate, renewal_trail_rule')
      .eq('carrier_name', policy.carrier_name)
      .eq('product_line', policy.product_line)
      .eq('policy_type', policy.policy_type)
      .eq('agent_level', agent_level)
      .single();

    if (scheduleErrAgent || !scheduleAgent) {
      console.error('No schedule found for writing agent:', scheduleErrAgent);
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'No commission schedule found for this policy + agent level.',
          carrier_name: policy.carrier_name,
          product_line: policy.product_line,
          policy_type: policy.policy_type,
          agent_level,
        }),
      };
    }

    const baseRateAgent = Number(scheduleAgent.base_commission_rate) || 0;
    const advanceRate   = Number(scheduleAgent.advance_rate) || 0;
    const ap            = Number(policy.premium_annual) || 0;

    if (ap <= 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Policy premium_annual is 0 or missing; cannot calculate commission.',
          policy_id,
          premium_annual: policy.premium_annual,
        }),
      };
    }

    // 4) Calculate writing agent advance
    const advanceAmount  = ap * baseRateAgent * advanceRate;
    const advanceRounded = Math.round(advanceAmount * 100) / 100;

    // 5) (SIMPLIFIED) Lead charge logic:
    // We are NOT creating lead_charge rows here anymore.
    // Lead costs are handled via lead_debts + weekly advance runs.
    const leadChargeAmount = 0;

    // 6) Multi-level override logic up the recruiter chain
    const ledgerRows = [];

    // Advance credit for writing agent
    ledgerRows.push({
      agent_id: policy.agent_id,
      policy_id: policy.id,
      amount: advanceRounded,
      currency: 'USD',
      entry_type: 'advance',
      description: `Advance on ${policy.carrier_name} ${policy.product_line} (${policy.policy_type})`,
      meta: {
        carrier_name: policy.carrier_name,
        product_line: policy.product_line,
        policy_type: policy.policy_type,
        agent_level,
        ap,
        base_commission_rate: baseRateAgent,
        advance_rate: advanceRate
      }
    });

    // Multi-level overrides using the SAME spread formula for each level
    let childAgent       = agent;           // start at writing agent
    let childBaseRate    = baseRateAgent;   // their base commission rate
    let totalOverrides   = 0;
    const overrideChain  = [];

    while (childAgent && childAgent.recruiter_id) {
      // Load the upline
      const { data: upline, error: uplineErr } = await supabase
        .from('agents')
        .select('id, full_name, level, recruiter_id')
        .eq('id', childAgent.recruiter_id)
        .single();

      if (uplineErr || !upline) {
        console.warn('No further upline found for agent', childAgent.id, uplineErr);
        break;
      }

      const uplineLevel = upline.level || 'agent';

      // Load upline schedule to get THEIR base rate
      const { data: scheduleUpline, error: scheduleErrUpline } = await supabase
        .from('commission_schedules')
        .select('base_commission_rate')
        .eq('carrier_name', policy.carrier_name)
        .eq('product_line', policy.product_line)
        .eq('policy_type', policy.policy_type)
        .eq('agent_level', uplineLevel)
        .single();

      if (scheduleErrUpline || !scheduleUpline) {
        console.warn(
          'No commission schedule found for upline level',
          { upline_id: upline.id, uplineLevel },
          scheduleErrUpline
        );
        // Move up anyway (prevents infinite loop if data is messy)
        childAgent = upline;
        childBaseRate = childBaseRate; // unchanged
        continue;
      }

      const baseRateUpline = Number(scheduleUpline.base_commission_rate) || 0;
      const spread         = baseRateUpline - childBaseRate;

      if (spread > 0) {
        const rawOverride = ap * spread * advanceRate;
        const overrideAmt = Math.round(rawOverride * 100) / 100;

        totalOverrides += overrideAmt;
        overrideChain.push({
          upline_id: upline.id,
          upline_name: upline.full_name,
          upline_level: uplineLevel,
          child_id: childAgent.id,
          child_name: childAgent.full_name,
          child_level: childAgent.level || 'agent',
          spread,
          override_amount: overrideAmt
        });

        ledgerRows.push({
          agent_id: upline.id,
          policy_id: policy.id,
          amount: overrideAmt,
          currency: 'USD',
          entry_type: 'override',
          description: `Override on downline policy (${childAgent.full_name})`,
          meta: {
            downline_agent_id: childAgent.id,
            downline_agent_name: childAgent.full_name,
            downline_level: childAgent.level || 'agent',
            carrier_name: policy.carrier_name,
            product_line: policy.product_line,
            policy_type: policy.policy_type,
            ap,
            spread,
            upline_level: uplineLevel,
            base_commission_rate_child: childBaseRate,
            base_commission_rate_upline: baseRateUpline
          }
        });
      }

      // Move one level up the tree
      childAgent    = upline;
      childBaseRate = baseRateUpline;
    }

    // 7) Insert into commission_ledger
    const { data: inserted, error: insErr } = await supabase
      .from('commission_ledger')
      .insert(ledgerRows)
      .select('*');

    if (insErr) {
      console.error('Error inserting ledger rows:', insErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to insert commission ledger rows', details: insErr }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Commission processed and ledger rows created (multi-level overrides).',
          policy_id,
          agent: {
            id: agent.id,
            full_name: agent.full_name,
            level: agent_level
          },
          advance: advanceRounded,
          lead_charge: leadChargeAmount,
          overrides: {
            total: totalOverrides,
            chain: overrideChain
          },
          ledger_rows_created: inserted,
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (err) {
    console.error('Unexpected error in processPolicyCommission:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
