// netlify/functions/remove-agent.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.');
}

const supabase = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    return {
      statusCode: 400,
      body: 'Invalid JSON body'
    };
  }

  const { auth_user_id, agent_id } = payload || {};
  if (!auth_user_id && !agent_id) {
    return {
      statusCode: 400,
      body: 'auth_user_id or agent_id is required'
    };
  }

  try {
    // 1) Load agent row so we know id, NPN, name, recruiter, email
    const agentQuery = supabase
      .from('agents')
      .select('id, agent_id, first_name, last_name, recruiter_id, email')
      .limit(1);

    const { data: agentData, error: agentErr } = await (auth_user_id
      ? agentQuery.eq('id', auth_user_id)
      : agentQuery.eq('agent_id', agent_id));

    if (agentErr) {
      console.error('Error fetching agent:', agentErr);
      return {
        statusCode: 500,
        body: 'Failed to fetch agent: ' + agentErr.message
      };
    }

    const agent = agentData && agentData[0];
    if (!agent) {
      return {
        statusCode: 404,
        body: 'Agent not found'
      };
    }

    const authId  = agent.id;                 // should equal auth.users.id
    const npn     = agent.agent_id;
    const first   = agent.first_name;
    const last    = agent.last_name;
    const upliner = agent.recruiter_id;

    // 2) Start deleting related rows. Do in a safe order.

    // 2a) Delete NIPR tables (by NPN)
    const niprTables = [
      'agent_nipr_appointments',
      'agent_nipr_licenses',
      'agent_nipr_profile',
      'agent_nipr_snapshot'
    ];

    for (const table of niprTables) {
      const { error: niprErr } = await supabase
        .from(table)
        .delete()
        .eq('agent_id', npn);

      if (niprErr) {
        console.error(`Error deleting from ${table}:`, niprErr);
        // We keep going, but include info in response
      }
    }

    // 2b) Delete approved_agents row for this NPN
    const { error: appErr } = await supabase
      .from('approved_agents')
      .delete()
      .eq('agent_id', npn);

    if (appErr) {
      console.error('Error deleting from approved_agents:', appErr);
    }

    // 2c) Delete recruits row that represents THIS agent
    //     (same logic used when you promoted them: recruiter + name)
    if (upliner && first && last) {
      const { error: recErr } = await supabase
        .from('recruits')
        .delete()
        .eq('recruiter_id', upliner)
        .ilike('first_name', first)
        .ilike('last_name', last);

      if (recErr) {
        console.error('Error deleting from recruits:', recErr);
      }
    }

    // 2d) (Optional but safer) Clear leads assigned_to → null so FK (if any) doesn’t block
    //     If you don't have FK or you don't want this, you can remove this block.
    const { error: leadsErr } = await supabase
      .from('leads')
      .update({ assigned_to: null })
      .eq('assigned_to', authId);

    if (leadsErr) {
      console.error('Error clearing leads.assigned_to:', leadsErr);
      // not fatal for the rest, but worth logging
    }

    // 2e) Delete from agents table
    const { error: agentDelErr } = await supabase
      .from('agents')
      .delete()
      .eq('id', authId);

    if (agentDelErr) {
      console.error('Error deleting from agents:', agentDelErr);
      return {
        statusCode: 500,
        body: 'Failed to delete agent row: ' + agentDelErr.message
      };
    }

    // 3) Delete the auth user
    //    ⚠️ This only works with service key and supabase-js v2+
    try {
      const { error: authErr } = await supabase.auth.admin.deleteUser(authId);
      if (authErr) {
        console.error('Error deleting auth user:', authErr);
        // Not fatal to DB consistency, but important to know
      }
    } catch (authCatchErr) {
      console.error('Exception deleting auth user:', authCatchErr);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        removed_agent_id: authId,
        removed_agent_npn: npn
      })
    };
  } catch (err) {
    console.error('Unexpected error in remove-agent function:', err);
    return {
      statusCode: 500,
      body: 'Unexpected error'
    };
  }
};
