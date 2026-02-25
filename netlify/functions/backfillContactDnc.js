// netlify/functions/backfillContactDnc.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

export async function handler(event) {
  try {
    // shared-secret protection (Netlify lowercases headers)
    const secret = process.env.NETLIFY_DNC_SECRET;
    if (secret) {
      const got = event.headers?.["x-dnc-secret"];
      if (got !== secret) return { statusCode: 401, body: "Unauthorized" };
    }

    const body = event.httpMethod === "POST" ? JSON.parse(event.body || "{}") : {};

    const batchSize = Math.max(1, Math.min(5000, parseInt(body.pageSize || 500, 10)));
    const maxPages = Math.max(1, Math.min(2000, parseInt(body.maxPages || 50, 10)));
    const dryRun = !!body.dryRun;

    let cursorCreatedAt = body.cursorCreatedAt || null;
    let cursorId = body.cursorId || null;

    let totalScanned = 0;
    let totalUpdated = 0;
    let totalOnDnc = 0;

    for (let page = 1; page <= maxPages; page++) {
      const { data, error } = await admin.rpc("backfill_contacts_dnc", {
        p_batch_size: batchSize,
        p_cursor_created_at: cursorCreatedAt,
        p_cursor_id: cursorId,
        p_dry_run: dryRun,
      });

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || !row.scanned) break;

      totalScanned += row.scanned || 0;
      totalUpdated += row.updated || 0;
      totalOnDnc += row.on_dnc || 0;

      cursorCreatedAt = row.next_cursor_created_at || null;
      cursorId = row.next_cursor_id || null;

      // if batch returned no cursor, we're done
      if (!cursorCreatedAt || !cursorId) break;

      // optional: stop early if this page scanned less than batch size
      if (row.scanned < batchSize) break;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        dryRun,
        totalScanned,
        totalUpdated,
        totalOnDnc,
        cursorCreatedAt,
        cursorId,
        note: "Call again with cursorCreatedAt + cursorId to resume.",
      }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: e?.message || "Server error" };
  }
}
