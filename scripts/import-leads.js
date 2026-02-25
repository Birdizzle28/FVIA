import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/**
 * ✅ Uses same Supabase project pattern as your other pages.
 * If you’d rather pull these from a shared config file later, we can do that.
 */
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// ---------- DOM ----------
const csvFile = document.getElementById('csvFile');
const parseBtn = document.getElementById('parseBtn');
const importBtn = document.getElementById('importBtn');

const rowCount = document.getElementById('rowCount');
const parsedCount = document.getElementById('parsedCount');
const importedCount = document.getElementById('importedCount');
const errorCount = document.getElementById('errorCount');
const statusEl = document.getElementById('status');
const progressBar = document.getElementById('progressBar');

const previewHead = document.getElementById('previewHead');
const previewBody = document.getElementById('previewBody');

const hubToggle = document.getElementById("agent-hub-toggle");
const hubMenu = document.getElementById("agent-hub-menu");

let parsedRows = [];
let headers = [];

// ---------- helpers ----------
const digitsOnly = (v) => String(v || '').replace(/\D/g, '');

function normalizePhone10(v){
  const d = digitsOnly(v);
  // keep last 10 digits if extra
  const last10 = d.length > 10 ? d.slice(-10) : d;
  if (last10.length < 10) return null;
  return last10;
}

function pickPhonesFromRow(r){
  const out = [];
  const cols = [
    r.cell_phone,
    r.landline,
    r.recent_cell_phone_1,
    r.recent_cell_phone_2,
    r.recent_cell_phone_3,
    r.recent_landline_1
  ];
  cols.forEach(x => {
    const p = normalizePhone10(x);
    if (p && !out.includes(p)) out.push(p);
  });
  return out;
}

function pickEmailsFromRow(r){
  const out = [];
  const cols = [r.email, r.recent_email_1, r.recent_email_2];
  cols.forEach(x => {
    const e = String(x || '').trim();
    if (!e) return;
    if (!out.includes(e)) out.push(e);
  });
  return out;
}

function zip5(zipPlusFour){
  const z = String(zipPlusFour || '').trim();
  if (!z) return null;
  const m = z.match(/^(\d{5})/);
  return m ? m[1] : z;
}

function safeDate(v){
  const s = String(v || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Everything that isn’t mapped cleanly gets shoved in notes as JSON.
 */
function buildExtraNotes(row){
  const mapped = new Set([
    'lead_id','first_name','last_name','address','city','state','zip_plus_four',
    'cell_phone','landline','recent_cell_phone_1','recent_cell_phone_2','recent_cell_phone_3',
    'recent_landline_1','email','recent_email_1','recent_email_2',
    'policy_type','date_requested','jornaya_lead_id','trusted_form'
  ]);

  const extra = {};
  Object.keys(row || {}).forEach(k => {
    if (mapped.has(k)) return;
    const v = row[k];
    if (v === null || v === undefined || String(v).trim() === '') return;
    extra[k] = v;
  });

  // Always include some source identifiers if present
  if (row.lead_id) extra.source_lead_id = row.lead_id;
  if (row.jornaya_lead_id) extra.jornaya_lead_id = row.jornaya_lead_id;
  if (row.trusted_form) extra.trusted_form = row.trusted_form;

  const keys = Object.keys(extra);
  if (!keys.length) return '';

  return `\n\n--- IMPORT EXTRA (NextWave) ---\n${JSON.stringify(extra, null, 2)}`;
}

function setStatus(text, isBad=false){
  statusEl.textContent = text;
  statusEl.style.color = isBad ? '#b00020' : '#353468';
}

function setProgress(pct){
  progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

// ---------- header dropdown ----------
function initAgentHubMenu(){
  if (!hubToggle || !hubMenu) return;
  hubMenu.style.display = 'none';
  hubToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    hubMenu.style.display = hubMenu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) hubMenu.style.display = 'none';
  });
}

// ---------- auth gate ----------
async function requireLogin(){
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }

  // hide admin-only if not admin
  const { data: me } = await supabase.from('agents').select('is_admin').eq('id', session.user.id).single();
  if (!me?.is_admin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }

  return session;
}

// ---------- CSV parsing ----------
function renderPreview(rows){
  previewHead.innerHTML = '';
  previewBody.innerHTML = '';

  const cols = headers.slice(0, 10); // keep preview readable
  const trh = document.createElement('tr');
  cols.forEach(h => {
    const th = document.createElement('th');
    th.textContent = h;
    trh.appendChild(th);
  });
  previewHead.appendChild(trh);

  rows.slice(0, 10).forEach(r => {
    const tr = document.createElement('tr');
    cols.forEach(h => {
      const td = document.createElement('td');
      td.textContent = (r[h] ?? '');
      tr.appendChild(td);
    });
    previewBody.appendChild(tr);
  });
}

function parseCsvFile(file){
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => resolve(res),
      error: (err) => reject(err)
    });
  });
}

// ---------- Supabase insert helpers ----------
async function findExistingContactByPhone(phone10){
  // contacts.phones stores strings; we store digits-only 10.
  // Use array contains to find any contact that already has this phone.
  const { data, error } = await supabase
    .from('contacts')
    .select('id, phones')
    .contains('phones', [phone10])
    .limit(1);

  if (error) return null;
  return (data && data.length) ? data[0] : null;
}

async function createContactFromRow(row, owningAgentId){
  const phones = pickPhonesFromRow(row);
  const emails = pickEmailsFromRow(row);

  // If we can match by a phone, reuse that contact (prevents easy duplicates)
  if (phones.length){
    const existing = await findExistingContactByPhone(phones[0]);
    if (existing?.id) return { id: existing.id, reused: true };
  }

  const baseNotes =
    `Imported from NextWave\n` +
    `Original date_requested: ${row.date_requested || '—'}\n` +
    `Policy type: ${row.policy_type || '—'}\n` +
    (row.jornaya_lead_id ? `Jornaya: ${row.jornaya_lead_id}\n` : '') +
    (row.trusted_form ? `TrustedForm: ${row.trusted_form}\n` : '');

  const extraNotes = buildExtraNotes(row);

  const consentAt = safeDate(row.date_requested);
  const tcpaconsent = !!(String(row.jornaya_lead_id || '').trim() || String(row.trusted_form || '').trim());

  const contactPayload = {
    first_name: (row.first_name || '').trim() || null,
    last_name: (row.last_name || '').trim() || null,
    phones: phones.length ? phones : [],
    emails: emails.length ? emails : [],
    address_line1: (row.address || '').trim() || null,
    address_line2: null,
    city: (row.city || '').trim() || null,
    state: (row.state || '').trim() || null,
    zip: zip5(row.zip_plus_four),
    owning_agent_id: owningAgentId,
    consent_source: 'NextWave',
    consent_at: consentAt,
    tcpaconsent,
    // safest default: mark as needs follow-up compliance / DNC check later
    dnc_flag: false,
    notes: (baseNotes + extraNotes).trim() || null
  };

  const { data, error } = await supabase
    .from('contacts')
    .insert(contactPayload)
    .select('id')
    .single();

  if (error) throw error;
  return { id: data.id, reused: false };
}

async function createLeadFromRow(row, session, agentProfile, contactId){
  const phones = pickPhonesFromRow(row);

  const leadNotes =
    `Imported from NextWave\n` +
    `Original lead_id: ${row.lead_id || '—'}\n` +
    `DOB: ${row.dob || '—'} | Gender: ${row.gender || '—'} | Smoker: ${row.smoker || '—'}\n` +
    `Requested: ${row.date_requested || '—'}\n` +
    (row.preexisting_conditions ? `Preexisting: ${row.preexisting_conditions}\n` : '');

  const extraNotes = buildExtraNotes(row);

  const payload = {
    first_name: (row.first_name || '').trim() || 'Unknown',
    last_name: (row.last_name || '').trim() || 'Unknown',
    age: null, // not provided directly in this csv
    address: (row.address || '').trim() || null,
    city: (row.city || '').trim() || null,
    state: (row.state || '').trim() || null,
    zip: zip5(row.zip_plus_four),
    product_type: (row.policy_type || '').trim() || null,
    lead_type: 'NextWave', // feel free to rename later
    notes: (leadNotes + extraNotes).trim() || null,
    phone: phones.length ? phones : [],
    submitted_by: session.user.id,
    assigned_to: session.user.id,
    submitted_by_name: agentProfile?.full_name || agentProfile?.full_name === '' ? agentProfile.full_name : (
      agentProfile ? `${agentProfile.first_name || ''} ${agentProfile.last_name || ''}`.trim() : null
    ),
    contact_id: contactId
  };

  const { error } = await supabase.from('leads').insert(payload);
  if (error) throw error;
}

// ---------- controlled concurrency (so you don’t get rate-limited) ----------
async function runPool(items, worker, concurrency=3){
  let i = 0;
  const results = [];
  const runners = new Array(concurrency).fill(0).map(async () => {
    while (i < items.length){
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------- main ----------
document.addEventListener('DOMContentLoaded', async () => {
  initAgentHubMenu();

  // mobile menu toggle (basic)
  document.getElementById('menu-toggle')?.addEventListener('click', () => {
    const mm = document.getElementById('mobile-menu');
    if (!mm) return;
    mm.style.display = (mm.style.display === 'block') ? 'none' : 'block';
  });
  document.getElementById('toolkit-toggle')?.addEventListener('click', () => {
    const sub = document.getElementById('toolkit-submenu');
    if (!sub) return;
    const hidden = sub.hasAttribute('hidden');
    if (hidden) sub.removeAttribute('hidden');
    else sub.setAttribute('hidden','');
  });

  const session = await requireLogin();
  if (!session) return;

  // load agent profile (for submitted_by_name)
  const { data: agentProfile } = await supabase
    .from('agents')
    .select('*')
    .eq('id', session.user.id)
    .single();

  csvFile.addEventListener('change', () => {
    parseBtn.disabled = !csvFile.files?.[0];
    importBtn.disabled = true;
    parsedRows = [];
    headers = [];
    rowCount.textContent = '—';
    parsedCount.textContent = '—';
    setStatus('File selected. Click Parse.');
    setProgress(0);
    previewHead.innerHTML = '';
    previewBody.innerHTML = '';
  });

  parseBtn.addEventListener('click', async () => {
    const file = csvFile.files?.[0];
    if (!file) return;

    setStatus('Parsing CSV…');
    setProgress(10);

    try {
      const res = await parseCsvFile(file);
      headers = res.meta?.fields || Object.keys(res.data?.[0] || {});
      parsedRows = (res.data || []).filter(r => {
        // keep rows that at least have a name or phone
        const hasName = String(r.first_name || r.last_name || '').trim().length > 0;
        const hasPhone = !!pickPhonesFromRow(r).length;
        return hasName || hasPhone;
      });

      rowCount.textContent = String(res.data?.length || 0);
      parsedCount.textContent = String(parsedRows.length);
      renderPreview(parsedRows);

      importBtn.disabled = parsedRows.length === 0;
      setStatus(`Parsed ${parsedRows.length} row(s). Ready to import.`);
      setProgress(25);
    } catch (e) {
      console.error(e);
      setStatus('Parse failed. Check console.', true);
      setProgress(0);
    }
  });

  importBtn.addEventListener('click', async () => {
    if (!parsedRows.length) return;

    const confirmed = window.confirm(
      `Import ${parsedRows.length} leads?\n\nThis will create Contacts + Leads in Supabase.`
    );
    if (!confirmed) return;

    importBtn.disabled = true;
    parseBtn.disabled = true;
    csvFile.disabled = true;

    let ok = 0;
    let bad = 0;
    importedCount.textContent = '0';
    errorCount.textContent = '0';
    setProgress(30);
    setStatus('Importing… do not close this tab.');

    const owningAgentId = session.user.id;

    await runPool(parsedRows, async (row, idx) => {
      try {
        const c = await createContactFromRow(row, owningAgentId);
        await createLeadFromRow(row, session, agentProfile, c.id);

        ok++;
        importedCount.textContent = String(ok);
      } catch (e) {
        bad++;
        errorCount.textContent = String(bad);
        console.error('[IMPORT ERROR]', idx, e, row);
      } finally {
        const pct = 30 + Math.round(((idx + 1) / parsedRows.length) * 70);
        setProgress(pct);
        setStatus(`Importing… ${idx + 1}/${parsedRows.length} processed.`);
      }
    }, 3);

    setProgress(100);
    setStatus(`Done. Imported ${ok}/${parsedRows.length}. Errors: ${bad}.`);
  });
});
