// netlify/functions/pi-verify-code.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

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

    // Get Supabase user
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
    if (userError || !userData?.user) {
      console.error("pi-verify-code: getUser error", userError);
      return { statusCode: 401, body: JSON.stringify({ error: "Invalid auth token" }) };
    }
    const userId = userData.user.id;

    const body = event.body ? JSON.parse(event.body) : {};
    const code = (body.code || "").trim();

    if (!code) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing code" }) };
    }

    // Get the most recent unused, unexpired OTP that matches this code
    const nowISO = new Date().toISOString();
    const { data: otps, error: otpError } = await supabase
      .from("agent_pi_otps")
      .select("*")
      .eq("agent_id", userId)
      .eq("code", code)
      .is("used_at", null)
      .gt("expires_at", nowISO)
      .order("created_at", { ascending: false })
      .limit(1);

    if (otpError) {
      console.error("pi-verify-code: OTP lookup error", otpError);
      return { statusCode: 500, body: JSON.stringify({ error: "Could not verify code" }) };
    }

    const otp = otps && otps[0];
    if (!otp) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid or expired code" }) };
    }

    // Mark this OTP as used
    const now = new Date().toISOString();
    const { error: usedError } = await supabase
      .from("agent_pi_otps")
      .update({ used_at: now })
      .eq("id", otp.id);

    if (usedError) {
      console.error("pi-verify-code: mark used error", usedError);
    }

    // Save/refresh phone number on agent record
    if (otp.phone) {
      const { error: agentUpdateError } = await supabase
        .from("agents")
        .update({ phone: otp.phone })
        .eq("id", userId);

      if (agentUpdateError) {
        console.error("pi-verify-code: agent phone update error", agentUpdateError);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    console.error("pi-verify-code: server error", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", details: err.message }),
    };
  }
}
