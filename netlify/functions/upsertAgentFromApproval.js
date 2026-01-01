// netlify/functions/upsertAgentFromApproval.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Use POST' };

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const user_id  = String(body.user_id || '').trim();
  const agent_id = String(body.agent_id || '').trim();
  const email    = String(body.email || '').trim().toLowerCase();

  if (!user_id)  return { statusCode: 400, body: 'user_id is required' };
  if (!agent_id) return { statusCode: 400, body: 'agent_id is required' };
  if (!email)    return { statusCode: 400, body: 'email is required' };

  // 1) Load approved record
  const { data: approved, error: apprErr } = await supabase
    .from('approved_agents')
    .select('id, agent_id, email, first_name, last_name, phone, level, recruiter_id, stripe_account_id')
    .eq('agent_id', agent_id)
    .maybeSingle();

  if (apprErr) return { statusCode: 500, body: `approved_agents read error: ${apprErr.message}` };
  if (!approved) return { statusCode: 403, body: 'Agent not pre-approved' };

  const approvedEmail = String(approved.email || '').trim().toLowerCase();
  if (approvedEmail !== email) return { statusCode: 403, body: 'Email does not match pre-approval record' };

  // 2) Optional: pull Stripe from waitlist too (if you created Stripe before approval got updated)
  const { data: waitRow } = await supabase
    .from('agent_waitlist')
    .select('stripe_account_id')
    .eq('agent_id', agent_id)
    .maybeSingle();

  const stripeId = waitRow?.stripe_account_id ?? approved.stripe_account_id ?? null;

  const fullName =
    [approved.first_name, approved.last_name].filter(Boolean).join(' ') ||
    approved.agent_id;

  // 3) Upsert agent row (create if missing; update if exists)
  const { data: existing } = await supabase
    .from('agents')
    .select('id, created_at, show_on_about')
    .eq('id', user_id)
    .maybeSingle();

  if (!existing) {
    const { error: insErr } = await supabase.from('agents').insert({
      id: user_id,
      email,
      agent_id: approved.agent_id,
      full_name: fullName,

      // ✅ fields you said must not be null
      show_on_about: false,
      phone: approved.phone || null,
      level: approved.level || null,
      stripe_account_id: stripeId,

      // normal fields
      first_name: approved.first_name || null,
      last_name: approved.last_name || null,
      recruiter_id: approved.recruiter_id || null,
      is_active: true,
      is_admin: false,
      profile_picture_url: null,
      companies: null,
      product_types: null,
      licensed_states_by_line: {},
      is_available: false
      // created_at will be filled by DB default if you set it, or remains null otherwise
    });

    if (insErr) return { statusCode: 500, body: `agents insert error: ${insErr.message}` };
  } else {
    const patch = {
      is_active: true,
      phone: approved.phone || null,
      level: approved.level || null,
      stripe_account_id: stripeId
    };

    if (existing.show_on_about == null) patch.show_on_about = false;
    if (!existing.created_at) patch.created_at = new Date().toISOString(); // optional backfill

    const { error: updErr } = await supabase
      .from('agents')
      .update(patch)
      .eq('id', user_id);

    if (updErr) return { statusCode: 500, body: `agents update error: ${updErr.message}` };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, user_id, agent_id, stripe_account_id: stripeId })
  };
}
