import { createClient } from "@supabase/supabase-js";

export const config = {
  schedule: "* * * * *", // every minute
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async () => {
  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const nowIso = new Date().toISOString();

    // find due announcements not yet pushed
    const { data: due, error } = await supabase
      .from("announcements")
      .select("id")
      .eq("push_sent", false)
      .not("publish_at", "is", null)
      .lte("publish_at", nowIso)
      .limit(50);

    if (error) return json(500, { ok: false, error: error.message });

    if (!due?.length) return json(200, { ok: true, sent: 0, message: "No announcements due." });

    let pushed = 0;

    // call your on-demand function internally by HTTP (simple + reuses same logic)
    // NOTE: Netlify provides URL env in runtime; we can also just re-implement here,
    // but this is simplest.
    const base = process.env.URL || ""; // your site URL in Netlify
    if (!base) {
      return json(500, { ok: false, error: "Missing process.env.URL (Netlify site URL)." });
    }

    for (const a of due) {
      const res = await fetch(`${base}/.netlify/functions/send-push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "announcement", announcement_id: a.id }),
      });

      if (res.ok) pushed++;
    }

    return json(200, { ok: true, sent: pushed, due: due.length });
  } catch (err) {
    console.error("push-announcements error:", err);
    return json(500, { ok: false, error: err?.message || "Unknown error" });
  }
};
