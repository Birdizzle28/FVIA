// scripts/commissions.js
let me = null;        // supabase auth user
let myProfile = null; // row from agents table

// We'll keep these in sync with Supabase so all UI uses the same numbers
let leadBalance = 0;
let chargebackBalance = 0;

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

  // ----- 2. Load my agent profile (for name + "level" label) -----
  try {
    const { data: profile, error: profErr } = await supabase
      .from('agents')
      .select('id, full_name, agent_id, is_admin, is_active, level')
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
  if (!overview) {
    // if overview fails, still give placeholders for balances/payouts
    renderPlaceholderSummary();
  }

  // 🔹 NEW: load upcoming payouts (advance + pay-thru)
  const previews = await loadNextPayoutsFromPreviews();
   
   if (!previews?.weekly && !previews?.monthly && !overview) {
     renderPlaceholderSummary();
   }

  // ----- 4. Wire up tabs & basic UI -----
  initTabs();
  initPoliciesDateRange();
  initFilesChips();
  initTeamAgentPanelToggle();

  // ----- 5. Load REAL lead debts + chargebacks -----
  await loadAndRenderLeadDebts();
  await loadAndRenderChargebacks();

  // ----- 6. Load REAL policy commissions for this agent -----
  await loadAndRenderPolicies();

  // ----- 7. Still use placeholder data for payouts, team, files (for now) -----
  await loadAndRenderPayouts();
  renderPlaceholderTeam();
  renderPlaceholderFiles();
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
  return next.toISOString().slice(0, 10);
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
  const res = await fetch(url, { method: 'POST' });
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

function updateBalancesUI() {
  const totalDebt = leadBalance + chargebackBalance;

  // Top summary
  setText('summary-leads-balance', formatMoney(leadBalance));
  setText('summary-chargeback-balance', formatMoney(chargebackBalance));
  setText('summary-total-balance', formatMoney(totalDebt));

  // Balances tab
  setText('balances-leads-amount', formatMoney(leadBalance));
  setText('balances-chargebacks-amount', formatMoney(chargebackBalance));
  setText('balances-total-amount', formatMoney(totalDebt));
}

/* ===============================
   Tabs logic
   =============================== */

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
    window.flatpickr(input, {
      mode: 'range',
      dateFormat: 'Y-m-d'
    });
  }
}

function initFilesChips() {
  const chipsWrap = document.getElementById('files-type-chips');
  if (!chipsWrap) return;

  chipsWrap.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;

    const type = btn.getAttribute('data-doc-type') || 'all';

    // Active state
    chipsWrap.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('is-active', chip === btn);
    });

    // Filter files table rows by data-doc-type attribute
    const tbody = document.querySelector('#files-table tbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('tr'));
    rows.forEach(row => {
      const rowType = row.getAttribute('data-doc-type') || 'other';
      const shouldShow = type === 'all' || rowType === type;
      row.style.display = shouldShow ? '' : 'none';
    });
  });
}

function initTeamAgentPanelToggle() {
  const select = document.getElementById('team-agent-select');
  const wrapper = document.getElementById('team-individual-wrapper');
  const title = document.getElementById('team-individual-title');
  const tableBody = document.querySelector('#team-individual-table tbody');

  if (!select || !wrapper || !tableBody) return;

  // Show/hide on change
  select.addEventListener('change', () => {
    const val = select.value;
    if (!val) {
      wrapper.hidden = true;
      tableBody.innerHTML = '';
      return;
    }

    wrapper.hidden = false;
    // For now, just simple placeholder details. Later we’ll fetch from Supabase.
    title.textContent = `Agent Detail – ${select.options[select.selectedIndex].text || 'Agent'}`;
    tableBody.innerHTML = `
      <tr>
        <td>AP (Last 30 Days)</td>
        <td>$4,200</td>
      </tr>
      <tr>
        <td>Leads Balance</td>
        <td>$320.00</td>
      </tr>
      <tr>
        <td>Chargebacks</td>
        <td>$180.00</td>
      </tr>
      <tr>
        <td>Overrides You Earned</td>
        <td>$540.00</td>
      </tr>
    `;
  });
}

/* ===============================
   REAL lead debts + chargebacks
   =============================== */

async function loadAndRenderLeadDebts() {
  if (!me) return;

  const tbody = document.querySelector('#lead-debts-table tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('lead_debts')
      .select('id, created_at, description, source, amount, status')
      .eq('agent_id', me.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading lead_debts:', error);
      renderPlaceholderLeadDebts();
      return;
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No lead debt records found.</td></tr>`;
    } else {
      tbody.innerHTML = data.map(row => {
        const date = row.created_at
          ? new Date(row.created_at).toLocaleDateString()
          : '—';
        const type = row.description || 'Lead';
        const source = row.source || 'FVG';
        const amount = Number(row.amount || 0);
        const status = formatStatus(row.status);

        return `
          <tr>
            <td>${date}</td>
            <td>${escapeHtml(type)}</td>
            <td>${escapeHtml(source)}</td>
            <td>${formatMoney(amount)}</td>
            <td>${escapeHtml(status)}</td>
          </tr>
        `;
      }).join('');
    }

    // Compute open balances/count from the same data
    let openCount = 0;
    let openTotal = 0;
    data.forEach(row => {
      const status = (row.status || '').toLowerCase();
      if (status === 'open' || status === 'in_repayment') {
        openCount += 1;
        openTotal += Number(row.amount || 0);
      }
    });

    leadBalance = openTotal;
    setText(
      'balances-leads-count',
      `${openCount} open item${openCount === 1 ? '' : 's'}`
    );

    // Re-sync summary + balances with new number
    updateBalancesUI();
  } catch (err) {
    console.error('Unexpected error in loadAndRenderLeadDebts:', err);
    renderPlaceholderLeadDebts();
  }
}

async function loadAndRenderChargebacks() {
  if (!me) return;

  const tbody = document.querySelector('#chargebacks-table tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('policy_chargebacks')
      .select('id, created_at, carrier_name, policyholder_name, amount, status')
      .eq('agent_id', me.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading policy_chargebacks:', error);
      renderPlaceholderChargebacks();
      return;
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5">No chargebacks found.</td></tr>`;
    } else {
      tbody.innerHTML = data.map(row => {
        const date = row.created_at
          ? new Date(row.created_at).toLocaleDateString()
          : '—';
        const carrier = row.carrier_name || '—';
        const name = row.policyholder_name || '—';
        const amount = Number(row.amount || 0);
        const status = formatStatus(row.status);

        return `
          <tr>
            <td>${date}</td>
            <td>${escapeHtml(carrier)}</td>
            <td>${escapeHtml(name)}</td>
            <td>${formatMoney(amount)}</td>
            <td>${escapeHtml(status)}</td>
          </tr>
        `;
      }).join('');
    }

    // Compute open chargeback balance + count
    let openCount = 0;
    let openTotal = 0;
    data.forEach(row => {
      const status = (row.status || '').toLowerCase();
      if (status === 'open' || status === 'in_repayment') {
        openCount += 1;
        openTotal += Number(row.amount || 0);
      }
    });

    chargebackBalance = openTotal;
    setText(
      'balances-chargebacks-count',
      `${openCount} open item${openCount === 1 ? '' : 's'}`
    );

    // Re-sync summary + balances with new number
    updateBalancesUI();
  } catch (err) {
    console.error('Unexpected error in loadAndRenderChargebacks:', err);
    renderPlaceholderChargebacks();
  }
}

/* ===============================
   REAL Policies & Details
   =============================== */

async function loadAndRenderPolicies() {
  if (!me) return;

  const tbody = document.querySelector('#policies-table tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('agent_policy_commissions_view')
      .select(
        'policy_id, agent_id, written_at, policyholder_name, carrier_name, product_line, status, ap, advance_amount, renewal_amount, total_commission'
      )
      .eq('agent_id', me.id)
      .order('written_at', { ascending: false });

    if (error) {
      console.error('Error loading agent_policy_commissions_view:', error);
      renderPlaceholderPolicies(); // fallback if view/policy_commissions not ready yet
      return;
    }

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9">No policy commissions found for you yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map(row => {
      const writtenDate = row.written_at
        ? new Date(row.written_at).toLocaleDateString()
        : '—';
      const name = row.policyholder_name || '—';
      const carrier = row.carrier_name || '—';
      const product = row.product_line || '—';
      const premium = Number(row.ap || 0);
      const status = formatStatus(row.status);
      const adv = Number(row.advance_amount || 0);
      const paythru = Number(row.renewal_amount || 0);
      const total = Number(row.total_commission || 0);

      return `
        <tr>
          <td>${writtenDate}</td>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(carrier)}</td>
          <td>${escapeHtml(product)}</td>
          <td>${formatMoney(premium)}</td>
          <td>${escapeHtml(status)}</td>
          <td>${formatMoney(adv)}</td>
          <td>${formatMoney(paythru)}</td>
          <td>${formatMoney(total)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Unexpected error in loadAndRenderPolicies:', err);
    renderPlaceholderPolicies();
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
  // Just a soft example so the page doesn’t look dead.
  const leads = 320;
  const chargebacks = 180;
  leadBalance = leads;
  chargebackBalance = chargebacks;

  updateBalancesUI();

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

  // Populate the "Individual Agent" select with the same placeholder names
  const select = document.getElementById('team-agent-select');
  if (select) {
    const keepFirst = select.querySelector('option:first-child');
    select.innerHTML = '';
    if (keepFirst) select.appendChild(keepFirst);

    ['Agent Alpha', 'Agent Bravo', 'Agent Charlie'].forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = `agent-${idx + 1}`;
      opt.textContent = name;
      select.appendChild(opt);
    });
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
      name: '1099 - 2024',
      type: '1099',
      group: '1099',
      period: 'Tax Year 2024',
      source: 'FVG',
      uploaded: '2025-01-31'
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
