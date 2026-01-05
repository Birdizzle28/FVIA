// netlify/functions/submitForm.js
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

// ---- Rate limit (best-effort in serverless) ----
// NOTE: In-memory rate limit can reset on cold starts.
// This still kills a ton of spam, but if you want "perfect" rate limiting,
// we can make it persistent with a Supabase table after this.
const IP_WINDOW_MS = 60_000;     // 1 minute
const IP_MAX_HITS  = 3;          // allow 3 per minute per IP
const ipHits = new Map();        // ip -> [timestamps]

function getClientIp(event) {
  const h = event.headers || {};
  const xff = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
  // XFF can be "ip, ip, ip"
  const first = String(xff).split(',')[0].trim();
  return first || h['client-ip'] || h['Client-Ip'] || 'unknown';
}

function isRateLimited(ip) {
  const now = Date.now();
  const arr = ipHits.get(ip) || [];
  const recent = arr.filter(t => now - t < IP_WINDOW_MS);
  recent.push(now);
  ipHits.set(ip, recent);
  return recent.length > IP_MAX_HITS;
}

function looksLikeGibberish(text) {
  const s = String(text || '').trim();
  if (!s) return true;

  // too short
  if (s.length < 8) return true;

  // if it's basically one "token" with no spaces, often spam
  if (!s.includes(' ') && s.length < 25) return true;

  // must contain letters
  if (!/[a-z]/i.test(s)) return true;

  // too many weird chars
  const weird = s.replace(/[a-z0-9\s.,!?'"()-]/gi, '').length;
  if (weird / Math.max(1, s.length) > 0.25) return true;

  // long random strings: lots of mixed letters+numbers, few vowels
  if (s.length >= 20) {
    const vowels = (s.match(/[aeiou]/gi) || []).length;
    if (vowels / s.length < 0.15) return true;
  }

  return false;
}

function isValidEmail(email) {
  const s = String(email || '').trim();
  // light check (no need to overdo it)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));
}

export async function handler(event) {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  const ip = getClientIp(event);

  // 1) Rate-limit by IP (SILENT SUCCESS)
  if (isRateLimited(ip)) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  // Parse JSON safely
  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const name    = String(payload.name || '').trim();
  const email   = String(payload.email || '').trim();
  const phone   = String(payload.phone || '').trim();
  const message = String(payload.message || '').trim();
  const source  = 'contact.html';

  // Honeypot (you added this to HTML)
  const honeypot = String(payload.company_website || '').trim();
  if (honeypot) {
    // bot filled hidden field -> silently ignore
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  // Required fields (keep as 400 for real users, but we’ll still be lenient for bots)
  if (!name || !email || !message) {
    // For spam, returning 200 reduces retries; for legit users, they’ll see client-side "required" anyway.
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  // 2) Validate message quality (SILENT SUCCESS on spam)
  if (!isValidEmail(email) || looksLikeGibberish(name) || looksLikeGibberish(message)) {
    return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
  }

  // 3) Save to Supabase (ONLY for real submissions)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { error: insertErr } = await supabase
    .from('support_messages')
    .insert([{ name, email, phone: phone || null, message, source, ip_address: ip }]); // ip_address column optional (if exists)

  if (insertErr) {
    // If your table does NOT have ip_address, this insert will fail.
    // Fix: remove ip_address OR add the column.
    console.error('Supabase insert error:', insertErr);
    return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ error: 'Failed to save message' }) };
  }

  // 4) Email you (ONLY for real submissions)
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
    const toInbox  = process.env.ZOHO_USER;

    // Email to support inbox
    await transporter.sendMail({
      from: `${siteName} <${process.env.ZOHO_USER}>`,
      to: toInbox,
      subject: `New support message from ${name}`,
      replyTo: email,
      text:
`New message from ${siteName} contact form

Name: ${name}
Email: ${email}
Phone: ${phone || '(not provided)'}
Source: ${source}
IP: ${ip}

Message:
${message}
`,
      html:
`<p><strong>New message from ${siteName} contact form</strong></p>
<p><b>Name:</b> ${escapeHtml(name)}<br>
<b>Email:</b> ${escapeHtml(email)}<br>
<b>Phone:</b> ${escapeHtml(phone || '(not provided)')}<br>
<b>Source:</b> ${escapeHtml(source)}<br>
<b>IP:</b> ${escapeHtml(ip)}</p>
<p><b>Message:</b><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
    });

    // OPTIONAL auto-reply (default OFF)
    const AUTO_REPLY = String(process.env.AUTO_REPLY || 'false').toLowerCase() === 'true';
    if (AUTO_REPLY) {
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
    }

  } catch (mailErr) {
    // Don’t fail the whole request if email sending has a hiccup
    console.error('Mail send error:', mailErr);
  }

  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({ ok: true }) };
}
