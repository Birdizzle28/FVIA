// scripts/admin-agent-stats.js
const sb = window.supabaseClient || window.supabase;

let allAgents = [];
let statPicker = null;

let chartWeekly = null;
let chartProducts = null;
let chartAssignments = null;

const DAY_MS = 86400000;
const PERSISTENCY_DAYS = 90;

function $(id){ return document.getElementById(id); }

function safeDiv(n, d){
  if (!d) return 0;
  return n / d;
}

function fmtPct(x){
  if (!Number.isFinite(x)) return '—';
  return `${Math.round(x * 100)}%`;
}

function isoYMD(d){
  return new Date(d).toISOString().split('T')[0];
}

function endExclusiveISO(endISO){
  // endISO is YYYY-MM-DD, make it exclusive by adding 1 day
  const d = new Date(endISO + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function inRange(dt, start, end){
  const t = dt.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function destroyCharts(){
  try { chartWeekly?.destroy(); } catch(_) {}
  try { chartProducts?.destroy(); } catch(_) {}
  try { chartAssignments?.destroy(); } catch(_) {}
  chartWeekly = chartProducts = chartAssignments = null;
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

// Try to infer a "stage" from many possible task shapes.
// Source admin.js uses getTaskStage(t) internally; we mirror intent.
function getTaskStage(t){
  const raw =
    (t?.stage || t?.task_stage || t?.type || t?.task_type || t?.category || t?.status || '')
      .toString()
      .toLowerCase();

  if (raw.includes('close') || raw.includes('sale') || raw.includes('issue')) return 'close';
  if (raw.includes('quote')) return 'quote';
  if (raw.includes('contact') || raw.includes('call') || raw.includes('text') || raw.includes('email')) return 'contact';

  // fallback: if completed + has result fields suggesting quote/close
  const note = (t?.notes || t?.result || '').toString().toLowerCase();
  if (note.includes('sold') || note.includes('issued')) return 'close';
  if (note.includes('quote')) return 'quote';

  return 'other';
}

async function loadAgents(){
  const { data, error } = await sb
    .from('agents')
    .select('id, full_name')
    .order('full_name', { ascending: true });

  if (error){
    console.warn('[Agent Stats] loadAgents error:', error);
    allAgents = [];
    return;
  }

  allAgents = data || [];

  const sel = $('stat-agent');
  if (sel){
    sel.innerHTML =
      `<option value="">All agents</option>` +
      allAgents.map(a => `<option value="${a.id}">${a.full_name || '—'}</option>`).join('');
  }
}

function initStatRange(){
  if (!window.flatpickr) return;

  const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
  statPicker = window.flatpickr('#stat-range-wrap', {
    mode: 'range',
    dateFormat: 'Y-m-d',
    defaultDate: [thirtyDaysAgo, new Date()],
    wrap: true,
    onChange: () => {
      if (!$('stat-all-time')?.checked) loadAgentStats();
    }
  });

  const allCb = $('stat-all-time');
  if (allCb){
    allCb.addEventListener('change', () => {
      const disabled = allCb.checked === true;
      const input = $('stat-range');
      const btn = document.querySelector('#stat-range-wrap .calendar-btn');
      if (input) input.disabled = disabled;
      if (btn) btn.disabled = disabled;
      loadAgentStats();
    });
  }

  $('stat-agent')?.addEventListener('change', loadAgentStats);
}

function getSelectedAgentId(){
  return $('stat-agent')?.value || '';
}

function getRange(){
  const isAll = $('stat-all-time')?.checked === true;
  if (isAll) return { isAll: true, start: null, end: null, startISO: null, endISO: null, endISOExclusive: null };

  const val = $('stat-range')?.value || '';
  if (!val.includes(' to ')) return { isAll: false, start: null, end: null, startISO: null, endISO: null, endISOExclusive: null };

  const [startISO, endISO] = val.split(' to ').map(s => (s || '').trim());
  if (!startISO || !endISO) return { isAll: false, start: null, end: null, startISO: null, endISO: null, endISOExclusive: null };

  const start = new Date(startISO + 'T00:00:00');
  const end   = new Date(endISO + 'T23:59:59');

  return {
    isAll: false,
    start,
    end,
    startISO,
    endISO,
    endISOExclusive: endExclusiveISO(endISO)
  };
}

async function fetchLeads({ agentId, range }){
  let q = sb
    .from('leads')
    .select('id, created_at, assigned_to, assigned_at, age, product_type')
    .order('created_at', { ascending: true });

  if (agentId){
    // Stats are for the agent the lead is assigned to
    q = q.eq('assigned_to', agentId);
  }

  if (!range.isAll && range.startISO && range.endISOExclusive){
    q = q.gte('created_at', range.startISO).lt('created_at', range.endISOExclusive);
  }

  const { data, error } = await q;
  if (error){
    console.error('[Agent Stats] leads query error:', error);
    return [];
  }
  return data || [];
}

async function fetchByLeadIds(table, fields, leadIds){
  if (!leadIds.length) return [];

  // chunk .in() to avoid URL limits / query limits
  const chunkSize = 250;
  const out = [];

  for (let i = 0; i < leadIds.length; i += chunkSize){
    const chunk = leadIds.slice(i, i + chunkSize);
    const { data, error } = await sb
      .from(table)
      .select(fields)
      .in('lead_id', chunk);

    if (error){
      console.warn(`[Agent Stats] ${table} query error:`, error);
      continue;
    }
    out.push(...(data || []));
  }

  return out;
}

function setKPIs({ leadsArr, tasksArr, policiesArr, range }){
  // Basic lead KPIs
  const kNew = leadsArr.length;

  const assignedInWindow = leadsArr.filter(l => {
    if (!l.assigned_to || !l.assigned_at) return false;
    if (range.isAll) return true;
    const t = new Date(l.assigned_at).getTime();
    return range.start && range.end ? (t >= range.start.getTime() && t <= range.end.getTime()) : true;
  });

  const kAssigned = assignedInWindow.length;

  const ages = leadsArr
    .map(l => Number(l.age))
    .filter(n => Number.isFinite(n) && n > 0);

  const avgAge = ages.length ? (ages.reduce((a,b)=>a+b,0) / ages.length) : NaN;

  const distinctAgents = new Set(assignedInWindow.map(l => l.assigned_to).filter(Boolean));
  const kAgents = distinctAgents.size;

  $('kpi-new').textContent = String(kNew);
  $('kpi-assigned').textContent = String(kAssigned);
  $('kpi-avg-age').textContent = Number.isFinite(avgAge) ? String(Math.round(avgAge * 10) / 10) : '—';
  $('kpi-agents').textContent = String(kAgents);

  // Contact / Quote / Close via tasks + policies
  const baseDen = leadsArr.length;
  const contactLeadIds = new Set();
  const quoteLeadIds   = new Set();
  const closedLeadIds  = new Set();

  tasksArr.forEach(t => {
    const stage = getTaskStage(t);
    const leadId = t.lead_id;
    if (!leadId) return;

    if (stage === 'contact') contactLeadIds.add(leadId);
    if (stage === 'quote') { contactLeadIds.add(leadId); quoteLeadIds.add(leadId); }
    if (stage === 'close') { contactLeadIds.add(leadId); quoteLeadIds.add(leadId); closedLeadIds.add(leadId); }
  });

  // Any issued policy counts as closed
  policiesArr.forEach(p => {
    if (!p.lead_id) return;
    if (p.issued_at) closedLeadIds.add(p.lead_id);
  });

  const contactedCount = baseDen ? leadsArr.filter(l => contactLeadIds.has(l.id)).length : 0;
  const quotedCount    = baseDen ? leadsArr.filter(l => quoteLeadIds.has(l.id) || closedLeadIds.has(l.id)).length : 0;
  const closedCount    = baseDen ? leadsArr.filter(l => closedLeadIds.has(l.id)).length : 0;

  const contactRate = safeDiv(contactedCount, baseDen);
  const quoteRate   = safeDiv(quotedCount, baseDen);
  const closeRate   = safeDiv(closedCount, baseDen);

  $('kpi-contact').textContent = fmtPct(contactRate);
  $('kpi-quote').textContent   = fmtPct(quoteRate);
  $('kpi-close').textContent   = fmtPct(closeRate);

  // Persistency 90-day (policies)
  const now = Date.now();
  const persistCandidates = policiesArr.filter(p => {
    if (!p.issued_at) return false;
    const ia = new Date(p.issued_at);

    if (!range.isAll && range.start && range.end && !inRange(ia, range.start, range.end)){
      return false;
    }

    return (now - ia.getTime()) >= (PERSISTENCY_DAYS * DAY_MS);
  });

  const persistentPolicies = persistCandidates.filter(p => {
    const status = (p.status || '').toLowerCase();
    return !['cancelled','canceled','terminated','lapsed'].includes(status);
  });

  const persistency = safeDiv(persistentPolicies.length, persistCandidates.length);
  $('kpi-persistency').textContent = fmtPct(persistency);
}

function buildCharts({ leadsArr, policiesArr, range }){
  destroyCharts();

  // Weekly/monthly new leads chart
  let timeLabels = [];
  let timeCounts = [];
  let chartLineLabel = 'Weekly New Leads';

  if (range.isAll){
    const nowD = new Date();
    const monthStarts = Array.from({ length: 12 }, (_, i) =>
      new Date(nowD.getFullYear(), nowD.getMonth() - (11 - i), 1)
    );
    const monthCounts = new Array(12).fill(0);

    for (const l of leadsArr){
      const dt = new Date(l.created_at);
      const base = monthStarts[0];
      const diffMonths = (dt.getFullYear() - base.getFullYear()) * 12 + (dt.getMonth() - base.getMonth());
      if (diffMonths >= 0 && diffMonths < 12) monthCounts[diffMonths]++;
    }

    timeLabels = monthStarts.map(d => `${d.toLocaleString('default', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`);
    timeCounts = monthCounts;
    chartLineLabel = 'Monthly New Leads';
  } else if (range.start && range.end){
    const totalDays = Math.max(1, Math.round((+range.end - +range.start) / DAY_MS) + 1);
    const useMonthly = totalDays > 120;

    if (useMonthly){
      const monthStarts = [];
      const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
      const last   = new Date(range.end.getFullYear(), range.end.getMonth(), 1);

      while (cursor <= last){
        monthStarts.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
      }

      const monthCounts = new Array(monthStarts.length).fill(0);

      for (const l of leadsArr){
        const dt = new Date(l.created_at);
        const idx = monthStarts.findIndex(m => dt.getFullYear() === m.getFullYear() && dt.getMonth() === m.getMonth());
        if (idx !== -1) monthCounts[idx]++;
      }

      timeLabels = monthStarts.map(d => `${d.toLocaleString('default', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`);
      timeCounts = monthCounts;
      chartLineLabel = 'Monthly New Leads';
    } else {
      const weekMs = 7 * DAY_MS;
      const bucketCount = Math.max(1, Math.ceil(totalDays / 7));
      const bucketStarts = Array.from({ length: bucketCount }, (_, i) =>
        new Date(range.start.getTime() + i * weekMs)
      );
      const weeklyCounts = new Array(bucketCount).fill(0);

      for (const l of leadsArr){
        const t = new Date(l.created_at).getTime();
        const idx = Math.floor((t - range.start.getTime()) / weekMs);
        if (idx >= 0 && idx < bucketCount) weeklyCounts[idx]++;
      }

      timeLabels = bucketStarts.map(d => `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`);
      timeCounts = weeklyCounts;
      chartLineLabel = 'Weekly New Leads';
    }
  }

  const weeklyCanvas = $('chart-weekly');
  if (weeklyCanvas){
    const weeklyTitleEl = weeklyCanvas.previousElementSibling;
    if (weeklyTitleEl) weeklyTitleEl.textContent = chartLineLabel;

    const weeklyCtx = weeklyCanvas.getContext('2d');
    chartWeekly = new Chart(weeklyCtx, {
      type: 'line',
      data: {
        labels: timeLabels,
        datasets: [{ label: chartLineLabel, data: timeCounts, tension: 0.3 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  // Product mix (prefer policies; fall back to leads)
  const productCounts = {};
  if (policiesArr.length){
    policiesArr.forEach(p => {
      const key = ((p.product_line || p.policy_type || 'Unknown') + '').trim() || 'Unknown';
      productCounts[key] = (productCounts[key] || 0) + 1;
    });
  } else {
    leadsArr.forEach(l => {
      const key = ((l.product_type || 'Unknown') + '').trim() || 'Unknown';
      productCounts[key] = (productCounts[key] || 0) + 1;
    });
  }

  const productLabels = Object.keys(productCounts);
  const productValues = productLabels.map(k => productCounts[k]);

  const productsCanvas = $('chart-products');
  if (productsCanvas){
    const productsCtx = productsCanvas.getContext('2d');
    chartProducts = new Chart(productsCtx, {
      type: 'doughnut',
      data: { labels: productLabels, datasets: [{ data: productValues }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  // Assignments by agent (bar)
  const nameById = new Map((allAgents || []).map(a => [a.id, a.full_name]));
  const assigns = {};

  // only count assignments that are in-window (same as KPI logic uses assigned_at)
  const assignedInWindow = leadsArr.filter(l => {
    if (!l.assigned_to || !l.assigned_at) return false;
    if (range.isAll) return true;
    if (!range.start || !range.end) return true;
    const t = new Date(l.assigned_at).getTime();
    return t >= range.start.getTime() && t <= range.end.getTime();
  });

  for (const l of assignedInWindow){
    const id = l.assigned_to || 'Unknown';
    assigns[id] = (assigns[id] || 0) + 1;
  }

  const assignLabels = Object.keys(assigns).map(id => nameById.get(id) || 'Unassigned/Unknown');
  const assignValues = Object.keys(assigns).map(id => assigns[id]);

  const assignsCanvas = $('chart-assignments');
  if (assignsCanvas){
    const assignsCtx = assignsCanvas.getContext('2d');
    chartAssignments = new Chart(assignsCtx, {
      type: 'bar',
      data: { labels: assignLabels, datasets: [{ label: 'Assignments', data: assignValues }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }
}

async function loadAgentStats(){
  const msg = $('stats-msg');
  if (msg) msg.textContent = 'Loading…';

  const agentId = getSelectedAgentId();
  const range = getRange();

  // Leads are the base dataset (source does charts based on leads too)
  const leadsArr = await fetchLeads({ agentId, range });
  const leadIds = leadsArr.map(l => l.id).filter(Boolean);

  // Tasks + Policies are attached to lead_id
  const tasksArr = await fetchByLeadIds('tasks', 'id, lead_id, stage, task_stage, type, task_type, category, status, notes, result, created_at', leadIds);
  const policiesArr = await fetchByLeadIds('policies', 'id, lead_id, issued_at, status, product_line, policy_type', leadIds);

  setKPIs({ leadsArr, tasksArr, policiesArr, range });
  buildCharts({ leadsArr, policiesArr, range });

  if (msg) msg.textContent = '';
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb){
    console.warn('[Agent Stats] Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  wireAdminNavLinks();

  const section = $('admin-stats-section');
  if (section) section.style.display = 'block';

  await loadAgents();
  initStatRange();
  await loadAgentStats();
});
