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

  // ----- 3. Load commission overview (lead/chargeback debt, etc.) -----
  const overview = await loadAgentCommissionOverview();
  if (overview) {
    // Top snapshot / summary
    setText('summary-leads-balance', formatMoney(overview.lead_balance));
    setText('summary-chargeback-balance', formatMoney(overview.chargeback_balance));
    setText('summary-total-balance', formatMoney(overview.total_debt));

    // Balances & Debt panel
    setText('balances-leads-amount', formatMoney(overview.lead_balance));
    setText('balances-chargebacks-amount', formatMoney(overview.chargeback_balance));
    setText('balances-total-amount', formatMoney(overview.total_debt));
  } else {
    // Fallback to fake data if it fails
    renderPlaceholderSummary();
  }

  // ----- 4. Load real policy commissions for Policies tab -----
  await loadPoliciesTableFromSupabase();

  // ----- 5. Wire up tabs -----
  initTabs();

  // ----- 6. Wire up filters + chips + misc UI -----
  initPoliciesDateRange();
  initFilesChips();
  initTeamAgentPanelToggle();

  // ----- 7. Render placeholder data for other areas (for now) -----
  renderPlaceholderPayouts();
  renderPlaceholderLeadDebts();
  renderPlaceholderChargebacks();
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

  // Use real level if present; otherwise fall back
  if (levelEl) {
    let label = 'Level: Agent';
    if (profile?.level) {
      // e.g., "agent", "mit", "manager", "mga", "area_manager"
      const pretty = profile.level
        .split('_')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ');
      label = `Level: ${pretty}`;
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

/* ===============================
   Policies table from Supabase
   =============================== */

async function loadPoliciesTableFromSupabase() {
  const tbody = document.querySelector('#policies-table tbody');
  if (!tbody || !me) return;

  // Clear while loading
  tbody.innerHTML = `
    <tr>
      <td colspan="9">Loading policies…</td>
    </tr>
  `;

  const { data, error } = await supabase
    .from('policy_commission_preview')
    .select('*')
    .eq('agent_id', me.id)
    .order('policy_created_at', { ascending: false });

  if (error) {
    console.error('Error loading policy_commission_preview:', error);
    // fall back to placeholders so the table isn’t empty
    renderPlaceholderPolicies();
    return;
  }

  if (!data || !data.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">No policies found yet.</td>
      </tr>
    `;
    return;
  }

  const rowsHtml = data.map((row) => {
    // Dates: prefer submitted_at as "Written Date"; fall back to created_at
    const writtenDate = formatDate(row.written_date || row.policy_created_at);

    // Premium: show AP as “Premium” for now (could later show both modal + AP)
    const ap = Number(row.ap) || 0;

    // Advance
    const advance = Number(row.advance_commission) || 0;

    // Pay-thru: estimate YEAR 2 renewals, then monthly
    const { monthlyPayThru, yearlyPayThru } = estimatePayThruFromRule(row.ap, row.renewal_trail_rule);

    // Total commission = advance + estimated first-year renewals (simplified)
    const totalCommission = advance + yearlyPayThru;

    // Policyholder name is not in the view yet; we can pull from contacts later
    const placeholderName = '—';

    return `
      <tr>
        <td>${writtenDate}</td>
        <td>${placeholderName}</td>
        <td>${row.carrier_name || ''}</td>
        <td>${row.product_line || row.policy_type || ''}</td>
        <td>${formatMoney(ap)}</td>
        <td>${row.status || ''}</td>
        <td>${formatMoney(advance)}</td>
        <td>${formatMoney(monthlyPayThru)}</td>
        <td>${formatMoney(totalCommission)}</td>
      </tr>
    `;
  }).join('');

  tbody.innerHTML = rowsHtml;
}

/**
 * Use the renewal_trail_rule JSON to estimate renewals.
 * For now:
 * - Look at bands where year 2 is inside [start_year, end_year]
 * - Sum AP * rate for those bands = yearlyPayThru
 * - monthlyPayThru = yearlyPayThru / 12
 */
function estimatePayThruFromRule(ap, renewalRule) {
  const apNum = Number(ap) || 0;
  if (!apNum || !renewalRule) {
    return { yearlyPayThru: 0, monthlyPayThru: 0 };
  }

  let rule = renewalRule;
  if (typeof rule === 'string') {
    try {
      rule = JSON.parse(rule);
    } catch (e) {
      console.error('Error parsing renewal_trail_rule:', e);
      return { yearlyPayThru: 0, monthlyPayThru: 0 };
    }
  }

  const bands = Array.isArray(rule.bands) ? rule.bands : [];
  if (!bands.length) {
    return { yearlyPayThru: 0, monthlyPayThru: 0 };
  }

  // Consider YEAR 2 as the first renewal year
  const targetYear = 2;
  let yearly = 0;

  bands.forEach((band) => {
    const start = band.start_year ?? 1;
    const end = band.end_year ?? 99;
    const rate = Number(band.rate) || 0;
    if (targetYear >= start && targetYear <= end) {
      yearly += apNum * rate;
    }
  });

  const monthly = yearly / 12;
  return {
    yearlyPayThru: yearly,
    monthlyPayThru: monthly
  };
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
   (still used for other panels for now)
   =============================== */

function renderPlaceholderSummary() {
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
  setText('team-my-ap', '$6,400');
  setText('team-my-ap-period', 'Last 30 days');
  setText('team-direct-ap', '$12,800');
  setText('team-direct-count', '4 active agents');
  setText('team-overrides-amount', '$1,950.00');
  setText('team-overrides-period', 'Last 30 days');

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

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatMoney(value) {
  const num = Number(value) || 0;
  return `$${num.toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
