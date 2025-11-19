// netlify/functions/signwell-create-webhook.js
// Hit this ONCE to register the webhook URL with SignWell

const ESIGN_API_KEY = process.env.ESIGN_API_KEY;
const ESIGN_APP_ID  = process.env.ESIGN_ICA_TEMPLATE_ID;
const ESIGN_API_BASE_URL =
  process.env.ESIGN_API_BASE_URL || 'https://www.signwell.com/api/v1';

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  };
}

exports.handler = async () => {
  if (!ESIGN_API_KEY || !ESIGN_APP_ID) {
    return json(500, {
      error: 'Missing ESIGN_API_KEY or ESIGN_APP_ID env vars'
    });
  }

  const callbackUrl =
    'https://familyvaluesgroup.com/.netlify/functions/signwell-webhook';

  const res = await fetch(`${ESIGN_API_BASE_URL}/hooks/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': ESIGN_API_KEY
    },
    body: JSON.stringify({
      callback_url: callbackUrl,
      api_application_id: ESIGN_APP_ID
    })
  });

  const text = await res.text();
  let jsonBody;
  try {
    jsonBody = text ? JSON.parse(text) : {};
  } catch {
    jsonBody = { raw: text };
  }

  if (!res.ok) {
    console.error('Create webhook error:', res.status, text);
    return json(res.status, {
      error: 'Failed to create webhook',
      details: jsonBody
    });
  }

  return json(200, {
    ok: true,
    message: 'Webhook created with SignWell',
    webhook: jsonBody
  });
};
