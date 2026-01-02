// scripts/commissions.js
let me = null;        // supabase auth user
let myProfile = null; // row from agents table

// We'll keep these in sync with Supabase so all UI uses the same numbers
let leadBalance = 0;
let chargebackBalance = 0;
let summaryLeadBalance = 0;
let summaryChargebackBalance = 0;
let accessToken = null;
let paythruPreviewByPolicy = {}; // { [policy_id]: monthly_amount }
// ---- Policies filters state ----
let policiesFp = null; // flatpickr instance (if loaded)
let policiesFilters = {
  startISO: null,   // YYYY-MM-DD
  endISO: null,     // YYYY-MM-DD
  carrier: '',
  status: ''
};
// Cache so we don't re-fetch names every toggle
let agentNameMapCache = {}; // { [agentId]: full_name }
let policiesScope = 'me'; // 'me' | 'team'
// ---- Commission Reports Picker state ----
let reportsFp = null;
let reportsStartISO = null;
let reportsEndISO = null;

async function getAgentNameMap(agentIds = []) {
  const ids = (agentIds || []).filter(Boolean);
  if (!ids.length) return {};

  // return cached if we already have all of them
  const missing = ids.filter(id => !agentNameMapCache[id]);
  if (!missing.length) {
    const out = {};
    ids.forEach(id => (out[id] = agentNameMapCache[id]));
    return out;
  }

  const { data, error } = await supabase
    .from('agents')
    .select('id, full_name')
    .in('id', missing);

  if (error) {
    console.error('Error loading agent names:', error);
    // fall back to whatever cache we already have
  } else {
    (data || []).forEach(r => {
      agentNameMapCache[r.id] = r.full_name || '';
    });
  }

  const out = {};
  ids.forEach(id => (out[id] = agentNameMapCache[id] || ''));
  return out;
}

document.addEventListener('DOMContentLoaded', async () => {

   if (!supabase) {
    console.error('Supabase client missing on this page');
    return;
  }
  // ----- 1. Require login -----
  const { data: { session }, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) {
    console.error('Error getting session on commissions page:', sessErr);
  }
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  me = session.user;
  accessToken = session.access_token;
  // ----- 2. Load my agent profile (for name + "level" label) -----
  try {
    const { data: profile, error: profErr } = await supabase
      .from('agents')
      .select('id, full_name, agent_id, is_admin, is_active, level, created_at')
      .eq('id', me.id)
      .single();

    if (profErr) {
      console.error('Error loading agent profile for commissions:', profErr);
    } else {
      myProfile = profile;
      hydrateHeaderFromProfile(profile);
    }
  } catch (e) {
    console.error('Unexpected error loading agent profile:', e);
  }

  // ----- 3. Load aggregate commission overview (view) -----
  const overview = await loadAgentCommissionOverview();

  // 🔹 NEW: load upcoming payouts (advance + pay-thru)
  const previews = await loadNextPayoutsFromPreviews();
   
   if (!previews?.weekly && !previews?.monthly && !overview) {
     renderPlaceholderSummary();
   }

  // ----- 4. Wire up tabs & basic UI -----
  initTabs();
  initPayoutRangeChange();
  initPoliciesDateRange();
  await populatePoliciesCarrierDropdown();
  initPoliciesFilters();
  initPoliciesScopeToggle();
  initFilesChips();
  initCommissionReportsPicker();
  initBalanceScopeToggle();
  // ----- 5. Load REAL lead debts + chargebacks -----

  // ----- 7. Still use placeholder data for payouts, team, files (for now) -----
  await loadAndRenderPayouts();
  await loadAndRenderTeamOverridesPanel();
  await loadAndRenderFilesForChip('all');
});

/* ===============================
   Header helpers
   =============================== */
function isoToLocalYMD(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, m - 1, d); // local date, no UTC shift
}

function getNextFridayISO() {
  const today = new Date();
  const day = today.getDay(); // 0 Sun ... 5 Fri
  const diff = (5 - day + 7) % 7 || 7;
  const next = new Date(today);
  next.setDate(today.getDate() + diff);
  return toISODate(next); // <-- your local YYYY-MM-DD helper
}

// Your monthly pay-thru preview defaults to the 5th.
// If today is after the 5th, we should preview NEXT month's 5th.
function getNextMonthlyPayThruISO() {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();

  const thisMonths5th = new Date(y, m, 5);
  const target = (today > thisMonths5th) ? new Date(y, m + 1, 5) : thisMonths5th;

  const yy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = '05';
  return `${yy}-${mm}-${dd}`;
}

async function postPreviewJson(url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });

  const text = await res.text();

  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!res.ok) {
    console.error('Preview function failed:', url, res.status, json || text);
    return null;
  }
  return json;
}

function pickMyPayoutAmount(previewJson) {
  // Weekly uses agent_payouts, Monthly uses agent_payouts_preview
  const list =
    previewJson?.agent_payouts_preview ||
    previewJson?.agent_payouts ||
    null;

  if (Array.isArray(list) && me?.id) {
    const mine = list.find(x => x?.agent_id === me.id);
    if (mine) {
      // Prefer net payout if present
      const v =
        mine.net_payout ??
        mine.net_amount ??
        mine.gross_payout ??
        mine.gross_monthly_trail ??
        mine.gross_amount ??
        0;

      return Number(v) || 0;
    }
  }

  // Fallback totals (monthly vs weekly keys)
  const fallback =
    previewJson?.total_net_preview ??
    previewJson?.total_net ??
    previewJson?.total_gross_preview ??
    previewJson?.total_gross ??
    0;

  return Number(fallback) || 0;
}

async function loadNextPayoutsFromPreviews() {
  // Weekly Advance
  const nextFriISO = getNextFridayISO();
  const weekly = await postPreviewJson(`/.netlify/functions/previewWeeklyAdvance?pay_date=${encodeURIComponent(nextFriISO)}`);
  if (weekly) {
    const amt = pickMyPayoutAmount(weekly);
    setText('summary-next-advance-amount', formatMoney(amt));
    setText('summary-next-advance-date', `(${getNextFridayLabel()})`);
    setText('next-advance-amount', formatMoney(amt));
    setText('next-advance-date', `Pays on: ${getNextFridayLabel()}`);
  }

  // Monthly Pay-Thru
  const nextMonthlyISO = getNextMonthlyPayThruISO();
  const monthly = await postPreviewJson(`/.netlify/functions/previewMonthlyPayThru?pay_date=${encodeURIComponent(nextMonthlyISO)}`);
  
  if (monthly) {
    // ✅ This is your per-policy TOTAL pay-thru (lifetime) numbers for the Policies table
    paythruPreviewByPolicy = monthly?.paythru_by_policy_preview || {};
  
    // ✅ This is the actual NEXT paythru payout amount (threshold + debt logic already applied)
    const amt = pickMyPayoutAmount(monthly);
  
    const label = isoToLocalYMD(nextMonthlyISO).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  
    setText('summary-next-paythru-amount', formatMoney(amt));
    setText('summary-next-paythru-date', `(${label})`);
  
    setText('next-paythru-amount', formatMoney(amt));
    setText('next-paythru-date', `Pays on: ${label}`);
  }

  return { weekly, monthly };
}

function hydrateHeaderFromProfile(profile) {
  const nameEl = document.getElementById('comm-agent-name');
  const levelEl = document.getElementById('comm-level-label');
  const progressEl = document.getElementById('comm-level-progress-text');

  if (nameEl) {
    nameEl.textContent = profile?.full_name || 'Agent';
  }

  // Use your agents.level column if present, else Admin/Agent label
  if (levelEl) {
    let label = 'Level: Agent';
    if (profile?.level) {
      // level is one of: agent | mit | manager | mga | area_manager
      label = `Level: ${String(profile.level).replace('_', ' ')}`;
    } else if (profile?.is_admin) {
      label = 'Level: Admin';
    }
    levelEl.textContent = label;
  }

  if (progressEl) {
    progressEl.textContent = 'Level progress tracking coming soon.';
  }
}

async function loadAgentCommissionOverview() {
  if (!me) return null;

  const { data, error } = await supabase
    .from('agent_commission_overview')
    .select('*')
    .eq('agent_id', me.id)
    .single();

  if (error) {
    console.error('Error loading agent_commission_overview:', error);
    return null;
  }

  return data;
}

async function loadAgentUpcomingPayouts() {
  if (!me) return null;

  const { data, error } = await supabase
    .from('agent_upcoming_payouts')
    .select('next_advance_gross, next_paythru_gross')
    .eq('agent_id', me.id)
    .single();

  if (error) {
    console.error('Error loading agent_upcoming_payouts:', error);
    return null;
  }

  const advance = Number(data?.next_advance_gross) || 0;
  const paythru = Number(data?.next_paythru_gross) || 0;

  // Labels (weekly = next Friday, monthly pay-thru = the 5th)
  const nextFriLabel = getNextFridayLabel();

  const nextMonthlyISO = getNextMonthlyPayThruISO(); // <-- uses your 5th logic
  const payThruLabel = isoToLocalYMD(nextMonthlyISO).toLocaleDateString(undefined, {
  month: 'short',
  day: 'numeric'
});

  // Top summary card
  setText('summary-next-advance-amount', formatMoney(advance));
  setText('summary-next-advance-date', `(${nextFriLabel})`);

  setText('summary-next-paythru-amount', formatMoney(paythru));
  setText('summary-next-paythru-date', `(${payThruLabel})`);

  // Earnings & Payouts panel cards
  setText('next-advance-amount', formatMoney(advance));
  setText('next-advance-date', `Pays on: ${nextFriLabel}`);

  setText('next-paythru-amount', formatMoney(paythru));
  setText('next-paythru-date', `Pays on: ${payThruLabel}`);

  return data;
}

/* ===============================
   Shared balances UI helper
   =============================== */

function updateBalancesUI({ updateSummary = true, updateBalancesTab = true } = {}) {
  const summaryTotal = summaryLeadBalance + summaryChargebackBalance;
  const tabTotal = leadBalance + chargebackBalance;

  if (updateSummary) {
    setText('summary-leads-balance', formatMoney(summaryLeadBalance));
    setText('summary-chargeback-balance', formatMoney(summaryChargebackBalance));
    setText('summary-total-balance', formatMoney(summaryTotal));
  }

  if (updateBalancesTab) {
    setText('balances-leads-amount', formatMoney(leadBalance));
    setText('balances-chargebacks-amount', formatMoney(chargebackBalance));
    setText('balances-total-amount', formatMoney(tabTotal));
  }
}

/* ===============================
   Tabs logic
   =============================== */
function initPayoutRangeChange() {
  const rangeSel = document.getElementById('payout-range');
  if (!rangeSel) return;

  rangeSel.addEventListener('change', async () => {
    await loadAndRenderTeamOverridesPanel();
  });
}

function initTabs() {
  const tabButtons = document.querySelectorAll('.commissions-tabs .tab');
  const panels = document.querySelectorAll('.commissions-tabs .panel');

  if (!tabButtons.length || !panels.length) return;

  function activateTab(target) {
    // tabs
    tabButtons.forEach(t => {
      const isActive = t.getAttribute('data-tab') === target;
      t.classList.toggle('is-active', isActive);
      t.setAttribute('aria-selected', String(isActive));
    });

    // panels
    panels.forEach(panel => {
      const idMatch = panel.id === `panel-${target}`;
      panel.classList.toggle('is-active', idMatch);
      if (idMatch) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', 'true');
    });
  }

  // ✅ On load: pick an already-active tab if present, else first tab
  const preActive = Array.from(tabButtons).find(t => t.classList.contains('is-active'));
  const defaultTarget = (preActive || tabButtons[0]).getAttribute('data-tab');

  // ✅ Hide everything except default immediately
  if (defaultTarget) activateTab(defaultTarget);

  // Click behavior
  tabButtons.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      if (!target) return;
      activateTab(target);
    });
  });
}

/* ===============================
   Filters & chips
   =============================== */

function initPoliciesDateRange() {
  const input = document.getElementById('policies-date-range');
  if (!input) return;

  // If flatpickr is available, use it. If not, just leave the plain input.
  if (window.flatpickr) {
    policiesFp = window.flatpickr(input, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      onChange: (selectedDates) => {
        // Keep filters in sync when user picks dates
        if (Array.isArray(selectedDates) && selectedDates.length) {
          const start = selectedDates[0] ? toISODate(selectedDates[0]) : null;
          const end = selectedDates[1] ? toISODate(selectedDates[1]) : start;
          policiesFilters.startISO = start;
          policiesFilters.endISO = end;
        } else {
          policiesFilters.startISO = null;
          policiesFilters.endISO = null;
        }
      }
    });
  } else {
    // No flatpickr loaded: user can type "YYYY-MM-DD to YYYY-MM-DD" or "YYYY-MM-DD - YYYY-MM-DD"
    input.addEventListener('change', () => {
      const { startISO, endISO } = parseDateRangeInput(input.value);
      policiesFilters.startISO = startISO;
      policiesFilters.endISO = endISO;
    });
  }
}

function initFilesChips() {
  const chipsWrap = document.getElementById('files-type-chips');
  if (!chipsWrap) return;

  chipsWrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;

    const type = btn.getAttribute('data-doc-type') || 'all';

    // Active state
    chipsWrap.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('is-active', chip === btn);
    });

    // ✅ Instead of just hiding/showing rows, we re-render the table
    await loadAndRenderFilesForChip(type);
  });
}

async function getAllDownlineAgentIds() {
  if (!me) return [];

  const { data, error } = await supabase
    .rpc('get_downline_agent_ids', { root_id: me.id });

  if (error) {
    console.error('Error loading downline agent ids:', error);
    return [];
  }

  return (data || []).map(r => r.agent_id).filter(Boolean);
}

function getPeriodStartISO(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (Number(days) || 30));
  return { startISO: toISODate(start), endISO: toISODate(end) };
}

function sumPremiumAnnual(rows) {
  return (rows || []).reduce((acc, r) => acc + (Number(r.premium_annual || 0)), 0);
}

function chunk(arr, size = 250) {
  const out = [];
  for (let i = 0; i < (arr || []).length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getAllDownlineAgentsFull() {
  if (!me) return [];

  // Your RPC returns rows like [{ agent_id: uuid }, ...]
  const downlineIds = await getAllDownlineAgentIds();
  const ids = Array.from(new Set((downlineIds || []).filter(Boolean)));

  if (!ids.length) return [];

  // Pull agent rows for ALL downline
  const { data, error } = await supabase
    .from('agents')
    .select('id, full_name, level, is_active, recruiter_id')
    .in('id', ids)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error loading full downline agents:', error);
    return [];
  }

  return data || [];
}

async function loadAPForAgents(agentIds, startISO, endISO) {
  // returns map { agent_id: apSum }
  const apMap = {};
  const batches = chunk(agentIds, 250);

  for (const ids of batches) {
    const { data, error } = await supabase
      .from('policies_with_written_at')
      .select('agent_id, premium_annual, written_at')
      .in('agent_id', ids)
      .gte('written_at', `${startISO}T00:00:00`)
      .lte('written_at', `${endISO}T23:59:59`);

    if (error) {
      console.error('Error loading policies_with_written_at for AP:', error);
      continue;
    }

    (data || []).forEach(p => {
      const aid = p.agent_id;
      if (!aid) return;
      apMap[aid] = (apMap[aid] || 0) + Number(p.premium_annual || 0);
    });
  }

  return apMap;
}

async function loadOverridesForMe(startISO, endISO) {
  if (!me) return { total: 0, byDownline: {} };

  const { data, error } = await supabase
    .from('commission_ledger')
    .select('amount, created_at, meta')
    .eq('agent_id', me.id)
    .eq('entry_type', 'override')
    .gte('created_at', `${startISO}T00:00:00`)
    .lte('created_at', `${endISO}T23:59:59`);

  if (error) {
    console.error('Error loading overrides:', error);
    return { total: 0, byDownline: {} };
  }

  let total = 0;
  const byDownline = {}; // { downlineId: sum }
  (data || []).forEach(r => {
    const amt = Number(r.amount || 0);
    total += amt;

    const downlineId = r?.meta?.downline_agent_id || null;
    if (downlineId) {
      byDownline[downlineId] = (byDownline[downlineId] || 0) + amt;
    }
  });

  return { total, byDownline };
}

async function loadOpenBalances(agentIds) {
  const map = {};
  const batches = chunk(agentIds, 250);

  for (const ids of batches) {
    const { data, error } = await supabase
      .from('agent_open_balances')
      .select('agent_id, open_lead_debt, open_chargebacks')
      .in('agent_id', ids);

    if (error) {
      console.error('Error loading agent_open_balances:', error);
      continue;
    }

    (data || []).forEach(r => {
      map[r.agent_id] = {
        leads: Number(r.open_lead_debt || 0),
        chargebacks: Number(r.open_chargebacks || 0),
      };
    });
  }

  return map;
}

async function loadAndRenderTeamOverridesPanel() {
  if (!me) return;

  // Use the same period as your payouts range dropdown (last 30/90/365/all)
  const rangeSel = document.getElementById('payout-range');
  const days = Number(rangeSel?.value || 30);

  let startISO = null, endISO = null;
  if (days === 0) {
    // all time
    startISO = '1970-01-01';
    endISO = toISODate(new Date());
  } else if (days === 365) {
    // YTD
    const now = new Date();
    startISO = `${now.getFullYear()}-01-01`;
    endISO = toISODate(now);
  } else {
    ({ startISO, endISO } = getPeriodStartISO(days));
  }

  const periodLabel =
    days === 0 ? 'All time' :
    days === 365 ? 'Year to date' :
    `Last ${days} days`;

  setText('team-my-ap-period', periodLabel);
  setText('team-overrides-period', periodLabel);

  // 1) My AP
  const myAPMap = await loadAPForAgents([me.id], startISO, endISO);
  const myAP = Number(myAPMap[me.id] || 0);
  setText('team-my-ap', formatMoney(myAP));

  // 2) All downline AP (NOT just direct)
  const downlineIds = await getAllDownlineAgentIds();
  const teamIdsAll = Array.from(new Set(downlineIds));

  let teamAP = 0;
  if (teamIdsAll.length) {
    const teamAPMap = await loadAPForAgents(teamIdsAll, startISO, endISO);
    teamAP = Object.values(teamAPMap).reduce((a, b) => a + Number(b || 0), 0);
  }

  // You want this card to be ALL downline, so overwrite label
  setText('team-direct-ap', formatMoney(teamAP));
  // we will set count below using DIRECT downline active count, since snapshot is direct
  // (If you want total downline count instead, tell me.)
  
  // 3) Overrides Earned (period)
  const overrides = await loadOverridesForMe(startISO, endISO);
  setText('team-overrides-amount', formatMoney(overrides.total));

  // 4) Team snapshot table (WHOLE downline)
  const teamAgents = await getAllDownlineAgentsFull();
  const teamIds = teamAgents.map(a => a.id);

  const activeCount = teamAgents.filter(a => a.is_active !== false).length;
  setText('team-direct-count', `${activeCount} active agents`);

  const apByTeam = teamIds.length ? await loadAPForAgents(teamIds, startISO, endISO) : {};
  const balancesByTeam = teamIds.length ? await loadOpenBalances(teamIds) : {};

  // Fill the table
  const tbody = document.querySelector('#team-agents-table tbody');
  if (!tbody) return;

  if (!teamAgents.length) {
    tbody.innerHTML = `<tr><td colspan="6">No downline agents yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = teamAgents.map(a => {
    const ap = Number(apByTeam[a.id] || 0);
    const bal = balancesByTeam[a.id] || { leads: 0, chargebacks: 0 };
    const ovToYou = Number(overrides.byDownline[a.id] || 0);

    return `
      <tr>
        <td>${escapeHtml(a.full_name || '—')}</td>
        <td>${escapeHtml(String(a.level || 'agent').replace('_',' '))}</td>
        <td>${formatMoney(ap)}</td>
        <td>${formatMoney(bal.leads)}</td>
        <td>${formatMoney(bal.chargebacks)}</td>
        <td>${formatMoney(ovToYou)}</td>
      </tr>
    `;
  }).join('');
}

/* ===============================
   REAL lead debts + chargebacks
   =============================== */

async function loadAndRenderLeadDebts(scope = 'me', teamIds = []) {
  if (!me) return;

  const tbody = document.querySelector('#lead-debts-table tbody');
  if (!tbody) return;

  try {
    let q = supabase
      .from('lead_debts')
      .select('id, created_at, description, source, amount, status, agent_id');

    if (scope === 'team') {
      if (!teamIds.length) {
        tbody.innerHTML = `<tr><td colspan="6">No direct team agents found.</td></tr>`;
        setTableAgentColumnVisible('lead-debts-table', true);
        leadBalance = 0;
        setText('balances-leads-count', '0 open items');
        updateBalancesUI({ updateSummary: false, updateBalancesTab: true });
        return;
      }
      q = q.in('agent_id', teamIds);
    } else {
      q = q.eq('agent_id', me.id);
    }

    const { data, error } = await q.order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading lead_debts:', error);
      renderPlaceholderLeadDebts();
      setTableAgentColumnVisible('lead-debts-table', false);
      return;
    }
   const nameMap = scope === 'team' ? await getAgentNameMap(teamIds) : {};
     
    if (!data || data.length === 0) {
      const colCount = (scope === 'team') ? 6 : 5;
      tbody.innerHTML = `<tr><td colspan="${colCount}">No lead debt records found.</td></tr>`;
    } else {
      tbody.innerHTML = data.map(row => {
        const date = row.created_at ? new Date(row.created_at).toLocaleDateString() : '—';
        const type = row.description || 'Lead';
        const source = row.source || 'FVG';
        const amount = Number(row.amount || 0);
        const status = formatStatus(row.status);
        const who =
           scope === 'team'
             ? (nameMap[row.agent_id] || '—')
             : '';

        return `
          <tr>
             <td class="col-agent">${escapeHtml(who)}</td>
            <td>${date}</td>
            <td>${escapeHtml(type)}</td>
            <td>${escapeHtml(source)}</td>
            <td>${formatMoney(amount)}</td>
            <td>${escapeHtml(status)}</td>
          </tr>
        `;
      }).join('');
    }

    // ✅ RUN AFTER ROWS EXIST
    setTableAgentColumnVisible('lead-debts-table', scope === 'team');

    // balances
    let openCount = 0;
    let openTotal = 0;
    (data || []).forEach(row => {
      const status = (row.status || '').toLowerCase();
      if (status === 'open' || status === 'in_repayment') {
        openCount += 1;
        openTotal += Number(row.amount || 0);
      }
    });

    leadBalance = openTotal;
    setText('balances-leads-count', `${openCount} open item${openCount === 1 ? '' : 's'}`);
    updateBalancesUI({ updateSummary: false, updateBalancesTab: true });
  } catch (err) {
    console.error('Unexpected error in loadAndRenderLeadDebts:', err);
    renderPlaceholderLeadDebts();
    setTableAgentColumnVisible('lead-debts-table', false);
  }
}

async function loadAndRenderChargebacks(scope = 'me', teamIds = []) {
  if (!me) return;

  const tbody = document.querySelector('#chargebacks-table tbody');
  if (!tbody) return;

  try {
    let q = supabase
      .from('policy_chargebacks')
      .select('id, created_at, carrier_name, policyholder_name, amount, status, agent_id');

    if (scope === 'team') {
      if (!teamIds.length) {
        tbody.innerHTML = `<tr><td colspan="6">No downline agents found.</td></tr>`;
        chargebackBalance = 0;
        setText('balances-chargebacks-count', '0 open items');
        updateBalancesUI({ updateSummary: false, updateBalancesTab: true });
        return;
      }
      q = q.in('agent_id', teamIds);
    } else {
      q = q.eq('agent_id', me.id);
    }

    const { data, error } = await q.order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading policy_chargebacks:', error);
      renderPlaceholderChargebacks();
      return;
    }
   const nameMap = scope === 'team' ? await getAgentNameMap(teamIds) : {};
     
    if (!data || data.length === 0) {
      const colCount = (scope === 'team') ? 6 : 5;
      tbody.innerHTML = `<tr><td colspan="${colCount}">No chargebacks found.</td></tr>`;
    } else {
      tbody.innerHTML = data.map(row => {
        const date = row.created_at ? new Date(row.created_at).toLocaleDateString() : '—';
        const carrier = row.carrier_name || '—';
        const name = row.policyholder_name || '—';
        const amount = Number(row.amount || 0);
        const status = formatStatus(row.status);
        const who =
           scope === 'team'
             ? (nameMap[row.agent_id] || '—')
             : '';

        return `
          <tr>
             <td class="col-agent">${escapeHtml(who)}</td>
            <td>${date}</td>
            <td>${escapeHtml(carrier)}</td>
            <td>${escapeHtml(name)}</td>
            <td>${formatMoney(amount)}</td>
            <td>${escapeHtml(status)}</td>
          </tr>
        `;
      }).join('');
    }

    let openCount = 0;
    let openTotal = 0;
    (data || []).forEach(row => {
      const status = (row.status || '').toLowerCase();
      if (status === 'open' || status === 'in_repayment') {
        openCount += 1;
        openTotal += Number(row.amount || 0);
      }
    });
   setTableAgentColumnVisible('chargebacks-table', scope === 'team');
    chargebackBalance = openTotal;
    setText('balances-chargebacks-count', `${openCount} open item${openCount === 1 ? '' : 's'}`);
    updateBalancesUI({ updateSummary: false, updateBalancesTab: true });
  } catch (err) {
    console.error('Unexpected error in loadAndRenderChargebacks:', err);
    renderPlaceholderChargebacks();
  }
}

function initBalanceScopeToggle() {
  const radios = document.querySelectorAll('input[name="balance-scope"]');

  const applyScope = async () => {
    // If radios exist, use them. If not, default to "me"
    const scope = radios.length
      ? (document.querySelector('input[name="balance-scope"]:checked')?.value || 'me')
      : 'me';

    const teamIds = scope === 'team' ? await getAllDownlineAgentIds() : [];

    // Reset numbers before reload to avoid mixed UI while loading
    leadBalance = 0;
    chargebackBalance = 0;
    updateBalancesUI({ updateSummary: false, updateBalancesTab: true });

    // Load tables
    await loadAndRenderLeadDebts(scope, teamIds);
    await loadAndRenderChargebacks(scope, teamIds);

    // ✅ Keep summary balances synced to whatever we just loaded
    summaryLeadBalance = leadBalance;
    summaryChargebackBalance = chargebackBalance;
    updateBalancesUI({ updateSummary: true, updateBalancesTab: false });
  };

  // If radios exist, hook changes
  if (radios.length) {
    radios.forEach(r => r.addEventListener('change', applyScope));
  }

  // ✅ Always run once on page load
  applyScope();
}

function toISODate(d) {
  // local YYYY-MM-DD (no UTC shift)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso, days) {
  const [y, m, d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + (Number(days) || 0));
  return toISODate(dt);
}

function parseDateRangeInput(str) {
  const raw = String(str || '').trim();
  if (!raw) return { startISO: null, endISO: null };

  // Accept: "YYYY-MM-DD to YYYY-MM-DD" OR "YYYY-MM-DD - YYYY-MM-DD"
  let parts = raw.split(' to ');
  if (parts.length === 1) parts = raw.split(' - ');

  const start = (parts[0] || '').trim();
  const end = (parts[1] || '').trim();

  const looksLikeISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!looksLikeISO(start)) return { startISO: null, endISO: null };

  if (end && looksLikeISO(end)) return { startISO: start, endISO: end };
  return { startISO: start, endISO: start };
}

async function populatePoliciesCarrierDropdown() {
  const sel = document.getElementById('policies-carrier');
  if (!sel) return;

  const { data, error } = await supabase
    .from('carriers')
    .select('carrier_name')
    .order('carrier_name', { ascending: true });

  if (error) {
    console.error('Error loading carriers:', error);
    return;
  }

  const carriers = (data || [])
    .map(r => (r.carrier_name || '').trim())
    .filter(Boolean);

  sel.innerHTML =
    `<option value="">All carriers</option>` +
    carriers.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${escapeHtml(c)}</option>`).join('');
}

function initPoliciesFilters() {
  const dateInput = document.getElementById('policies-date-range');
  const carrierSel = document.getElementById('policies-carrier');
  const statusSel = document.getElementById('policies-status');
  const applyBtn = document.getElementById('policies-apply-filters');
  const resetBtn = document.getElementById('policies-reset-filters');

  if (!applyBtn || !resetBtn) return;

  // Keep state updated when user changes carrier/status
  if (carrierSel) {
    carrierSel.addEventListener('change', () => {
      policiesFilters.carrier = carrierSel.value || '';
    });
  }
  if (statusSel) {
    statusSel.addEventListener('change', () => {
      policiesFilters.status = statusSel.value || '';
    });
  }

  applyBtn.addEventListener('click', async () => {
    // If flatpickr not present, parse typed range
    if (!policiesFp && dateInput) {
      const { startISO, endISO } = parseDateRangeInput(dateInput.value);
      policiesFilters.startISO = startISO;
      policiesFilters.endISO = endISO;
    }

    await loadAndRenderPolicies(policiesFilters, policiesScope);
  });

  resetBtn.addEventListener('click', async () => {
    // Clear UI
    if (policiesFp) {
      policiesFp.clear();
    } else if (dateInput) {
      dateInput.value = '';
    }

    if (carrierSel) carrierSel.value = '';
    if (statusSel) statusSel.value = '';

    // Clear state
    policiesFilters = { startISO: null, endISO: null, carrier: '', status: '' };

    await loadAndRenderPolicies(policiesFilters, policiesScope);
  });
}

/* ===============================
   REAL Policies & Details
   =============================== */

function getPolicyWrittenAtLocal(policyRow) {
  // Best-effort “Written Date” without adding a written_at column:
  // prefer submitted_at, then issued_at, else created_at.
  const v = policyRow?.submitted_at || policyRow?.issued_at || policyRow?.created_at || null;
  const d = v ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function formatDateShort(d) {
  if (!d) return '—';
  return d.toLocaleDateString();
}

function renderPoliciesTableHeader(scope) {
  const thead = document.querySelector('#policies-table thead');
  if (!thead) return;

  if (scope === 'team') {
    thead.innerHTML = `
      <tr>
        <th>Agent</th>
        <th>Written Date</th>
        <th>Policyholder</th>
        <th>Carrier</th>
        <th>AP</th>
        <th>Status</th>
        <th>Override</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr>
        <th>Written Date</th>
        <th>Policyholder</th>
        <th>Carrier</th>
        <th>AP</th>
        <th>Status</th>
        <th>Advance</th>
        <th>Pay-Thru</th>
        <th>Total Commission</th>
      </tr>
    `;
  }
}

function initPoliciesScopeToggle() {
  const radios = document.querySelectorAll('input[name="policies-scope"]');

  const apply = async () => {
    policiesScope =
      document.querySelector('input[name="policies-scope"]:checked')?.value || 'me';

    renderPoliciesTableHeader(policiesScope);
    await loadAndRenderPolicies(policiesFilters, policiesScope);
  };

  if (!radios.length) {
    apply(); // ✅ still loads policies even if no radios exist
    return;
  }

  radios.forEach(r => r.addEventListener('change', apply));
  apply();
}

async function loadAndRenderPolicies(filters = null, scope = 'me') {
  if (!me) return;

  const tbody = document.querySelector('#policies-table tbody');
  if (!tbody) return;

  const f = filters || policiesFilters;

  // Ensure header matches scope (in case called directly)
  renderPoliciesTableHeader(scope);

  const colCount = (scope === 'team') ? 7 : 8;
  tbody.innerHTML = `<tr><td colspan="${colCount}">Loading…</td></tr>`;

  try {
    if (scope === 'me') {
      // 1) Load my policies
      // NOTE: AP uses premium_annual.
      // Status uses policies.status.
      const { data: policies, error: polErr } = await supabase
        .from('policies')
        .select(`
          id,
          created_at,
          submitted_at,
          issued_at,
          status,
          premium_annual,
          carrier_name,
          product_line,
          contact:contacts(first_name, last_name)
        `)
        .eq('agent_id', me.id)
        .order('created_at', { ascending: false })
        .limit(500);

      if (polErr) {
        console.error('Error loading policies (me):', polErr);
        tbody.innerHTML = `<tr><td colspan="8">Failed to load policies.</td></tr>`;
        return;
      }

      let rows = policies || [];

      // Apply filters (carrier/status/date range)
      rows = rows.filter(p => {
        if (f?.carrier && (p.carrier_name || '') !== f.carrier) return false;
        if (f?.status && (p.status || '') !== f.status) return false;

        const wd = getPolicyWrittenAtLocal(p);
        const wdISO = wd ? toISODate(wd) : null;

        if (f?.startISO && (!wdISO || wdISO < f.startISO)) return false;
        if (f?.endISO && (!wdISO || wdISO > f.endISO)) return false;

        return true;
      });

      if (!rows.length) {
        const hasFilters = !!(f?.startISO || f?.endISO || f?.carrier || f?.status);
        tbody.innerHTML = hasFilters
          ? `<tr><td colspan="8">No policies match your filters.</td></tr>`
          : `<tr><td colspan="8">No policies found for you yet.</td></tr>`;
        return;
      }

      // 2) Load ledger entries for those policies (advance/renewal)
      const policyIds = rows.map(r => r.id);
      const { data: ledger, error: ledErr } = await supabase
        .from('commission_ledger')
        .select('policy_id, entry_type, amount')
        .eq('agent_id', me.id)
        .in('policy_id', policyIds);

      if (ledErr) {
        console.error('Error loading commission_ledger (me):', ledErr);
      }

      // group totals per policy
      const byPolicy = {};
      (ledger || []).forEach(l => {
        const pid = l.policy_id;
        if (!pid) return;
        byPolicy[pid] ||= { advance: 0, renewal: 0 };
        const amt = Number(l.amount || 0);
        const t = (l.entry_type || '').toLowerCase();
        if (t === 'advance') byPolicy[pid].advance += amt;
        if (t === 'renewal' || t === 'paythru' || t === 'trail') byPolicy[pid].renewal += amt;
      });

      tbody.innerHTML = rows.map(p => {
        const written = getPolicyWrittenAtLocal(p);
        const writtenDate = formatDateShort(written);

        const contact = p.contact || {};
        const policyholder =
          [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—';

        const carrier = p.carrier_name || '—';
        const ap = Number(p.premium_annual || 0);
        const status = formatStatus(p.status);

        const sums = byPolicy[p.id] || { advance: 0, renewal: 0 };
        const adv = Number(sums.advance || 0);
        const paythru = Number(paythruPreviewByPolicy?.[p.id] || 0);
        const total = adv + paythru;

        return `
          <tr>
            <td>${writtenDate}</td>
            <td>${escapeHtml(policyholder)}</td>
            <td>${escapeHtml(carrier)}</td>
            <td>${formatMoney(ap)}</td>
            <td>${escapeHtml(status)}</td>
            <td>${formatMoney(adv)}</td>
            <td>${formatMoney(paythru)}</td>
            <td>${formatMoney(total)}</td>
          </tr>
        `;
      }).join('');

      return;
    }

    // =========================
    // TEAM scope = overrides I earned
    // =========================

    // 1) Load override ledger rows that pay ME
    const { data: overrides, error: ovErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, amount, created_at, meta')
      .eq('agent_id', me.id)
      .eq('entry_type', 'override')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (ovErr) {
      console.error('Error loading override ledger:', ovErr);
      tbody.innerHTML = `<tr><td colspan="7">Failed to load team overrides.</td></tr>`;
      return;
    }

    const ovRows = overrides || [];
    if (!ovRows.length) {
      tbody.innerHTML = `<tr><td colspan="7">No overrides found yet.</td></tr>`;
      return;
    }

    // 2) Group by policy, sum override amounts, keep downline name/id
    const policyAgg = {}; // {policy_id: {overrideTotal, downlineName, downlineId}}
    ovRows.forEach(r => {
      const pid = r.policy_id;
      if (!pid) return;
      const amt = Number(r.amount || 0);
      const meta = r.meta || {};
      policyAgg[pid] ||= {
        overrideTotal: 0,
        downlineName: meta.downline_agent_name || '',
        downlineId: meta.downline_agent_id || null
      };
      policyAgg[pid].overrideTotal += amt;

      // keep a name if we get one later
      if (!policyAgg[pid].downlineName && meta.downline_agent_name) {
        policyAgg[pid].downlineName = meta.downline_agent_name;
      }
      if (!policyAgg[pid].downlineId && meta.downline_agent_id) {
        policyAgg[pid].downlineId = meta.downline_agent_id;
      }
    });

    const policyIds = Object.keys(policyAgg);
    if (!policyIds.length) {
      tbody.innerHTML = `<tr><td colspan="7">No overrides found yet.</td></tr>`;
      return;
    }

    // 3) Load those policies
    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select(`
        id,
        created_at,
        submitted_at,
        issued_at,
        status,
        premium_annual,
        carrier_name,
        contact:contacts(first_name, last_name)
      `)
      .in('id', policyIds)
      .order('created_at', { ascending: false });

    if (polErr) {
      console.error('Error loading policies (team):', polErr);
      tbody.innerHTML = `<tr><td colspan="7">Failed to load team policies.</td></tr>`;
      return;
    }

    let rows = (policies || []).map(p => {
      const agg = policyAgg[p.id] || { overrideTotal: 0, downlineName: '', downlineId: null };
      return { policy: p, agg };
    });

    // If we need missing names, fetch them
    const missingIds = rows
      .map(r => r.agg.downlineId)
      .filter(id => id && !agentNameMapCache[id]);
    if (missingIds.length) {
      await getAgentNameMap(missingIds);
    }

    // Apply filters (carrier/status/date range)
    rows = rows.filter(({ policy }) => {
      if (f?.carrier && (policy.carrier_name || '') !== f.carrier) return false;
      if (f?.status && (policy.status || '') !== f.status) return false;

      const wd = getPolicyWrittenAtLocal(policy);
      const wdISO = wd ? toISODate(wd) : null;

      if (f?.startISO && (!wdISO || wdISO < f.startISO)) return false;
      if (f?.endISO && (!wdISO || wdISO > f.endISO)) return false;

      return true;
    });

    if (!rows.length) {
      const hasFilters = !!(f?.startISO || f?.endISO || f?.carrier || f?.status);
      tbody.innerHTML = hasFilters
        ? `<tr><td colspan="7">No team policies match your filters.</td></tr>`
        : `<tr><td colspan="7">No team policies found yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map(({ policy, agg }) => {
      const written = getPolicyWrittenAtLocal(policy);
      const writtenDate = formatDateShort(written);

      const contact = policy.contact || {};
      const policyholder =
        [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '—';

      const carrier = policy.carrier_name || '—';
      const ap = Number(policy.premium_annual || 0);
      const status = formatStatus(policy.status);

      const agentName =
        agg.downlineName ||
        (agg.downlineId ? (agentNameMapCache[agg.downlineId] || '') : '') ||
        '—';

      const overrideAmt = Number(agg.overrideTotal || 0);

      return `
        <tr>
          <td>${escapeHtml(agentName)}</td>
          <td>${writtenDate}</td>
          <td>${escapeHtml(policyholder)}</td>
          <td>${escapeHtml(carrier)}</td>
          <td>${formatMoney(ap)}</td>
          <td>${escapeHtml(status)}</td>
          <td>${formatMoney(overrideAmt)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Unexpected error in loadAndRenderPolicies:', err);
    tbody.innerHTML = `<tr><td colspan="${colCount}">Unexpected error loading policies.</td></tr>`;
  }
}

/* ===============================
   REAL Payouts (advance + pay-thru)
   =============================== */

async function loadAndRenderPayouts() {
  if (!me) return;

  const tbody = document.querySelector('#payouts-table tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('agent_payouts_view')
      .select('*')
      .eq('agent_id', me.id)
      .order('pay_date', { ascending: false });

    if (error) {
      console.error('Error loading agent_payouts_view:', error);
      renderPlaceholderPayouts();
      return;
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6">No payouts found for you yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(row => {
      const date = row.pay_date
        ? new Date(row.pay_date).toLocaleDateString()
        : '—';

      const typeLabel =
        row.batch_type === 'advance'
          ? 'Advance'
          : row.batch_type === 'paythru'
          ? 'Pay-Thru'
          : (row.batch_type || 'Other');

      const periodLabel =
        row.batch_type === 'advance'
          ? 'Weekly'
          : row.batch_type === 'paythru'
          ? 'Monthly'
          : '';

      const amount = Number(row.net_amount || row.gross_amount || 0);
      const source = 'FVG';

      const details = `Batch #${String(row.payout_batch_id).slice(0, 8)}… (status: ${row.status})`;

      return `
        <tr>
          <td>${date}</td>
          <td>${typeLabel}</td>
          <td>${periodLabel}</td>
          <td>${formatMoney(amount)}</td>
          <td>${escapeHtml(source)}</td>
          <td>${escapeHtml(details)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Unexpected error in loadAndRenderPayouts:', err);
    renderPlaceholderPayouts();
  }
}
/* ===============================
   Placeholder data generators
   (still used for payouts, team, files, and fallback)
   =============================== */

function renderPlaceholderSummary() {
  summaryLeadBalance = 320;
  summaryChargebackBalance = 180;

  // Optional: make the Balances tab show the same placeholders initially
  leadBalance = summaryLeadBalance;
  chargebackBalance = summaryChargebackBalance;

  updateBalancesUI({ updateSummary: true, updateBalancesTab: true });

  setText('summary-next-advance-amount', '$1,250.00');
  setText('summary-next-advance-date', '(Next Friday)');
  setText('summary-next-paythru-amount', '$780.00');
  setText('summary-next-paythru-date', '(End of month)');

  setText('next-advance-amount', '$1,250.00');
  setText('next-advance-date', 'Pays on: Next Friday');
  setText('next-paythru-amount', '$780.00');
  setText('next-paythru-date', 'Pays on: End of month');

  setText('balances-leads-count', '4 open items');
  setText('balances-chargebacks-count', '2 open items');
  setText('balances-total-note', 'Projected after next payouts: $120.00');
}

function renderPlaceholderPayouts() {
  const tbody = document.querySelector('#payouts-table tbody');
  if (!tbody) return;

  const rows = [
    { date: '2025-11-21', type: 'Advance',  period: 'Weekly',   amount: 1250.00, source: 'FVG',    details: '3 issued policies' },
    { date: '2025-10-31', type: 'Pay-Thru', period: 'Monthly',  amount: 780.00,  source: 'FVG',    details: 'Trails + renewals' },
    { date: '2025-10-15', type: 'Bonus',    period: 'Quarterly',amount: 500.00,  source: 'Carrier',details: 'Production bonus' }
  ];

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.type}</td>
      <td>${r.period}</td>
      <td>$${r.amount.toFixed(2)}</td>
      <td>${r.source}</td>
      <td>${r.details}</td>
    </tr>
  `).join('');
}

function renderPlaceholderLeadDebts() {
  const tbody = document.querySelector('#lead-debts-table tbody');
  if (!tbody) return;

  const rows = [
    { date: '2025-11-05', type: 'Facebook Final Expense', source: 'FVG',    cost: 25.00, status: 'Unpaid' },
    { date: '2025-11-10', type: 'Inbound Call',           source: 'FVG',    cost: 35.00, status: 'In repayment' },
    { date: '2025-11-12', type: 'Direct Mail',            source: 'Vendor', cost: 40.00, status: 'Unpaid' },
    { date: '2025-11-15', type: 'Online Form',            source: 'Website',cost: 20.00, status: 'Paid' }
  ];

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.type}</td>
      <td>${r.source}</td>
      <td>$${r.cost.toFixed(2)}</td>
      <td>${r.status}</td>
    </tr>
  `).join('');
}

function renderPlaceholderChargebacks() {
  const tbody = document.querySelector('#chargebacks-table tbody');
  if (!tbody) return;

  const rows = [
    { date: '2025-10-20', carrier: 'Carrier A', name: 'J. Smith', amount: 120.00, status: 'Open' },
    { date: '2025-09-15', carrier: 'Carrier B', name: 'R. Brown', amount: 60.00,  status: 'In repayment' }
  ];

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>${r.carrier}</td>
      <td>${r.name}</td>
      <td>$${r.amount.toFixed(2)}</td>
      <td>${r.status}</td>
    </tr>
  `).join('');
}

function renderPlaceholderPolicies() {
  const tbody = document.querySelector('#policies-table tbody');
  if (!tbody) return;

  const rows = [
    {
      written: '2025-10-30',
      name: 'Jane Doe',
      carrier: 'Carrier A',
      product: 'Final Expense',
      premium: 80.00,
      status: 'Issued',
      advance: 600.00,
      paythru: 40.00
    },
    {
      written: '2025-11-05',
      name: 'John Smith',
      carrier: 'Carrier B',
      product: 'Term Life',
      premium: 60.00,
      status: 'Pending',
      advance: 0.00,
      paythru: 0.00
    }
  ];

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${r.written}</td>
      <td>${r.name}</td>
      <td>${r.carrier}</td>
      <td>${r.product}</td>
      <td>$${r.premium.toFixed(2)}</td>
      <td>${r.status}</td>
      <td>$${r.advance.toFixed(2)}</td>
      <td>$${r.paythru.toFixed(2)}</td>
      <td>$${(r.advance + r.paythru).toFixed(2)}</td>
    </tr>
  `).join('');
}

function renderPlaceholderTeam() {
  // Top stat cards
  setText('team-my-ap', '$6,400');
  setText('team-my-ap-period', 'Last 30 days');
  setText('team-direct-ap', '$12,800');
  setText('team-direct-count', '4 active agents');
  setText('team-overrides-amount', '$1,950.00');
  setText('team-overrides-period', 'Last 30 days');

  // Direct team table
  const tbody = document.querySelector('#team-agents-table tbody');
  if (tbody) {
    const rows = [
      { name: 'Agent Alpha', level: 'L2', ap: 3200, leads: 150, chargebacks: 80, overrides: 480 },
      { name: 'Agent Bravo', level: 'L1', ap: 2200, leads: 90,  chargebacks: 40, overrides: 330 },
      { name: 'Agent Charlie', level: 'L1', ap: 3400, leads: 80,  chargebacks: 60, overrides: 520 }
    ];
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${r.name}</td>
        <td>${r.level}</td>
        <td>$${r.ap.toFixed(2)}</td>
        <td>$${r.leads.toFixed(2)}</td>
        <td>$${r.chargebacks.toFixed(2)}</td>
        <td>$${r.overrides.toFixed(2)}</td>
      </tr>
    `).join('');
  }
}

function renderPlaceholderFiles() {
  const tbody = document.querySelector('#files-table tbody');
  if (!tbody) return;

  const rows = [
    {
      name: 'Weekly Commission Report - 2025-11-21',
      type: 'Report',
      group: 'reports',
      period: 'Week of Nov 15–21',
      source: 'FVG',
      uploaded: '2025-11-22'
    },
    {
      name: 'Pay Schedule 2025',
      type: 'Schedule',
      group: 'schedule',
      period: 'Full Year',
      source: 'FVG',
      uploaded: '2025-01-01'
    },
    {
      name: 'Carrier Bonus Flyer',
      type: 'Other',
      group: 'other',
      period: 'Q4 2025',
      source: 'Carrier',
      uploaded: '2025-10-01'
    }
  ];

  tbody.innerHTML = rows.map(r => `
    <tr data-doc-type="${r.group}">
      <td>${r.name}</td>
      <td>${r.type}</td>
      <td>${r.period}</td>
      <td>${r.source}</td>
      <td>${r.uploaded}</td>
      <td>
        <button type="button" class="btn-ghost-sm">Download</button>
      </td>
    </tr>
  `).join('');
}
async function loadAndRenderFilesForChip(type) {
  // ✅ If user selected "Commission Reports", show picker UI and hide table
  if (type === 'reports') {
    showCommissionReportsPicker(true);
    return;
  }

  // Otherwise: show normal table
  showCommissionReportsPicker(false);

  // Keep schedules special
  if (type === 'schedule') {
    await loadAndRenderPaySchedulesTable();
    return;
  }

  // Default placeholder files
  renderPlaceholderFiles();

  const tbody = document.querySelector('#files-table tbody');
  if (!tbody) return;

  // ✅ If user clicked "Other", prepend a Commission Manual row
  if (type === 'other') {
    const manualRow = document.createElement('tr');
    manualRow.setAttribute('data-doc-type', 'other');
    manualRow.innerHTML = `
      <td>Commission Manual (PDF)</td>
      <td>Other</td>
      <td>—</td>
      <td>FVG</td>
      <td>—</td>
      <td>
        <button type="button" class="btn-ghost-sm btn-download-manual">
          Download
        </button>
      </td>
    `;
    tbody.prepend(manualRow);

    const btn = manualRow.querySelector('.btn-download-manual');
    btn.addEventListener('click', async () => {
      await downloadCommissionManualPdf();
    });
  }

  // Filter placeholder rows (and the injected row)
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.forEach(row => {
    const rowType = row.getAttribute('data-doc-type') || 'other';
    const shouldShow = type === 'all' || rowType === type;
    row.style.display = shouldShow ? '' : 'none';
  });
}

async function loadAndRenderPaySchedulesTable() {
  const tbody = document.querySelector('#files-table tbody');
  if (!tbody) return;

  if (!me || !myProfile) {
    tbody.innerHTML = `<tr><td colspan="6">Loading…</td></tr>`;
    return;
  }

  tbody.innerHTML = `<tr><td colspan="6">Loading pay schedules…</td></tr>`;

  try {
    // ✅ If admin, show ALL carriers
    // ✅ If not admin, show ONLY carriers they are actively contracted with
    let carriers = [];

    if (myProfile.is_admin) {
      const { data, error } = await supabase
        .from('carriers')
        .select('id, carrier_name')
        .order('carrier_name', { ascending: true });

      if (error) throw error;
      carriers = data || [];
    } else {
      // Pull agent_carriers and join carrier name
      const { data, error } = await supabase
        .from('agent_carriers')
        .select(`
          carrier_id,
          is_contracted,
          status,
          effective_date,
          terminated_date,
          carriers:carriers ( id, carrier_name )
        `)
        .eq('agent_id', me.id)
        .eq('is_contracted', true)
        .eq('status', 'active');

      if (error) throw error;

      const today = new Date();
      const iso = today.toISOString().slice(0, 10);

      carriers = (data || [])
        .filter(r => {
          // effective_date <= today (if set)
          if (r.effective_date && String(r.effective_date) > iso) return false;
          // terminated_date > today (if set)
          if (r.terminated_date && String(r.terminated_date) <= iso) return false;
          return true;
        })
        .map(r => r.carriers)
        .filter(Boolean);
    }

    // De-dupe by id (just in case)
    const seen = new Set();
    carriers = (carriers || []).filter(c => {
      if (!c?.id) return false;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });

    if (!carriers.length) {
      tbody.innerHTML = `<tr><td colspan="6">No active carrier pay schedules found.</td></tr>`;
      return;
    }

    // Render rows as "Schedule" type
    tbody.innerHTML = carriers.map(c => `
      <tr data-doc-type="schedule" data-carrier-id="${escapeHtml(c.id)}">
        <td>${escapeHtml(c.carrier_name || 'Carrier')}</td>
        <td>Schedule</td>
        <td>Current</td>
        <td>FVG</td>
        <td>—</td>
        <td>
          <button type="button" class="btn-ghost-sm btn-download-schedule" data-carrier-id="${escapeHtml(c.id)}">
            Download
          </button>
        </td>
      </tr>
    `).join('');

    // Wire download buttons
    tbody.querySelectorAll('.btn-download-schedule').forEach(btn => {
      btn.addEventListener('click', async () => {
        const carrierId = btn.getAttribute('data-carrier-id');
        if (!carrierId) return;
        await downloadCarrierPaySchedulePdf(carrierId);
      });
    });

  } catch (err) {
    console.error('Error loading pay schedules:', err);
    tbody.innerHTML = `<tr><td colspan="6">Failed to load pay schedules.</td></tr>`;
  }
}

async function downloadCarrierPaySchedulePdf(carrierId) {
  try {
    if (!accessToken) {
      alert('Missing session token. Please log in again.');
      return;
    }

    const url = `/.netlify/functions/downloadCarrierPaySchedule?carrier_id=${encodeURIComponent(carrierId)}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const t = await res.text();
      console.error('Download failed:', res.status, t);
      alert('Download failed. You may not be active with that carrier.');
      return;
    }

    const blob = await res.blob();

    // filename from header if present
    const dispo = res.headers.get('Content-Disposition') || '';
    const match = dispo.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'PaySchedule.pdf';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  } catch (err) {
    console.error('downloadCarrierPaySchedulePdf error:', err);
    alert('Download error. Check console.');
  }
}
async function downloadCommissionManualPdf() {
  try {
    if (!accessToken) {
      alert('Missing session token. Please log in again.');
      return;
    }

    const res = await fetch(`/.netlify/functions/downloadCommissionManual`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!res.ok) {
      const t = await res.text();
      console.error('Commission Manual download failed:', res.status, t);
      alert('Download failed.');
      return;
    }

    const blob = await res.blob();

    const dispo = res.headers.get('Content-Disposition') || '';
    const match = dispo.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || 'Commission-Manual.pdf';

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  } catch (err) {
    console.error('downloadCommissionManualPdf error:', err);
    alert('Download error. Check console.');
  }
}
function initCommissionReportsPicker() {
  const input = document.getElementById('commission-report-range');
  if (!input) return;

  if (window.flatpickr) {
    reportsFp = window.flatpickr(input, {
      mode: 'range',
      dateFormat: 'Y-m-d',
      allowInput: false,
      onChange: (selectedDates) => {
        if (Array.isArray(selectedDates) && selectedDates.length) {
          const start = selectedDates[0] ? toISODate(selectedDates[0]) : null;
          const end = selectedDates[1] ? toISODate(selectedDates[1]) : start; // if only one clicked
          reportsStartISO = start;
          reportsEndISO = end;
        } else {
          reportsStartISO = null;
          reportsEndISO = null;
        }
      }
    });
  } else {
    input.addEventListener('change', () => {
      const { startISO, endISO } = parseDateRangeInput(input.value);
      reportsStartISO = startISO;
      reportsEndISO = endISO;
    });
  }

  const btn = document.getElementById('btn-download-commission-report');
  if (btn) {
    btn.addEventListener('click', async () => {
      await downloadCommissionReportPdf();
    });
  }
}

function showCommissionReportsPicker(show) {
  const picker = document.getElementById('commission-reports-picker');
  const table = document.getElementById('files-table');
  if (picker) picker.hidden = !show;
  if (table) table.style.display = show ? 'none' : '';
}

async function downloadCommissionReportPdf() {
  try {
    if (!accessToken) {
      alert('Missing session token. Please log in again.');
      return;
    }

    // Must have at least a start date; if user picked 1 day, end is auto-set to start
    if (!reportsStartISO) {
      alert('Select a date range first.');
      return;
    }
    const start_date = reportsStartISO;
    const end_date = reportsEndISO || reportsStartISO;

    const btn = document.getElementById('btn-download-commission-report');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating…`;
    }

    const res = await fetch('/.netlify/functions/generateCommissionReport', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ start_date, end_date })
    });

    if (!res.ok) {
      const t = await res.text();
      console.error('Commission report download failed:', res.status, t);
      alert('Report generation failed. Check console.');
      return;
    }

    const blob = await res.blob();

    // filename from header if present
    const dispo = res.headers.get('Content-Disposition') || '';
    const match = dispo.match(/filename="([^"]+)"/i);
    const filename =
      match?.[1] || `Commission-Statement-${start_date}_to_${end_date}.pdf`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(a.href);
    a.remove();
  } catch (err) {
    console.error('downloadCommissionReportPdf error:', err);
    alert('Download error. Check console.');
  } finally {
    const btn = document.getElementById('btn-download-commission-report');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-download"></i> Download`;
    }
  }
}
/* ===============================
   Tiny helpers
   =============================== */
function getNextFridayLabel() {
  const today = new Date();
  const day = today.getDay(); // 0 = Sun, 5 = Fri
  const diff = (5 - day + 7) % 7 || 7; // days until next Friday
  const next = new Date(today);
  next.setDate(today.getDate() + diff);
  return next.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getEndOfMonthLabel() {
  const today = new Date();
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return `$${num.toFixed(2)}`;
}

function formatStatus(status) {
  if (!status) return '—';
  const s = String(status).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function setTableAgentColumnVisible(tableId, visible) {
  const table = document.getElementById(tableId);
  if (!table) return;

  // hide/show anything marked as col-agent (best)
  const agentCells = table.querySelectorAll('.col-agent');
  if (agentCells.length) {
    agentCells.forEach(el => (el.style.display = visible ? '' : 'none'));
    return;
  }

  // fallback: last column
  const th = table.querySelector('thead th:last-child');
  if (th) th.style.display = visible ? '' : 'none';
  table.querySelectorAll('tbody tr').forEach(tr => {
    const td = tr.querySelector('td:last-child');
    if (td) td.style.display = visible ? '' : 'none';
  });
}
