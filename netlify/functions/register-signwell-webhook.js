// netlify/functions/register-signwell-webhook.js
// One-time helper to register your Netlify webhook URL with SignWell

const ESIGN_API_KEY = process.env.ESIGN_API_KEY || '';
const ESIGN_API_BASE_URL =
  process.env.ESIGN_API_BASE_URL || 'https://www.signwell.com/api/v1';

const ESIGN_API_APPLICATION_ID = process.env.ESIGN_API_APPLICATION_ID || '';
const SIGNWELL_WEBHOOK_URL = process.env.SIGNWELL_WEBHOOK_URL || '';

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify(data)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Use GET in the browser to run this.' });
  }

  if (!ESIGN_API_KEY || !ESIGN_API_APPLICATION_ID || !SIGNWELL_WEBHOOK_URL) {
    return jsonResponse(500, {
      error:
        'Missing ESIGN_API_KEY, ESIGN_API_APPLICATION_ID, or SIGNWELL_WEBHOOK_URL env vars.'
    });
  }

  try {
    // 1) List current webhooks, see if ours already exists
    const listRes = await fetch(`${ESIGN_API_BASE_URL}/hooks/`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'X-Api-Key': ESIGN_API_KEY
      }
    });

    const listText = await listRes.text();
    let listJson;
    try {
      listJson = listText ? JSON.parse(listText) : [];
    } catch {
      listJson = [];
    }

    const hooks = Array.isArray(listJson) ? listJson : (listJson.results || []);
    const existing = hooks.find(
      (h) => h.callback_url === SIGNWELL_WEBHOOK_URL
    );

    if (existing) {
      return jsonResponse(200, {
        ok: true,
        message: 'Webhook already exists for this URL.',
        id: existing.id,
        callback_url: existing.callback_url
      });
    }

    // 2) Create webhook
    const createBody = {
      callback_url: SIGNWELL_WEBHOOK_URL,
      api_application_id: ESIGN_API_APPLICATION_ID
    };

    const createRes = await fetch(`${ESIGN_API_BASE_URL}/hooks/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': ESIGN_API_KEY
      },
      body: JSON.stringify(createBody)
    });

    const createText = await createRes.text();
    let createJson;
    try {
      createJson = createText ? JSON.parse(createText) : {};
    } catch {
      createJson = { raw: createText };
    }

    if (!createRes.ok) {
      console.error('Create webhook error:', createRes.status, createText);
      return jsonResponse(createRes.status, {
        error: 'Failed to create webhook',
        details: createJson
      });
    }

    return jsonResponse(200, {
      ok: true,
      message: 'Webhook created successfully.',
      hook: createJson
    });
  } catch (err) {
    console.error('register-signwell-webhook error:', err);
    return jsonResponse(500, { error: 'Unexpected error', details: String(err) });
  }
};
