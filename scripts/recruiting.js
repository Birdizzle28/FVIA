import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let me = null;
let agents = [];
let byUpline = new Map();
let searchIndex = [];

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

async function fetchAgents() {
  try {
    const { data, error } = await supabase.from('agents')
      .select('id, recruiter_id, full_name, email, created_at, product_types, is_admin, is_active');
    if (error) throw error;
    return data || [];
  } catch (e) {
    document.getElementById('schema-warning').style.display = 'block';
    return [];
  }
}

function buildIndex() {
  byUpline.clear();
  agents.forEach(a => {
    const key = a.recruiter_id || 'root';
    if (!byUpline.has(key)) byUpline.set(key, []);
    byUpline.get(key).push(a);
  });
  searchIndex = agents.map(a => ({ id: a.id, name: (a.full_name || '').toLowerCase() }));
}

function isAdmin(a) { return a?.is_admin === true; }

function rootsFor(user) {
  if (isAdmin(user)) return (byUpline.get('root') || []).slice();
  return [user];
}

function nodeBadgeHTML(a) {
  const active = a.is_active ? 'Active' : 'Inactive';
  const prods = Array.isArray(a.product_types) ? a.product_types.join(', ') : (a.product_types || '');
  return `
    <span class="badge">${active}</span>
    ${prods ? `<span class="badge">${prods}</span>` : ''}
  `;
}

function liNode(a, hasChildren) {
  const li = document.createElement('li');
  li.dataset.id = a.id;
  li.className = hasChildren ? 'collapsed' : '';
  li.innerHTML = `
    <div class="node">
      <span class="chev">${hasChildren ? '▸' : ''}</span>
      <span class="name">${a.full_name}</span>
      <span class="badges">${nodeBadgeHTML(a)}</span>
    </div>
  `;
  if (hasChildren) {
    const ul = document.createElement('ul');
    li.appendChild(ul);
  }
  return li;
}

function buildSubtree(parentEl, parentAgent) {
  const kids = byUpline.get(parentAgent.id) || [];
  const ul = parentEl.querySelector(':scope > ul') || document.createElement('ul');
  if (!parentEl.contains(ul)) parentEl.appendChild(ul);
  ul.innerHTML = '';
  kids.sort((a,b) => a.full_name.localeCompare(b.full_name)).forEach(child => {
    const hasChildren = (byUpline.get(child.id) || []).length > 0;
    const li = liNode(child, hasChildren);
    ul.appendChild(li);
  });
}

function expand(li) {
  if (!li.classList.contains('collapsed')) return;
  const id = li.dataset.id;
  const agent = agents.find(a => a.id === id);
  buildSubtree(li, agent);
  li.classList.remove('collapsed');
  const chev = li.querySelector('.chev'); if (chev) chev.textContent = '▾';
}

function collapse(li) {
  if (li.classList.contains('collapsed')) return;
  li.classList.add('collapsed');
  const chev = li.querySelector('.chev'); if (chev) chev.textContent = '▸';
}

function expandAll() {
  document.querySelectorAll('#downline-tree li').forEach(li => expand(li));
}
function collapseAll() {
  document.querySelectorAll('#downline-tree li').forEach(li => collapse(li));
}

function renderTree() {
  const host = document.getElementById('downline-tree');
  host.innerHTML = '';
  const roots = rootsFor(me);
  roots.sort((a,b) => (a.full_name || '').localeCompare(b.full_name || ''));
  roots.forEach(rootAgent => {
    const hasChildren = (byUpline.get(rootAgent.id) || []).length > 0;
    const li = liNode(rootAgent, hasChildren);
    host.appendChild(li);
    if (hasChildren) expand(li);
  });
}

function bindTreeEvents() {
  const tree = document.getElementById('downline-tree');
  tree.addEventListener('click', (e) => {
    const node = e.target.closest('.node');
    if (!node) return;
    const li = node.closest('li');
    const id = li.dataset.id;
    const a = agents.find(x => x.id === id);
    if (li.classList.contains('collapsed')) expand(li); else collapse(li);
    openPanel(a);
  });
  document.getElementById('expand-all').addEventListener('click', expandAll);
  document.getElementById('collapse-all').addEventListener('click', collapseAll);
  const panel = document.getElementById('agent-panel');
  document.getElementById('panel-close').addEventListener('click', () => panel.classList.remove('open'));
}

function bindSearch() {
  const input = document.getElementById('tree-search');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      document.querySelectorAll('#downline-tree .node').forEach(n => n.style.background='');
      return;
    }
    const hits = new Set(searchIndex.filter(r => r.name.includes(q)).map(r => r.id));
    document.querySelectorAll('#downline-tree li').forEach(li => {
      const match = hits.has(li.dataset.id);
      li.querySelector('.node').style.background = match ? 'rgba(237,158,165,0.25)' : '';
      if (match) {
        let cur = li.parentElement.closest('li');
        while (cur) { expand(cur); cur = cur.parentElement.closest('li'); }
      }
    });
  });
}

async function panelMetrics(agentId) {
  const now = Date.now();
  const d24 = new Date(now - 24*3600*1000).toISOString();
  const d7  = new Date(now - 7*24*3600*1000).toISOString();
  const d30 = new Date(now - 30*24*3600*1000).toISOString();

  const [{ count: c24 }] = await Promise.all([
    supabase.from('activities').select('id',{count:'exact',head:true})
      .eq('actor_user_id', agentId).gte('created_at', d24)
  ]);

  const { count: c7 } = await supabase.from('activities').select('id',{count:'exact',head:true})
      .eq('actor_user_id', agentId).gte('created_at', d7);

  const { data: issuedActs } = await supabase.from('activities')
      .select('policy_id, kind, created_at')
      .eq('actor_user_id', agentId)
      .eq('kind','status_change')
      .gte('created_at', d30);

  const issued = (issuedActs || []).filter(x => !!x.policy_id).length;
  return { c24: c24 || 0, c7: c7 || 0, issued };
}

async function panelRecent(agentId) {
  const { data, error } = await supabase.from('activities')
    .select('created_at, kind, summary')
    .eq('actor_user_id', agentId)
    .order('created_at', { ascending:false })
    .limit(10);
  if (error) return [];
  return data || [];
}

function setText(id, txt) { const el = document.getElementById(id); if (el) el.textContent = txt || '—'; }

async function openPanel(a) {
  const panel = document.getElementById('agent-panel');
  setText('panel-name', a.full_name || '—');
  setText('panel-email', a.email || '—');
  const prods = Array.isArray(a.product_types) ? a.product_types.join(', ') : (a.product_types || '');
  setText('panel-products', prods || '—');
  try { setText('panel-joined', new Date(a.created_at).toLocaleDateString()); } catch { setText('panel-joined','—'); }

  const { c24, c7, issued } = await panelMetrics(a.id);
  setText('m-24h', String(c24));
  setText('m-7d', String(c7));
  setText('m-issued30', String(issued));

  const items = await panelRecent(a.id);
  const ul = document.getElementById('panel-activity');
  ul.innerHTML = '';
  items.forEach(it => {
    const li = document.createElement('li');
    li.textContent = `${new Date(it.created_at).toLocaleString()} — ${it.kind} — ${it.summary || ''}`;
    ul.appendChild(li);
  });

  panel.classList.add('open');
}

function subscribeRealtime() {
  const ch = supabase.channel('agents_activities')
    .on('postgres_changes', { event:'*', schema:'public', table:'agents' }, async () => {
      agents = await fetchAgents(); buildIndex(); renderTree();
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'activities' }, () => {
      const openName = document.getElementById('panel-name')?.textContent || '';
      const current = agents.find(a => a.full_name === openName);
      if (current) openPanel(current);
    })
    .subscribe();
  window.addEventListener('beforeunload', () => { try { supabase.removeChannel(ch); } catch {} });
}

(async () => {
  initMenus();
  const user = await requireSession();
  if (!user) return;
  me = await fetchMe(user.id);
  if (!me) { window.location.href = 'login.html'; return; }

  agents = await fetchAgents();
  buildIndex();
  renderTree();
  bindTreeEvents();
  bindSearch();
  subscribeRealtime();

  const adminLink = document.querySelector('.admin-only');
  if (me && me.is_admin !== true && adminLink) adminLink.style.display = 'none';
})();
