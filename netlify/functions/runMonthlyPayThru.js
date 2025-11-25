import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

function getPayDate(event) {
  const qs = event.queryStringParameters || {};
  if (qs.pay_date) {
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) return d;
  }

  // Default = last day of current month
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0);
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDate = getPayDate(event);
    const payDateStr = payDate.toISOString().slice(0, 10);

    // For now, just return a test payload
    return {
      statusCode: 200,
      body: JSON.stringify(
        {
          message: 'Monthly Pay-Thru stub. Not yet calculating trails/renewals.',
          pay_date: payDateStr
        },
        null,
        2
      ),
      headers: { 'Content-Type': 'application/json' }
    };

  } catch (err) {
    console.error('[runMonthlyPayThru] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
