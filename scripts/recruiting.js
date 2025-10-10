import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let me = null;
let downline = [];
let downlineIds = [];
let currentPage = 1;
const PAGE_SIZE = 25;

function initMenus() {
  const toggle = document.getElementById("agent-hub-toggle");
  const menu = document.getElementById("agent-hub-menu");
  if (!toggle || !menu) return;
  menu.style.display = "none";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = (menu.style.display === "block") ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) menu.style.display = "none";
  });
}

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(); } catch { return ''; }
}

async function requireSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return null; }
  return session.user;
}

async function fetchMe(userId) {
  const { data, error } = await supabase.from('agents').select('*').eq('id', userId).single();
  if (error) return null;
  return data;
}

async function fetchDownline() {
  try {
    const { data, error } = await supabase.from('agents').select('id, full_name, email, created_at, product_types').eq('recruiter_id', me.id);
    if (error) throw error;
    return data || [];
  } catch (e) {
    document.getElementById('schema-warning').style.display = 'block';
    return [];
  }
}

function fillTeamSummary() {
  document.getElementById('metric-count').textContent = String(downline.length);
  const list = document.getElementById('recruit-list');
  list.innerHTML = '';
  downline.forEach(a => {
    const el = document.createElement('div');
    el.className = 'recruit-card';
    const prods = Array.isArray(a.product_types) ? a.product_types.join(', ') : (a.product_types || '');
    el.innerHTML = `<div class="name">${a.full_name}</div>
      <div class="meta">${a.email}</div>
      <div class="meta">Since: ${new Date(a.created_at).toLocaleDateString()}</div>
      <div class="meta">Products: ${prods || '—'}</div>`;
    list.appendChild(el);
  });
}

function buildAgentFilter() {
  const sel = document.getElementById('agent-filter');
  sel.innerHTML = `<option value="">All Recruits</option>`;
  downline.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.full_name;
    sel.appendChild(opt);
  });
  try { new Choices(sel, { shouldSort: false, itemSelectText: '' }); } catch {}
}

function initDatePicker() {
  flatpickr('#date-range', { mode: 'range', dateFormat: 'Y-m-d' });
}

function getFilters() {
  const agentId = document.getElementById('agent-filter').value || '';
  const kind = document.getElementById('kind-filter').value || '';
  const q = (document.getElementById('search-text').value || '').trim();
  const dr = document.getElementById('date-range').value;
  let start = null, end = null;
  if (dr && dr.includes(' to ')) {
    const [s, e] = dr.split(' to ');
    const sd = new Date(s); const ed = new Date(e); ed.setHours(23,59,59,999);
    if (!isNaN(sd) && !isNaN(ed)) { start = sd.toISOString(); end = ed.toISOString(); }
  }
  return { agentId, kind, q, start, end };
}

async function fetchActivityPage() {
  const { agentId, kind, q, start, end } = getFilters();
  let actorIds = downlineIds.slice();
  if (agentId) actorIds = actorIds.filter(id => id === agentId);
  if (actorIds.length === 0) return { rows: [], total: 0 };

  let query = supabase.from('activities')
    .select('*', { count: 'exact' })
    .in('actor_user_id', actorIds);

  if (kind) query = query.eq('kind', kind);
  if (start) query = query.gte('created_at', start);
  if (end) query = query.lte('created_at', end);
  if (q) query = query.or(`summary.ilike.%${q}%,details.ilike.%${q}%`);

  query = query.order('created_at', { ascending: false }).range((currentPage-1)*PAGE_SIZE, currentPage*PAGE_SIZE - 1);

  const { data, count, error } = await query;
  if (error) { console.error(error); return { rows: [], total: 0 }; }
  return { rows: data || [], total: count || 0 };
}

async function hydrateNames(rows) {
  const contactIds = Array.from(new Set(rows.map(r => r.contact_id).filter(Boolean)));
  const leadIds = Array.from(new Set(rows.map(r => r.lead_id).filter(Boolean)));
  const agentMap = new Map(downline.map(a => [a.id, a.full_name]));
  const contactMap = new Map();
  const leadMap = new Map();

  if (contactIds.length) {
    const { data } = await supabase.from('contacts').select('id, full_name').in('id', contactIds);
    (data || []).forEach(c => contactMap.set(c.id, c.full_name));
  }
  if (leadIds.length) {
    const { data } = await supabase.from('leads').select('id, first_name, last_name').in('id', leadIds);
    (data || []).forEach(l => leadMap.set(l.id, `${l.first_name || ''} ${l.last_name || ''}`.trim()));
  }

  return rows.map(r => ({
    date: fmtDate(r.created_at),
    agent: agentMap.get(r.actor_user_id) || '—',
    kind: r.kind,
    summary: r.summary || '',
    target: r.contact_id ? (contactMap.get(r.contact_id) || r.contact_id) :
            r.lead_id ? (leadMap.get(r.lead_id) || r.lead_id) : '—'
  }));
}

function renderTable(rows) {
  const tb = document.querySelector('#activity-table tbody');
  tb.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.date}</td><td>${r.agent}</td><td>${r.kind}</td><td>${r.summary}</td><td>${r.target}</td>`;
    tb.appendChild(tr);
  });
}

function renderPager(total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  document.getElementById('page-label').textContent = `Page ${currentPage} / ${pages}`;
  document.getElementById('prev-page').disabled = currentPage <= 1;
  document.getElementById('next-page').disabled = currentPage >= pages;
}

async function loadMetrics() {
  const now = Date.now();
  const d24 = new Date(now - 24*3600*1000).toISOString();
  const d7 = new Date(now - 7*24*3600*1000).toISOString();
  let q1 = supabase.from('activities').select('id', { count: 'exact', head: true }).in('actor_user_id', downlineIds).gte('created_at', d24);
  let q2 = supabase.from('activities').select('id', { count: 'exact', head: true }).in('actor_user_id', downlineIds).gte('created_at', d7);
  const { count: c24 } = await q1; const { count: c7 } = await q2;
  document.getElementById('metric-24h').textContent = String(c24 || 0);
  document.getElementById('metric-7d').textContent = String(c7 || 0);

  const d30 = new Date(now - 30*24*3600*1000).toISOString();
  const { data: issuedActs } = await supabase.from('activities')
    .select('policy_id').in('actor_user_id', downlineIds)
    .eq('kind','status_change').gte('created_at', d30);
  const issuedCount = (issuedActs || []).filter(a => !!a.policy_id).length;
  document.getElementById('metric-issued').textContent = String(issuedCount);
}

async function loadFeed() {
  const { rows, total } = await fetchActivityPage();
  const hydrated = await hydrateNames(rows);
  renderTable(hydrated);
  renderPager(total);
}

function bindFilterButtons() {
  document.getElementById('apply-filters').addEventListener('click', () => { currentPage = 1; loadFeed(); });
  document.getElementById('reset-filters').addEventListener('click', () => {
    document.getElementById('agent-filter').value = '';
    document.getElementById('kind-filter').value = '';
    document.getElementById('date-range').value = '';
    document.getElementById('search-text').value = '';
    currentPage = 1; loadFeed();
  });
  document.getElementById('prev-page').addEventListener('click', () => { if (currentPage > 1) { currentPage--; loadFeed(); } });
  document.getElementById('next-page').addEventListener('click', () => { currentPage++; loadFeed(); });
}

function subscribeRealtime() {
  const channel = supabase.channel('activities_all')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activities' }, payload => {
      if (downlineIds.includes(payload.new?.actor_user_id || payload.old?.actor_user_id)) loadFeed();
    }).subscribe();
  window.addEventListener('beforeunload', () => { try { supabase.removeChannel(channel); } catch {} });
}

(async () => {
  initMenus();
  const user = await requireSession();
  if (!user) return;
  me = await fetchMe(user.id);
  if (!me) { window.location.href = 'login.html'; return; }

  downline = await fetchDownline();
  downlineIds = downline.map(a => a.id);

  fillTeamSummary();
  buildAgentFilter();
  initDatePicker();
  bindFilterButtons();
  await loadMetrics();
  await loadFeed();
  subscribeRealtime();
})();
