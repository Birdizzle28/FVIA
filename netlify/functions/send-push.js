import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function safeArr(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

async function fetchSubsForUser(supabase, userId) {
  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) throw error;
  return data || [];
}

async function sendToUserSubs(supabase, userId, payloadStr) {
  const subs = await fetchSubsForUser(supabase, userId);

  if (!subs.length) return { userId, delivered: false, reason: "no_subs" };

  let anySuccess = false;

  for (const s of subs) {
    const subObj = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subObj, payloadStr);
      anySuccess = true;
    } catch (err) {
      const code = err?.statusCode;
      if (code === 410 || code === 404) {
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        console.error("Push send failed:", code, err?.body || err?.message || err);
      }
    }
  }

  return { userId, delivered: anySuccess };
}

async function resolveAnnouncementRecipients(supabase, annc) {
  const audience = annc?.audience || {};
  const scope = audience?.scope || "all";

  // ✅ easiest: if announcement stored explicit IDs, use them
  if (scope === "custom_agents") {
    return safeArr(audience.agent_ids);
  }

  // Otherwise, query agents table based on scope
  let q = supabase.from("agents").select("id").eq("is_active", true);

  if (scope === "admins") {
    q = q.eq("is_admin", true);
  } else if (scope === "by_level") {
    const levels = safeArr(audience.levels);
    if (levels.length) q = q.in("level", levels);
  } else if (scope === "by_product" || scope === "by_product_state") {
    // assumes agents.product_types is text[] (you have it)
    const products = safeArr(audience.products);
    if (products.length) q = q.overlaps("product_types", products);
  }

  // OPTIONAL state targeting (only works if you actually have one of these columns)
  if (scope === "by_state" || scope === "by_product_state") {
    const states = safeArr(audience.states);
    if (states.length) {
      // Try states[] first, then fallback to resident_state
      const tryStatesArray = await q.overlaps("states", states);
      if (tryStatesArray?.error) {
        // fallback for schemas that use resident_state text instead of states[]
        q = supabase.from("agents").select("id").eq("is_active", true).in("resident_state", states);
        if (scope === "admins") q = q.eq("is_admin", true);
        if (scope === "by_level") {
          const levels = safeArr(audience.levels);
          if (levels.length) q = q.in("level", levels);
        }
        if (scope === "by_product_state") {
          const products = safeArr(audience.products);
          if (products.length) q = q.overlaps("product_types", products);
        }
      } else {
        // if states[] worked, keep it
        return (tryStatesArray.data || []).map(r => r.id);
      }
    }
  }

  const { data, error } = await q;
  if (error) throw error;

  return (data || []).map(r => r.id);
}

export default async (req) => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const VAPID_PUBLIC_KEY = (process.env.VAPID_PUBLIC_KEY || "").trim();
    const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || "").trim();

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
    }
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return json(500, { ok: false, error: "Missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY." });
    }

    const body = await req.json().catch(() => ({}));
    const type = (body?.type || "").toLowerCase();
    const task_id = body?.task_id || null;
    const announcement_id = body?.announcement_id || null;

    if (!["task", "announcement"].includes(type)) {
      return json(400, { ok: false, error: "type must be 'task' or 'announcement'." });
    }

    if (type === "task" && !task_id) return json(400, { ok: false, error: "Missing task_id." });
    if (type === "announcement" && !announcement_id) return json(400, { ok: false, error: "Missing announcement_id." });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    webpush.setVapidDetails("mailto:info@familyvaluesgroup.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    if (type === "task") {
      const { data: task, error } = await supabase
        .from("tasks")
        .select("id, assigned_to, title, due_at, metadata, push_sent")
        .eq("id", task_id)
        .maybeSingle();

      if (error) return json(500, { ok: false, error: error.message });
      if (!task) return json(404, { ok: false, error: "Task not found." });

      // prevent duplicates
      if (task.push_sent === true) return json(200, { ok: true, sent: 0, message: "Already pushed." });

      const meta = task.metadata || {};
      const link = meta.link_url || "tasks.html";
      const dueText = task.due_at ? new Date(task.due_at).toLocaleString() : "No due date";

      const payload = JSON.stringify({
        title: "New Task Assigned",
        body: `${task.title || "Task"} • ${dueText}`,
        url: link,
        task_id: task.id,
      });

      const res = await sendToUserSubs(supabase, task.assigned_to, payload);

      if (res.delivered) {
        await supabase.from("tasks").update({
          push_sent: true,
          push_sent_at: new Date().toISOString()
        }).eq("id", task.id);

        return json(200, { ok: true, sent: 1 });
      }

      return json(200, { ok: true, sent: 0, message: "No valid subscriptions for that user." });
    }

    // announcement
    const { data: annc, error: anncErr } = await supabase
      .from("announcements")
      .select("id, title, body, link_url, publish_at, push_sent, audience")
      .eq("id", announcement_id)
      .maybeSingle();

    if (anncErr) return json(500, { ok: false, error: anncErr.message });
    if (!annc) return json(404, { ok: false, error: "Announcement not found." });

    if (annc.push_sent === true) return json(200, { ok: true, sent: 0, message: "Already pushed." });

    const recipients = await resolveAnnouncementRecipients(supabase, annc);

    if (!recipients.length) {
      await supabase.from("announcements").update({
        push_sent: true,
        push_sent_at: new Date().toISOString()
      }).eq("id", annc.id);

      return json(200, { ok: true, sent: 0, message: "No recipients." });
    }

    const payload = JSON.stringify({
      title: annc.title || "Announcement",
      body: (annc.body || "").slice(0, 180),
      url: annc.link_url || "/dashboard.html",
      announcement_id: annc.id,
    });

    let deliveredCount = 0;
    for (const userId of recipients) {
      const res = await sendToUserSubs(supabase, userId, payload);
      if (res.delivered) deliveredCount++;
    }

    await supabase.from("announcements").update({
      push_sent: true,
      push_sent_at: new Date().toISOString()
    }).eq("id", annc.id);

    return json(200, { ok: true, sent: deliveredCount, recipients: recipients.length });
  } catch (err) {
    console.error("send-push error:", err);
    return json(500, { ok: false, error: err?.message || "Unknown error" });
  }
};
