import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) };
  }

  try {
    const { email, code } = JSON.parse(event.body);

    if (!email || !code) {
      return { statusCode: 400, body: JSON.stringify({ error: "Email and code required" }) };
    }

    const { error: mailError } = await supabase.functions.invoke("send-email", {
      body: {
        to: email,
        subject: "Your Family Values Verification Code",
        html: `<p>Your verification code is: <strong>${code}</strong></p>`,
        text: `Your verification code is: ${code}`
      }
    });

    if (mailError) {
      console.error("send-email error:", mailError);
      return { statusCode: 500, body: JSON.stringify({ error: "Email failed" }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
}
