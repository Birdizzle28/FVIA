import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return { statusCode: 401, body: "Missing bearer token" };

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return { statusCode: 401, body: "Invalid token" };
    const userId = userData.user.id;

    const body = JSON.parse(event.body || "{}");
    const sub = body.subscription;
    const deviceLabel = body.device_label || null;

    if (!sub?.endpoint) return { statusCode: 400, body: "Missing subscription.endpoint" };
    const p256dh = sub.keys?.p256dh;
    const authKey = sub.keys?.auth;
    if (!p256dh || !authKey) return { statusCode: 400, body: "Missing subscription keys" };

    const ua = event.headers["user-agent"] || event.headers["User-Agent"] || null;

    const payload = {
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh,
      auth: authKey,
      user_agent: ua,
      device_label: deviceLabel,
      last_seen_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "endpoint" });

    if (error) throw error;

    return { statusCode: 200, body: "OK" };
  } catch (e) {
    return { statusCode: 500, body: e.message || "Server error" };
  }
};
