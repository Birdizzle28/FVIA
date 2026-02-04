import { createClient } from '@supabase/supabase-js';

const DNC_IMPORTS = 'dnc_imports';
const DNC_AREA_CODES = 'dnc_area_codes';
const DNC_RANGES = 'dnc_ranges';

function getBearerToken(headers = {}) {
  const h = headers.authorization || headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

// Extract area code from <list ... val='423'> OR <ac val='423'>
function extractAreaCode(xmlText) {
  const m1 = xmlText.match(/<list[^>]*\bval=['"](\d{3})['"][^>]*>/i);
  if (m1?.[1]) return m1[1];
  const m2 = xmlText.match(/<ac[^>]*\bval=['"](\d{3})['"][^>]*>/i);
  if (m2?.[1]) return m2[1];
  return null;
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Missing Supabase env vars' }) };
    }

    const token = getBearerToken(event.headers);
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Missing auth token' }) };
    }

    // Verify user session (anon key)
    const authClient = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const { data: userData, error: userErr } = await authClient.auth.getUser(token);

    if (userErr || !userData?.user?.id) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Invalid session' }) };
    }

    const userId = userData.user.id;

    // Service role client
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Admin check
    const { data: agentRow, error: agentErr } = await adminClient
      .from('agents')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle();

    if (agentErr) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Admin check failed' }) };
    }

    if (agentRow?.is_admin !== true) {
      return { statusCode: 403, body: JSON.stringify({ ok: false, error: 'Admin access required' }) };
    }

    // Parse JSON payload
    let payload = {};
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid JSON body' }) };
    }

    const bucket = payload.bucket;
    const path = payload.path;
    const originalFilename = payload.original_filename || 'upload.xml';

    if (!bucket || !path) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing bucket/path' }) };
    }

    // Download XML from Supabase Storage
    const { data: fileBlob, error: dlErr } = await adminClient.storage.from(bucket).download(path);
    if (dlErr || !fileBlob) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Storage download failed: ${dlErr?.message || 'unknown'}` }) };
    }

    const ab = await fileBlob.arrayBuffer();
    const xmlText = Buffer.from(ab).toString('utf8');

    const areaCode = extractAreaCode(xmlText);
    if (!areaCode) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Could not detect area code in XML' }) };
    }

    // Create import record
    const { data: importRow, error: importErr } = await adminClient
      .from(DNC_IMPORTS)
      .insert({
        area_code: areaCode,
        file_name: originalFilename,
        uploaded_by: userId,
        row_count: 0
      })
      .select('id')
      .single();

    if (importErr || !importRow?.id) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Import row insert failed: ${importErr?.message || 'unknown'}` }) };
    }

    const importId = importRow.id;

    // Replace existing ranges for that area code
    const { error: delErr } = await adminClient
      .from(DNC_RANGES)
      .delete()
      .eq('area_code', areaCode);

    if (delErr) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Delete old ranges failed: ${delErr.message}` }) };
    }

    // Build ranges by scanning <ph val='xxxxxxx' />
    const PH_RE = /<ph\s+val=['"](\d{1,7})['"]\s*\/>/gi;

    let match;
    let totalPhones = 0;

    let rangeStart = null;
    let prev = null;

    const RANGE_INSERT_CHUNK = 2000;
    let rangeRows = [];
    let totalRanges = 0;

    async function flushRanges() {
      if (!rangeRows.length) return;
      const { error } = await adminClient.from(DNC_RANGES).insert(rangeRows, { returning: 'minimal' });
      if (error) throw new Error(`Range insert failed: ${error.message}`);
      totalRanges += rangeRows.length;
      rangeRows = [];
    }

    while ((match = PH_RE.exec(xmlText)) !== null) {
      const local7 = parseInt(match[1], 10);
      if (Number.isNaN(local7)) continue;

      totalPhones++;

      if (rangeStart === null) {
        rangeStart = local7;
        prev = local7;
        continue;
      }

      if (local7 === prev + 1) {
        prev = local7;
        continue;
      }

      // close previous range
      rangeRows.push({
        area_code: areaCode,
        start_local7: rangeStart,
        end_local7: prev,
        import_id: importId
      });

      if (rangeRows.length >= RANGE_INSERT_CHUNK) {
        await flushRanges();
      }

      // start new range
      rangeStart = local7;
      prev = local7;
    }

    // close final range
    if (rangeStart !== null) {
      rangeRows.push({
        area_code: areaCode,
        start_local7: rangeStart,
        end_local7: prev,
        import_id: importId
      });
    }

    await flushRanges();

    if (totalPhones === 0) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'No <ph> entries found in XML' }) };
    }

    // Update import count (phone count)
    const { error: updErr } = await adminClient
      .from(DNC_IMPORTS)
      .update({ row_count: totalPhones })
      .eq('id', importId);

    if (updErr) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Update import row_count failed: ${updErr.message}` }) };
    }

    // Upsert area code as active
    const { error: acErr } = await adminClient
      .from(DNC_AREA_CODES)
      .upsert(
        { area_code: areaCode, active_import_id: importId, updated_at: new Date().toISOString() },
        { onConflict: 'area_code' }
      );

    if (acErr) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: `Upsert area code failed: ${acErr.message}` }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        area_code: areaCode,
        imported_phones: totalPhones,
        inserted_ranges: totalRanges,
        replaced_previous: true,
        import_id: importId
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err?.message || String(err) })
    };
  }
}
