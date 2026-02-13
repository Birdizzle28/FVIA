// netlify/functions/push-reminders.js
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

export const config = {
  schedule: "* * * * *", // every minute
};

export default async () => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
    const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY env vars.");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    webpush.setVapidDetails(
      "mailto:fvinsuranceagency@gmail.com",
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // NOTE: Your UI writes:
    //  - remind_enabled: boolean
    //  - remind_before_minutes: int
    // This runner respects those.
    const { data: appts, error: apptErr } = await supabase
      .from("appointments")
      .select("id, agent_id, title, scheduled_for, url, remind_enabled, remind_before_minutes, remind_sent")
      .eq("remind_enabled", true)
      .eq("remind_sent", false)
      .gte("scheduled_for", now.toISOString())
      .lte("scheduled_for", in24h.toISOString());

    if (apptErr) throw apptErr;

    const due = (appts || []).filter((a) => {
      const start = new Date(a.scheduled_for);
      const beforeMin = Number(a.remind_before_minutes ?? 0);
      const fireAt = new Date(start.getTime() - beforeMin * 60 * 1000);

      // 0 mins = at start time (with a small grace window)
      const graceMs = 3 * 60 * 1000;
      return now.getTime() >= fireAt.getTime() && now.getTime() <= start.getTime() + graceMs;
    });

    if (due.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent: 0, message: "Nothing due right now." }),
      };
    }

    let sentCount = 0;

    for (const appt of due) {
      // ✅ Your push_subscriptions schema is:
      // endpoint, p256dh, auth (NO "subscription" column)
      const { data: subs, error: subErr } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("user_id", appt.agent_id);

      if (subErr) throw subErr;

      if (!subs || subs.length === 0) {
        // No device subscribed — mark as sent so it doesn't loop forever
        await supabase
          .from("appointments")
          .update({ remind_sent: true, remind_sent_at: new Date().toISOString() })
          .eq("id", appt.id);
        continue;
      }

      const startLocal = new Date(appt.scheduled_for).toLocaleString();

      const payload = JSON.stringify({
        title: "Appointment Reminder",
        body: `${appt.title || "Appointment"} • ${startLocal}`,
        url: appt.url || "/scheduling.html",
        appointment_id: appt.id,
      });

      let anySuccess = false;

      for (const s of subs) {
        const subObj = {
          endpoint: s.endpoint,
          keys: {
            p256dh: s.p256dh,
            auth: s.auth,
          },
        };

        try {
          await webpush.sendNotification(subObj, payload);
          anySuccess = true;
        } catch (err) {
          const code = err?.statusCode;

          // Remove dead subs
          if (code === 410 || code === 404) {
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
          } else {
            console.error("Push send failed:", code, err?.body || err?.message || err);
          }
        }
      }

      if (anySuccess) {
        await supabase
          .from("appointments")
          .update({ remind_sent: true, remind_sent_at: new Date().toISOString() })
          .eq("id", appt.id);

        sentCount++;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, sent: sentCount }),
    };
  } catch (err) {
    console.error("Reminder runner error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err?.message || "Unknown error" }),
    };
  }
};
