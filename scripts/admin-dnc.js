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

  const { set: areaCodes, unknown } = collectAreaCodesFromFiles(files);

  if (!areaCodes.size){
    setStatus('I could not detect any area codes from filenames. Rename files to include the 3-digit area code (ex: 615.txt).', true);
    return;
  }

  // Warn (but allow) if some filenames didn’t match a 3-digit code
  if (unknown.length){
    setStatus(`Detected area codes: ${Array.from(areaCodes).sort().join(', ')} • Note: some files had no detectable 3-digit code.`, false);
  } else {
    setStatus(`Detected area codes: ${Array.from(areaCodes).sort().join(', ')}`, false);
  }

  // This endpoint will be created in Step 3 (Netlify parser).
  // We are NOT creating it here—this just prepares the frontend to hit it.
  const endpoint = '/.netlify/functions/dnc-import';

  const fd = new FormData();
  Array.from(files).forEach(f => fd.append('files', f, f.name));
  fd.append('area_codes', JSON.stringify(Array.from(areaCodes)));

  setStatus('Uploading…');

  try {
    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const text = await res.text().catch(() => '');

    if (!res.ok){
      // Until Step 3 exists, this will likely error—still show the response cleanly.
      setStatus(`Upload failed (${res.status}). This is expected until we build the parser function. ${text ? 'Details: ' + text : ''}`, true);
      return;
    }

    // If it returns JSON later, we can display counts, replaced area codes, etc.
    setStatus('Upload successful. (Parser will enforce upsert/replace by area code.)');
  } catch (err){
    setStatus(`Upload error. This is expected until the parser function exists. ${err?.message || ''}`, true);
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
