// netlify/functions/sync-ica-status.js
// Sync latest ICA status from SignWell into Supabase

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ESIGN_API_KEY = process.env.ESIGN_API_KEY || '';
const ESIGN_API_BASE_URL =
  process.env.ESIGN_API_BASE_URL || 'https://www.signwell.com/api/v1';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  if (!ESIGN_API_KEY) {
    console.error('ESIGN_API_KEY is not set');
    return jsonResponse(500, { error: 'SignWell API not configured' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { approved_agent_id, agent_id } = body;

    if (!approved_agent_id && !agent_id) {
      return jsonResponse(400, {
        error: 'approved_agent_id or agent_id is required'
      });
    }

    // 1) Load approved_agents row
    let query = supabase.from('approved_agents').select('*').limit(1);
    if (approved_agent_id) {
      query = query.eq('id', approved_agent_id);
    } else {
      query = query.eq('agent_id', agent_id);
    }

    const { data: rows, error: apprErr } = await query;
    if (apprErr) {
      console.error('Error loading approved_agents:', apprErr);
      return jsonResponse(500, { error: 'Failed to load approved agent' });
    }

    const approved = rows && rows[0];
    if (!approved) {
      return jsonResponse(404, { error: 'Approved agent not found' });
    }

    const envelopeId = approved.ica_envelope_id;
    if (!envelopeId) {
      return jsonResponse(400, {
        error: 'No ICA envelope_id stored for this agent yet'
      });
    }

    // 2) Call SignWell for latest document status
    const docUrl = `${ESIGN_API_BASE_URL}/documents/${envelopeId}/`;

    const res = await fetch(docUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': ESIGN_API_KEY
      }
    });

    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch (_) {
      json = { raw: text };
    }

    if (!res.ok) {
      console.error('SignWell GET /documents error:', res.status, text);
      return jsonResponse(502, {
        error: `Failed to fetch ICA status from SignWell (${res.status})`
      });
    }

    const latestStatus = (json.status || '').toLowerCase() || 'unknown';
    const nowIso = new Date().toISOString();
    const wasSigned = approved.ica_signed === true;

    const updatePayload = {
      ica_status: latestStatus
    };

    // If it just became completed, mark signed + timestamp + onboarding_stage
    if (latestStatus === 'completed' && !wasSigned) {
      updatePayload.ica_signed = true;
      updatePayload.ica_signed_at = nowIso;
      // bump onboarding stage if you want
      if (!approved.onboarding_stage || approved.onboarding_stage === 'pre_approved') {
        updatePayload.onboarding_stage = 'ica_signed';
      }
    }

    const { error: updateErr } = await supabase
      .from('approved_agents')
      .update(updatePayload)
      .eq('id', approved.id);

    if (updateErr) {
      console.error('Error updating approved_agents with ICA status:', updateErr);
      return jsonResponse(500, {
        error: 'Failed to update ICA status in Supabase'
      });
    }

    return jsonResponse(200, {
      ok: true,
      ica_status: latestStatus,
      ica_signed: latestStatus === 'completed' || wasSigned,
      ica_signed_at: latestStatus === 'completed'
        ? (approved.ica_signed_at || nowIso)
        : (approved.ica_signed_at || null)
    });
  } catch (err) {
    console.error('sync-ica-status error:', err);
    return jsonResponse(500, { error: 'Unexpected error in sync-ica-status' });
  }
};
