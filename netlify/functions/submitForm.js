// netlify/functions/submitForm.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parse JSON body
  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const name = (data.name || '').trim();
  const email = (data.email || '').trim();
  const phone = (data.phone || '').trim();
  const message = (data.message || '').trim();
  const source = 'contact.html';

  if (!name || !email || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // Server-side Supabase client (safe: uses SERVICE_ROLE from Netlify env)
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Insert into support_messages
  const { error } = await supabase.from('support_messages').insert([
    { name, email, phone, message, source }
  ]);

  if (error) {
    console.error('Supabase insert error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save message' }) };
  }

  // Success
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
  };
};
