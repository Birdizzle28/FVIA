// scripts/admin-dnc.js
const sb = window.supabaseClient || window.supabase;

function $(id){ return document.getElementById(id); }

function wireAdminNavLinks(){
  const navIds = ['nav-all','nav-requests','nav-history','nav-stats','nav-commissions','nav-content','nav-dnc'];
  navIds.forEach(id => {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const href = btn.getAttribute('data-href');
      if (href) location.href = href;
    });
  });
}

function setStatus(msg, isError=false){
  const el = $('dnc-status');
  if (!el) return;
  el.style.color = isError ? '#b00020' : '#333';
  el.textContent = msg || '';
}

function parseAreaCodeFromFilename(name){
  if (!name) return null;

  // Common patterns:
  // "DNC_615.txt", "615.txt", "AreaCode-615.csv", "TN_615_DNC.zip" (if you ever do zips later)
  // We'll grab the first standalone 3-digit chunk.
  const m = String(name).match(/(^|[^0-9])(\d{3})([^0-9]|$)/);
  if (!m) return null;
  return m[2];
}

function renderAreaCodes(areaCodes){
  const chipRow = $('dnc-area-codes');
  const empty = $('dnc-area-codes-empty');
  if (!chipRow || !empty) return;

  chipRow.innerHTML = '';

  const list = Array.from(areaCodes || []).sort();
  if (!list.length){
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';

  list.forEach(code => {
    const chip = document.createElement('span');
    chip.textContent = code;
    chip.style.display = 'inline-flex';
    chip.style.alignItems = 'center';
    chip.style.justifyContent = 'center';
    chip.style.padding = '6px 10px';
    chip.style.fontWeight = '800';
    chip.style.border = '1px solid #e5e6ef';
    chip.style.background = '#fff';
    chip.style.color = 'var(--indigo)';
    chip.style.borderRadius = '0';
    chipRow.appendChild(chip);
  });
}

function renderFileList(files){
  const ul = $('dnc-file-list');
  if (!ul) return;
  ul.innerHTML = '';

  (files || []).forEach(f => {
    const li = document.createElement('li');
    li.textContent = `${f.name} (${Math.ceil(f.size/1024)} KB)`;
    ul.appendChild(li);
  });
}

function collectAreaCodesFromFiles(files){
  const set = new Set();
  const unknown = [];

  (files || []).forEach(f => {
    const code = parseAreaCodeFromFilename(f.name);
    if (code) set.add(code);
    else unknown.push(f.name);
  });

  return { set, unknown };
}

async function uploadFiles(files){
  if (!files || !files.length){
    setStatus('Choose at least one file.', true);
    return;
  }

  try {
    const supabase = window.supabaseClient || window.supabase;
    const { data: { session } = {} } = await supabase.auth.getSession();
    const token = session?.access_token;

    if (!token){
      setStatus('No session token found. Please log in again.', true);
      return;
    }

    const bucket = 'dnc_uploads';

    for (let i = 0; i < files.length; i++){
      const file = files[i];
      const areaCode = parseAreaCodeFromFilename(file.name);

      if (!areaCode){
        setStatus(`Skipped ${file.name}: no 3-digit area code found in filename.`, true);
        continue;
      }

      setStatus(`(${i+1}/${files.length}) Uploading ${file.name} to storage (area code ${areaCode})…`);

      const storagePath = `${areaCode}/latest.xml`;

      const { error: upErr } = await supabase
        .storage
        .from(bucket)
        .upload(storagePath, file, { upsert: true, contentType: 'text/xml' });

      if (upErr){
        setStatus(`Storage upload failed for ${file.name}: ${upErr.message}`, true);
        continue;
      }

      setStatus(`(${i+1}/${files.length}) Storage uploaded. Starting background import for ${areaCode}…`);

      const res = await fetch('/.netlify/functions/dnc-import-background', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bucket,
          path: storagePath,
          original_filename: file.name
        })
      });

      if (!(res.ok || res.status === 202)) {
        const text = await res.text().catch(() => '');
        setStatus(`Import start failed for ${file.name} (${res.status}). ${text ? 'Details: ' + text : ''}`, true);
        continue;
      }
    }

    setStatus(`All selected files uploaded. Imports are running in the background. Refresh in a bit to see results.`);
  } catch (err){
    setStatus(`Upload/import error: ${err?.message || ''}`, true);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wireAdminNavLinks();

  const input = $('dnc-files');
  const uploadBtn = $('dnc-upload-btn');
  const clearBtn = $('dnc-clear-btn');

  function refreshUI(){
    const files = input?.files ? Array.from(input.files) : [];
    renderFileList(files);

    const { set: areaCodes } = collectAreaCodesFromFiles(files);
    renderAreaCodes(areaCodes);

    if (!files.length) setStatus('');
  }

  input?.addEventListener('change', refreshUI);

  clearBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    if (input) input.value = '';
    refreshUI();
  });

  uploadBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const files = input?.files ? Array.from(input.files) : [];
    await uploadFiles(files);
  });

  refreshUI();
});
