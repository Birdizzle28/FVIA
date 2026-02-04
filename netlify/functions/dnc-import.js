// netlify/functions/dnc-import.js
const Busboy = require('busboy');
const { createClient } = require('@supabase/supabase-js');

const DNC_IMPORTS_TABLE = 'dnc_imports';
const DNC_AREA_CODES_TABLE = 'dnc_area_codes';
const DNC_NUMBERS_TABLE = 'dnc_numbers';

// Insert size per call (safe for payload limits)
const BATCH_SIZE = 5000;

// Regex for this FTC/National DNC XML format
const LIST_AC_REGEX = /<list[^>]*\bval='(\d{3})'[^>]*>/i;
const PH_REGEX_GLOBAL = /<ph\s+val='(\d{1,7})'\s*\/>/gi;

function getBearerToken(headers) {
  const h = headers.authorization || headers.Authorization || '';
  const m = String(h).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function areaCodeFromFilename(name) {
  const m = String(name || '').match(/(^|[^0-9])(\d{3})([^0-9]|$)/);
  return m ? m[2] : null;
}

async function requireAdmin({ supabaseUrl, anonKey, serviceKey, token }) {
  if (!token) return { ok: false, error: 'Missing Authorization Bearer token.' };

  // Verify token -> get user
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await authClient.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return { ok: false, error: 'Invalid/expired session. Please log in again.' };
  }

  const userId = userData.user.id;

  // Check admin status using service role (bypasses RLS safely server-side)
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: agentRow, error: agentErr } = await adminClient
    .from('agents')
    .select('is_admin')
    .eq('id', userId)
    .maybeSingle();

  if (agentErr) return { ok: false, error: 'Could not verify admin status.' };
  if (agentRow?.is_admin !== true) return { ok: false, error: 'Admin access required.' };

  return { ok: true, userId, adminClient };
}

async function insertImportRow(adminClient, { area_code, file_name, uploaded_by, row_count }) {
  const { data, error } = await adminClient
    .from(DNC_IMPORTS_TABLE)
    .insert({
      area_code,
      file_name,
      uploaded_by,
      row_count: row_count || 0,
    })
    .select('id')
    .single();

  if (error) throw new Error(`dnc_imports insert failed: ${error.message}`);
  return data.id;
}

async function updateImportRowCount(adminClient, importId, row_count) {
  const { error } = await adminClient
    .from(DNC_IMPORTS_TABLE)
    .update({ row_count })
    .eq('id', importId);

  if (error) throw new Error(`dnc_imports row_count update failed: ${error.message}`);
}

async function replaceAreaCodeData(adminClient, area_code) {
  // Replace means: delete old numbers for that area code (FTC files are full snapshots)
  const { error } = await adminClient
    .from(DNC_NUMBERS_TABLE)
    .delete()
    .eq('area_code', area_code);

  if (error) throw new Error(`Delete old dnc_numbers failed for ${area_code}: ${error.message}`);
}

async function upsertAreaCode(adminClient, area_code, importId) {
  const { error } = await adminClient
    .from(DNC_AREA_CODES_TABLE)
    .upsert(
      { area_code, active_import_id: importId, updated_at: new Date().toISOString() },
      { onConflict: 'area_code' }
    );

  if (error) throw new Error(`Upsert dnc_area_codes failed for ${area_code}: ${error.message}`);
}

async function insertBatch(adminClient, rows) {
  if (!rows.length) return;
  const { error } = await adminClient
    .from(DNC_NUMBERS_TABLE)
    .insert(rows, { returning: 'minimal' });

  if (error) throw new Error(`Insert batch failed: ${error.message}`);
}

exports.handler = async (event) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Missing env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
        }),
      };
    }

    const token = getBearerToken(event.headers);

    const adminCheck = await requireAdmin({ supabaseUrl, anonKey, serviceKey, token });
    if (!adminCheck.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: adminCheck.error }) };
    }

    const { userId, adminClient } = adminCheck;

    // Parse multipart form-data
    const contentType = event.headers['content-type'] || event.headers['Content-Type'];
    if (!contentType || !contentType.includes('multipart/form-data')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Expected multipart/form-data upload.' }),
      };
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });

    const results = [];
    let finished = false;

    // Netlify gives body as base64 for multipart
    const bodyBuffer = Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'utf8');

    const donePromise = new Promise((resolve, reject) => {
      busboy.on('file', (fieldname, fileStream, filename) => {
        if (fieldname !== 'files') {
          fileStream.resume();
          return;
        }

        const fileName = filename || 'upload.xml';
        const fileAreaFromName = areaCodeFromFilename(fileName);

        let detectedArea = null;
        let importId = null;
        let replaced = false;

        let carry = '';
        let batch = [];
        let count = 0;
        let paused = false;
        let hadListTag = false;

        const flush = async () => {
          if (!batch.length) return;
          const toInsert = batch;
          batch = [];
          await insertBatch(adminClient, toInsert);
        };

        const ensureStarted = async () => {
          if (!detectedArea) {
            throw new Error(`Could not detect area code from XML in file: ${fileName}`);
          }

          // If filename had an area code too, it must match XML
          if (fileAreaFromName && fileAreaFromName !== detectedArea) {
            throw new Error(
              `Area code mismatch. Filename suggests ${fileAreaFromName} but XML is ${detectedArea} (${fileName}).`
            );
          }

          // Create import row first (row_count filled later)
          importId = await insertImportRow(adminClient, {
            area_code: detectedArea,
            file_name: fileName,
            uploaded_by: userId,
            row_count: 0,
          });

          // Replace old data for that area code
          await replaceAreaCodeData(adminClient, detectedArea);
          replaced = true;

          // Ensure area code exists / points to this import
          await upsertAreaCode(adminClient, detectedArea, importId);
        };

        fileStream.on('data', async (chunk) => {
          try {
            const text = chunk.toString('utf8');

            // Detect area code from the opening <list ... val='423'>
            if (!hadListTag) {
              const m = text.match(LIST_AC_REGEX);
              if (m && m[1]) {
                detectedArea = m[1];
                hadListTag = true;
                await ensureStarted();
              }
            }

            // We can’t parse ph rows until we know detectedArea/importId
            if (!importId) {
              // keep a little buffer in case the <list> tag spans chunks
              carry = (carry + text).slice(-5000);
              return;
            }

            // Streaming parse: keep a rolling buffer
            carry += text;

            // Extract all <ph val='xxxxxxx' /> matches currently in carry
            let match;
            PH_REGEX_GLOBAL.lastIndex = 0;

            while ((match = PH_REGEX_GLOBAL.exec(carry)) !== null) {
              let local7 = match[1] || '';
              // pad to 7 digits just in case
              local7 = local7.padStart(7, '0');

              const phone10 = `${detectedArea}${local7}`;

              batch.push({
                area_code: detectedArea,
                phone_10: phone10,
                import_id: importId,
              });
              count++;

              if (batch.length >= BATCH_SIZE && !paused) {
                paused = true;
                fileStream.pause();
                await flush();
                paused = false;
                fileStream.resume();
              }
            }

            // Keep only the tail so we don’t grow unbounded
            if (carry.length > 20000) carry = carry.slice(-20000);
          } catch (err) {
            fileStream.unpipe();
            fileStream.resume();
            busboy.emit('error', err);
          }
        });

        fileStream.on('end', async () => {
          try {
            if (!importId) {
              throw new Error(`No <list ... val='###'> area code found in XML (${fileName}).`);
            }

            await flush();
            await updateImportRowCount(adminClient, importId, count);

            results.push({
              file: fileName,
              area_code: detectedArea,
              imported: count,
              replaced_previous: replaced,
              import_id: importId,
            });
          } catch (err) {
            results.push({
              file: fileName,
              error: err.message || String(err),
            });
          }
        });
      });

      busboy.on('finish', () => {
        finished = true;
        resolve();
      });

      busboy.on('error', (err) => reject(err));
    });

    busboy.end(bodyBuffer);
    await donePromise;

    if (!finished) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Upload did not finish.' }) };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        results,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: err?.message || String(err),
      }),
    };
  }
};
