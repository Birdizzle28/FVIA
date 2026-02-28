// scripts/admin-agent-stats.js
const sb = window.supabaseClient || window.supabase;

const DAY_MS = 864e5;

let allAgents = [];
let statPicker = null;

let chartPersistency = null;
let chartWeekly = null;
let chartProducts = null;
let chartAssignments = null;

function $(id){ return document.getElementById(id); }

function setMsg(t){
  const el = $('stats-msg');
  if (el) el.textContent = t || '';
}

function money(n){
  const val = Number(n);
  if (!Number.isFinite(val)) return '—';
  return val.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
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
  try { if (chartWeekly) chartWeekly.destroy(); } catch(_) {}
  try { if (chartProducts) chartProducts.destroy(); } catch(_) {}
  try { if (chartAssignments) chartAssignments.destroy(); } catch(_) {}
  try { if (chartPersistency) chartPersistency.destroy(); } catch(_) {}

  chartWeekly = null;
  chartProducts = null;
  chartAssignments = null;
  chartPersistency = null;
}

function getRange(){
  const allTime = $('stat-all-time')?.checked === true;

  if (allTime) return { startISO: null, endISO: null, allTime: true };

  const selected = statPicker?.selectedDates || [];
  const start = selected[0] || null;
  const end   = selected[1] || null;

  // if only one date picked, treat as that day
  if (start && !end) return {
    startISO: start.toISOString().slice(0,10),
    endISO: start.toISOString().slice(0,10),
    allTime: false
  };

  if (!start || !end) return { startISO: null, endISO: null, allTime: false };

  return {
    startISO: start.toISOString().slice(0,10),
    endISO: end.toISOString().slice(0,10),
    allTime: false
  };
}

function isoEndExclusive(endISO){
  const d = new Date(endISO + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString();
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
}

async function fetchLeads({ startISO, endISO, agentId }){
  let q = sb
    .from('leads')
    .select('id, created_at, age, product_type, assigned_to, assigned_at, contacted_at, quoted_at, closed_status')
    .order('created_at', { ascending: true });

  if (startISO && endISO){
    q = q.gte('created_at', startISO).lt('created_at', isoEndExclusive(endISO));
  }

  // Agent filter in stats = assigned_to that agent
  if (agentId){
    q = q.eq('assigned_to', agentId);
  }

  const { data, error } = await q;
  if (error){
    console.warn('fetchLeads error:', error);
    return [];
  }
  return data || [];
}

async function fetchPolicies({ startISO, endISO, agentId }){
  let q = sb
    .from('policies')
    .select('id, issued_at, agent_id, product_line, policy_type, status, premium_annual, lapsed_at, cancelled_at')
    .order('issued_at', { ascending: true });

  if (startISO && endISO){
    q = q.gte('issued_at', startISO).lt('issued_at', isoEndExclusive(endISO));
  }

  if (agentId){
    q = q.eq('agent_id', agentId);
  }

  const { data, error } = await q;
  if (error){
    console.warn('fetchPolicies error:', error);
    return [];
  }
  return data || [];
}

function renderKPIs(leadsArr, policiesArr, agentId){
  const total = leadsArr.length;

  const uniqueAgents = new Set(leadsArr.map(l => l.assigned_to).filter(Boolean)).size;
  const contacted = leadsArr.filter(l => !!l.contacted_at).length;
  const quoted    = leadsArr.filter(l => !!l.quoted_at).length;
  const won       = leadsArr.filter(l => String(l.closed_status || '').toLowerCase() === 'won').length;

  const avgAge = mean(leadsArr.map(l => (l.age == null ? null : Number(l.age))));

  // Annualized Premium = sum premium_annual for “active-ish” statuses
  const annualizedPremium = (policiesArr || [])
    .filter(p => ['in_force','issued','reinstated','renewed'].includes(String(p.status || '').toLowerCase()))
    .reduce((sum, p) => {
      const n = Number(p?.premium_annual);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

  $('kpi-new').textContent = String(total);
  $('kpi-ap').textContent = money(annualizedPremium);
  $('kpi-agents').textContent = String(agentId ? 1 : uniqueAgents);

  $('kpi-contact').textContent = pct(contacted, total);
  $('kpi-quote').textContent   = pct(quoted, total);
  $('kpi-close').textContent   = quoted ? pct(won, quoted) : '—';

  $('kpi-avg-age').textContent = (avgAge == null) ? '—' : String(Math.round(avgAge));

  // KPI persistency stays placeholder; your real persistency is the new line chart
  $('kpi-persistency').textContent = '—';
}

function buildTimeSeries(leadsArr, startISO, endISO){
  let timeLabels = [];
  let timeCounts = [];
  let chartLineLabel = 'Weekly New Leads';

  if (!startISO || !endISO){
    const now = new Date();
    const monthStarts = [];
    for (let i = 11; i >= 0; i--){
      monthStarts.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }
    const monthCounts = new Array(monthStarts.length).fill(0);

    for (const l of leadsArr){
      const dt = new Date(l.created_at);
      const idx = monthStarts.findIndex(m =>
        dt.getFullYear() === m.getFullYear() && dt.getMonth() === m.getMonth()
      );
      if (idx !== -1) monthCounts[idx]++;
    }

    timeLabels = monthStarts.map(d =>
      `${d.toLocaleString('default', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`
    );
    timeCounts = monthCounts;
    chartLineLabel = 'Monthly New Leads';
  } else {
    const start = new Date(startISO + 'T00:00:00');
    const end   = new Date(endISO + 'T00:00:00');

    const totalDays = Math.max(1, Math.round((+end - +start) / DAY_MS) + 1);
    const useMonthly = totalDays > 120;

    if (useMonthly){
      const monthStarts = [];
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const last   = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= last){
        monthStarts.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
      }

      const monthCounts = new Array(monthStarts.length).fill(0);
      for (const l of leadsArr){
        const dt = new Date(l.created_at);
        const idx = monthStarts.findIndex(m =>
          dt.getFullYear() === m.getFullYear() && dt.getMonth() === m.getMonth()
        );
        if (idx !== -1) monthCounts[idx]++;
      }

      timeLabels = monthStarts.map(d =>
        `${d.toLocaleString('default', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`
      );
      timeCounts = monthCounts;
      chartLineLabel = 'Monthly New Leads';
    } else {
      const weekMs = 7 * DAY_MS;
      const bucketCount = Math.min(24, Math.max(1, Math.ceil(totalDays / 7)));
      const weeklyCounts = new Array(bucketCount).fill(0);
      const bucketStarts = Array.from({ length: bucketCount }, (_, i) =>
        new Date(start.getTime() + i * weekMs)
      );

      for (const l of leadsArr){
        const t = new Date(l.created_at).getTime();
        const idx = Math.floor((t - start.getTime()) / weekMs);
        if (idx >= 0 && idx < bucketCount) weeklyCounts[idx]++;
      }

      timeLabels = bucketStarts.map(d =>
        `${String(d.getMonth() + 1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`
      );
      timeCounts = weeklyCounts;
      chartLineLabel = 'Weekly New Leads';
    }
  }

  const weeklyTitleEl = document.querySelector('#chart-weekly')?.previousElementSibling;
  if (weeklyTitleEl) weeklyTitleEl.textContent = chartLineLabel;

  return { timeLabels, timeCounts, chartLineLabel };
}

// ---------- Persistency helpers (adds 13m + 25m) ----------

function minDate(a, b){
  const da = a ? new Date(a) : null;
  const db = b ? new Date(b) : null;
  if (da && db) return (da <= db) ? da : db;
  return da || db;
}

function addMonths(dateObj, months){
  const d = new Date(dateObj);
  d.setMonth(d.getMonth() + months);
  return d;
}

function bucketKeyForDate(dt, useMonthly){
  const d = new Date(dt);
  if (isNaN(d)) return null;

  if (useMonthly){
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2,'0');
    return `${y}-${m}-01`;
  }

  // weekly bucket start (Mon)
  const day = d.getDay(); // 0 Sun..6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

function labelForBucket(bucketISO, useMonthly){
  const d = new Date(bucketISO + 'T00:00:00');
  if (useMonthly){
    return `${d.toLocaleString('default', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`;
  }
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

function calcPersistencySeries(policiesArr, startISO, endISO){
  let useMonthly = false;

  if (!startISO || !endISO){
    useMonthly = true;
    const now = new Date();
    const buckets = [];
    for (let i = 11; i >= 0; i--){
      buckets.push(new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0,10));
    }
    return buildPersistencyFromBuckets(policiesArr, buckets, true, null, new Date());
  }

  const start = new Date(startISO + 'T00:00:00');
  const end   = new Date(endISO + 'T00:00:00');
  const totalDays = Math.max(1, Math.round((+end - +start) / DAY_MS) + 1);
  useMonthly = totalDays > 120;

  let buckets = [];
  if (useMonthly){
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const last   = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= last){
      buckets.push(new Date(cursor).toISOString().slice(0,10));
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const weekMs = 7 * DAY_MS;
    const bucketCount = Math.min(24, Math.max(1, Math.ceil(totalDays / 7)));
    for (let i = 0; i < bucketCount; i++){
      const d = new Date(start.getTime() + i * weekMs);
      const key = bucketKeyForDate(d.toISOString(), false);
      if (key && !buckets.includes(key)) buckets.push(key);
    }
    buckets = buckets.sort();
  }

  return buildPersistencyFromBuckets(policiesArr, buckets, useMonthly, start, end);
}

function buildPersistencyFromBuckets(policiesArr, bucketISOs, useMonthly, startDateObj, endDateObj){
  const cohorts = {}; // bucketISO -> policy list

  for (const p of (policiesArr || [])){
    if (!p?.issued_at) continue;
    const key = bucketKeyForDate(p.issued_at, useMonthly);
    if (!key) continue;

    if (startDateObj && endDateObj){
      const kDate = new Date(key + 'T00:00:00');
      if (kDate < startDateObj || kDate > endDateObj) continue;
    }

    cohorts[key] = cohorts[key] || [];
    cohorts[key].push(p);
  }

  const endCutoff = endDateObj || new Date();
  const labels = bucketISOs.map(b => labelForBucket(b, useMonthly));

  // day-based + month-based windows
  const dayWindows = [30, 60, 90];
  const monthWindows = [13, 25];

  const series = {
    '30d': new Array(bucketISOs.length).fill(null),
    '60d': new Array(bucketISOs.length).fill(null),
    '90d': new Array(bucketISOs.length).fill(null),
    '13m': new Array(bucketISOs.length).fill(null),
    '25m': new Array(bucketISOs.length).fill(null),
  };

  bucketISOs.forEach((bucketISO, idx) => {
    const cohort = cohorts[bucketISO] || [];
    if (!cohort.length) return;

    const bucketStart = new Date(bucketISO + 'T00:00:00');

    // ----- Day windows -----
    for (const w of dayWindows){
      const matureBy = new Date(endCutoff.getTime() - w * DAY_MS);
      if (bucketStart > matureBy){
        series[`${w}d`][idx] = null;
        continue;
      }

      let survived = 0;
      let total = 0;

      for (const p of cohort){
        const issued = new Date(p.issued_at);
        if (isNaN(issued)) continue;

        total += 1;

        const endEvent = minDate(p.lapsed_at, p.cancelled_at);
        const threshold = new Date(issued.getTime() + w * DAY_MS);

        if (!endEvent || endEvent >= threshold) survived += 1;
      }

      series[`${w}d`][idx] = total ? Math.round((survived / total) * 100) : null;
    }

    // ----- Month windows (13m / 25m) -----
    for (const m of monthWindows){
      const matureBy = addMonths(endCutoff, -m);
      if (bucketStart > matureBy){
        series[`${m}m`][idx] = null;
        continue;
      }

      let survived = 0;
      let total = 0;

      for (const p of cohort){
        const issued = new Date(p.issued_at);
        if (isNaN(issued)) continue;

        total += 1;

        const endEvent = minDate(p.lapsed_at, p.cancelled_at);
        const threshold = addMonths(issued, m);

        if (!endEvent || endEvent >= threshold) survived += 1;
      }

      series[`${m}m`][idx] = total ? Math.round((survived / total) * 100) : null;
    }
  });

  return { labels, series, useMonthly };
}

// ---------- Charts ----------

function renderCharts({ leadsArr, policiesArr, startISO, endISO }){
  destroyCharts();

  // ----- Time series -----
  const ts = buildTimeSeries(leadsArr, startISO, endISO);
  const weeklyCtx = $('chart-weekly')?.getContext('2d');
  if (weeklyCtx){
    chartWeekly = new Chart(weeklyCtx, {
      type: 'line',
      data: {
        labels: ts.timeLabels,
        datasets: [{ label: ts.chartLineLabel, data: ts.timeCounts, tension: 0.3 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  // ----- Product mix (prefer policies; fall back to leads) -----
  const productCounts = {};
  if ((policiesArr || []).length){
    policiesArr.forEach(p => {
      const key = (p.product_line || p.policy_type || 'Unknown').trim() || 'Unknown';
      productCounts[key] = (productCounts[key] || 0) + 1;
    });
  } else {
    leadsArr.forEach(l => {
      const key = (l.product_type || 'Unknown').trim() || 'Unknown';
      productCounts[key] = (productCounts[key] || 0) + 1;
    });
  }

  const productLabels = Object.keys(productCounts);
  const productValues = productLabels.map(k => productCounts[k]);

  const productsCtx = $('chart-products')?.getContext('2d');
  if (productsCtx){
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

  // ----- Assignments by agent -----
  const agentMap = new Map((allAgents || []).map(a => [a.id, a.full_name]));
  const assigns = {};
  const assignedInWindow = leadsArr.filter(l => !!l.assigned_to);

  for (const l of assignedInWindow){
    const id = l.assigned_to || 'Unknown';
    assigns[id] = (assigns[id] || 0) + 1;
  }

  const assignLabels = Object.keys(assigns).map(id => agentMap.get(id) || 'Unassigned/Unknown');
  const assignValues = Object.keys(assigns).map(id => assigns[id]);

  const assignCtx = $('chart-assignments')?.getContext('2d');
  if (assignCtx){
    chartAssignments = new Chart(assignCtx, {
      type: 'bar',
      data: { labels: assignLabels, datasets: [{ data: assignValues }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });
  }

  // ----- Persistency Over Time (30/60/90/13m/25m) -----
  const pCtx = $('chart-persistency')?.getContext('2d');
  if (pCtx){
    const p = calcPersistencySeries(policiesArr || [], startISO, endISO);

    chartPersistency = new Chart(pCtx, {
      type: 'line',
      data: {
        labels: p.labels,
        datasets: [
          { label: '30-day', data: p.series['30d'], tension: 0.3, spanGaps: false },
          { label: '60-day', data: p.series['60d'], tension: 0.3, spanGaps: false },
          { label: '90-day', data: p.series['90d'], tension: 0.3, spanGaps: false },
          { label: '13-month', data: p.series['13m'], tension: 0.3, spanGaps: false },
          { label: '25-month', data: p.series['25m'], tension: 0.3, spanGaps: false },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } }
        }
      }
    });
  }
}

async function loadAgentStats(){
  setMsg('Loading…');

  const agentId = $('stat-agent')?.value || '';
  const { startISO, endISO } = getRange();

  const [leadsArr, policiesArr] = await Promise.all([
    fetchLeads({ startISO, endISO, agentId }),
    fetchPolicies({ startISO, endISO, agentId })
  ]);

  renderKPIs(leadsArr, policiesArr, agentId);
  renderCharts({ leadsArr, policiesArr, startISO, endISO });

  setMsg('');
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb){
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  wireAdminNavLinks();

  const section = $('admin-stats-section');
  if (section) section.style.display = 'block';

  initStatRange();

  $('stat-agent')?.addEventListener('change', loadAgentStats);

  await loadAgents();
  await loadAgentStats();
});
