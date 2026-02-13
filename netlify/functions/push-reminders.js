const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Netlify Scheduled Function: runs every minute
exports.config = {
  schedule: "* * * * *",
};

webpush.setVapidDetails(
  "mailto:fvinsuranceagency@gmail.com", // can be any real contact email
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

exports.handler = async () => {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      throw new Error("Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY env vars.");
    }

    // We only need to look a short window ahead to catch "remind_before"
    // Grab upcoming appointments in next 24h that still haven't been reminded
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const { data: appts, error: apptErr } = await supabase
      .from("appointments")
      .select("id, agent_id, title, scheduled_for, location_type, location_address, url, remind_enabled, remind_before_minutes, remind_sent")
      .eq("remind_enabled", true)
      .eq("remind_sent", false)
      .gte("scheduled_for", now.toISOString())
      .lte("scheduled_for", in24h.toISOString());

    if (apptErr) throw apptErr;

    if (!appts || appts.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent: 0, message: "No reminders due." }),
      };
    }

    // Determine which ones are due *right now*
    const due = appts.filter((a) => {
      const start = new Date(a.scheduled_for);
      const beforeMin = Number(a.remind_before_minutes || 0);
      const fireAt = new Date(start.getTime() - beforeMin * 60 * 1000);

      // Due if now is past fireAt, but still before the start time (+ small grace)
      const graceMs = 2 * 60 * 1000; // 2 minutes grace
      return now.getTime() >= fireAt.getTime() && now.getTime() <= start.getTime() + graceMs;
    });

    if (due.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, sent: 0, message: "Nothing due in this minute." }),
      };
    }

    let sentCount = 0;

    for (const appt of due) {
      // Get all subscriptions for that agent
      const { data: subs, error: subErr } = await supabase
        .from("push_subscriptions")
        .select("id, endpoint, subscription")
        .eq("user_id", appt.agent_id);

      if (subErr) throw subErr;

      if (!subs || subs.length === 0) {
        // No device subscribed — still mark as sent so it doesn't loop forever
        await supabase
          .from("appointments")
          .update({ remind_sent: true, remind_sent_at: new Date().toISOString() })
          .eq("id", appt.id);

        continue;
      }

      const startLocal = new Date(appt.scheduled_for).toLocaleString();

      const payload = {
        title: "Appointment Reminder",
        body: `${appt.title || "Appointment"} • ${startLocal}`,
        url: appt.url || "/scheduling.html",
        appointment_id: appt.id,
      };

      // Try send to each subscription
      let anySuccess = false;

      for (const s of subs) {
        try {
          await webpush.sendNotification(s.subscription, JSON.stringify(payload));
          anySuccess = true;
        } catch (err) {
          // Remove dead subs (410 Gone or 404)
          const code = err?.statusCode;
          if (code === 410 || code === 404) {
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
          } else {
            console.error("Push send failed:", code, err?.body || err?.message || err);
          }
        }
      }

      // Mark appointment as reminded if at least 1 send succeeded
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
