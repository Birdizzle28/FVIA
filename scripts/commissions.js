// scripts/commissions.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Same Supabase project as the rest of your CRM
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let me = null;        // supabase auth user
let myProfile = null; // row from agents table

document.addEventListener('DOMContentLoaded', async () => {
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
      .select('id, full_name, agent_id, is_admin, is_active')
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

  // ----- 3. Wire up tabs -----
  initTabs();

  // ----- 4. Wire up filters + chips + misc UI -----
  initPoliciesDateRange();
  initFilesChips();
  initTeamAgentPanelToggle();

  // ----- 5. Render placeholder data (we’ll replace with Supabase later) -----
  renderPlaceholderSummary();
  renderPlaceholderPayouts();
  renderPlaceholderBalances();
  renderPlaceholderLeadDebts();
  renderPlaceholderChargebacks();
  renderPlaceholderPolicies();
  renderPlaceholderTeam();
  renderPlaceholderFiles();
});

/* ===============================
   Header helpers
   =============================== */

function hydrateHeaderFromProfile(profile) {
  const nameEl = document.getElementById('comm-agent-name');
  const levelEl = document.getElementById('comm-level-label');
  const progressEl = document.getElementById('comm-level-progress-text');

  if (nameEl) {
    nameEl.textContent = profile?.full_name || 'Agent';
  }

  // We don’t have a real "level" column yet; placeholder until schema is ready
  if (levelEl) {
    const label = profile?.is_admin ? 'Level: Admin' : 'Level: Agent';
    levelEl.textContent = label;
  }

  if (progressEl) {
    progressEl.textContent = 'Level progress tracking coming soon.';
  }
}

/* ===============================
   Tabs logic
   =============================== */

function initTabs() {
  const tabButtons = document.querySelectorAll('.commissions-tabs .tab');
  const panels = document.querySelectorAll('.commissions-tabs .panel');

  if (!tabButtons.length || !panels.length) return;

  tabButtons.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      if (!target) return;

      // Update active class + aria-selected
      tabButtons.forEach(t => {
        const isActive = t === tab;
        t.classList.toggle('is-active', isActive);
        t.setAttribute('aria-selected', String(isActive));
      });

      // Show only matching panel
      panels.forEach(panel => {
        const idMatch = panel.id === `panel-${target}`;
        panel.classList.toggle('is-active', idMatch);
        if (idMatch) {
          panel.removeAttribute('hidden');
        } else {
          panel.setAttribute('hidden', 'true');
        }
      });
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
   Placeholder data generators
   (we’ll replace these later with Supabase queries)
   =============================== */

function renderPlaceholderSummary() {
  // Just a soft example so the page doesn’t look dead.
  const leads = 320;
  const chargebacks = 180;
  const total = leads + chargebacks;

  setText('summary-leads-balance', `$${leads.toFixed(2)}`);
  setText('summary-chargeback-balance', `$${chargebacks.toFixed(2)}`);
  setText('summary-total-balance', `$${total.toFixed(2)}`);

  setText('summary-next-advance-amount', '$1,250.00');
  setText('summary-next-advance-date', '(Next Friday)');
  setText('summary-next-paythru-amount', '$780.00');
  setText('summary-next-paythru-date', '(End of month)');

  setText('next-advance-amount', '$1,250.00');
  setText('next-advance-date', 'Pays on: Next Friday');
  setText('next-paythru-amount', '$780.00');
  setText('next-paythru-date', 'Pays on: End of month');
}

function renderPlaceholderPayouts() {
  const tbody = document.querySelector('#payouts-table tbody');
  if (!tbody) return;

  const rows = [
    { date: '2025-11-21', type: 'Advance',  period: 'Weekly',   amount: 1250.00, source: 'FVG', details: '3 issued policies' },
    { date: '2025-10-31', type: 'Pay-Thru', period: 'Monthly',  amount: 780.00,  source: 'FVG', details: 'Trails + renewals' },
    { date: '2025-10-15', type: 'Bonus',    period: 'Quarterly',amount: 500.00,  source: 'Carrier', details: 'Production bonus' }
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

function renderPlaceholderBalances() {
  setText('balances-leads-amount', '$320.00');
  setText('balances-leads-count', '4 open items');
  setText('balances-chargebacks-amount', '$180.00');
  setText('balances-chargebacks-count', '2 open items');
  setText('balances-total-amount', '$500.00');
  setText('balances-total-note', 'Projected after next payouts: $120.00');
}

function renderPlaceholderLeadDebts() {
  const tbody = document.querySelector('#lead-debts-table tbody');
  if (!tbody) return;

  const rows = [
    { date: '2025-11-05', type: 'Facebook Final Expense', source: 'FVG', cost: 25.00, status: 'Unpaid' },
    { date: '2025-11-10', type: 'Inbound Call',           source: 'FVG', cost: 35.00, status: 'In repayment' },
    { date: '2025-11-12', type: 'Direct Mail',            source: 'Vendor', cost: 40.00, status: 'Unpaid' },
    { date: '2025-11-15', type: 'Online Form',            source: 'Website', cost: 20.00, status: 'Paid' }
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
    // Clear any existing (keep the first "Select agent…" option)
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
   Tiny helper
   =============================== */

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
