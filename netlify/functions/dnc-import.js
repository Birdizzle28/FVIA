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

function areaCodeFromFilename(name = '') {
  const m = name.match(/(^|[^0-9])(\d{3})([^0-9]|$)/);
  return m ? m[2] : null;
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
      throw new Error('Missing Supabase environment variables');
    }

    const token = getBearerToken(event.headers);
    if (!token) {
      return { statusCode: 401, body: 'Missing auth token' };
    }

    // Verify user session
    const authClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false }
    });

    const { data: userData, error: userErr } =
      await authClient.auth.getUser(token);

    if (userErr || !userData?.user?.id) {
      return { statusCode: 401, body: 'Invalid session' };
    }

    const userId = userData.user.id;

    // Admin check
    const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const { data: agent } = await adminClient
      .from('agents')
      .select('is_admin')
      .eq('id', userId)
      .maybeSingle();

    if (!agent?.is_admin) {
      return { statusCode: 403, body: 'Admin access required' };
    }

    // Decode multipart body (Netlify provides base64)
    const raw = Buffer.from(
      event.body,
      event.isBase64Encoded ? 'base64' : 'utf8'
    ).toString('utf8');

    // Very simple multipart extraction (single file input)
    const xmlMatch = raw.match(/<\?xml[\s\S]+$/);
    if (!xmlMatch) {
      throw new Error('No XML content found in upload');
    }

    const xmlText = xmlMatch[0];

    // Parse XML
    const parsed = await parseStringPromise(xmlText, {
      explicitArray: false,
      mergeAttrs: true
    });

    const list = parsed?.list;
    if (!list?.val) {
      throw new Error('Invalid DNC XML format (missing area code)');
    }

    const areaCode = String(list.val);
    const filenameArea = areaCodeFromFilename(
      event.headers['x-file-name'] || ''
    );

    if (filenameArea && filenameArea !== areaCode) {
      throw new Error(
        `Filename area code (${filenameArea}) does not match XML (${areaCode})`
      );
    }

    // Create import record
    const { data: importRow, error: importErr } = await adminClient
      .from(DNC_IMPORTS)
      .insert({
        area_code: areaCode,
        file_name: 'upload.xml',
        uploaded_by: userId
      })
      .select('id')
      .single();

    if (importErr) throw importErr;

    const importId = importRow.id;

    // Replace existing data
    await adminClient
      .from(DNC_NUMBERS)
      .delete()
      .eq('area_code', areaCode);

    // Extract phone numbers
    const phones = Array.isArray(list.ph) ? list.ph : [list.ph];

    const rows = phones.map(p => {
      const local7 = String(p.val).padStart(7, '0');
      return {
        area_code: areaCode,
        phone_10: `${areaCode}${local7}`,
        import_id: importId
      };
    });

    // Insert in chunks
    const CHUNK = 5000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await adminClient
        .from(DNC_NUMBERS)
        .insert(rows.slice(i, i + CHUNK), { returning: 'minimal' });
    }

    // Update import row count
    await adminClient
      .from(DNC_IMPORTS)
      .update({ row_count: rows.length })
      .eq('id', importId);

    // Mark area code active
    await adminClient
      .from(DNC_AREA_CODES)
      .upsert(
        {
          area_code: areaCode,
          active_import_id: importId,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'area_code' }
      );

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        area_code: areaCode,
        imported: rows.length,
        replaced_previous: true
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: err.message
      })
    };
  }
}
