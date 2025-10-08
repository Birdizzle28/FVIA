// scripts/leads.js — DROP-IN REPLACEMENT
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let agentProfile = null;
let agentCurrentPage = 1;
let agentTotalPages = 1;
const PAGE_SIZE = 25;

// ---------- helpers ----------
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const toE164 = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (s.startsWith('+')) return s.replace(/[^\d+]/g, '');
  const d = s.replace(/\D/g,'');
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return `+${d}`;
};
function contactToVCard(c) {
  const first = c.first_name || '';
  const last  = c.last_name  || '';
  const org   = 'Family Values Insurance Agency';
  const phones = Array.isArray(c.phones) ? c.phones : (c.phones ? [c.phones] : []);
  const emails = Array.isArray(c.emails) ? c.emails : (c.emails ? [c.emails] : []);
  const lines = [
    'BEGIN:VCARD','VERSION:3.0',
    `N:${last};${first};;;`,
    `FN:${[first,last].filter(Boolean).join(' ') || 'Contact'}`,
    `ORG:${org}`,
    ...phones.map(p => `TEL;TYPE=CELL:${toE164(p) || p}`),
    ...emails.map(e => `EMAIL;TYPE=INTERNET:${e}`),
    'END:VCARD'
  ];
  return lines.join('\r\n');
}
function downloadText(filename, text, mime='text/vcard;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ---------- UI sections (your existing tab behavior preserved) ----------
const getNavButtons = () => ({
  view:    document.querySelector('#nav-view'),
  submit:  document.querySelector('#nav-submit'),
  request: document.querySelector('#nav-request'),
  contacts:document.querySelector('#nav-contacts')
});

const getSections = () => ({
  view:    document.querySelector('#lead-viewer-section'),
  submit:  document.querySelector('#submit-lead-section'),
  request: document.querySelector('#request-leads-section'),
  contacts:document.querySelector('#contacts-section')
});

function hideAll() {
  const secs = getSections();
  Object.values(secs).forEach(el => { if (el) el.style.display = 'none'; });
  const navs = getNavButtons();
  Object.values(navs).forEach(btn => btn?.classList.remove('active'));
}

function showSection(name) {
  const secs = getSections();
  const navs = getNavButtons();
  hideAll();
  const sec = secs[name];
  if (sec) sec.style.display = 'block';
  const btn = navs[name];
  btn?.classList.add('active');
}

// ---------- header dropdown init (same as maps/scheduling) ----------
function initAgentHubMenu() {
  const toggle = $('#agent-hub-toggle');
  const menu   = $('#agent-hub-menu');
  if (!toggle || !menu) return;
  menu.style.display = 'none';
  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) menu.style.display = 'none';
  });
}

// ---------- load agent profile ----------
async function fetchAgentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('agents').select('*').eq('id', user.id).single();
  if (error) { console.error(error); return null; }
  return data;
}

// ---------- Leads table ----------
function updatePaginationControls() {
  const pgEl = $('#agent-current-page');
  if (pgEl) pgEl.textContent = `Page ${agentCurrentPage}`;

  const prev = $('#agent-prev-page');
  if (prev) prev.toggleAttribute('disabled', agentCurrentPage === 1);

  const next = $('#agent-next-page');
  if (next) next.toggleAttribute('disabled', agentCurrentPage === agentTotalPages);
}

async function loadAgentLeads() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session.user;

  // Pull my leads, then client-side paginate (keeps it simple)
  let { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .eq('assigned_to', user.id)
    .order('created_at', { ascending: false });

  if (error) { console.error('load leads error:', error); leads = []; }

  agentTotalPages = Math.max(1, Math.ceil((leads.length || 0) / PAGE_SIZE));
  const start = (agentCurrentPage - 1) * PAGE_SIZE;
  const page  = (leads || []).slice(start, start + PAGE_SIZE);

  const tbody = $('#agent-leads-table tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  page.forEach(l => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="lead-checkbox" data-id="${l.id}"></td>
      <td>${new Date(l.created_at).toLocaleDateString()}</td>
      <td>${l.submitted_by_name || ''}</td>
      <td>${l.first_name || ''}</td>
      <td>${l.last_name || ''}</td>
      <td>${l.age ?? ''}</td>
      <td>${(l.phone || []).join(', ')}</td>
      <td>${l.address || ''}</td>
      <td>${l.city || ''}</td>
      <td>${l.state || ''}</td>
      <td>${l.zip || ''}</td>
      <td>${l.lead_type || ''}</td>
      <td>${l.product_type || ''}</td>
      <td>${l.notes || ''}</td>
    `;
    tbody.appendChild(tr);
  });

  updatePaginationControls();
}

// ✅ Select All that matches your existing checkbox id (#select-all)
function initSelectAll() {
  const master = $('#select-all'); // this is how your table header is wired
  if (!master) return;
  master.addEventListener('change', () => {
    const on = master.checked;
    $$('.lead-checkbox').forEach(cb => cb.checked = on);
  });
}

// ✅ Archive selected → leads_archive (fallback: archive)
async function archiveSelectedLeads() {
  const ids = $$('.lead-checkbox:checked').map(cb => cb.dataset.id);
  if (!ids.length) return alert('Select at least one lead.');

  // read selected rows
  const { data: rows, error: selErr } = await supabase.from('leads').select('*').in('id', ids);
  if (selErr) { alert('Failed reading leads.'); console.error(selErr); return; }

  // try leads_archive, then fallback to archive
  let insErr = null, target = 'leads_archive';
  let ins = await supabase.from(target).insert(rows);
  if (ins.error) {
    target = 'archive';
    const try2 = await supabase.from(target).insert(rows);
    if (try2.error) insErr = try2.error;
  }
  if (insErr) { alert('Failed to archive (insert).'); console.error(insErr); return; }

  // delete originals
  const { error: delErr } = await supabase.from('leads').delete().in('id', ids);
  if (delErr) { alert('Archived, but failed to delete originals.'); console.error(delErr); }

  alert(`Archived ${ids.length} lead(s).`);
  await loadAgentLeads();
  const sa = $('#select-all'); if (sa) sa.checked = false;
}

// ---------- Contacts ----------
let contacts = [];
let selectMode = false;
const selectedIds = new Set();

function renderContacts() {
  const wrap = $('#contacts-list');
  if (!wrap) return;
  wrap.innerHTML = '';

  const q = ($('#contacts-search')?.value || '').toLowerCase();
  const order = $('#contacts-order')?.value || 'created_desc';

  let list = contacts.slice();
  if (q) {
    list = list.filter(c => {
      const name = `${c.first_name||''} ${c.last_name||''}`.toLowerCase();
      const phones = (c.phones||[]).join(' ').toLowerCase();
      const emails = (c.emails||[]).join(' ').toLowerCase();
      return name.includes(q) || phones.includes(q) || emails.includes(q);
    });
  }

  // order
  list.sort((a,b)=>{
    if (order === 'created_desc') return new Date(b.created_at) - new Date(a.created_at);
    if (order === 'created_asc')  return new Date(a.created_at) - new Date(b.created_at);
    const A = `${a.first_name||''} ${a.last_name||''}`.toLowerCase().trim();
    const B = `${b.first_name||''} ${b.last_name||''}`.toLowerCase().trim();
    if (order === 'name_asc')  return A.localeCompare(B);
    if (order === 'name_desc') return B.localeCompare(A);
    return 0;
  });

  // header
  const head = document.createElement('div');
  head.style.cssText='display:grid;grid-template-columns:40px 1fr 1fr 1fr;gap:8px;padding:10px 14px;border-bottom:1px solid #eef0f6;background:#f9fafe;';
  head.innerHTML = `
    <div>${selectMode ? '<i class="fa-regular fa-square-check"></i>' : ''}</div>
    <div><strong>Name</strong></div>
    <div><strong>Phone</strong></div>
    <div><strong>Email</strong></div>`;
  wrap.appendChild(head);

  list.forEach(c=>{
    const row = document.createElement('div');
    row.className='contact-row';
    row.style.cssText='display:grid;grid-template-columns:40px 1fr 1fr 1fr;gap:8px;align-items:center;padding:12px 14px;border-bottom:1px solid #f1f2f6;cursor:pointer;';
    const name  = `${c.first_name||''} ${c.last_name||''}`.trim() || '(No name)';
    const phone = (c.phones && c.phones[0]) ? c.phones[0] : '';
    const email = (c.emails && c.emails[0]) ? c.emails[0] : '';
    const checked = selectedIds.has(c.id) ? 'checked' : '';
    row.innerHTML = `
      <div>${selectMode ? `<input type="checkbox" class="contact-cb" data-id="${c.id}" ${checked}>` : '<i class="fa-solid fa-user"></i>'}</div>
      <div><i class="fa-solid fa-id-card-clip" style="margin-right:6px;"></i>${name}</div>
      <div><i class="fa-solid fa-phone" style="margin-right:6px;"></i>${phone || '—'}</div>
      <div><i class="fa-solid fa-envelope" style="margin-right:6px;"></i>${email || '—'}</div>
    `;

    row.addEventListener('click', (e)=>{
      if (selectMode) {
        const cb = row.querySelector('.contact-cb');
        if (e.target !== cb) cb.checked = !cb.checked;
        if (cb.checked) selectedIds.add(c.id); else selectedIds.delete(c.id);
        updateBulkBar();
      } else {
        openContactDetail(c);
      }
    });

    wrap.appendChild(row);
  });

  updateBulkBar();
}

function updateBulkBar() {
  const bar = $('#contacts-bulk-actions');
  const count = selectedIds.size;
  $('#contacts-selected-count').textContent = String(count);
  bar.style.display = count > 0 ? 'flex' : 'none';
}

function openContactDetail(c) {
  const modal = $('#contact-detail-modal');
  const title = $('#contact-modal-name');
  const body  = $('#contact-modal-body');
  const name  = `${c.first_name||''} ${c.last_name||''}`.trim() || 'Contact';

  title.textContent = name;
  body.innerHTML = `
    <p><strong><i class="fa-solid fa-phone"></i> Phone(s):</strong><br>${(c.phones||[]).map(p => `<a href="tel:${toE164(p)||p}">${p}</a>`).join('<br>') || '—'}</p>
    <p><strong><i class="fa-solid fa-envelope"></i> Email(s):</strong><br>${(c.emails||[]).map(e => `<a href="mailto:${e}">${e}</a>`).join('<br>') || '—'}</p>
    <p><strong><i class="fa-solid fa-location-dot"></i> Address:</strong><br>${[c.address, c.city, c.state, c.zip].filter(Boolean).join(', ') || '—'}</p>
    ${c.notes ? `<p><strong><i class="fa-solid fa-note-sticky"></i> Notes:</strong><br>${c.notes}</p>` : ''}
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
      <button id="contact-save-one" class="see-all"><i class="fa-solid fa-download"></i> Save to phone (.vcf)</button>
    </div>
  `;
  modal.classList.add('open'); modal.setAttribute('aria-hidden','false');
  $('#contact-save-one').addEventListener('click', ()=> downloadText(`${name||'contact'}.vcf`, contactToVCard(c)));
}
function closeOverlaysOnClicks() {
  document.addEventListener('click', (e)=>{
    if (e.target.matches('[data-close], .overlay-backdrop')) {
      const ov = e.target.closest('.overlay');
      if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden','true'); }
    }
  });
}
async function loadContacts() {
  let query = supabase.from('contacts').select('*').order('created_at', { ascending:false });
  const { data, error } = await query;
  if (error) { console.error('contacts load error', error); return; }
  contacts = data || [];
  renderContacts();
}
function saveSelectedContacts() {
  const pick = contacts.filter(c => selectedIds.has(c.id));
  if (!pick.length) return;
  const text = pick.map(contactToVCard).join('\r\n');
  downloadText(`FVIA_Contacts_${pick.length}.vcf`, text);
}

// ---------- DOMContentLoaded ----------
document.addEventListener('DOMContentLoaded', async () => {
  initAgentHubMenu();
  closeOverlaysOnClicks();

  // auth
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }

  agentProfile = await fetchAgentProfile();
  if (!agentProfile?.is_admin) $('.admin-only')?.style && ($('.admin-only').style.display = 'none');

  // tabs
  const navs = getNavButtons();
  navs.view?.addEventListener('click', () => showSection('view'));
  navs.submit?.addEventListener('click', () => showSection('submit'));
  navs.request?.addEventListener('click', () => showSection('request'));
  navs.contacts?.addEventListener('click', async () => {
    showSection('contacts');
    await loadContacts();
  });
  showSection('view'); // default, consistent with your current script  [oai_citation:9‡scripts:leads.js](file-service://file-8XF1g2dPHrc3V5sLjFFYWE)

  // leads table + pagination
  await loadAgentLeads();
  $('#agent-next-page')?.addEventListener('click', async ()=>{ if (agentCurrentPage < agentTotalPages) { agentCurrentPage++; await loadAgentLeads(); }});
  $('#agent-prev-page')?.addEventListener('click', async ()=>{ if (agentCurrentPage > 1) { agentCurrentPage--; await loadAgentLeads(); }});

  // ✅ select all (matches your table’s #select-all id)
  initSelectAll();

  // ✅ archive selected
  $('#agent-archive-btn')?.addEventListener('click', archiveSelectedLeads);

  // contacts wiring
  $('#contacts-refresh')?.addEventListener('click', loadContacts);
  $('#contacts-search')?.addEventListener('input', renderContacts);
  $('#contacts-order')?.addEventListener('change', renderContacts);

  $('#contacts-select-toggle')?.addEventListener('click', ()=>{
    selectMode = !selectMode;
    if (!selectMode) selectedIds.clear();
    $('#contacts-select-all').style.display = selectMode ? 'inline-block' : 'none';
    renderContacts();
  });
  $('#contacts-select-all')?.addEventListener('click', ()=>{
    const allIds = contacts.map(c=>c.id);
    const allSelected = allIds.every(id => selectedIds.has(id));
    if (allSelected) allIds.forEach(id => selectedIds.delete(id));
    else allIds.forEach(id => selectedIds.add(id));
    renderContacts();
  });
  $('#contacts-bulk-save')?.addEventListener('click', saveSelectedContacts);

  // logout (kept, since your pages share this pattern)
  $('#logout-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signOut();
    if (error) alert('Logout failed!'); else window.location.href = '../index.html';
  });
});
