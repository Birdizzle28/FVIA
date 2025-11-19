// netlify/functions/send-ica.js
// Generic ICA sender – wire real e-sign provider later (DocuSign, SignWell, etc.)

const { createClient } = require('@supabase/supabase-js');

// ✅ Environment variables you MUST set in Netlify dashboard
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Optional: placeholders for your future e-sign provider
const ESIGN_API_KEY = process.env.ESIGN_API_KEY || '';
const ESIGN_API_BASE_URL = process.env.ESIGN_API_BASE_URL || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Placeholder: create an envelope with your e-sign provider
 * Replace this with real DocuSign / SignWell calls later.
 *
 * For now, it just returns a fake envelopeId + status so you can
 * test the entire flow (DB writes, UI, etc.) without hitting a real API.
 */
async function createEnvelopeWithEsignProvider(payload) {
  // payload = { email, firstName, lastName, level, agentId, approvedAgentId }

  console.log('createEnvelopeWithEsignProvider() called with:', payload);

  // TODO: Replace with real HTTP call to DocuSign / SignWell
  // Example shape:
  // const res = await fetch(`${ESIGN_API_BASE_URL}/envelopes`, { ... });
  // const json = await res.json();
  // return {
  //   envelopeId: json.envelopeId,
  //   status: json.status || 'sent',
  //   raw: json
  // };

  const fakeEnvelopeId = `DEMO-ENV-${Date.now()}`;

  return {
    envelopeId: fakeEnvelopeId,
    status: 'sent',
    raw: {
      provider: 'demo',
      at: new Date().toISOString()
    }
  };
}

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*', // same-origin in your app, but leave * for now
      'Access-Control-Allow-Methods': 'OPTIONS, POST',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event, context) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const {
      agent_id,           // NPN
      email,
      first_name,
      last_name,
      level,              // Agent / MIT / Manager / MGA / Area Manager
      approved_agent_id   // optional: direct reference to approved_agents.id
    } = body;

    if (!agent_id) {
      return jsonResponse(400, { error: 'agent_id (NPN) is required' });
    }
    if (!email) {
      return jsonResponse(400, { error: 'email is required to send ICA' });
    }
    if (!first_name || !last_name) {
      return jsonResponse(400, { error: 'first_name and last_name are required' });
    }
    if (!level) {
      return jsonResponse(400, { error: 'level is required (Agent / MIT / Manager / MGA / Area Manager)' });
    }

    // 1) Fetch the approved_agents row (by id if provided, otherwise by agent_id)
    let approvedAgentRow = null;

    if (approved_agent_id) {
      const { data, error } = await supabase
        .from('approved_agents')
        .select('*')
        .eq('id', approved_agent_id)
        .maybeSingle();

      if (error) {
        console.error('Error loading approved_agents by id:', error);
        return jsonResponse(500, { error: 'Failed to load approved agent (by id)' });
      }

      approvedAgentRow = data;
    } else {
      const { data, error } = await supabase
        .from('approved_agents')
        .select('*')
        .eq('agent_id', agent_id)
        .maybeSingle();

      if (error) {
        console.error('Error loading approved_agents by agent_id:', error);
        return jsonResponse(500, { error: 'Failed to load approved agent (by agent_id)' });
      }

      approvedAgentRow = data;
    }

    if (!approvedAgentRow) {
      return jsonResponse(404, {
        error: 'No approved_agents row found. Pre-approve the agent first.'
      });
    }

    const approvedId = approvedAgentRow.id;

    // 2) Call the e-sign provider (placeholder stub for now)
    const envelope = await createEnvelopeWithEsignProvider({
      email,
      firstName: first_name,
      lastName: last_name,
      level,
      agentId: agent_id,
      approvedAgentId: approvedId
    });

    if (!envelope || !envelope.envelopeId) {
      console.error('E-sign provider did not return an envelopeId:', envelope);
      return jsonResponse(502, {
        error: 'Failed to create ICA envelope with e-sign provider'
      });
    }

    const envelopeId = envelope.envelopeId;
    const envelopeStatus = envelope.status || 'sent';

    // 3) Insert into ica_envelopes (audit log of all envelopes)
    const { error: insertEnvErr } = await supabase
      .from('ica_envelopes')
      .insert({
        approved_agent_id: approvedId,
        agent_id,
        envelope_id: envelopeId,
        status: envelopeStatus,
        sent_at: new Date().toISOString(),
        raw_payload: envelope.raw || null
      });

    if (insertEnvErr) {
      console.error('Error inserting into ica_envelopes:', insertEnvErr);
      // Not fatal for the caller, but we should still let them know
    }

    // 4) Update approved_agents with level, contact info, and ICA status
    const { error: updateApprErr } = await supabase
      .from('approved_agents')
      .update({
        level,
        email,
        first_name,
        last_name,
        ica_envelope_id: envelopeId,
        ica_status: envelopeStatus,
        ica_signed: envelopeStatus === 'completed' // usually "sent", so this will be false
      })
      .eq('id', approvedId);

    if (updateApprErr) {
      console.error('Error updating approved_agents:', updateApprErr);
      return jsonResponse(500, { error: 'Failed to update approved_agents with ICA info' });
    }

    return jsonResponse(200, {
      ok: true,
      message: 'ICA envelope created and tracked successfully.',
      envelope_id: envelopeId,
      status: envelopeStatus
    });
  } catch (err) {
    console.error('send-ica error:', err);
    return jsonResponse(500, { error: 'Unexpected error in send-ica function' });
  }
};
