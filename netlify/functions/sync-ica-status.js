// netlify/functions/sync-ica-status.js
// Sync latest ICA status from SignWell into Supabase + notify uplines

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
    const wasCompleted = (approved.ica_status || '').toLowerCase() === 'completed';

    const updatePayload = {
      ica_status: latestStatus
    };

    let justCompletedNow = false;

    // If it just became completed, mark signed + timestamp + onboarding_stage
    if (latestStatus === 'completed' && !wasSigned && !wasCompleted) {
      justCompletedNow = true;
      updatePayload.ica_signed = true;
      updatePayload.ica_signed_at = nowIso;

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

    // 3) Notify uplines only the *first* time it becomes completed
    if (justCompletedNow) {
      try {
        // Collect recipient IDs: recruiter + all admins
        const recipientIds = new Set();

        if (approved.recruiter_id) {
          recipientIds.add(approved.recruiter_id);
        }

        const { data: admins, error: adminErr } = await supabase
          .from('agents')
          .select('id')
          .eq('is_admin', true);

        if (adminErr) {
          console.error('Error loading admins for ICA notification:', adminErr);
        } else if (admins) {
          admins.forEach(a => recipientIds.add(a.id));
        }

        const recipients = Array.from(recipientIds);
        if (recipients.length) {
          const agentName =
            (approved.first_name || approved.last_name)
              ? `${approved.first_name || ''} ${approved.last_name || ''}`.trim()
              : approved.agent_id;

          const tasks = recipients.map(rid => ({
            title: `New agent ICA signed: ${agentName}`,
            status: 'open',
            assigned_to: rid,
            metadata: {
              type: 'onboarding',
              stage: 'ica_signed',
              agent_id: approved.agent_id,
              approved_agent_id: approved.id
            }
          }));

          const { error: taskErr } = await supabase
            .from('tasks')
            .insert(tasks);

          if (taskErr) {
            console.error('Error inserting ICA notification tasks:', taskErr);
          }
        }
      } catch (notifyErr) {
        console.error('Error during ICA upline notifications:', notifyErr);
      }
    }

    return jsonResponse(200, {
      ok: true,
      ica_status: latestStatus,
      ica_signed: latestStatus === 'completed' || wasSigned,
      ica_signed_at:
        latestStatus === 'completed'
          ? (approved.ica_signed_at || nowIso)
          : (approved.ica_signed_at || null)
    });
  } catch (err) {
    console.error('sync-ica-status error:', err);
    return jsonResponse(500, { error: 'Unexpected error in sync-ica-status' });
  }
};
