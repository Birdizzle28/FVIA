// netlify/functions/storeSignupSSN.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const encKey      = process.env.SSN_ENCRYPTION_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' };
  }
  if (!encKey) {
    return { statusCode: 500, body: 'Missing SSN_ENCRYPTION_KEY env var' };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const agent_id = String(body.agent_id || '').trim();
  const email    = String(body.email || '').trim().toLowerCase();
  const user_id  = String(body.user_id || '').trim();
  const ssnRaw   = String(body.ssn || '').trim();

  const ssn = onlyDigits(ssnRaw);

  if (!agent_id) return { statusCode: 400, body: 'agent_id is required' };
  if (!email)    return { statusCode: 400, body: 'email is required' };
  if (!user_id)  return { statusCode: 400, body: 'user_id is required' };
  if (ssn.length !== 9) return { statusCode: 400, body: 'SSN must be 9 digits' };

  // 1) Verify agent is pre-approved, email matches
  const { data: approved, error: apprErr } = await supabase
    .from('approved_agents')
    .select('id, agent_id, email, is_registered')
    .eq('agent_id', agent_id)
    .maybeSingle();

  if (apprErr) {
    return { statusCode: 500, body: `Error reading approved_agents: ${apprErr.message}` };
  }
  if (!approved) {
    return { statusCode: 403, body: 'Agent not pre-approved' };
  }
  if ((approved.email || '').toLowerCase().trim() !== email) {
    return { statusCode: 403, body: 'Email does not match pre-approval record' };
  }

  // ✅ If already registered, only allow SSN storage if THIS request matches the real agent row
  if (approved.is_registered) {
    const { data: agentRow, error: agentErr } = await supabase
      .from('agents')
      .select('id, agent_id, email')
      .eq('id', user_id)
      .maybeSingle();

    if (agentErr) {
      return { statusCode: 500, body: `Error reading agents: ${agentErr.message}` };
    }

    const agentOk =
      agentRow &&
      String(agentRow.id) === user_id &&
      String(agentRow.agent_id || '').trim() === agent_id &&
      String(agentRow.email || '').trim().toLowerCase() === email;

    if (!agentOk) {
      return { statusCode: 409, body: 'Agent already registered' };
    }
    // else: same agent/user/email → allow SSN storage
  }

  // 2) Update agents row with encrypted SSN (server-side encryption via pgcrypto)
  const { error: updErr } = await supabase.rpc('fvia_store_agent_ssn', {
    p_user_id: user_id,
    p_agent_id: agent_id,
    p_email: email,
    p_ssn: ssn,
    p_key: encKey
  });

  if (updErr) {
    return { statusCode: 500, body: `Failed to store SSN: ${updErr.message}` };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, user_id, agent_id, ssn_last4: ssn.slice(-4) })
  };
}
