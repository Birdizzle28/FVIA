import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function uniqueStrings(arr = []) {
  return [...new Set((arr || []).map(v => String(v || '').trim()).filter(Boolean))];
}

function fillTemplate(template, agent, carrierNames, destinationEmail = '') {
  const namesList = carrierNames.map(name => `- ${name}`).join('\n');

  return String(template || '')
    .replaceAll('{{agent_name}}', agent.full_name || '')
    .replaceAll('{{agent_email}}', agent.email || '')
    .replaceAll('{{agent_id}}', agent.agent_id || '')
    .replaceAll('{{carrier_names}}', carrierNames.join(', '))
    .replaceAll('{{carrier_names_list}}', namesList)
    .replaceAll('{{destination_email}}', destinationEmail || '');
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const request_ids = Array.isArray(body.request_ids) ? body.request_ids : [];

    if (!request_ids.length) {
      return json(400, { error: 'request_ids is required.' });
    }

    const { data: requests, error } = await supabase
      .from('carrier_contracting_requests')
      .select(`
        id,
        agent_id,
        carrier_id,
        rule_id,
        agents:agent_id (
          id,
          full_name,
          email,
          agent_id
        ),
        carriers:carrier_id (
          carrier_name
        ),
        rules:rule_id (
          id,
          send_agent_packet,
          attachment_urls,
          email_to,
          agent_packet_subject_template,
          agent_packet_body_template
        )
      `)
      .in('id', request_ids);

    if (error) {
      return json(500, { error: error.message });
    }

    if (!requests?.length) {
      return json(404, { error: 'No matching requests found.' });
    }

    const grouped = {};

    for (const req of requests) {
      const agent = req.agents;
      const rule = req.rules;

      if (!agent?.email) continue;
      if (!rule?.send_agent_packet) continue;

      const key = `${req.agent_id}__${rule.id}`;

      if (!grouped[key]) {
        grouped[key] = {
          agent,
          rule,
          carriers: []
        };
      }

      grouped[key].carriers.push(req.carriers?.carrier_name || 'Unknown Carrier');
    }

    const results = [];

    for (const [groupKey, group] of Object.entries(grouped)) {
      const { agent, rule, carriers } = group;
      const destinationEmail = uniqueStrings(rule.email_to || []).join(', ');

      const subject = fillTemplate(
        rule.agent_packet_subject_template || 'Family Values Group Contracting Packet – {{carrier_names}}',
        agent,
        carriers,
        destinationEmail
      );

      const bodyText = fillTemplate(
        rule.agent_packet_body_template || `Hello {{agent_name}},

Attached is your contracting packet for:

{{carrier_names_list}}

Please complete your portion and send it to:
{{destination_email}}

If you have any questions, reply to this email.

Thank you,
Family Values Group`,
        agent,
        carriers,
        destinationEmail
      );

      const attachments = uniqueStrings(rule.attachment_urls || []).map(url => ({
        filename: url.split('/').pop() || 'attachment',
        path: url
      }));

      try {
        const info = await transporter.sendMail({
          from: SMTP_FROM,
          to: agent.email,
          subject,
          text: bodyText,
          attachments
        });

        results.push({
          success: true,
          group_key: groupKey,
          message_id: info.messageId,
          to: agent.email,
          carriers
        });
      } catch (sendError) {
        results.push({
          success: false,
          group_key: groupKey,
          error: sendError.message,
          to: agent.email,
          carriers
        });
      }
    }

    return json(200, { ok: true, results });
  } catch (err) {
    return json(500, { error: err.message || 'Unexpected error' });
  }
}
