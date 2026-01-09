// scripts/admin-assignment-history.js
const sb = window.supabaseClient || window.supabase;

const PAGE_SIZE = 25;

let me = null;

let agentNameById = {}; // { [uuid]: full_name }

let page = 1;
let totalRows = 0;

let dateStartISO = null; // YYYY-MM-DD
let dateEndISO = null;   // YYYY-MM-DD

function $(id){ return document.getElementById(id); }

function escapeHtml(v){
  if (v == null) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function formatDate(dt){
  if (!dt) return '—';
  try { return new Date(dt).toLocaleString(); }
  catch { return String(dt); }
}

function isoEndExclusive(endISO){
  const d = new Date(endISO + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function setMsg(t){
  const el = $('hist-msg');
  if (el) el.textContent = t || '';
}

function wireAdminNavLinks(){
  const navIds = ['nav-all','nav-requests','nav-history','nav-stats','nav-commissions','nav-content'];
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

async function loadMe(){
  const { data: { session } = {} } = await sb.auth.getSession();
  me = session?.user || null;
}

async function loadAgentsMapAndFilters(){
  const { data, error } = await sb
    .from('agents')
    .select('id, full_name')
    .order('full_name', { ascending: true });

  if (error){
    console.warn('loadAgentsMapAndFilters error:', error);
    return;
  }

  agentNameById = {};
  (data || []).forEach(a => {
    if (a?.id) agentNameById[a.id] = a.full_name || '—';
  });

  const toSel = $('hist-assigned-to');
  const bySel = $('hist-assigned-by');

  if (toSel){
    toSel.innerHTML = `<option value="">All Agents</option>` + (data || [])
      .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.full_name || '—')}</option>`)
      .join('');
  }

  if (bySel){
    bySel.innerHTML = `<option value="">All Admins/Agents</option>` + (data || [])
      .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.full_name || '—')}</option>`)
      .join('');
  }
}

function initDateRangePicker(){
  const input = $('hist-date-range');
  if (!input || !window.flatpickr) return;

  window.flatpickr(input, {
    mode: 'range',
    dateFormat: 'Y-m-d',
    onClose: (dates) => {
      if (!dates || dates.length < 2){
        dateStartISO = null;
        dateEndISO = null;
        return;
      }
      const [start, end] = dates;
      dateStartISO = new Date(start).toISOString().slice(0, 10);
      dateEndISO = new Date(end).toISOString().slice(0, 10);
    }
  });
}

function getFilters(){
  return {
    order: $('hist-order')?.value || 'desc',
    assignedTo: $('hist-assigned-to')?.value || '',
    assignedBy: $('hist-assigned-by')?.value || ''
  };
}

function resetFiltersUI(){
  $('hist-order').value = 'desc';
  $('hist-assigned-to').value = '';
  $('hist-assigned-by').value = '';
  $('hist-date-range').value = '';
  dateStartISO = null;
  dateEndISO = null;
}

async function loadHistory(){
  const tbody = $('assignment-history-table')?.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Loading…</td></tr>`;
  setMsg('');

  const f = getFilters();

  let q = sb
    .from('assignments')
    .select('id, created_at, lead_id, assigned_to, assigned_by, reason', { count: 'exact' })
    .eq('target_type', 'lead');

  if (dateStartISO && dateEndISO){
    q = q.gte('created_at', dateStartISO)
         .lt('created_at', isoEndExclusive(dateEndISO));
  }

  if (f.assignedTo) q = q.eq('assigned_to', f.assignedTo);
  if (f.assignedBy) q = q.eq('assigned_by', f.assignedBy);

  q = q.order('created_at', { ascending: f.order === 'asc' });

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  q = q.range(from, to);

  const { data, error, count } = await q;

  if (error){
    console.warn('loadHistory error:', error);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">Error loading history.</td></tr>`;
    setMsg('Could not load assignment history. Check console.');
    return;
  }

  totalRows = count || 0;
  const rows = data || [];

  if (!rows.length){
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;">No history found.</td></tr>`;
    $('hist-page').textContent = `Page ${page}`;
    return;
  }

  tbody.innerHTML = '';

  for (const r of rows){
    const tr = document.createElement('tr');

    const assignedToName = agentNameById[r.assigned_to] || (r.assigned_to ? String(r.assigned_to) : '—');
    const assignedByName = agentNameById[r.assigned_by] || (r.assigned_by ? String(r.assigned_by) : '—');

    tr.innerHTML = `
      <td>${escapeHtml(formatDate(r.created_at))}</td>
      <td style="font-family: monospace; font-size: 12px;">${escapeHtml(r.lead_id || '—')}</td>
      <td>${escapeHtml(assignedToName)}</td>
      <td>${escapeHtml(assignedByName)}</td>
      <td>${escapeHtml(r.reason || '—')}</td>
    `;

    tbody.appendChild(tr);
  }

  $('hist-page').textContent = `Page ${page}`;
}

function wireUI(){
  $('hist-apply')?.addEventListener('click', async (e) => {
    e.preventDefault();
    page = 1;
    await loadHistory();
  });

  $('hist-reset')?.addEventListener('click', async (e) => {
    e.preventDefault();
    resetFiltersUI();
    page = 1;
    await loadHistory();
  });

  $('hist-prev')?.addEventListener('click', async () => {
    if (page <= 1) return;
    page -= 1;
    await loadHistory();
  });

  $('hist-next')?.addEventListener('click', async () => {
    const maxPage = Math.max(1, Math.ceil((totalRows || 0) / PAGE_SIZE));
    if (page >= maxPage) return;
    page += 1;
    await loadHistory();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb){
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  wireAdminNavLinks();

  const section = $('admin-history-section');
  if (section) section.style.display = 'block';

  await loadMe();
  initDateRangePicker();
  wireUI();

  await loadAgentsMapAndFilters();
  await loadHistory();
});
