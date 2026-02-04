import { createClient } from '@supabase/supabase-js';
import { parseStringPromise } from 'xml2js';

const DNC_IMPORTS = 'dnc_imports';
const DNC_AREA_CODES = 'dnc_area_codes';
const DNC_NUMBERS = 'dnc_numbers';

function getBearerToken(headers = {}) {
  const h = headers.authorization || headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
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
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: 'Missing Supabase environment variables' })
      };
    }

    const token = getBearerToken(event.headers);
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Missing auth token' }) };
    }

    // Verify user session using anon key
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false }
    });

    const { data: userData, error: userErr } = await authClient.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Invalid session' }) };
    }

    const userId = userData.user.id;

    // Service role client (bypasses RLS)
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

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
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: `Storage download failed: ${dlErr?.message || 'unknown'}` })
      };
    }

    // Convert Blob -> string
    const ab = await fileBlob.arrayBuffer();
    const xmlText = Buffer.from(ab).toString('utf8').trim();

    if (!xmlText || !xmlText.includes('<list')) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Downloaded file is not valid XML' }) };
    }

    // Parse XML
    const parsed = await parseStringPromise(xmlText, {
      explicitArray: false,
      mergeAttrs: true
    });

    const list = parsed?.list;
    if (!list?.val) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Invalid DNC XML format (missing list val area code)' }) };
    }

    const areaCode = String(list.val);

    // Extract phone numbers
    // In your DNC XML, phone entries look like: <ph val='0000000' />
    // Full 10-digit phone = areaCode + 7-digit local
    // Extract phone numbers
    // Some files are: <list><ph .../></list>
    // Your file is:  <list><ac><ph .../></ac></list>
    let phones = list.ph || list.ac?.ph || null;
    
    // If list.ac is an array (just in case), collect ph from each ac node
    if (!phones && Array.isArray(list.ac)) {
      phones = list.ac.flatMap(a => a?.ph || []);
    }
    
    if (!phones) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'No <ph> entries found in XML' }) };
    }
    
    // Normalize to a flat array
    if (!Array.isArray(phones)) phones = [phones];
    phones = phones.flat().filter(Boolean);
    
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
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: `Import row insert failed: ${importErr?.message || 'unknown'}` })
      };
    }

    const importId = importRow.id;

    // Replace existing numbers for that area code (monthly snapshot)
    const { error: delErr } = await adminClient
      .from(DNC_NUMBERS)
      .delete()
      .eq('area_code', areaCode);

    if (delErr) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: `Delete old numbers failed: ${delErr.message}` })
      };
    }

    // Insert in chunks (smaller chunk prevents timeouts/large payload issues)
    const CHUNK = 500;
    let inserted = 0;

    for (let i = 0; i < phones.length; i += CHUNK) {
      const slice = phones.slice(i, i + CHUNK);

      const rows = slice.map(p => {
        const local7 = String(p?.val ?? '').padStart(7, '0');
        return {
          area_code: areaCode,
          phone_10: `${areaCode}${local7}`,
          import_id: importId
        };
      });

      const { error: insErr } = await adminClient
        .from(DNC_NUMBERS)
        .insert(rows, { returning: 'minimal' });

      if (insErr) {
        return {
          statusCode: 500,
          body: JSON.stringify({
            ok: false,
            error: `Insert failed near index ${i}: ${insErr.message}`
          })
        };
      }

      inserted += rows.length;
    }

    // Update import count
    const { error: updErr } = await adminClient
      .from(DNC_IMPORTS)
      .update({ row_count: inserted })
      .eq('id', importId);

    if (updErr) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: `Update import row_count failed: ${updErr.message}` })
      };
    }

    // Upsert area code to mark it active
    const { error: acErr } = await adminClient
      .from(DNC_AREA_CODES)
      .upsert(
        {
          area_code: areaCode,
          active_import_id: importId,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'area_code' }
      );

    if (acErr) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: `Upsert area code failed: ${acErr.message}` })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        area_code: areaCode,
        imported: inserted,
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
