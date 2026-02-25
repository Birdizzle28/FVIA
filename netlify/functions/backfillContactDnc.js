// netlify/functions/backfillContactDnc.js
import { createClient } from "@supabase/supabase-js";

/**
 * ENV VARS (Netlify -> Site settings -> Environment variables)
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * OPTIONAL:
 * - SUPABASE_ANON_KEY (only if you want to verify end-user JWT; not required here)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function digits10(v) {
  return String(v || "").replace(/\D/g, "").slice(-10);
}

function phoneToAreaAndLocal7(phone) {
  const d = digits10(phone);
  if (d.length !== 10) return null;
  const areaCode = d.slice(0, 3);
  const local7Str = d.slice(3); // keep leading zeros
  const local7Int = parseInt(local7Str, 10);
  if (!Number.isFinite(local7Int)) return null;
  return { areaCode, local7Int, local7Str };
}

async function isPhoneOnNationalDnc(phone) {
  const parts = phoneToAreaAndLocal7(phone);
  if (!parts) return false;

  const { areaCode, local7Int } = parts;

  const { data, error } = await admin
    .from("dnc_ranges")
    .select("area_code")
    .eq("area_code", areaCode)
    .lte("start_local7", local7Int)
    .gte("end_local7", local7Int)
    .limit(1);

  if (error) {
    // Fail CLOSED (safer): if DNC table query fails, treat as on DNC.
    console.error("[DNC CHECK ERROR]", error);
    return true;
  }

  return (data || []).length > 0;
}

async function phonesOnNationalDnc(phones) {
  const list = Array.isArray(phones) ? phones : [];
  for (const p of list) {
    if (await isPhoneOnNationalDnc(p)) return true;
  }
  return false;
}

/**
 * Paginates contacts by created_at + id for stable ordering.
 */
async function fetchContactsPage({ limit, cursorCreatedAt, cursorId }) {
  let q = admin
    .from("contacts")
    .select("id, created_at, phones, needs_dnc_check, metadata")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);

  // cursor: (created_at, id) tuple
  if (cursorCreatedAt && cursorId) {
    // emulate tuple ">" with OR:
    // (created_at > cursorCreatedAt) OR (created_at = cursorCreatedAt AND id > cursorId)
    q = q.or(
      `created_at.gt.${cursorCreatedAt},and(created_at.eq.${cursorCreatedAt},id.gt.${cursorId})`
    );
  }

  const { data, error } = await q;
  if (error) throw error;

  return data || [];
}

export async function handler(event) {
  try {
    // OPTIONAL simple protection:
    // require a shared secret header. Set NETLIFY_DNC_SECRET in env and call with that header.
    const secret = process.env.NETLIFY_DNC_SECRET;
    if (secret) {
      const got = event.headers["x-dnc-secret"] || event.headers["X-DNC-SECRET"];
      if (got !== secret) {
        return { statusCode: 401, body: "Unauthorized" };
      }
    }

    // Controls
    const body = event.httpMethod === "POST" ? JSON.parse(event.body || "{}") : {};
    const limit = Math.max(1, Math.min(2000, parseInt(body.pageSize || 500, 10)));
    const maxPages = Math.max(1, Math.min(2000, parseInt(body.maxPages || 50, 10)));
    const dryRun = !!body.dryRun;

    // Cursor resume support
    let cursorCreatedAt = body.cursorCreatedAt || null;
    let cursorId = body.cursorId || null;

    let totalScanned = 0;
    let totalUpdated = 0;
    let totalOnDnc = 0;

    for (let page = 1; page <= maxPages; page++) {
      const rows = await fetchContactsPage({ limit, cursorCreatedAt, cursorId });
      if (!rows.length) break;

      // update cursor to last row
      const last = rows[rows.length - 1];
      cursorCreatedAt = last.created_at;
      cursorId = last.id;

      for (const c of rows) {
        totalScanned++;

        const onDnc = await phonesOnNationalDnc(c.phones);
        if (onDnc) totalOnDnc++;

        // Only update if changed (saves writes)
        const nextNeeds = !!onDnc;
        const prevNeeds = !!c.needs_dnc_check;

        if (nextNeeds === prevNeeds) continue;

        const nextMeta = {
          ...(c.metadata || {}),
          dnc_last_checked_at: new Date().toISOString(),
          dnc_source: "national_dnc_ranges",
        };

        if (!dryRun) {
          const { error: upErr } = await admin
            .from("contacts")
            .update({
              needs_dnc_check: nextNeeds,
              metadata: nextMeta,
            })
            .eq("id", c.id);

          if (upErr) {
            console.error("[CONTACT UPDATE ERROR]", c.id, upErr);
            // keep going
            continue;
          }
        }

        totalUpdated++;
      }
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
        note:
          "If more contacts remain, call again with cursorCreatedAt + cursorId to resume.",
      }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: e?.message || "Server error" };
  }
}
