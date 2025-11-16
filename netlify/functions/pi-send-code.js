// netlify/functions/pi-send-code.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_MESSAGING_PROFILE_ID = process.env.TELNYX_MESSAGING_PROFILE_ID; // or use FROM number instead

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const toE164 = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;      // US 10-digit
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
};

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return { statusCode: 401, body: JSON.stringify({ error: "Missing auth token" }) };
    }
    const accessToken = authHeader.slice("Bearer ".length).trim();

    // Get the Supabase user from the token
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user) {
      console.error("pi-send-code: getUser error", userError);
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid auth token" }) };
    }
    const userId = userData.user.id;

    const body = event.body ? JSON.parse(event.body) : {};
    const rawPhone = body.phone;
    const phone = toE164(rawPhone);

    if (!phone) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid phone number" }) };
    }

    // Confirm this user is an agent and get their agent row (optional but nice)
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, phone")
      .eq("id", userId)
      .single();

    if (agentError || !agent) {
      console.error("pi-send-code: agent lookup error", agentError);
      return { statusCode: 404, body: JSON.stringify({ error: "Agent record not found" }) };
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Expire in 10 minutes
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Mark previous unused codes as used (optional, keeps it clean)
    await supabase
      .from("agent_pi_otps")
      .update({ used_at: new Date().toISOString() })
      .eq("agent_id", agent.id)
      .is("used_at", null);

    // Insert new OTP
    const { error: insertError } = await supabase.from("agent_pi_otps").insert({
      agent_id: agent.id,
      phone,
      code,
      expires_at: expiresAt,
    });

    if (insertError) {
      console.error("pi-send-code: insert error", insertError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Could not create verification code" }),
      };
    }

    // Send SMS via Telnyx
    if (!TELNYX_API_KEY) {
      console.warn("pi-send-code: TELNYX_API_KEY not set, skipping real SMS send.");
    } else {
      const smsBody = {
        to: phone,
        text: `Your Family Values Group dashboard code is ${code}. It expires in 10 minutes.`,
      };

      // Use messaging profile if provided, otherwise caller must switch to a "from" number
      if (TELNYX_MESSAGING_PROFILE_ID) {
        smsBody.messaging_profile_id = TELNYX_MESSAGING_PROFILE_ID;
      } else {
        // Example only – you can switch this to a TELNYX_FROM_NUMBER env var if you prefer
        smsBody.from = process.env.TELNYX_FROM_NUMBER;
      }

      try {
        const resp = await fetch("https://api.telnyx.com/v2/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TELNYX_API_KEY}`,
          },
          body: JSON.stringify(smsBody),
        });

        if (!resp.ok) {
          const txt = await resp.text();
          console.error("pi-send-code: Telnyx error", resp.status, txt);
        }
      } catch (err) {
        console.error("pi-send-code: Telnyx fetch error", err);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("pi-send-code: server error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", details: err.message }),
    };
  }
}
