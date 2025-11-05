// netlify/functions/submitForm.js
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Parse JSON safely
  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const name = String(payload.name || '').trim();
  const email = String(payload.email || '').trim();
  const phone = String(payload.phone || '').trim();
  const message = String(payload.message || '').trim();
  const source = 'contact.html';

  if (!name || !email || !message) {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // 1) Save to Supabase
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const { error: insertErr } = await supabase
    .from('support_messages')
    .insert([{ name, email, phone: phone || null, message, source }]);

  if (insertErr) {
    console.error('Supabase insert error:', insertErr);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to save message' }) };
  }

  // 2) Send email via Zoho (to you) + optional auto-reply
  try {
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS
      }
    });

    const siteName = process.env.SITE_NAME || 'Family Values Group';
    const toInbox = process.env.ZOHO_USER || process.env.ZOHO_USER;

    // Email to support inbox
    await transporter.sendMail({
      from: `${siteName} <${process.env.ZOHO_USER}>`,
      to: toInbox,
      subject: `New support message from ${name}`,
      replyTo: email, // so you can reply straight to the sender
      text:
`New message from ${siteName} contact form

Name: ${name}
Email: ${email}
Phone: ${phone || '(not provided)'}
Source: ${source}

Message:
${message}
`,
      html:
`<p><strong>New message from ${siteName} contact form</strong></p>
<p><b>Name:</b> ${escapeHtml(name)}<br>
<b>Email:</b> ${escapeHtml(email)}<br>
<b>Phone:</b> ${escapeHtml(phone || '(not provided)')}<br>
<b>Source:</b> ${escapeHtml(source)}</p>
<p><b>Message:</b><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    });

    // Optional: auto-reply to sender (comment out if you don’t want this)
    await transporter.sendMail({
      from: `${siteName} <${process.env.ZOHO_USER}>`,
      to: email,
      subject: `We received your message — ${siteName}`,
      text:
`Hi ${name},

Thanks for reaching out! We received your message and will get back to you soon.

— ${siteName} Support
`,
      html:
`<p>Hi ${escapeHtml(name)},</p>
<p>Thanks for reaching out! We received your message and will get back to you soon.</p>
<p>— ${escapeHtml(siteName)} Support</p>`
    });

  } catch (mailErr) {
    // Don’t fail the whole request if email sending has a hiccup
    console.error('Mail send error:', mailErr);
    // You can choose to return 200 anyway since the message is saved.
  }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
}

// tiny helper to avoid HTML injection in the email
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}
