import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.ZOHO_USER;
const SMTP_PASS = process.env.ZOHO_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_PORT === 465,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS
  }
});

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  };
}

function uniqueStrings(arr = []) {
  return [...new Set((arr || []).map(v => String(v || '').trim()).filter(Boolean))];
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const requestIds = Array.isArray(body.request_ids) ? body.request_ids : [];

    if (!requestIds.length) {
      return json(400, { error: 'request_ids is required.' });
    }

    const { data: requests, error: requestError } = await supabase
      .from('carrier_contracting_requests')
      .select(`
        id,
        agent_id,
        carrier_id,
        status,
        batch_key,
        start_method_snapshot,
        destination_group_snapshot,
        email_to_snapshot,
        email_cc_snapshot,
        email_bcc_snapshot,
        email_subject_snapshot,
        email_body_snapshot,
        agents:agent_id (
          id,
          full_name,
          email,
          agent_id
        ),
        carriers:carrier_id (
          carrier_name
        )
      `)
      .in('id', requestIds);

    if (requestError) {
      return json(500, { error: requestError.message });
    }

    if (!requests || !requests.length) {
      return json(404, { error: 'No matching contracting requests found.' });
    }

    const emailRequests = requests.filter(
      r => (r.start_method_snapshot || '').toLowerCase() === 'email'
    );

    if (!emailRequests.length) {
      return json(400, { error: 'No email-based requests found in the provided request_ids.' });
    }

    const grouped = {};
    for (const req of emailRequests) {
      const key = `${req.agent_id}__${req.destination_group_snapshot || req.id}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(req);
    }

    const results = [];

    for (const [groupKey, groupRequests] of Object.entries(grouped)) {
      const first = groupRequests[0];
      const agent = first.agents || {};
      const carrierNames = groupRequests.map(r => r.carriers?.carrier_name || 'Unknown Carrier');

      let subject = first.email_subject_snapshot || `Contracting Request - ${agent.full_name || agent.email || 'Agent'}`;
      let body = first.email_body_snapshot || '';

      subject = subject
        .replaceAll('{{agent_name}}', agent.full_name || '')
        .replaceAll('{{agent_email}}', agent.email || '')
        .replaceAll('{{agent_id}}', agent.agent_id || '')
        .replaceAll('{{carrier_names}}', carrierNames.join(', '))
        .replaceAll('{{carrier_names_list}}', carrierNames.map(name => `- ${name}`).join('\n'));

      body = body
        .replaceAll('{{agent_name}}', agent.full_name || '')
        .replaceAll('{{agent_email}}', agent.email || '')
        .replaceAll('{{agent_id}}', agent.agent_id || '')
        .replaceAll('{{carrier_names}}', carrierNames.join(', '))
        .replaceAll('{{carrier_names_list}}', carrierNames.map(name => `- ${name}`).join('\n'))
        .replaceAll('%0D%0A', '\n')
        .replaceAll('%20', ' ');

      const to = uniqueStrings(first.email_to_snapshot);
      const cc = uniqueStrings(first.email_cc_snapshot);
      const bcc = uniqueStrings(first.email_bcc_snapshot);

      if (!to.length) {
        results.push({
          group_key: groupKey,
          success: false,
          error: 'No recipient email found.',
          request_ids: groupRequests.map(r => r.id)
        });
        continue;
      }

      try {
        const info = await transporter.sendMail({
          from: SMTP_FROM,
          to,
          cc,
          bcc,
          subject,
          text: body
        });

        const sentIds = groupRequests.map(r => r.id);

        const { error: updateError } = await supabase
          .from('carrier_contracting_requests')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .in('id', sentIds);

        if (updateError) {
          results.push({
            group_key: groupKey,
            success: false,
            error: updateError.message,
            request_ids: sentIds
          });
          continue;
        }

        results.push({
          group_key: groupKey,
          success: true,
          message_id: info.messageId,
          request_ids: sentIds,
          to,
          carrier_names: carrierNames,
          agent_name: agent.full_name || agent.email || 'Agent'
        });
      } catch (sendError) {
        results.push({
          group_key: groupKey,
          success: false,
          error: sendError.message,
          request_ids: groupRequests.map(r => r.id)
        });
      }
    }

    return json(200, {
      ok: true,
      results
    });
  } catch (error) {
    return json(500, { error: error.message || 'Unexpected error.' });
  }
}
