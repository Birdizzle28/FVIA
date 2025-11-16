// netlify/functions/pi-send-code.js
import fetch from "node-fetch";

const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_MESSAGING_PROFILE_ID = process.env.TELNYX_MESSAGING_PROFILE_ID;
const TELNYX_FROM_NUMBER = process.env.TELNYX_FROM_NUMBER; // +1XXXXXXXXXX

function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, success: false, error: "Use POST" }),
    };
  }

  try {
    if (!TELNYX_API_KEY || !TELNYX_MESSAGING_PROFILE_ID || !TELNYX_FROM_NUMBER) {
      console.error("Missing Telnyx env vars");
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          success: false,
          error: "Telnyx not configured",
        }),
      };
    }

    const body = event.body ? JSON.parse(event.body) : {};
    const rawPhone = body.phone;
    const to = toE164(rawPhone);

    if (!to) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          ok: false,
          success: false,
          error: "Invalid phone number",
        }),
      };
    }

    // 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    const payload = {
      to,
      from: TELNYX_FROM_NUMBER,
      messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
      text: `Your Family Values verification code is: ${code}`,
    };

    console.log("pi-send-code payload:", payload);

    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log("pi-send-code Telnyx response:", res.status, data);

    if (!res.ok) {
      return {
        statusCode: res.status,
        body: JSON.stringify({
          ok: false,
          success: false,
          error: "Telnyx error",
          telnyx: data,
        }),
      };
    }

    // TODO: save `code` to Supabase tied to the user/session

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        success: true,
        codeSent: true,
      }),
    };
  } catch (err) {
    console.error("pi-send-code server error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        success: false,
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
