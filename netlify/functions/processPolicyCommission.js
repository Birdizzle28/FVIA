// netlify/functions/processPolicyCommission.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

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

    const baseRateAgent   = Number(scheduleAgent.base_commission_rate) || 0;
    const advanceRate     = Number(scheduleAgent.advance_rate) || 0; // used for both agent & upline in this simple override model
    const ap              = Number(policy.premium_annual) || 0;

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
    const advanceAmount = ap * baseRateAgent * advanceRate;
    const advanceRounded = Math.round(advanceAmount * 100) / 100;

    // 5) Optional: look up lead cost for lead_charge row
    let leadChargeAmount = 0;
    if (policy.lead_id) {
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .select('id, cost')
        .eq('id', policy.lead_id)
        .single();

      if (!leadErr && lead && lead.cost != null) {
        // Convention: negative amount for debits
        leadChargeAmount = -Math.abs(Number(lead.cost) || 0);
      }
    }

    // 6) Override logic for direct upline (recruiter)
    let overrideAmount = 0;
    let uplineInfo = null;

    if (agent.recruiter_id) {
      const { data: upline, error: uplineErr } = await supabase
        .from('agents')
        .select('id, full_name, level')
        .eq('id', agent.recruiter_id)
        .single();

      if (!uplineErr && upline) {
        uplineInfo = upline;
        const upline_level = upline.level || 'agent';

        const { data: scheduleUpline, error: scheduleErrUpline } = await supabase
          .from('commission_schedules')
          .select('base_commission_rate')
          .eq('carrier_name', policy.carrier_name)
          .eq('product_line', policy.product_line)
          .eq('policy_type', policy.policy_type)
          .eq('agent_level', upline_level)
          .single();

        if (!scheduleErrUpline && scheduleUpline) {
          const baseRateUpline = Number(scheduleUpline.base_commission_rate) || 0;
          const spread = baseRateUpline - baseRateAgent;

          if (spread > 0) {
            const rawOverride = ap * spread * advanceRate;
            overrideAmount = Math.round(rawOverride * 100) / 100;
          }
        }
      }
    }

    // 7) Build ledger rows array
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

    // Lead charge (if any)
    if (leadChargeAmount !== 0) {
      ledgerRows.push({
        agent_id: policy.agent_id,
        policy_id: policy.id,
        amount: leadChargeAmount,
        currency: 'USD',
        entry_type: 'lead_charge',
        description: 'Lead cost for this policy',
        meta: {
          lead_id: policy.lead_id
        }
      });
    }

    // Override credit for upline (if any)
    if (overrideAmount > 0 && uplineInfo) {
      ledgerRows.push({
        agent_id: uplineInfo.id,
        policy_id: policy.id,
        amount: overrideAmount,
        currency: 'USD',
        entry_type: 'override',
        description: `Override on downline policy (${agent.full_name})`,
        meta: {
          downline_agent_id: agent.id,
          downline_agent_name: agent.full_name,
          carrier_name: policy.carrier_name,
          product_line: policy.product_line,
          policy_type: policy.policy_type,
          ap
        }
      });
    }

    // 8) Insert into commission_ledger
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
          message: 'Commission processed and ledger rows created.',
          policy_id,
          agent: { id: agent.id, full_name: agent.full_name, level: agent_level },
          advance: advanceRounded,
          lead_charge: leadChargeAmount,
          override: {
            amount: overrideAmount,
            upline: uplineInfo
              ? { id: uplineInfo.id, full_name: uplineInfo.full_name, level: uplineInfo.level || null }
              : null
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
