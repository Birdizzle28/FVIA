// scripts/admin-agent-stats.js
const sb = window.supabaseClient || window.supabase;

let agentNameById = {}; // { id: full_name }

let fp = null;

let weeklyChart = null;
let productChart = null;
let assignChart = null;

function $(id){ return document.getElementById(id); }

function setMsg(t){
  const el = $('stats-msg');
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

function isoEndExclusive(endISO){
  const d = new Date(endISO + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function weekKey(dateStr){
  const d = new Date(dateStr);
  if (isNaN(d)) return 'Unknown';
  const day = d.getDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

function pct(n, d){
  if (!d) return '—';
  return `${Math.round((n / d) * 100)}%`;
}

function mean(nums){
  const arr = nums.filter(x => Number.isFinite(x));
  if (!arr.length) return null;
  const sum = arr.reduce((a,b) => a + b, 0);
  return sum / arr.length;
}

function destroyCharts(){
  if (weeklyChart) { weeklyChart.destroy(); weeklyChart = null; }
  if (productChart) { productChart.destroy(); productChart = null; }
  if (assignChart) { assignChart.destroy(); assignChart = null; }
}

function formatMoney(n){
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

async function loadAgents(){
  const { data, error } = await sb
    .from('agents')
    .select('id, full_name')
    .order('full_name', { ascending: true });

  if (error){
    console.warn('loadAgents error:', error);
    return;
  }

  agentNameById = {};
  (data || []).forEach(a => {
    if (a?.id) agentNameById[a.id] = a.full_name || '—';
  });

  const sel = $('stat-agent');
  if (sel){
    sel.innerHTML = `<option value="">All agents</option>` + (data || [])
      .map(a => `<option value="${a.id}">${(a.full_name || '—')}</option>`)
      .join('');
  }
}

function initFlatpickr(){
  const wrap = $('stat-range-wrap');
  if (!wrap || !window.flatpickr) return;

  fp = window.flatpickr(wrap, {
    mode: 'range',
    dateFormat: 'Y-m-d',
    wrap: true
  });
}

function getRangeISO(){
  const allTime = $('stat-all-time')?.checked === true;

  if (allTime) return { startISO: null, endISO: null, allTime: true };

  const val = $('stat-range')?.value || '';
  if (!val || !val.includes(' to ')) return { startISO: null, endISO: null, allTime: false };

  const [startISO, endISO] = val.split(' to ').map(s => (s || '').trim());
  if (!startISO || !endISO) return { startISO: null, endISO: null, allTime: false };

  return { startISO, endISO, allTime: false };
}

function getSelectedAgent(){
  return $('stat-agent')?.value || '';
}

async function fetchAllLeadsForStats({ startISO, endISO, agentId }){
  // Pull only what we need; paginate to avoid 1k cap issues
  const pageSize = 1000;
  let from = 0;
  let out = [];
  let safety = 0;

  while (true){
    safety += 1;
    if (safety > 20) break; // hard cap ~20k rows

    let q = sb
      .from('leads')
      .select('id, created_at, age, product_type, assigned_to, contacted_at, quoted_at, closed_status', { count: 'exact' });

    if (startISO && endISO){
      q = q.gte('created_at', startISO)
           .lt('created_at', isoEndExclusive(endISO));
    }

    if (agentId){
      // Agent Stats = stats for who it's assigned TO
      q = q.eq('assigned_to', agentId);
    }

    q = q.order('created_at', { ascending: true })
         .range(from, from + pageSize - 1);

    const { data, error } = await q;

    if (error){
      console.warn('fetchAllLeadsForStats error:', error);
      break;
    }

    const rows = data || [];
    out = out.concat(rows);

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

/**
 * Annualized Premium:
 * - policies.status IN ('in_force', 'issued')
 * - SUM policies.premium_annual
 * - applies same filters (agent + date range)
 *
 * We try common column names so this works even if your schema differs slightly:
 * - agent column: agent_id, assigned_to, writing_agent_id
 * - date column: issued_at, created_at, effective_date (in that order)
 */
async function fetchAnnualizedPremium({ startISO, endISO, agentId }){
  const statuses = ['in_force', 'issued'];

  const agentColsToTry = ['agent_id', 'assigned_to', 'writing_agent_id'];
  const dateColsToTry = ['issued_at', 'created_at', 'effective_date'];

  // Try combinations until one works
  for (const agentCol of agentColsToTry){
    for (const dateCol of dateColsToTry){
      const pageSize = 1000;
      let from = 0;
      let total = 0;
      let safety = 0;

      while (true){
        safety += 1;
        if (safety > 50) break; // hard cap ~50k rows

        let q = sb
          .from('policies')
          .select(`premium_annual, status, ${agentCol}, ${dateCol}`)
          .in('status', statuses);

        if (agentId){
          q = q.eq(agentCol, agentId);
        }

        if (startISO && endISO){
          q = q.gte(dateCol, startISO)
               .lt(dateCol, isoEndExclusive(endISO));
        }

        q = q.order(dateCol, { ascending: true })
             .range(from, from + pageSize - 1);

        const { data, error } = await q;

        if (error){
          // This combo likely has a missing column; try next combo
          // Only warn once per combo attempt
          // console.warn(`fetchAnnualizedPremium combo failed: agentCol=${agentCol}, dateCol=${dateCol}`, error);
          break;
        }

        const rows = data || [];
        for (const r of rows){
          const n = Number(r?.premium_annual);
          if (Number.isFinite(n)) total += n;
        }

        if (rows.length < pageSize) return total;
        from += pageSize;
      }
    }
  }

  console.warn('fetchAnnualizedPremium: could not query policies with any expected column mapping.');
  return null;
}

function renderKPIs(rows, agentId, annualPremium){
  const total = rows.length;

  const assignedCount = rows.filter(r => !!r.assigned_to).length;
  const uniqueAgents = new Set(rows.map(r => r.assigned_to).filter(Boolean)).size;

  const contacted = rows.filter(r => !!r.contacted_at).length;
  const quoted = rows.filter(r => !!r.quoted_at).length;

  const won = rows.filter(r => String(r.closed_status || '').toLowerCase() === 'won').length;

  const avgAge = mean(rows.map(r => (r.age == null ? null : Number(r.age))));

  $('kpi-new').textContent = String(total);

  // ✅ replaced "Assigned" KPI with Annualized Premium
  const apEl = $('kpi-ap');
  if (apEl) apEl.textContent = (annualPremium == null) ? '—' : formatMoney(annualPremium);

  $('kpi-agents').textContent = String(agentId ? 1 : uniqueAgents);

  $('kpi-contact').textContent = pct(contacted, total);
  $('kpi-quote').textContent = pct(quoted, total);

  // Close rate = Won / Quoted (more meaningful than Won/All)
  $('kpi-close').textContent = quoted ? pct(won, quoted) : '—';

  $('kpi-avg-age').textContent = (avgAge == null) ? '—' : String(Math.round(avgAge));

  // Persistency needs policies to be real; keep placeholder for now
  $('kpi-persistency').textContent = '—';

  // If you still want assignedCount somewhere later, it’s preserved here:
  // assignedCount, uniqueAgents
}

function renderCharts(rows, agentId){
  destroyCharts();

  // Weekly New Leads
  const weekly = {};
  rows.forEach(r => {
    const k = weekKey(r.created_at);
    weekly[k] = (weekly[k] || 0) + 1;
  });
  const weeklyLabels = Object.keys(weekly).sort();
  const weeklyVals = weeklyLabels.map(k => weekly[k]);

  const weeklyCtx = $('chart-weekly')?.getContext('2d');
  if (weeklyCtx){
    weeklyChart = new Chart(weeklyCtx, {
      type: 'bar',
      data: {
        labels: weeklyLabels,
        datasets: [{ label: 'New Leads', data: weeklyVals }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true }
        }
      }
    });
  }

  // Product Mix
  const mix = {};
  rows.forEach(r => {
    const p = (r.product_type || '—').trim() || '—';
    mix[p] = (mix[p] || 0) + 1;
  });
  const mixLabels = Object.keys(mix).sort((a,b) => (mix[b]-mix[a]));
  const mixVals = mixLabels.map(k => mix[k]);

  const prodCtx = $('chart-products')?.getContext('2d');
  if (prodCtx){
    productChart = new Chart(prodCtx, {
      type: 'pie',
      data: {
        labels: mixLabels,
        datasets: [{ data: mixVals }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  // Assignments by Agent (or Assignments by Week if single agent selected)
  const assignCtx = $('chart-assignments')?.getContext('2d');
  if (!assignCtx) return;

  if (!agentId){
    $('chart-assign-title').textContent = 'Assignments by Agent';

    const byAgent = {};
    rows.forEach(r => {
      if (!r.assigned_to) return;
      const name = agentNameById[r.assigned_to] || '—';
      byAgent[name] = (byAgent[name] || 0) + 1;
    });

    const aLabels = Object.keys(byAgent).sort((a,b) => (byAgent[b]-byAgent[a]));
    const aVals = aLabels.map(k => byAgent[k]);

    assignChart = new Chart(assignCtx, {
      type: 'bar',
      data: {
        labels: aLabels,
        datasets: [{ label: 'Assignments', data: aVals }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  } else {
    $('chart-assign-title').textContent = 'Assignments by Week';

    const byWeek = {};
    rows.forEach(r => {
      const k = weekKey(r.created_at);
      byWeek[k] = (byWeek[k] || 0) + 1;
    });

    const wLabels = Object.keys(byWeek).sort();
    const wVals = wLabels.map(k => byWeek[k]);

    assignChart = new Chart(assignCtx, {
      type: 'line',
      data: {
        labels: wLabels,
        datasets: [{ label: 'Assignments', data: wVals, tension: 0.25 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }
}

async function refreshStats(){
  setMsg('Loading…');

  const agentId = getSelectedAgent();
  const range = getRangeISO();

  // Leads (for charts + lead-based KPIs)
  const rows = await fetchAllLeadsForStats({
    startISO: range.startISO,
    endISO: range.endISO,
    agentId
  });

  // Policies (for Annualized Premium KPI)
  const annualPremium = await fetchAnnualizedPremium({
    startISO: range.startISO,
    endISO: range.endISO,
    agentId
  });

  renderKPIs(rows, agentId, annualPremium);
  renderCharts(rows, agentId);

  const title = $('chart-weekly-title');
  if (title) title.textContent = 'Weekly New Leads';

  setMsg(rows.length > 20000 ? 'Showing first 20,000 rows (safety cap).' : '');
}

function wireUI(){
  $('stat-agent')?.addEventListener('change', refreshStats);

  $('stat-all-time')?.addEventListener('change', () => {
    const allTime = $('stat-all-time').checked === true;
    const input = $('stat-range');
    const btn = $('stat-range-wrap')?.querySelector('[data-toggle]');

    if (input) input.disabled = allTime;
    if (btn) btn.disabled = allTime;

    refreshStats();
  });

  // Refresh when range changes
  $('stat-range')?.addEventListener('change', refreshStats);
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb){
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  wireAdminNavLinks();

  const section = $('admin-stats-section');
  if (section) section.style.display = 'block';

  initFlatpickr();
  wireUI();

  await loadAgents();

  // Default: not all-time, no range selected, still shows all until range picked
  await refreshStats();
});
