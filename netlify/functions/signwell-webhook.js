// netlify/functions/signwell-webhook.js
// Receives SignWell events and updates ICA + approved_agents
// Also captures Phone_1 from the document fields and notifies uplines
// when an ICA becomes completed for the first time.

const { createClient } = require('@supabase/supabase-js');

// ---- Environment variables ----
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Simple helper for Netlify HTTP responses
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

// Normalize phone into something Telnyx-friendly (US-centric)
function normalizePhoneToE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;

  // 10 digits -> assume US, prefix +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // 11 digits starting with 1 -> +1XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // Fallback: return with + if missing
  if (!digits.startsWith('+')) {
    return `+${digits}`;
  }

  return digits;
}

// Flatten SignWell's fields (array of pages -> array of fields)
function flattenFields(fieldsGrid) {
  if (!Array.isArray(fieldsGrid)) return [];
  const flat = [];
  for (const page of fieldsGrid) {
    if (Array.isArray(page)) {
      for (const f of page) {
        flat.push(f);
      }
    }
  }
  return flat;
}

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (err) {
    console.error('❌ Failed to parse SignWell webhook body:', err);
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  const eventType = payload?.event?.type || '';
  const doc = payload?.data?.object;

  if (!doc || !doc.id) {
    console.warn('⚠️ Webhook without document object/id');
    return jsonResponse(200, { ok: true, skipped: 'no document' });
  }

  const documentId = doc.id;
  const status = doc.status || '';
  const lowerStatus = status.toLowerCase();
  const isCompleted = lowerStatus === 'completed';

  console.log('📩 SignWell webhook:', {
    eventType,
    documentId,
    status
  });

  // ---- 1) Find ICA envelope row by envelope_id (document id) ----
  const { data: icaRow, error: icaErr } = await supabase
    .from('ica_envelopes')
    .select('id, approved_agent_id')
    .eq('envelope_id', documentId)
    .maybeSingle();

  if (icaErr) {
    console.error('❌ Error loading ica_envelopes for doc', documentId, icaErr);
    return jsonResponse(500, { error: 'DB error loading ICA' });
  }

  if (!icaRow) {
    console.warn('⚠️ No ica_envelopes row found for document', documentId);
    // Not fatal – maybe this was some other doc
    return jsonResponse(200, { ok: true, skipped: 'no ica_envelopes match' });
  }

  const completedAt =
    isCompleted && doc.updated_at
      ? doc.updated_at
      : (isCompleted ? new Date().toISOString() : null);

  // ---- 2) Update ica_envelopes with latest status & payload ----
  const { error: updateIcaErr } = await supabase
    .from('ica_envelopes')
    .update({
      status: status,
      completed_at: completedAt,
      raw_payload: doc // store full document object for debugging/reference
    })
    .eq('id', icaRow.id);

  if (updateIcaErr) {
    console.error('❌ Error updating ica_envelopes:', updateIcaErr);
    // Not fatal for our logic below – continue
  }

  // ---- 3) Load existing approved_agent row so we can detect first-time completion ----
  const { data: approved, error: apprErr } = await supabase
    .from('approved_agents')
    .select('*')
    .eq('id', icaRow.approved_agent_id)
    .maybeSingle();

  if (apprErr) {
    console.error(
      '❌ Error loading approved_agents for id',
      icaRow.approved_agent_id,
      apprErr
    );
    return jsonResponse(500, { error: 'DB error loading approved_agent' });
  }

  if (!approved) {
    console.warn(
      '⚠️ No approved_agents row found for id',
      icaRow.approved_agent_id
    );
    return jsonResponse(200, { ok: true, skipped: 'no approved_agents match' });
  }

  const prevStatus = (approved.ica_status || '').toLowerCase();
  const prevSigned = approved.ica_signed === true;
  const wasCompletedBefore = prevStatus === 'completed';

  // ---- 4) Extract Phone_1 from fields (if present) ----
  let phoneFromDoc = null;
  try {
    const flatFields = flattenFields(doc.fields || []);
    const phoneField = flatFields.find(f => f.api_id === 'Phone_1');
    if (phoneField && phoneField.value) {
      phoneFromDoc = normalizePhoneToE164(phoneField.value);
      console.log(
        '📞 Extracted Phone_1 from doc:',
        phoneField.value,
        '=>',
        phoneFromDoc
      );
    } else {
      console.log('ℹ️ No Phone_1 field value found on this document.');
    }
  } catch (err) {
    console.error('❌ Error extracting Phone_1 from fields:', err);
  }

  // ---- 5) Build update payload for approved_agents ----
  const approvedUpdate = {
    ica_status: status,
    ica_envelope_id: documentId,
    // Only mark signed when completed
    ica_signed: isCompleted || prevSigned,
    ica_signed_at: isCompleted
      ? (approved.ica_signed_at || completedAt || new Date().toISOString())
      : approved.ica_signed_at || null
  };

  // If you’re using onboarding stages, bump the stage on completion
  if (isCompleted && (!approved.onboarding_stage || approved.onboarding_stage === 'pre_approved')) {
    approvedUpdate.onboarding_stage = 'ica_signed';
  }

  // If we got a phone from the doc, store it
  if (phoneFromDoc) {
    // Make sure your approved_agents table has a "phone" text column.
    approvedUpdate.phone = phoneFromDoc;
  }

  const { error: approvedErr } = await supabase
    .from('approved_agents')
    .update(approvedUpdate)
    .eq('id', approved.id);

  if (approvedErr) {
    console.error('❌ Error updating approved_agents from webhook:', approvedErr);
    return jsonResponse(500, { error: 'Failed to update approved_agents' });
  }

  console.log(
    '✅ Updated approved_agents from SignWell webhook for approved_agent_id',
    approved.id
  );

  // ---- 6) Upline notifications when ICA becomes completed for the first time ----
  let justCompletedNow = false;
  if (isCompleted && !prevSigned && !wasCompletedBefore) {
    justCompletedNow = true;
  }

  if (justCompletedNow) {
    console.log(
      '📣 ICA just completed for the first time for approved_agent_id',
      approved.id
    );
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
        console.error(
          'Error loading admins for ICA notification from webhook:',
          adminErr
        );
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
          console.error('Error inserting ICA notification tasks (webhook):', taskErr);
        } else {
          console.log(
            '✅ Inserted ICA notification tasks for recipients:',
            recipients
          );
        }
      } else {
        console.log('ℹ️ No recipients found for ICA notification (webhook).');
      }
    } catch (notifyErr) {
      console.error('Error during ICA upline notifications (webhook):', notifyErr);
    }
  }

  return jsonResponse(200, { ok: true });
};
