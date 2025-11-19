// netlify/functions/send-ica.js
// Sends ICA via SignWell template + tracks status in Supabase

const { createClient } = require('@supabase/supabase-js');

// ---- Environment variables ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// SignWell config
const ESIGN_API_KEY = process.env.ESIGN_API_KEY || '';
const ESIGN_API_BASE_URL =
  process.env.ESIGN_API_BASE_URL || 'https://www.signwell.com/api/v1';
const ESIGN_ICA_TEMPLATE_ID = process.env.ESIGN_ICA_TEMPLATE_ID || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
}

if (!ESIGN_API_KEY || !ESIGN_ICA_TEMPLATE_ID) {
  console.warn(
    '⚠️ ESIGN_API_KEY or ESIGN_ICA_TEMPLATE_ID is not set. ICA sending will fail.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---- Helper for responses ----
function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'OPTIONS, POST',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(data)
  };
}

/**
 * Actually create a SignWell document from the ICA template.
 * payload = { email, firstName, lastName, level, agentId, approvedAgentId }
 *//**
 * Actually create a SignWell document from the ICA template.
 * payload = { email, firstName, lastName, level, agentId, approvedAgentId }
 */
async function createEnvelopeWithEsignProvider(payload) {
  if (!ESIGN_API_KEY || !ESIGN_ICA_TEMPLATE_ID) {
    throw new Error('SignWell API not fully configured');
  }

  // ✅ Use the generic /documents endpoint
  const url = `${ESIGN_API_BASE_URL}/documents/`;

  // This role MUST match the role name defined in your SignWell template
  const signerRole = 'Contractor'; // change if your template role name is different

  const body = {
    // test_mode: true will send "test" envelopes in SignWell
    test_mode: false,

    // Either `title` or `name` (we'll send both just to be safe)
    title: `Independent Contractor Agreement - ${payload.firstName} ${payload.lastName}`,
    name:  `Independent Contractor Agreement - ${payload.firstName} ${payload.lastName}`,

    subject: 'Independent Contractor Agreement',
    message:
      'Please review and sign the Independent Contractor Agreement to get started with Family Values Group.',

    // ✅ IMPORTANT: This is what the 422 error is asking for
    recipients: [
      {
        name:  `${payload.firstName} ${payload.lastName}`,
        email: payload.email,
        role:  signerRole,   // must match the template role
      }
    ],

    // ✅ IMPORTANT: this satisfies the "files" requirement by telling
    // SignWell to use your saved template
    template_ids: [ESIGN_ICA_TEMPLATE_ID],

    // Optional: store extra info on the document
    metadata: {
      agent_id: payload.agentId,
      level: payload.level,
      approved_agent_id: payload.approvedAgentId || null
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': ESIGN_API_KEY
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    json = { raw: text };
  }

  if (!res.ok) {
    console.error('SignWell API error:', res.status, text);
    throw new Error(
      `SignWell error ${res.status}: ${
        json.error || json.message || 'see logs'
      }`
    );
  }

  // SignWell returns an id for the document
  const envelopeId = json.id || json.document_id || null;
  const status = json.status || 'sent';

  return {
    envelopeId,
    status,
    raw: json
  };
}

// ---- Netlify handler ----
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
      agent_id, // NPN
      email,
      first_name,
      last_name,
      level, // Agent / MIT / Manager / MGA / Area Manager
      approved_agent_id // optional: direct reference to approved_agents.id
    } = body;

    if (!agent_id) {
      return jsonResponse(400, { error: 'agent_id (NPN) is required' });
    }
    if (!email) {
      return jsonResponse(400, { error: 'email is required to send ICA' });
    }
    if (!first_name || !last_name) {
      return jsonResponse(400, {
        error: 'first_name and last_name are required'
      });
    }
    if (!level) {
      return jsonResponse(400, {
        error:
          'level is required (Agent / MIT / Manager / MGA / Area Manager)'
      });
    }

    // 1) Fetch the approved_agents row
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
        return jsonResponse(500, {
          error: 'Failed to load approved agent (by agent_id)'
        });
      }
      approvedAgentRow = data;
    }

    if (!approvedAgentRow) {
      return jsonResponse(404, {
        error: 'No approved_agents row found. Pre-approve the agent first.'
      });
    }

    const approvedId = approvedAgentRow.id;

    // 2) Call SignWell
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

    // 3) Insert into ica_envelopes
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
      // not fatal
    }

    // 4) Update approved_agents with ICA info
    const { error: updateApprErr } = await supabase
      .from('approved_agents')
      .update({
        level,
        email,
        first_name,
        last_name,
        ica_envelope_id: envelopeId,
        ica_status: envelopeStatus,
        ica_signed: envelopeStatus === 'completed'
      })
      .eq('id', approvedId);

    if (updateApprErr) {
      console.error('Error updating approved_agents:', updateApprErr);
      return jsonResponse(500, {
        error: 'Failed to update approved_agents with ICA info'
      });
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
