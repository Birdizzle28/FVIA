import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const VER = "pushTask_2026-03-05a";

function safeJsonParse(str) {
  try { return JSON.parse(str || "{}"); } catch { return {}; }
}

function buildSubscriptionRowToWebPushSub(row) {
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: "Method Not Allowed", ver: VER }),
    };
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
    const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:fvinsuranceagency@gmail.com";

    if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase env vars");
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error("Missing VAPID keys");

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = safeJsonParse(event.body);
    const taskId = body.taskId || null;
    const userId = body.userId || null; // <-- auth.users.id (agent login user)

    if (!taskId || !userId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing taskId/userId", ver: VER }),
      };
    }

    // Load task
    const { data: task, error: tErr } = await supabase
      .from("tasks")
      .select("id, title, assigned_to, push_sent")
      .eq("id", taskId)
      .single();

    if (tErr) throw new Error(tErr.message);
    if (!task) throw new Error("Task not found");

    // Make sure the push is for the same agent user we’re targeting:
    // If your agents table id == auth.users.id, then assigned_to should match userId.
    if (String(task.assigned_to) !== String(userId)) {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Task not assigned to this user", ver: VER }),
      };
    }

    // Load ALL device subscriptions for this user
    const { data: subs, error: sErr } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth, device_label, user_agent")
      .eq("user_id", userId);

    if (sErr) throw new Error(sErr.message);

    if (!subs || subs.length === 0) {
      // leave push_sent=false for retry
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, sent: false, reason: "no_subscriptions", ver: VER }),
      };
    }

    const payload = JSON.stringify({
      title: "New Lead",
      body: task.title || "You have a new lead task.",
      taskId: task.id,
      url: "/leads.html",
    });

    const results = [];
    const staleSubIds = [];

    for (const row of subs) {
      const sub = buildSubscriptionRowToWebPushSub(row);
      try {
        await webpush.sendNotification(sub, payload);
        results.push({ id: row.id, ok: true });
      } catch (err) {
        // If a subscription is gone/invalid, webpush throws with statusCode 404/410 often.
        const code = err?.statusCode || null;
        results.push({ id: row.id, ok: false, statusCode: code });

        if (code === 404 || code === 410) staleSubIds.push(row.id);
      }
    }

    // delete stale subs (optional but recommended)
    if (staleSubIds.length) {
      await supabase.from("push_subscriptions").delete().in("id", staleSubIds);
    }

    // Mark task push_sent if at least one device succeeded
    const anySent = results.some(r => r.ok);
    if (anySent) {
      await supabase
        .from("tasks")
        .update({ push_sent: true, push_sent_at: new Date().toISOString() })
        .eq("id", task.id);
    }

    // update last_seen_at (nice to have)
    await supabase
      .from("push_subscriptions")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("user_id", userId);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        sent: anySent,
        devices: results.length,
        stale_removed: staleSubIds.length,
        results,
        ver: VER,
      }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: e?.message || "Unknown error", ver: VER }),
    };
  }
};
