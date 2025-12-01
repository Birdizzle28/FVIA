import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let statPicker;
let userId = null;
let userRole = null;
let allAgents = [];
let selectedLeads = new Set();
let currentPage = 1;
const PAGE_SIZE = 25;
let rangeStart = null;
let rangeEnd = null;
let allowedProductsFilter = null;
// ---- KPI helpers ----
const DAY_MS = 864e5;
const PERSISTENCY_DAYS = 90;

const safeDiv = (num, den) => (den > 0 ? num / den : NaN);
const fmtPct  = v => Number.isFinite(v) ? (Math.round(v * 1000) / 10) + '%' : '—';

const getStage = l => String(l.status || l.stage || '').toLowerCase();
const isContacted = l => !!l.contact_at || ['contacted','quoted','closed'].includes(getStage(l));
const isQuoted = l => !!l.quote_at || ['quoted','closed'].includes(getStage(l));
const isClosed = l => !!(l.issued_at || l.closed_at) || ['closed','issued','policy'].includes(getStage(l));
const issuedAt = l => l.issued_at ? new Date(l.issued_at) : (l.closed_at ? new Date(l.closed_at) : null);
const inRange = (d, start, end) => { if (!d) return false; const t = +d; return (!start || t >= +start) && (!end || t <= +end); };
const policyModal = document.getElementById('policy-modal');
const adjustmentModal = document.getElementById('adjustment-modal');
const openPolicyBtn = document.getElementById('open-policy-modal');
const openAdjustmentBtn = document.getElementById('open-debit-credit-modal');
const policyCancelBtn = document.getElementById('policy-cancel');
const adjustmentCancelBtn = document.getElementById('adjustment-cancel');

function openModal(el) {
  if (el) el.style.display = 'flex';
}

function closeModal(el) {
  if (el) el.style.display = 'none';
}
let commissionAgentsLoaded = false;

async function loadAgentsForCommissions(force = false) {
  if (commissionAgentsLoaded && !force) return;

  const { data, error } = await supabase
    .from('agents')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error loading agents for commissions', error);
    return;
  }

  const selects = [
    document.getElementById('policy-agent'),
    document.getElementById('adjustment-agent'),
  ];

  selects.forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '<option value="">Select agent…</option>';
    data.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.full_name || agent.id;
      sel.appendChild(opt);
    });
  });

  commissionAgentsLoaded = true;
}
openPolicyBtn?.addEventListener('click', async () => {
  await loadAgentsForCommissions();
  openModal(policyModal);
});

openAdjustmentBtn?.addEventListener('click', async () => {
  await loadAgentsForCommissions();
  openModal(adjustmentModal);
});

policyCancelBtn?.addEventListener('click', () => closeModal(policyModal));
adjustmentCancelBtn?.addEventListener('click', () => closeModal(adjustmentModal));

async function loadPoliciesIntoList() {
  const container = document.getElementById('policy-list');
  if (!container) return;
  container.textContent = 'Loading...';

  const { data, error } = await supabase
    .from('policies')
    .select('id, policy_number, carrier, product, annual_premium, issue_date')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error loading policies', error);
    container.textContent = 'Error loading policies.';
    return;
  }

  if (!data || data.length === 0) {
    container.textContent = 'No policies yet.';
    return;
  }

  container.innerHTML = '';
  data.forEach(row => {
    const div = document.createElement('div');
    div.className = 'mini-row';
    const prem = typeof row.annual_premium === 'number'
      ? row.annual_premium.toFixed(2)
      : row.annual_premium;
    div.textContent = `${row.policy_number} – ${row.carrier} (${row.product}) – $${prem} – ${row.issue_date}`;
    container.appendChild(div);
  });
}

const policyForm = document.getElementById('policy-form');
policyForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('policy-error');
  if (errorEl) errorEl.textContent = '';

  const agent_id = document.getElementById('policy-agent').value || null;
  const carrier = document.getElementById('policy-carrier').value.trim();
  const product = document.getElementById('policy-product').value.trim();
  const policy_number = document.getElementById('policy-number').value.trim();
  const annual_premium = parseFloat(
    document.getElementById('policy-annual-premium').value || '0'
  );
  const issue_date = document.getElementById('policy-issue-date').value;
  const status = document.getElementById('policy-status').value;

  if (!agent_id || !carrier || !product || !policy_number || !issue_date || !annual_premium) {
    if (errorEl) errorEl.textContent = 'Please fill in all required fields.';
    return;
  }

  const { error } = await supabase
    .from('policies')
    .insert([{
      agent_id,
      carrier,
      product,
      policy_number,
      annual_premium,
      issue_date,
      status,
    }]);

  if (error) {
    console.error('Error inserting policy', error);
    if (errorEl) errorEl.textContent = 'Error saving policy.';
    return;
  }

  policyForm.reset();
  closeModal(policyModal);
  loadPoliciesIntoList();
});

async function loadAdjustmentsIntoList() {
  const container = document.getElementById('debit-credit-list');
  if (!container) return;
  container.textContent = 'Loading...';

  const { data, error } = await supabase
    .from('agent_adjustments')
    .select('id, type, category, amount, effective_date')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error loading debits/credits', error);
    container.textContent = 'Error loading debits / credits.';
    return;
  }

  if (!data || data.length === 0) {
    container.textContent = 'No debits or credits yet.';
    return;
  }

  container.innerHTML = '';
  data.forEach(row => {
    const div = document.createElement('div');
    div.className = 'mini-row';
    const sign = row.type === 'credit' ? '+' : '-';
    const amt = typeof row.amount === 'number' ? row.amount.toFixed(2) : row.amount;
    div.textContent = `${sign}$${amt} — ${row.category} (${row.effective_date})`;
    container.appendChild(div);
  });
}

const adjustmentForm = document.getElementById('adjustment-form');
adjustmentForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('adjustment-error');
  if (errorEl) errorEl.textContent = '';

  const agent_id = document.getElementById('adjustment-agent').value || null;
  const type = document.getElementById('adjustment-type').value;
  const category = document.getElementById('adjustment-category').value;
  const amount = parseFloat(
    document.getElementById('adjustment-amount').value || '0'
  );
  const effective_date = document.getElementById('adjustment-date').value;
  const description = document.getElementById('adjustment-description').value.trim();

  if (!agent_id || !type || !category || !effective_date || !amount) {
    if (errorEl) errorEl.textContent = 'Please fill in all required fields.';
    return;
  }

  const { error } = await supabase
    .from('agent_adjustments')
    .insert([{
      agent_id,
      type,
      category,
      amount,
      effective_date,
      description,
    }]);

  if (error) {
    console.error('Error inserting adjustment', error);
    if (errorEl) errorEl.textContent = 'Error saving debit/credit.';
    return;
  }

  adjustmentForm.reset();
  closeModal(adjustmentModal);
  loadAdjustmentsIntoList();
});

// NEW: interpret task metadata/title as contact / quote / close
function getTaskStage(task) {
  const meta = task.metadata || {};

  let raw = (meta.stage || meta.type || meta.kind || '').toString().toLowerCase();

  if (!raw) {
    const title = (task.title || '').toLowerCase();
    if (title.includes('quote')) raw = 'quote';
    else if (
      title.includes('app') ||
      title.includes('application') ||
      title.includes('issue') ||
      title.includes('close') ||
      title.includes('sale') ||
      title.includes('policy')
    ) {
      raw = 'close';
    } else if (
      title.includes('call') ||
      title.includes('contact') ||
      title.includes('vm') ||
      title.includes('voice') ||
      title.includes('text') ||
      title.includes('sms')
    ) {
      raw = 'contact';
    }
  }

  if (raw.startsWith('contact')) return 'contact';
  if (raw.startsWith('quote'))   return 'quote';
  if (raw.startsWith('close') || raw.startsWith('sale') || raw.startsWith('issue')) return 'close';

  return '';
}

// ===== Helpers for announcements =====
async function uploadAnnouncementImage(file, me) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `annc_${me || 'anon'}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('announcements').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'application/octet-stream'
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('announcements').getPublicUrl(path);
  return data?.publicUrl || null;
}
async function uploadTaskImage(file, me) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `task_${me || 'anon'}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('tasks').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'application/octet-stream'
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('tasks').getPublicUrl(path);
  return data?.publicUrl || null;
}

function summarizeAudience(aud) {
  if (!aud || !aud.scope) return 'All users';

  const levelLabels = {
    agent: 'Agent',
    mit: 'MIT',
    manager: 'Manager',
    mga: 'MGA',
    area_manager: 'Area Manager'
  };

  switch (aud.scope) {
    case 'admins':
      return 'Admins only';

    case 'by_product': {
      const prods = (aud.products || []).join(', ') || '—';
      return `Products: ${prods}`;
    }

    case 'by_state': {
      const states = (aud.states || []).join(', ') || '—';
      return `States: ${states}`;
    }

    case 'by_level': {
      const lvls = (aud.levels || []).map(v => levelLabels[v] || v);
      return `Levels: ${lvls.join(', ') || '—'}`;
    }

    case 'by_product_state': {
      const prods = (aud.products || []).join(', ') || 'Any';
      const states = (aud.states || []).join(', ') || 'Any';
      return `Products: ${prods} · States: ${states}`;
    }

    case 'custom_agents':
      return `Agents: ${(aud.agent_ids || []).length}`;

    default:
      return 'All users';
  }
}

function populateStatAgentSelect() {
  const sel = document.getElementById('stat-agent');
  if (!sel) return;
  sel.innerHTML = '<option value="">All agents</option>';
  allAgents.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.full_name;
    sel.appendChild(opt);
  });
  try { new Choices(sel, { shouldSort:false, searchEnabled:true, itemSelectText:'' }); } catch(_) {}
}

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  userId = session.user.id;

  const { data: profile } = await supabase.from('agents').select('is_admin').eq('id', userId).single();
  if (!profile || profile.is_admin !== true) {
    location.replace('dashboard.html'); // no alert, no history entry
    return;
  }
  userRole = 'admin';

  flatpickr('#date-range', { mode:'range', dateFormat:'Y-m-d',
    onChange: (ds)=>{ rangeStart = ds[0]?.toISOString().split('T')[0] || null; rangeEnd = ds[1]?.toISOString().split('T')[0] || null; loadLeadsWithFilters(); }
  });
  new Choices('#state-filter', { searchEnabled:true, itemSelectText:'' });

  await loadAgentsForAdmin();
  await populateRecruiterSelect();
  populateTaskAgentSelect();

  // Populate Announcement multi-selects
  (function hydrateAnncProducts(){
    const sel = document.getElementById('annc-products');
    if (!sel) return;

    const products = ['Life', 'Health', 'Property', 'Casualty'];

    products.forEach(p => {
      const o = document.createElement('option');
      o.value = p;
      o.textContent = p;
      sel.appendChild(o);
    });

    try {
      new Choices(sel, {
        removeItemButton: true,
        shouldSort: false,
        searchEnabled: false
      });
    } catch (_) {}
  })();
    (function hydrateAnncLevels(){
    const sel = document.getElementById('annc-levels');
    if (!sel) return;

    const levels = [
      { value: 'agent',        label: 'Agent' },
      { value: 'mit',          label: 'MIT' },
      { value: 'manager',      label: 'Manager' },
      { value: 'mga',          label: 'MGA' },
      { value: 'area_manager', label: 'Area Manager' }
    ];

    levels.forEach(l => {
      const o = document.createElement('option');
      o.value = l.value;
      o.textContent = l.label;
      sel.appendChild(o);
    });

    try {
      new Choices(sel, {
        removeItemButton: true,
        shouldSort: false,
        searchEnabled: false
      });
    } catch (_) {}
  })();
  (function hydrateAnncAgents(){
    const sel = document.getElementById('annc-agent-ids'); if (!sel) return;
    (allAgents||[]).forEach(a => { const o=document.createElement('option'); o.value=a.id; o.textContent=a.full_name; sel.appendChild(o); });
    try { new Choices(sel, { removeItemButton:true, shouldSort:true, searchEnabled:true }); } catch(_) {}
  })();
  (function enhanceAnncStates(){
    const sel = document.getElementById('annc-states'); if (!sel) return;
    try { new Choices(sel, { removeItemButton:true, shouldSort:true, searchEnabled:true }); } catch(_) {}
  })();

  populateStatAgentSelect();
  await loadLeadsWithFilters();
  await loadRequestedLeads();
  await loadAssignmentHistory();
  await loadAnnouncements(); // NEW: load list on page load

  (function initStatRange(){
    const thirtyDaysAgo = new Date(Date.now() - 30*864e5);
    statPicker = flatpickr('#stat-range-wrap', {
      mode:'range', dateFormat:'Y-m-d', defaultDate:[thirtyDaysAgo, new Date()], wrap:true,
      onChange:()=>{ if (!document.getElementById('stat-all-time').checked) loadAgentStats(); }
    });
    const allCb = document.getElementById('stat-all-time');
    allCb.addEventListener('change', ()=> {
      const disabled = allCb.checked;
      document.getElementById('stat-range').disabled = disabled;
      document.querySelector('#stat-range-wrap .calendar-btn').disabled = disabled;
      loadAgentStats();
    });
  })();
  document.getElementById('stat-agent')?.addEventListener('change', loadAgentStats);
  document.getElementById('stat-range')?.addEventListener('change', loadAgentStats);

  // Filter changes
  document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => el.addEventListener('change', loadLeadsWithFilters));
  document.getElementById('apply-filters').addEventListener('click', () => loadLeadsWithFilters());
  document.getElementById('reset-filters').addEventListener('click', () => {
    document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => { if (el.tagName==='SELECT') el.selectedIndex=0; else el.value=''; });
    rangeStart = null; rangeEnd = null; allowedProductsFilter = null; loadLeadsWithFilters();
  });

  // Table sorting
  let currentSortColumn = null, currentSortDirection = 'asc';
  document.querySelectorAll('#leads-table th[data-column]').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.getAttribute('data-column');
      if (currentSortColumn === column) currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
      else { currentSortColumn = column; currentSortDirection = 'asc'; }
      document.getElementById('sort-by').value = column;
      document.getElementById('date-order').value = currentSortDirection;
      loadLeadsWithFilters();
    });
  });

  // Bulk assign
  document.getElementById('bulk-assign-agent').addEventListener('change', e => {
    const agentId = e.target.value;
    selectedLeads = new Set(Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => cb.dataset.leadId));
    if (!agentId) { allowedProductsFilter = null; return; }
    const agent = allAgents.find(a => a.id === agentId);
    if (agent && agent.product_types) {
      if (Array.isArray(agent.product_types)) {
        allowedProductsFilter = agent.product_types.slice();
      } else {
        allowedProductsFilter = String(agent.product_types).split(',').map(s=>s.trim()).filter(Boolean);
      }
    } else {
      allowedProductsFilter = null;
    }
  });

  document.getElementById('bulk-assign-btn').addEventListener('click', async () => {
    const selectedIds = Array.from(selectedLeads);
    if (!selectedIds.length) { alert('⚠️ No leads selected'); return; }
    const agentId = document.getElementById('bulk-assign-agent').value;
    if (!agentId) { alert('⚠️ No agent selected'); return; }
    const agentInfo = allAgents.find(a => a.id === agentId);
    if (agentInfo && Array.isArray(agentInfo.product_types) && agentInfo.product_types.length) {
      let ineligibleFound = false;
      for (let id of selectedLeads) {
        const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
        const product = row?.querySelector('.lead-product')?.textContent.trim();
        if (product && !agentInfo.product_types.includes(product)) { ineligibleFound = true; break; }
      }
      if (ineligibleFound) { alert('❌ One or more selected leads have product types this agent is not eligible for.'); return; }
    }
    const needsReassignConfirm = selectedIds.some(id => {
      const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
      const currentAgent = row?.querySelector('td:nth-child(3)')?.textContent;
      return currentAgent && currentAgent !== 'Unassigned';
    });
    if (needsReassignConfirm) document.getElementById('reassign-warning-modal').style.display = 'flex';
    else { alert('✅ Assigning leads…'); await assignLeads(agentId); }
  });
  document.getElementById('submit-anyway-btn').addEventListener('click', async () => {
    const agentId = document.getElementById('bulk-assign-agent').value;
    await assignLeads(agentId);
    document.getElementById('reassign-warning-modal').style.display = 'none';
  });
  document.getElementById('cancel-reassign-btn').addEventListener('click', () => {
    document.getElementById('reassign-warning-modal').style.display = 'none';
  });

  // Export dropdown toggle
  const exportBtn = document.getElementById('export-btn');
  const exportOptions = document.getElementById('export-options');
  if (exportBtn && exportOptions) {
    exportBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      exportOptions.style.display = (exportOptions.style.display === 'block') ? 'none' : 'block';
    });
    exportOptions.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { exportOptions.style.display = 'none'; });
  }
  ['export-csv','export-pdf','export-print'].forEach(id => document.getElementById(id)?.addEventListener('click', () => { exportOptions.style.display = 'none'; }));

  // CSV
  document.getElementById('export-csv').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) { alert('No leads selected.'); return; }
    const headers = Object.keys(leads[0]).join(',');
    const rows = leads.map(lead => Object.values(lead).map(v => `"${v}"`).join(','));
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'leads.csv'; link.click();
  });
  // Print
  document.getElementById('export-print').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) { alert('No leads selected.'); return; }
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head>
        <link href="https://fonts.googleapis.com/css2?family=Bellota+Text&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Bellota Text', sans-serif; padding: 30px; text-align: center; }
          .logo { width: 60px; height: 60px; object-fit: contain; display: block; margin: 0 auto 10px auto; }
          .label { display: inline-block; font-weight: bold; width: 150px; text-align: right; margin-right: 10px; }
          .value { display: inline-block; text-align: left; }
          p { text-align: left; margin: 6px 0 6px 100px; }
          .footer { margin-top: 30px; font-size: 10px; text-align: center; color: #777; }
          .lead-page { page-break-after: always; }
        </style>
        </head><body>
        ${leads.map(lead => `
          <div class="lead-page">
            <img src="/Pics/img6.png" class="logo" />
            <h2>Family Values Insurance Agency</h2>
            <h4>Lead Confirmation Form</h4>
            <p><span class="label">First Name:</span> <span class="value">${lead.first_name}</span></p>
            <p><span class="label">Last Name:</span> <span class="value">${lead.last_name}</span></p>
            <p><span class="label">Age:</span> <span class="value">${lead.age}</span></p>
            <p><span class="label">Phone:</span> <span class="value">${lead.phone}</span></p>
            <p><span class="label">Lead Type:</span> <span class="value">${lead.leadType}</span></p>
            <p><span class="label">City:</span> <span class="value">${lead.city}</span></p>
            <p><span class="label">State:</span> <span class="value">${lead.state}</span></p>
            <p><span class="label">ZIP:</span> <span class="value">${lead.zip}</span></p>
            <p><span class="label">Address:</span> <span class="value">${lead.address}</span></p>
            <p><span class="label">Agent Assigned:</span> <span class="value">${lead.agent}</span></p>
            <p><span class="label">Submitted At:</span> <span class="value">${lead.submittedAt}</span></p>
            <div class="footer">Generated on ${new Date().toLocaleDateString()}</div>
          </div>
        `).join('')}
      </body></html>
    `);
    win.document.close(); win.print();
  });
  // PDF
  document.getElementById('export-pdf').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) { alert('No leads selected.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logoImg = new Image(); logoImg.src = '/Pics/img6.png';
    logoImg.onload = () => {
      leads.forEach((lead, i) => {
        if (i) doc.addPage();
        doc.addImage(logoImg, 'PNG', 90, 10, 30, 30);
        doc.setFontSize(18); doc.setFont('helvetica', 'bold');
        doc.text('Family Values Insurance Agency', 105, 50, { align: 'center' });
        doc.setFontSize(14); doc.setFont('helvetica', 'normal');
        doc.text('Lead Confirmation Form', 105, 60, { align: 'center' });
        const startY = 80, lineH = 10, labelX = 20, valueX = 70;
        const fields = [
          ['First Name', lead.first_name], ['Last Name', lead.last_name], ['Age', lead.age],
          ['Phone', lead.phone], ['Lead Type', lead.leadType], ['City', lead.city],
          ['State', lead.state], ['ZIP', lead.zip], ['Address', lead.address],
          ['Agent Assigned', lead.agent], ['Submitted At', lead.submittedAt]
        ];
        fields.forEach(([label, value], idx) => {
          const y = startY + idx * lineH; doc.setFont('helvetica', 'bold'); doc.text(`${label}:`, labelX, y);
          doc.setFont('helvetica', 'normal'); doc.text(value || '—', valueX, y);
        });
        doc.setFontSize(10); doc.setTextColor(120);
        doc.text(`Generated on ${new Date().toLocaleDateString()}`, 105, 285, { align: 'center' });
      });
      doc.save('FVIA_Leads.pdf');
    };
    logoImg.onerror = () => alert('❌ Failed to load logo for PDF.');
  });

    const navButtons = {
    all: document.getElementById('nav-all'),
    requests: document.getElementById('nav-requests'),
    history: document.getElementById('nav-history'),
    stats: document.getElementById('nav-stats'),
    commissions: document.getElementById('nav-commissions'),
    content: document.getElementById('nav-content'),
  };

  const sections = {
    all: document.getElementById('admin-all-section'),
    requests: document.getElementById('admin-requests-section'),
    history: document.getElementById('admin-history-section'),
    stats: document.getElementById('admin-stats-section'),
    commissions: document.getElementById('admin-commissions-section'),
    content: document.getElementById('admin-content-section'),
  };
  
    function hideAllAdminSections() {
    Object.values(sections).forEach(sec => {
      if (sec) sec.style.display = 'none';
    });
    Object.values(navButtons).forEach(btn => {
      if (btn) btn.classList.remove('active');
    });
  }

  function showAdminSection(name) {
    hideAllAdminSections();
    if (sections[name]) {
      sections[name].style.display = 'block';
    }
    if (navButtons[name]) {
      navButtons[name].classList.add('active');
    }

    if (name === 'history') {
      loadAssignmentHistory();
    }
    if (name === 'stats') {
      loadAgentStats();
    }
    if (name === 'content') {
      loadAnnouncements();
      loadTrainingMaterials();
      loadMarketingAssets();
      loadWaitlist();
    }
    if (name === 'commissions') {
      loadAgentsForCommissions();
      loadPoliciesIntoList();
      loadAdjustmentsIntoList();
      // loadPayoutBatchesIntoList(); // when we build this in step 3
    }
  }

  showAdminSection('all');
  navButtons.all?.addEventListener('click', () => showAdminSection('all'));
  navButtons.requests?.addEventListener('click', () => showAdminSection('requests'));
  navButtons.history?.addEventListener('click', () => showAdminSection('history'));
  navButtons.stats?.addEventListener('click', () => showAdminSection('stats'));
  navButtons.commissions?.addEventListener('click', () => showAdminSection('commissions'));
  navButtons.content?.addEventListener('click', () => showAdminSection('content'));

  // Overlays
  document.getElementById('open-annc-modal')?.addEventListener('click', () => openOverlay('annc-modal'));
  document.getElementById('open-train-modal')?.addEventListener('click', () => openOverlay('train-modal'));
  document.getElementById('open-mkt-modal')?.addEventListener('click', () => openOverlay('mkt-modal'));
  document.getElementById('open-agent-modal')?.addEventListener('click', () => openOverlay('agent-modal'));
  document.getElementById('open-remove-agent-modal')?.addEventListener('click', () => openOverlay('remove-agent-modal'));
  document.getElementById('open-task-modal')?.addEventListener('click', () => openOverlay('task-modal'));
  function openOverlay(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
  }
  function closeOverlay(el){
    el.classList.remove('open');
    el.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }
  document.querySelectorAll('.overlay [data-close], .overlay .overlay-backdrop').forEach(btn=>{
    btn.addEventListener('click', (e)=> {
      const wrap = e.target.closest('.overlay');
      if (wrap) closeOverlay(wrap);
    });
  });

    try {
      flatpickr('#annc-publish', { enableTime:true, dateFormat:'Y-m-d H:i' });
      flatpickr('#annc-expires', { enableTime:true, dateFormat:'Y-m-d H:i' });
      flatpickr('#annc-repeat-end', { enableTime:true, dateFormat:'Y-m-d H:i' });
    } catch(_) {}
    
    try {
      flatpickr('#task-due', {
        enableTime: true,
        dateFormat: 'Y-m-d H:i'
      });
    } catch (_) {}
  
    // Announcements list collapse toggle
    const anncListEl   = document.getElementById('annc-list');
    const anncToggleEl = document.getElementById('toggle-annc-list');
    if (anncListEl && anncToggleEl) {
      anncToggleEl.addEventListener('click', () => {
        const isHidden = anncListEl.hasAttribute('hidden');
        if (isHidden) {
          anncListEl.removeAttribute('hidden');
          anncToggleEl.setAttribute('aria-expanded', 'true');
          anncToggleEl.querySelector('i')?.classList.replace('fa-chevron-down', 'fa-chevron-up');
        } else {
          anncListEl.setAttribute('hidden', '');
          anncToggleEl.setAttribute('aria-expanded', 'false');
          anncToggleEl.querySelector('i')?.classList.replace('fa-chevron-up', 'fa-chevron-down');
        }
      });
    }

  const scopeSel     = document.getElementById('annc-scope');
  const wrapProducts = document.getElementById('annc-products-wrap');
  const wrapStates   = document.getElementById('annc-states-wrap');
  const wrapAgents   = document.getElementById('annc-agents-wrap');
  const wrapLevels   = document.getElementById('annc-levels-wrap');

  function refreshAudienceUI() {
    if (!scopeSel) return;
    const v = scopeSel.value;

    if (wrapProducts) {
      wrapProducts.style.display =
        (v === 'by_product' || v === 'by_product_state') ? 'block' : 'none';
    }

    if (wrapStates) {
      wrapStates.style.display =
        (v === 'by_state' || v === 'by_product_state') ? 'block' : 'none';
    }

    if (wrapAgents) {
      wrapAgents.style.display = (v === 'custom_agents') ? 'block' : 'none';
    }

    if (wrapLevels) {
      wrapLevels.style.display = (v === 'by_level') ? 'block' : 'none';
    }
  }

  scopeSel?.addEventListener('change', refreshAudienceUI);
  refreshAudienceUI();

  // === Announcements (Create/Upload) ===
  document.getElementById('annc-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const msg = document.getElementById('annc-msg');
    msg.textContent = '';

    const { data: { session } } = await supabase.auth.getSession();
    const me = session?.user?.id;

    const title   = document.getElementById('annc-title').value.trim();
    const body    = document.getElementById('annc-body').value.trim();
    const linkUrl = document.getElementById('annc-link').value.trim() || null;
    const imgFile = document.getElementById('annc-image').files[0] || null;

    const scope     = document.getElementById('annc-scope').value;
    const publishAt = document.getElementById('annc-publish').value.trim() || null;
    const expiresAt = document.getElementById('annc-expires').value.trim() || null;

    const repeatFreq = document.getElementById('annc-repeat')?.value || 'none';
    const repeatEnd  = document.getElementById('annc-repeat-end')?.value.trim() || null;

    const audience = { scope };

    if (scope === 'by_product') {
      audience.products = Array.from(
        document.getElementById('annc-products')?.selectedOptions || []
      ).map(o => o.value);
    }

    if (scope === 'by_state') {
      audience.states = Array.from(
        document.getElementById('annc-states')?.selectedOptions || []
      ).map(o => o.value);
    }

    if (scope === 'by_level') {
      audience.levels = Array.from(
        document.getElementById('annc-levels')?.selectedOptions || []
      ).map(o => o.value);
    }

    if (scope === 'by_product_state') {
      audience.products = Array.from(
        document.getElementById('annc-products')?.selectedOptions || []
      ).map(o => o.value);

      audience.states = Array.from(
        document.getElementById('annc-states')?.selectedOptions || []
      ).map(o => o.value);
    }

    if (scope === 'custom_agents') {
      audience.agent_ids = Array.from(
        document.getElementById('annc-agent-ids')?.selectedOptions || []
      ).map(o => o.value);
    }

    // Store recurrence info inside the audience JSON so no new DB columns are needed
    if (repeatFreq && repeatFreq !== 'none') {
      audience.repeat = {
        frequency: repeatFreq,
        until: repeatEnd ? new Date(repeatEnd).toISOString() : null
      };
    }

    let image_url = null;
    try {
      if (imgFile) {
        image_url = await uploadAnnouncementImage(imgFile, me);
      }
    } catch (err) {
      msg.textContent = '❌ Image upload failed: ' + (err?.message || err);
      return;
    }

    const { error } = await supabase.from('announcements').insert({
      title,
      body,
      link_url: linkUrl || null,
      image_url: image_url || null,
      created_by: me || null,
      audience,
      publish_at: publishAt ? new Date(publishAt).toISOString() : null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      is_active: true
    });

    if (error) {
      msg.textContent = '❌ ' + error.message;
      return;
    }

    msg.textContent = '✅ Saved.';
    await loadAnnouncements();

    setTimeout(() => {
      document.querySelector('#annc-modal .overlay-close')?.click();
    }, 600);

    // reset form
    e.target.reset();
  });
  document.getElementById('train-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('train-msg');
    if (msg) msg.textContent = '';

    const titleEl = document.getElementById('train-title');
    const descEl = document.getElementById('train-desc');
    const urlEl  = document.getElementById('train-url');
    const tagsEl = document.getElementById('train-tags');

    const title = titleEl?.value.trim() || '';
    const description = descEl?.value.trim() || '';
    const url = urlEl?.value.trim() || '';
    const rawTags = tagsEl?.value.trim() || '';

    if (!title) {
      if (msg) msg.textContent = 'Title is required.';
      return;
    }

    const tags = rawTags
      ? rawTags.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    const payload = {
      title,
      description: description || null,
      url: url || null,
      tags,
      created_by: userId || null,
      is_published: true
    };

    const { error } = await supabase.from('training_materials').insert(payload);
    if (error) {
      if (msg) msg.textContent = '❌ ' + error.message;
      return;
    }

    if (msg) msg.textContent = '✅ Training item saved.';

    await loadTrainingMaterials();

    e.target.reset();

    setTimeout(() => {
      document.querySelector('#train-modal [data-close]')?.click();
      if (msg) msg.textContent = '';
    }, 700);
  });
  
  // Admin creates a task for an agent (with optional image)
  document.getElementById('admin-task-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('task-msg');
    if (msg) msg.textContent = '';

    const agentId = document.getElementById('task-agent')?.value || '';
    const title   = document.getElementById('task-title')?.value.trim() || '';
    const body    = document.getElementById('task-body')?.value.trim() || '';
    const linkUrl = document.getElementById('task-link')?.value.trim() || '';
    const dueRaw  = document.getElementById('task-due')?.value.trim() || '';
    const imgFile = document.getElementById('task-image')?.files[0] || null;

    if (!agentId || !title) {
      if (msg) msg.textContent = '⚠️ Choose an agent and enter a task title.';
      return;
    }

    let dueAt = null;
    if (dueRaw) {
      const d = new Date(dueRaw.replace(' ', 'T'));
      if (!isNaN(d.getTime())) {
        dueAt = d.toISOString();
      }
    }

    // who is creating the task
    const { data: { session } } = await supabase.auth.getSession();
    const createdBy = session?.user?.id || userId || null;

    // Build metadata (used when listing tasks)
    const metadata = {
      created_by: createdBy,
      source: 'admin_panel'
    };
    if (body) {
      metadata.notes = body;
    }
    if (linkUrl) {
      metadata.link_url = linkUrl;
    }

    // 🔹 Upload task image if present
    if (imgFile) {
      try {
        const imageUrl = await uploadTaskImage(imgFile, createdBy);
        if (imageUrl) {
          metadata.image_url = imageUrl;
        }
      } catch (err) {
        console.error('Task image upload failed:', err);
        if (msg) msg.textContent = '❌ Task image upload failed. Please try again.';
        return;
      }
    }

    const payload = {
      assigned_to: agentId,
      title,
      status: 'open',
      due_at: dueAt,
      metadata
    };

    const { error } = await supabase.from('tasks').insert(payload);

    if (error) {
      console.error('Error creating task:', error);
      if (msg) msg.textContent = '❌ Could not create task: ' + error.message;
      return;
    }

    if (msg) msg.textContent = '✅ Task created and assigned.';

    // Reset fields but keep agent selected
    document.getElementById('task-title').value = '';
    document.getElementById('task-body').value = '';
    document.getElementById('task-link').value = '';
    document.getElementById('task-due').value = '';
    const imgInput = document.getElementById('task-image');
    if (imgInput) imgInput.value = '';

    // If the manage panel is open, refresh the list
    const taskPanelEl = document.getElementById('task-list-panel');
    if (taskPanelEl && !taskPanelEl.hasAttribute('hidden')) {
      loadMyTasks();
    }
  });
  
  document.getElementById('mkt-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('mkt-msg');
    if (msg) msg.textContent = '';

    const titleEl = document.getElementById('mkt-title');
    const descEl  = document.getElementById('mkt-desc');
    const urlEl   = document.getElementById('mkt-url');
    const tagsEl  = document.getElementById('mkt-tags');

    const title = titleEl?.value.trim() || '';
    const description = descEl?.value.trim() || '';
    const url = urlEl?.value.trim() || '';
    const rawTags = tagsEl?.value.trim() || '';

    if (!title) {
      if (msg) msg.textContent = 'Title is required.';
      return;
    }

    const tags = rawTags
      ? rawTags.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    const { data: { session } } = await supabase.auth.getSession();
    const created_by = session?.user?.id || userId || null;

    const payload = {
      title,
      description: description || null,
      url: url || null,
      file_url: null,
      tags,
      created_by,
      is_published: true
    };

    const { error } = await supabase.from('marketing_assets').insert(payload);
    if (error) {
      if (msg) msg.textContent = '❌ ' + error.message;
      return;
    }

    if (msg) msg.textContent = '✅ Asset saved.';

    e.target.reset();

    setTimeout(() => {
      document.querySelector('#mkt-modal [data-close]')?.click();
      if (msg) msg.textContent = '';
    }, 700);
  });
  
  // Pagination buttons
  const nextBtn = document.getElementById('next-page');
  const prevBtn = document.getElementById('prev-page');
  nextBtn?.addEventListener('click', async () => { currentPage++; await loadLeadsWithFilters(); });
  prevBtn?.addEventListener('click', async () => { if (currentPage > 1) { currentPage--; await loadLeadsWithFilters(); } });

  document.getElementById('agent-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('agent-msg');
    if (msg) msg.textContent = '';
  
    const npn         = document.getElementById('agent-id')?.value.trim() || '';
    const firstName   = document.getElementById('agent-first-name')?.value.trim() || '';
    const lastName    = document.getElementById('agent-last-name')?.value.trim() || '';
    const phone       = document.getElementById('agent-phone')?.value.trim() || '';
    const email       = document.getElementById('agent-email')?.value.trim() || '';
    const recruiterId = document.getElementById('agent-recruiter')?.value || '';
    const level       = document.getElementById('agent-level')?.value || '';
  
    if (!npn || !firstName || !lastName || !email || !recruiterId || !level) {
      if (msg) msg.textContent = '⚠️ Fill out NPN, name, email, level, and recruiter.';
      return;
    }
  
    // 1) Try to match a recruit row by recruiter + name
    let recruitId = null;
    try {
      const { data: recruitMatch, error: recErr } = await supabase
        .from('recruits')
        .select('id')
        .eq('recruiter_id', recruiterId)
        .ilike('first_name', firstName)
        .ilike('last_name', lastName)
        .maybeSingle();
  
      if (recErr && recErr.code !== 'PGRST116') {
        console.error('Error checking recruits:', recErr);
      }
      if (recruitMatch?.id) {
        recruitId = recruitMatch.id;
      }
    } catch (err) {
      console.error('Unexpected error looking up recruit:', err);
    }
  
    // 2) Add/Update in agent_waitlist (ONLY waitlist here)
    const waitlistPayload = {
      agent_id: npn,
      first_name: firstName,
      last_name: lastName,
      phone,
      email,
      recruiter_id: recruiterId,
      level,
      recruit_id: recruitId || null
      // flags default to false via schema
    };
  
    const { error: waitErr } = await supabase
      .from('agent_waitlist')
      .upsert(waitlistPayload, { onConflict: 'agent_id' });
  
    if (waitErr) {
      console.error('Error saving to agent_waitlist:', waitErr);
      if (msg) msg.textContent = '❌ Could not save to pre-approval waitlist: ' + waitErr.message;
      return;
    }
  
    if (msg) msg.textContent =
      '✅ Added to pre-approval waitlist. Syncing NIPR and sending ICA…';
  
    // Refresh the waitlist UI if Content tab is open
    try { loadWaitlist(); } catch (_) {}
  
    // 3) NIPR sync + parse (licenses lookup)
    try {
      const syncRes = await fetch('/.netlify/functions/nipr-sync-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: npn })
      });
  
      if (!syncRes.ok) {
        const txt = await syncRes.text();
        console.error('NIPR sync error:', txt);
        if (msg) msg.textContent = '⚠️ On waitlist, but NIPR sync failed. Check logs.';
        return;
      }
  
      const syncJson = await syncRes.json();
      console.log('NIPR sync result:', syncJson);
  
      const parseRes = await fetch('/.netlify/functions/nipr-parse-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: npn })
      });
  
      if (!parseRes.ok) {
        const txt = await parseRes.text();
        console.error('NIPR parse error:', txt);
        if (msg) msg.textContent = '⚠️ On waitlist & synced, but parse failed. Check logs.';
        return;
      }
  
      const parseJson = await parseRes.json();
      console.log('NIPR parse result:', parseJson);
    } catch (err) {
      console.error('Error calling NIPR functions:', err);
      if (msg) msg.textContent =
        '⚠️ On waitlist, but there was an error syncing NIPR data.';
      return;
    }
  
    // 4) Send ICA via Netlify + SignWell (NO approved_agents yet)
    try {
      const icaRes = await fetch('/.netlify/functions/send-ica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: npn,
          email,
          first_name: firstName,
          last_name: lastName,
          level,
          approved_agent_id: null   // keep field name for compatibility
        })
      });
  
      if (!icaRes.ok) {
        const txt = await icaRes.text();
        console.error('ICA send error:', txt);
        if (msg) msg.textContent = '⚠️ NIPR ok, but ICA send failed. Check logs.';
        return;
      }
  
      const icaJson = await icaRes.json();
      console.log('ICA send result:', icaJson);
      if (msg) msg.textContent =
        '🎉 Pre-approved, NIPR synced, and ICA sent for e-sign.';
    } catch (err) {
      console.error('Error calling send-ica function:', err);
      if (msg) msg.textContent =
        '⚠️ NIPR ok, but there was an error sending ICA.';
      return;
    }
  
    setTimeout(() => {
      document.querySelector('#agent-modal [data-close]')?.click();
    }, 900);
  });
}); // end DOMContentLoaded

// Load active agents
// Load active agents
async function loadAgentsForAdmin() {
  let { data, error } = await supabase
    .from('agents')
    .select('id, full_name, product_types')
    .eq('is_active', true);

  if (error) {
    console.error('Error loading agents (primary):', error);
    const { data: dataFallback, error: err2 } = await supabase
      .from('agents')
      .select('id, full_name')
      .eq('is_active', true);
    if (err2) {
      console.error('Error loading agents (fallback):', err2);
      return;
    }
    data = dataFallback;
  }

  // 🔍 DEBUG: see exactly which agents are visible to this logged-in admin
  console.log('loadAgentsForAdmin → data:', data);
  window._agentsDebug = data; // so you can inspect in the console

  allAgents = data || [];

  allAgents.forEach(agent => {
    if (agent.product_types) {
      if (Array.isArray(agent.product_types)) {
        // ok
      } else if (typeof agent.product_types === 'string') {
        agent.product_types = agent.product_types
          .split(',')
          .map(s => s.trim());
      } else {
        agent.product_types = null;
      }
    }
  });

  const agentFilterEl = document.getElementById('agent-filter');
  const bulkAssignEl  = document.getElementById('bulk-assign-agent');

  agentFilterEl.innerHTML = '<option value="">All Agents</option>';
  bulkAssignEl.innerHTML  = '<option value="">Select Agent</option>';

  allAgents.forEach(agent => {
    const opt1 = document.createElement('option');
    opt1.value = agent.id;
    opt1.textContent = agent.full_name;
    agentFilterEl.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = agent.id;
    opt2.textContent = agent.full_name;
    bulkAssignEl.appendChild(opt2);
  });

  new Choices(agentFilterEl, {
    shouldSort: false,
    searchEnabled: true,
    placeholder: true,
    itemSelectText: ''
  });

  new Choices(bulkAssignEl, {
    shouldSort: false,
    searchEnabled: true,
    placeholder: true,
    itemSelectText: ''
  });
}

function populateRecruiterSelect() {
  const sel = document.getElementById('agent-recruiter');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select recruiter…</option>';
  (allAgents || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.full_name || a.id;
    sel.appendChild(opt);
  });
}
function populateTaskAgentSelect() {
  const sel = document.getElementById('task-agent');
  if (!sel) return;

  sel.innerHTML = '<option value="">Select agent…</option>';

  (allAgents || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id; // agents.id (matches auth.uid)
    opt.textContent = a.full_name || a.id;
    sel.appendChild(opt);
  });
}

// Leads table
async function loadLeadsWithFilters() {
  const tbody = document.querySelector('#leads-table tbody'); if (!tbody) return;
  const prevSelection = new Set(selectedLeads);
  tbody.innerHTML = ''; document.getElementById('selected-count').textContent = '0';

  let query = supabase.from('leads').select('*', { count: 'exact' });
  const orderDir = document.getElementById('date-order').value;
  const sortBy = document.getElementById('sort-by').value || 'created_at';
  const agentVal = document.getElementById('agent-filter').value;
  const zip = document.getElementById('zip-filter').value.trim();
  const city = document.getElementById('city-filter').value.trim();
  const state = document.getElementById('state-filter').value;
  const first = document.getElementById('first-name-filter').value.trim();
  const last = document.getElementById('last-name-filter').value.trim();
  const type = document.getElementById('lead-type-filter').value;
  const assignedVal = document.getElementById('assigned-filter').value;

  if (agentVal) query = query.eq('assigned_to', agentVal);
  if (rangeStart) query = query.gte('created_at', rangeStart);
  if (rangeEnd) query = query.lte('created_at', rangeEnd);
  if (zip) query = query.ilike('zip', `%${zip}%`);
  if (city) query = query.ilike('city', `%${city}%`);
  if (state) query = query.ilike('state', `%${state}%`);
  if (first) query = query.ilike('first_name', `%${first}%`);
  if (last) query = query.ilike('last_name', `%${last}%`);
  if (type) query = query.ilike('product_type', `%${type}%`);
  if (assignedVal === 'true') query = query.not('assigned_to', 'is', null);
  else if (assignedVal === 'false') query = query.is('assigned_to', null);

  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data: leads, error, count } = await query.order(sortBy, { ascending: orderDir === 'asc' }).range(from, to);
  if (error) {
    console.error('Error loading leads:', error);
    tbody.innerHTML = '<tr><td colspan="14">Error loading leads.</td></tr>';
    return;
  }

  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  document.getElementById('current-page').textContent = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('prev-page').disabled = currentPage <= 1;
  document.getElementById('next-page').disabled = currentPage >= totalPages;

  (leads || []).forEach(lead => {
    const tr = document.createElement('tr');
    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.classList.add('lead-checkbox'); checkbox.dataset.leadId = lead.id;
    checkbox.addEventListener('change', e => {
      const id = String(lead.id);
      if (e.target.checked) selectedLeads.add(id); else selectedLeads.delete(id);
      document.getElementById('selected-count').textContent = selectedLeads.size;
      toggleExportVisibility();
    });
    checkboxTd.appendChild(checkbox); tr.appendChild(checkboxTd);
    if (prevSelection.has(String(lead.id))) { checkbox.checked = true; selectedLeads.add(String(lead.id)); }
    const agentName = lead.assigned_to ? (allAgents.find(a => a.id === lead.assigned_to)?.full_name || 'Unassigned') : 'Unassigned';
    const cellMap = {
      'lead-date': new Date(lead.created_at).toLocaleDateString(),
      'lead-agent': agentName,
      'lead-name': lead.first_name || '',
      'lead-last': lead.last_name || '',
      'lead-age': lead.age || '',
      'lead-phone': (lead.phone || []).join(', '),
      'lead-address': lead.address || '',
      'lead-city': lead.city || '',
      'lead-state': lead.state || '',
      'lead-zip': lead.zip || '',
      'lead-type': lead.lead_type || '',
      'lead-notes': lead.notes || '',
      'lead-product': lead.product_type || ''
    };
    for (const [cls, text] of Object.entries(cellMap)) {
      const td = document.createElement('td');
      td.classList.add(cls);
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  document.getElementById('selected-count').textContent = String(selectedLeads.size);
  toggleExportVisibility();
}

const selectAllBox = document.getElementById('select-all');
selectAllBox?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.lead-checkbox').forEach(cb => {
    cb.checked = checked;
    cb.dispatchEvent(new Event('change'));
  });
});

// Requests
async function loadRequestedLeads() {
  const container = document.getElementById('requested-leads-container');
  if (!container) return;
  container.innerHTML = 'Loading...';
  const { data: requests, error } = await supabase.from('lead_requests').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error loading requests:', error);
    container.innerHTML = '<p>Error loading requests.</p>';
    return;
  }
  if (!requests?.length) {
    container.innerHTML = '<p>No lead requests found.</p>';
    return;
  }
  container.innerHTML = requests.map(req => `
    <div class="lead-request-box" data-request-id="${req.id}">
      <strong>Requested By:</strong> ${req.submitted_by_name || 'Unknown'}<br>
      <strong>City:</strong> ${req.city || 'N/A'}<br>
      <strong>ZIP:</strong> ${req.zip || 'N/A'}<br>
      <strong>State:</strong> ${req.state || 'N/A'}<br>
      <strong>Lead Type:</strong> ${req.lead_type || 'N/A'}<br>
      <strong>How many:</strong> ${req.requested_count || 'N/A'}<br>
      <strong>Notes:</strong> ${req.notes || 'None'}<br>
      <em>Submitted: ${req.created_at ? new Date(req.created_at).toLocaleString() : 'N/A'}</em><br>
      <button class="delete-request-btn">Delete</button>
      <hr>
    </div>
  `).join('');
  document.querySelectorAll('.delete-request-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const box = e.target.closest('.lead-request-box');
      const requestId = box?.getAttribute('data-request-id');
      if (!requestId) return;
      if (!confirm('Are you sure you want to delete this request?')) return;
      const { error: deleteError } = await supabase.from('lead_requests').delete().eq('id', requestId);
      if (deleteError) {
        alert('❌ Failed to delete request.');
        console.error(deleteError);
      } else {
        box.remove();
        alert('✅ Request deleted.');
      }
    });
  });
}

// Assignment history
async function loadAssignmentHistory() {
  const tbody = document.querySelector('#assignment-history-table tbody');
  if (!tbody) return;
  tbody.innerHTML = 'Loading...';
  const { data: history, error } = await supabase.from('lead_assignments')
    .select(`lead_id, assigned_at, assigned_to_agent:assigned_to(full_name), assigned_by_agent:assigned_by(full_name)`)
    .order('assigned_at', { ascending: false });
  if (error) {
    console.error('Error loading history:', error);
    tbody.innerHTML = '<tr><td colspan="4">Error loading history.</td></tr>';
    return;
  }
  if (!history?.length) {
    tbody.innerHTML = '<tr><td colspan="4">No assignment history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  history.forEach(entry => {
    const tr = document.createElement('tr');
    const assignedToName = entry.assigned_to_agent?.full_name || entry.assigned_to;
    const assignedByName = entry.assigned_by_agent?.full_name || entry.assigned_by;
    tr.innerHTML = `
      <td>${entry.assigned_at ? new Date(entry.assigned_at).toLocaleString() : ''}</td>
      <td>${entry.lead_id}</td>
      <td>${assignedToName}</td>
      <td>${assignedByName}</td>
    `;
    tbody.appendChild(tr);
  });
}

let chartWeekly, chartProducts, chartAssignments;

async function loadAgentStats() {
  const isAll = document.getElementById('stat-all-time')?.checked === true;
  const agentId = document.getElementById('stat-agent')?.value || '';

  // destroy existing charts
  chartWeekly?.destroy();
  chartProducts?.destroy();
  chartAssignments?.destroy();

  // ----- Date window -----
  let start = null;
  let end   = null;

  if (!isAll) {
    const dates = statPicker?.selectedDates || [];
    if (dates.length === 2) {
      [start, end] = dates;
    } else {
      end = new Date();
      start = new Date(end.getTime() - 30 * DAY_MS);
    }
  }

  const startISO = start ? start.toISOString() : null;
  const endISO   = end
    ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).toISOString()
    : null;

  // ----- Build queries -----
  let leadsQ = supabase.from('leads').select('*');
  if (!isAll && startISO && endISO) {
    leadsQ = leadsQ.gte('created_at', startISO).lte('created_at', endISO);
  }
  if (agentId) {
    leadsQ = leadsQ.eq('assigned_to', agentId);
  }

  // Only completed tasks count for contact/quote stats
  let tasksQ = supabase.from('tasks').select('*').eq('status', 'completed');
  if (!isAll && startISO && endISO) {
    tasksQ = tasksQ.gte('completed_at', startISO).lte('completed_at', endISO);
  }
  if (agentId) {
    tasksQ = tasksQ.eq('assigned_to', agentId);
  }

  // Policies for close rate & persistency
  let policiesQ = supabase.from('policies').select('*');
  if (!isAll && startISO && endISO) {
    policiesQ = policiesQ.gte('issued_at', startISO).lte('issued_at', endISO);
  }
  if (agentId) {
    policiesQ = policiesQ.eq('agent_id', agentId);
  }

  const [
    { data: leads,    error: leadErr },
    { data: tasks,    error: taskErr },
    { data: policies, error: polErr }
  ] = await Promise.all([leadsQ, tasksQ, policiesQ]);

  if (leadErr) {
    console.error('Stats load error (leads):', leadErr);
    return;
  }
  if (taskErr) {
    console.error('Stats load error (tasks):', taskErr);
  }
  if (polErr) {
    console.error('Stats load error (policies):', polErr);
  }

  const leadsArr    = leads    || [];
  const tasksArr    = tasks    || [];
  const policiesArr = policies || [];

  // ----- Basic lead KPIs (same idea as before) -----
  const kNew = leadsArr.length;

  const assignedInWindow = leadsArr.filter(l => {
    if (!l.assigned_to || !l.assigned_at) return false;
    if (isAll) return true;
    const t = new Date(l.assigned_at).getTime();
    return t >= start.getTime() && t <= new Date(endISO).getTime();
  });

  const kAssigned = assignedInWindow.length;

  const ages = leadsArr
    .map(l => Number(l.age))
    .filter(n => Number.isFinite(n) && n > 0);
  const avgAge = ages.length
    ? (ages.reduce((a, b) => a + b, 0) / ages.length)
    : NaN;

  const distinctAgents = new Set(
    assignedInWindow.map(l => l.assigned_to).filter(Boolean)
  );
  const kAgents = distinctAgents.size;

  document.getElementById('kpi-new').textContent      = String(kNew);
  document.getElementById('kpi-assigned').textContent = String(kAssigned);
  document.getElementById('kpi-avg-age').textContent  =
    Number.isFinite(avgAge) ? (Math.round(avgAge * 10) / 10) : '—';
  document.getElementById('kpi-agents').textContent   = String(kAgents);

  // ----- Contact / Quote / Close via tasks + policies -----
  const baseDen = leadsArr.length;
  let contactedCount = 0;
  let quotedCount    = 0;
  let closedCount    = 0;

  const contactLeadIds = new Set();
  const quoteLeadIds   = new Set();
  const closedLeadIds  = new Set();

  // From tasks
  tasksArr.forEach(t => {
    const stage  = getTaskStage(t);
    const leadId = t.lead_id;
    if (!leadId) return;

    if (stage === 'contact') {
      contactLeadIds.add(leadId);
    }
    if (stage === 'quote') {
      contactLeadIds.add(leadId);
      quoteLeadIds.add(leadId);
    }
    if (stage === 'close') {
      contactLeadIds.add(leadId);
      quoteLeadIds.add(leadId);
      closedLeadIds.add(leadId);
    }
  });

  // From policies (any issued policy counts as closed)
  policiesArr.forEach(p => {
    const leadId = p.lead_id;
    if (!leadId) return;
    if (p.issued_at) {
      closedLeadIds.add(leadId);
    }
  });

  if (baseDen > 0) {
    contactedCount = leadsArr.filter(l => contactLeadIds.has(l.id)).length;
    quotedCount    = leadsArr.filter(
      l => quoteLeadIds.has(l.id) || closedLeadIds.has(l.id)
    ).length;
    closedCount    = leadsArr.filter(l => closedLeadIds.has(l.id)).length;
  }

  const contactRate = safeDiv(contactedCount, baseDen);
  const quoteRate   = safeDiv(quotedCount, baseDen);
  const closeRate   = safeDiv(closedCount, baseDen);

  // ----- Persistency 90-day (policies) -----
  const now = Date.now();
  const persistCandidates = policiesArr.filter(p => {
    if (!p.issued_at) return false;
    const ia = new Date(p.issued_at);

    if (!isAll && start && end && !inRange(ia, start, new Date(endISO))) {
      return false;
    }

    return (now - ia.getTime()) >= PERSISTENCY_DAYS * DAY_MS;
  });

  const persistentPolicies = persistCandidates.filter(p => {
    const status = (p.status || '').toLowerCase();
    return !['cancelled', 'canceled', 'terminated', 'lapsed'].includes(status);
  });

  const persistency = safeDiv(
    persistentPolicies.length,
    persistCandidates.length
  );

  document.getElementById('kpi-contact').textContent     = fmtPct(contactRate);
  document.getElementById('kpi-quote').textContent       = fmtPct(quoteRate);
  document.getElementById('kpi-close').textContent       = fmtPct(closeRate);
  document.getElementById('kpi-persistency').textContent = fmtPct(persistency);

  // ----- Weekly/monthly new leads chart (still based on leads) -----
  let timeLabels;
  let timeCounts;
  let chartLineLabel;

  if (isAll) {
    const nowD = new Date();
    const monthStarts = Array.from({ length: 12 }, (_, i) =>
      new Date(nowD.getFullYear(), nowD.getMonth() - (11 - i), 1)
    );
    const monthCounts = new Array(12).fill(0);

    for (const l of leadsArr) {
      const dt = new Date(l.created_at);
      const base = monthStarts[0];
      const diffMonths =
        (dt.getFullYear() - base.getFullYear()) * 12 +
        (dt.getMonth() - base.getMonth());
      if (diffMonths >= 0 && diffMonths < 12) {
        monthCounts[diffMonths]++;
      }
    }

    timeLabels = monthStarts.map(d =>
      `${d.toLocaleString('default', { month: 'short' })} ${String(
        d.getFullYear()
      ).slice(-2)}`
    );
    timeCounts     = monthCounts;
    chartLineLabel = 'Monthly New Leads';
  } else {
    const totalDays = Math.max(
      1,
      Math.round((+new Date(endISO) - +start) / DAY_MS) + 1
    );
    const useMonthly = totalDays > 120;

    if (useMonthly) {
      const monthStarts = [];
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const last   = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= last) {
        monthStarts.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      const monthCounts = new Array(monthStarts.length).fill(0);
      for (const l of leadsArr) {
        const dt = new Date(l.created_at);
        const idx = monthStarts.findIndex(
          m =>
            dt.getFullYear() === m.getFullYear() &&
            dt.getMonth() === m.getMonth()
        );
        if (idx !== -1) monthCounts[idx]++;
      }
      timeLabels = monthStarts.map(d =>
        `${d.toLocaleString('default', { month: 'short' })} ${String(
          d.getFullYear()
        ).slice(-2)}`
      );
      timeCounts     = monthCounts;
      chartLineLabel = 'Monthly New Leads';
    } else {
      const weekMs       = 7 * DAY_MS;
      const bucketCount  = Math.min(
        24,
        Math.max(1, Math.ceil(totalDays / 7))
      );
      const bucketStarts = Array.from({ length: bucketCount }, (_, i) =>
        new Date(start.getTime() + i * weekMs)
      );
      const weeklyCounts = new Array(bucketCount).fill(0);

      for (const l of leadsArr) {
        const t = new Date(l.created_at).getTime();
        const idx = Math.floor((t - start.getTime()) / weekMs);
        if (idx >= 0 && idx < bucketCount) weeklyCounts[idx]++;
      }

      timeLabels = bucketStarts.map(d =>
        `${String(d.getMonth() + 1).padStart(2, '0')}/${String(
          d.getDate()
        ).padStart(2, '0')}`
      );
      timeCounts     = weeklyCounts;
      chartLineLabel = 'Weekly New Leads';
    }
  }

  const weeklyTitleEl = document
    .querySelector('#chart-weekly')
    ?.previousElementSibling;
  if (weeklyTitleEl) {
    weeklyTitleEl.textContent = chartLineLabel;
  }

  // ----- Product mix (prefer policies; fall back to leads) -----
  const productCounts = {};

  if (policiesArr.length) {
    policiesArr.forEach(p => {
      const key =
        (p.product_line || p.policy_type || 'Unknown').trim() || 'Unknown';
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

  // ----- Assignments by agent (same concept as before) -----
  const nameById = new Map(allAgents.map(a => [a.id, a.full_name]));
  const assigns  = {};
  for (const l of assignedInWindow) {
    const id = l.assigned_to || 'Unknown';
    assigns[id] = (assigns[id] || 0) + 1;
  }
  const assignLabels = Object.keys(assigns).map(
    id => nameById.get(id) || 'Unassigned/Unknown'
  );
  const assignValues = Object.keys(assigns).map(id => assigns[id]);

  // ----- Build charts -----
  const weeklyCtx = document.getElementById('chart-weekly').getContext('2d');
  chartWeekly = new Chart(weeklyCtx, {
    type: 'line',
    data: {
      labels: timeLabels,
      datasets: [
        {
          label: chartLineLabel,
          data: timeCounts,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });

  const productsCtx = document.getElementById('chart-products').getContext('2d');
  chartProducts = new Chart(productsCtx, {
    type: 'doughnut',
    data: {
      labels: productLabels,
      datasets: [
        {
          data: productValues
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } }
    }
  });

  const assignsCtx = document
    .getElementById('chart-assignments')
    .getContext('2d');
  chartAssignments = new Chart(assignsCtx, {
    type: 'bar',
    data: {
      labels: assignLabels,
      datasets: [
        {
          label: 'Assignments',
          data: assignValues
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    }
  });
}

// Toggle export UI
function toggleExportVisibility() {
  const anyChecked = document.querySelectorAll('input.lead-checkbox:checked').length > 0;
  document.getElementById('export-controls').style.display = anyChecked ? 'block' : 'none';
}
function getSelectedLeadsData() {
  return Array.from(document.querySelectorAll('input.lead-checkbox:checked')).map(cb => {
    const row = cb.closest('tr');
    return {
      first_name: row.querySelector('.lead-name')?.textContent.trim() || '',
      last_name: row.querySelector('.lead-last')?.textContent.trim() || '',
      age: row.querySelector('.lead-age')?.textContent.trim() || '',
      phone: row.querySelector('.lead-phone')?.textContent.trim() || '',
      leadType: row.querySelector('.lead-type')?.textContent.trim() || '',
      city: row.querySelector('.lead-city')?.textContent.trim() || '',
      state: row.querySelector('.lead-state')?.textContent.trim() || '',
      zip: row.querySelector('.lead-zip')?.textContent.trim() || '',
      address: row.querySelector('.lead-address')?.textContent.trim() || '',
      agent: row.querySelector('.lead-agent')?.textContent.trim() || '',
      submittedAt: row.querySelector('.lead-date')?.textContent.trim() || ''
    };
  });
}
async function assignLeads(agentId) {
  if (!agentId || selectedLeads.size === 0) {
    alert('Please select leads and an agent.');
    return;
  }
  const leadIds = Array.from(selectedLeads);
  const now = new Date().toISOString();
  const { error: updateError } = await supabase.from('leads').update({
    assigned_to: agentId,
    assigned_at: now
  }).in('id', leadIds);
  if (updateError) {
    alert('❌ Failed to assign leads: ' + updateError.message);
    return;
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const currentUserId = sessionData?.session?.user?.id || userId;
  const logs = leadIds.map(leadId => ({
    lead_id: leadId,
    assigned_to: agentId,
    assigned_by: currentUserId,
    assigned_at: now
  }));
  const { error: logError } = await supabase.from('lead_assignments').insert(logs);
  if (logError) {
    alert('⚠️ Leads assigned, but failed to log history: ' + logError.message);
  } else {
    alert('✅ Lead(s) successfully assigned.');
  }
  selectedLeads.clear();
  document.getElementById('selected-count').textContent = '0';
  await loadLeadsWithFilters();
  await loadAssignmentHistory();
}

/* =========================
   Announcements: List/Delete
   ========================= */
async function loadAnnouncements() {
  const list = document.getElementById('annc-list');
  if (!list) return;

  list.innerHTML = 'Loading…';

  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    list.innerHTML = '<p>Error loading announcements.</p>';
    return;
  }

  if (!data?.length) {
    list.innerHTML = '<p>No announcements yet.</p>';
    return;
  }

  list.innerHTML = data.map(a => {
    const aud = a.audience || {};
    const repeat = aud.repeat || null;

    let repeatText = '';
    if (repeat && repeat.frequency && repeat.frequency !== 'none') {
      const labels = {
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly',
        yearly: 'Yearly'
      };
      const freqLabel = labels[repeat.frequency] || repeat.frequency;
      repeatText = ` · Repeats: ${freqLabel}`;
      if (repeat.until) {
        repeatText += ` until ${new Date(repeat.until).toLocaleDateString()}`;
      }
    }

    return `
      <div class="annc-row" data-id="${a.id}" style="display:grid; grid-template-columns: 64px 1fr auto; gap:12px; align-items:center; padding:10px; border:1px solid #eee; border-radius:8px; margin-bottom:10px;">
        <div class="thumb" style="width:64px; height:64px; background:#f7f7f7; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:6px;">
          ${a.image_url ? `<img src="${a.image_url}" alt="" style="max-width:100%; max-height:100%;">` : `<i class="fa-regular fa-image"></i>`}
        </div>
        <div class="meta" style="min-width:0;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <strong>${a.title || '(no title)'}</strong>
            ${a.link_url ? `<a href="${a.link_url}" target="_blank" rel="noopener" style="font-size:12px;"><i class="fa-solid fa-link"></i> Open link</a>` : ''}
          </div>
          <div style="font-size:12px; color:#666; margin-top:2px;">
            Audience: ${summarizeAudience(a.audience)}
            · Published: ${a.publish_at ? new Date(a.publish_at).toLocaleString() : 'Now'}
            ${a.expires_at ? ` · Expires: ${new Date(a.expires_at).toLocaleString()}` : ''}
            ${repeatText}
          </div>
          <div style="font-size:13px; margin-top:6px; color:#333; white-space:pre-wrap;">
            ${(a.body || '').slice(0, 240)}${a.body && a.body.length > 240 ? '…' : ''}
          </div>
        </div>
        <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
          <button class="annc-copy" title="Copy link JSON" style="padding:6px 10px;">Copy JSON</button>
          <button class="annc-delete" style="padding:6px 10px; background:#ffe6e6; border:1px solid #ffb3b3;">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Copy JSON
  list.querySelectorAll('.annc-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('.annc-row');
      const id = row?.getAttribute('data-id');
      const a = data.find(x => String(x.id) === String(id));
      if (!a) return;
      navigator.clipboard?.writeText(JSON.stringify(a, null, 2));
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy JSON', 1200);
    });
  });

  // Delete
  list.querySelectorAll('.annc-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.annc-row');
      const id = row?.getAttribute('data-id');
      if (!id) return;
      if (!confirm('Delete this announcement?')) return;
      const { error: delErr } = await supabase.from('announcements').delete().eq('id', id);
      if (delErr) {
        alert('❌ Failed to delete.');
        console.error(delErr);
        return;
      }
      row.remove();
      if (!document.querySelector('#annc-list .annc-row')) {
        document.getElementById('annc-list').innerHTML = '<p>No announcements yet.</p>';
      }
    });
  });
}
  // === Training list collapse ===
  const trainingPanelEl = document.getElementById('training-manage-panel');
  const trainingToggleEl = document.getElementById('toggle-training-list');
  const trainingSearchEl = document.getElementById('training-search');

  if (trainingPanelEl && trainingToggleEl) {
    trainingToggleEl.addEventListener('click', () => {
      const isHidden = trainingPanelEl.hasAttribute('hidden');
      if (isHidden) {
        trainingPanelEl.removeAttribute('hidden');
        trainingToggleEl.setAttribute('aria-expanded', 'true');
        trainingToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-down', 'fa-chevron-up');
        // When first opened, ensure list is loaded
        loadTrainingMaterials();
      } else {
        trainingPanelEl.setAttribute('hidden', '');
        trainingToggleEl.setAttribute('aria-expanded', 'false');
        trainingToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-up', 'fa-chevron-down');
      }
    });
  }

  // Search within training list
  window._trainingSearchTerm = '';
  if (trainingSearchEl) {
    trainingSearchEl.addEventListener('input', () => {
      window._trainingSearchTerm = trainingSearchEl.value.toLowerCase();
      loadTrainingMaterials();
    });
  }
  // === Marketing list collapse ===
  const mktPanelEl  = document.getElementById('mkt-manage-panel');
  const mktToggleEl = document.getElementById('toggle-mkt-list');
  const mktSearchEl = document.getElementById('mkt-search');
  
  if (mktPanelEl && mktToggleEl) {
    mktToggleEl.addEventListener('click', () => {
      const isHidden = mktPanelEl.hasAttribute('hidden');
      if (isHidden) {
        mktPanelEl.removeAttribute('hidden');
        mktToggleEl.setAttribute('aria-expanded', 'true');
        mktToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-down', 'fa-chevron-up');
        // When first opened, ensure list is loaded
        loadMarketingAssets();
      } else {
        mktPanelEl.setAttribute('hidden', '');
        mktToggleEl.setAttribute('aria-expanded', 'false');
        mktToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-up', 'fa-chevron-down');
      }
    });
  }
  
  // Search within marketing list
  window._marketingSearchTerm = '';
  if (mktSearchEl) {
    mktSearchEl.addEventListener('input', () => {
      window._marketingSearchTerm = mktSearchEl.value.toLowerCase();
      loadMarketingAssets();
    });
  }
  // === Task list collapse ===
  const taskPanelEl  = document.getElementById('task-list-panel');
  const taskToggleEl = document.getElementById('toggle-task-list');

  if (taskPanelEl && taskToggleEl) {
    taskToggleEl.addEventListener('click', () => {
      const isHidden = taskPanelEl.hasAttribute('hidden');

      if (isHidden) {
        // Open panel
        taskPanelEl.removeAttribute('hidden');
        taskToggleEl.setAttribute('aria-expanded', 'true');
        taskToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-down', 'fa-chevron-up');

        // Load tasks when first opened
        loadMyTasks();
      } else {
        // Close panel
        taskPanelEl.setAttribute('hidden', '');
        taskToggleEl.setAttribute('aria-expanded', 'false');
        taskToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-up', 'fa-chevron-down');
      }
    });
  }
/* =========================
   Training Materials: List/Delete
   ========================= */
async function loadTrainingMaterials() {
  const listEl = document.getElementById('training-list');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  const { data, error } = await supabase
    .from('training_materials')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading training materials:', error);
    listEl.innerHTML = '<p>Error loading training materials.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No training items yet.</p>';
    return;
  }

  // Apply search filter (title, description, tags)
  const term = (window._trainingSearchTerm || '').trim().toLowerCase();
  const filtered = term
    ? data.filter(item => {
        const tagsText = Array.isArray(item.tags) ? item.tags.join(' ') : '';
        const haystack = [
          item.title || '',
          item.description || '',
          tagsText
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
    : data;

  if (!filtered.length) {
    listEl.innerHTML = '<p>No training items match your search.</p>';
    return;
  }

  listEl.innerHTML = filtered
    .map(item => {
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : '';
      const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';

      return `
        <div class="training-row" data-id="${item.id}"
             style="display:grid; grid-template-columns: 1fr auto; gap:8px; padding:8px 10px; border:1px solid #eee; border-radius:6px; margin-bottom:8px;">
          <div class="meta" style="min-width:0;">
            <strong>${item.title || '(no title)'}</strong>
            <div style="font-size:12px; color:#666; margin-top:2px;">
              ${created ? `Created: ${created}` : ''}
              ${tags ? ` · Tags: ${tags}` : ''}
            </div>
            <div style="font-size:13px; margin-top:4px; color:#333; white-space:pre-wrap;">
              ${(item.description || '').slice(0, 240)}${item.description && item.description.length > 240 ? '…' : ''}
            </div>
            ${
              item.url
                ? `
              <div style="margin-top:4px; font-size:13px;">
                <a href="${item.url}" target="_blank" rel="noopener">
                  <i class="fa-solid fa-link"></i> Open link
                </a>
              </div>`
                : ''
            }
          </div>
          <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
            <button class="train-delete" style="padding:6px 10px; background:#ffe6e6; border:1px solid #ffb3b3;">
              Delete
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire delete buttons
  listEl.querySelectorAll('.train-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.training-row');
      const id = row?.getAttribute('data-id');
      if (!id) return;

      if (!confirm('Delete this training item?')) return;

      const { error: delErr } = await supabase
        .from('training_materials')
        .delete()
        .eq('id', id);

      if (delErr) {
        alert('❌ Failed to delete training item.');
        console.error(delErr);
        return;
      }

      row.remove();
      if (!document.querySelector('#training-list .training-row')) {
        listEl.innerHTML = '<p>No training items yet.</p>';
      }
    });
  });
}
/* =========================
   Marketing Assets: List/Delete
   ========================= */
async function loadMarketingAssets() {
  const listEl = document.getElementById('mkt-list');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  const { data, error } = await supabase
    .from('marketing_assets')
    .select('*')
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading marketing assets:', error);
    listEl.innerHTML = '<p>Error loading marketing assets.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No marketing assets yet.</p>';
    return;
  }

  // Apply search filter (title, description, tags)
  const term = (window._marketingSearchTerm || '').trim().toLowerCase();
  const filtered = term
    ? data.filter(item => {
        const tagsText = Array.isArray(item.tags) ? item.tags.join(' ') : '';
        const haystack = [
          item.title || '',
          item.description || '',
          tagsText
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
    : data;

  if (!filtered.length) {
    listEl.innerHTML = '<p>No marketing assets match your search.</p>';
    return;
  }

  listEl.innerHTML = filtered
    .map(item => {
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : '';
      const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';
      const linkUrl = item.url || item.file_url || null;

      let linkHtml = '';
      if (linkUrl) {
        linkHtml = `
          <div style="margin-top:4px; font-size:13px;">
            <a href="${linkUrl}" target="_blank" rel="noopener">
              <i class="fa-solid fa-link"></i> Open asset
            </a>
          </div>
        `;
      }

      return `
        <div class="mkt-row" data-id="${item.id}"
             style="display:grid; grid-template-columns: 1fr auto; gap:8px; padding:8px 10px; border:1px solid #eee; border-radius:6px; margin-bottom:8px;">
          <div class="meta" style="min-width:0;">
            <strong>${item.title || '(no title)'}</strong>
            <div style="font-size:12px; color:#666; margin-top:2px;">
              ${created ? `Created: ${created}` : ''}
              ${tags ? ` · Tags: ${tags}` : ''}
            </div>
            <div style="font-size:13px; margin-top:4px; color:#333; white-space:pre-wrap;">
              ${(item.description || '').slice(0, 240)}${item.description && item.description.length > 240 ? '…' : ''}
            </div>
            ${linkHtml}
          </div>
          <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
            <button class="mkt-delete"
                    style="padding:6px 10px; background:#ffe6e6; border:1px solid #ffb3b3;">
              Delete
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire delete buttons
  listEl.querySelectorAll('.mkt-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.mkt-row');
      const id = row?.getAttribute('data-id');
      if (!id) return;

      if (!confirm('Delete this marketing asset?')) return;

      const { error: delErr } = await supabase
        .from('marketing_assets')
        .delete()
        .eq('id', id);

      if (delErr) {
        alert('❌ Failed to delete marketing asset.');
        console.error(delErr);
        return;
      }

      row.remove();
      if (!document.querySelector('#mkt-list .mkt-row')) {
        listEl.innerHTML = '<p>No marketing assets yet.</p>';
      }
    });
  });
}
/* =========================
   Tasks: List / Complete / Delete (sent from Admin panel)
   ========================= */
async function loadMyTasks() {
  const listEl = document.getElementById('task-list');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  // Only tasks created from the admin panel by this admin
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .contains('metadata', {
      created_by: userId,
      source: 'admin_panel'
    })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading tasks:', error);
    listEl.innerHTML = '<p>Error loading tasks.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No tasks sent yet.</p>';
    return;
  }

  // Map agent id → name
  const nameById = new Map((allAgents || []).map(a => [a.id, a.full_name]));

  listEl.innerHTML = data
    .map(task => {
      const meta = task.metadata || {};
      const agentName = nameById.get(task.assigned_to) || 'Unknown agent';
      const status = (task.status || 'open').toLowerCase();
      const dueText = task.due_at
        ? new Date(task.due_at).toLocaleString()
        : 'No due date';

      const notes = (meta.notes || '').toString();
      const shortNotes =
        notes.length > 200 ? notes.slice(0, 200) + '…' : notes;

      const linkUrl = meta.link_url || null;

      return `
        <div class="task-row"
             data-id="${task.id}"
             style="display:grid; grid-template-columns: 64px 1fr auto; gap:8px; padding:8px 10px; border:1px solid #eee; border-radius:6px; margin-bottom:8px; font-size:13px;">
      
          <div class="thumb"
               style="width:64px; height:64px; background:#f7f7f7; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:6px;">
            ${
              meta.image_url
                ? `<img src="${meta.image_url}" style="max-width:100%; max-height:100%;">`
                : `<i class="fa-regular fa-image"></i>`
            }
          </div>
      
          <div class="meta" style="min-width:0;">
            <strong>${task.title || '(no title)'}</strong>
            <div style="font-size:12px; color:#666; margin-top:2px;">
              Assigned to: ${agentName}
              · Status: ${status}
              · Due: ${dueText}
            </div>
            ${
              shortNotes
                ? `<div style="font-size:13px; margin-top:4px; white-space:pre-wrap;">${shortNotes}</div>`
                : ''
            }
            ${
              linkUrl
                ? `<div style="margin-top:4px; font-size:13px;">
                     <a href="${linkUrl}" target="_blank"><i class="fa-solid fa-link"></i> Open link</a>
                   </div>`
                : ''
            }
          </div>
      
          <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
            <button class="task-complete" style="padding:4px 8px; font-size:12px;">Mark done</button>
            <button class="task-delete" style="padding:4px 8px; font-size:12px; background:#ffe6e6; border:1px solid #ffb3b3;">Delete</button>
          </div>
      
        </div>
      `;
    })
    .join('');

  // Wire "Mark done"
  listEl.querySelectorAll('.task-complete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.task-row');
      const id  = row?.getAttribute('data-id');
      if (!id) return;

      try {
        const now = new Date().toISOString();
        const { error: updErr } = await supabase
          .from('tasks')
          .update({ status: 'completed', completed_at: now })
          .eq('id', id);

        if (updErr) {
          alert('❌ Failed to mark task done.');
          console.error(updErr);
          return;
        }

        // Reload list
        await loadMyTasks();
      } catch (err) {
        console.error('Error marking task complete:', err);
        alert('❌ Error marking task complete.');
      }
    });
  });

  // Wire "Delete"
  listEl.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.task-row');
      const id  = row?.getAttribute('data-id');
      if (!id) return;

      if (!confirm('Delete this task?')) return;

      try {
        const { error: delErr } = await supabase
          .from('tasks')
          .delete()
          .eq('id', id);

        if (delErr) {
          alert('❌ Failed to delete task.');
          console.error(delErr);
          return;
        }

        row.remove();
        if (!document.querySelector('#task-list .task-row')) {
          listEl.innerHTML = '<p>No tasks sent yet.</p>';
        }
      } catch (err) {
        console.error('Error deleting task:', err);
        alert('❌ Error deleting task.');
      }
    });
  });
}
/* =========================
   Agent Waitlist: List + Approvals
   ========================= */
async function loadWaitlist() {
  const listEl = document.getElementById('waitlist-container');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  const { data, error } = await supabase
    .from('agent_waitlist')
    .select('id, agent_id, first_name, last_name, phone, email, recruiter_id, level, recruit_id, licensing_approved, ica_signed, banking_approved, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading agent waitlist:', error);
    listEl.innerHTML = '<p>Error loading waitlist.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No agents in the waitlist yet.</p>';
    return;
  }

  // Map recruiter_id → full_name using allAgents if available
  const recruiterNameById = new Map(
    (allAgents || []).map(a => [a.id, a.full_name])
  );

  listEl.innerHTML = data
    .map(item => {
      const recruiterName =
        recruiterNameById.get(item.recruiter_id) || 'Unknown recruiter';
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : '';

      const licChecked  = item.licensing_approved ? 'checked' : '';
      const icaChecked  = item.ica_signed ? 'checked' : '';
      const bankChecked = item.banking_approved ? 'checked' : '';

      return `
        <div class="wait-row"
             data-id="${item.id}"
             data-agent-id="${item.agent_id || ''}"
             data-first-name="${item.first_name || ''}"
             data-last-name="${item.last_name || ''}"
             data-email="${item.email || ''}"
             data-phone="${item.phone || ''}"
             data-recruiter-id="${item.recruiter_id || ''}"
             data-level="${item.level || ''}"
             data-recruit-id="${item.recruit_id || ''}"
             style="border:1px solid #eee; border-radius:6px; padding:10px 12px; margin-bottom:10px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
            <div>
              <div><strong>${item.first_name || ''} ${item.last_name || ''}</strong> (${item.agent_id || 'No NPN'})</div>
              <div>Email: ${item.email || '—'}</div>
              <div>Phone: ${item.phone || '—'}</div>
              <div>Recruiter: ${recruiterName}</div>
              <div>Level: ${item.level || '—'}</div>
              <div style="color:#666; font-size:12px;">Added: ${created}</div>
            </div>
            <div style="min-width:220px;">
              <div style="font-weight:600; margin-bottom:4px;">Checklist</div>
              <label style="display:block; margin-bottom:2px;">
                <input type="checkbox" class="wait-lic" ${licChecked}>
                Licensing approved
              </label>
              <label style="display:block; margin-bottom:2px;">
                <input type="checkbox" class="wait-ica" ${icaChecked}>
                ICA signed
              </label>
              <label style="display:block; margin-bottom:2px;">
                <input type="checkbox" class="wait-bank" ${bankChecked}>
                Banking / Stripe ok
              </label>
              <button type="button"
                      class="wait-approve-btn"
                      style="margin-top:6px; padding:4px 8px; font-size:12px;">
                Approve & Add to Approved Agents
              </button>
              <button type="button"
                      class="wait-delete-btn"
                      style="margin-top:4px; padding:4px 8px; font-size:12px; background:#ffe6e6; border:1px solid #ffb3b3;">
                Delete from Waitlist
              </button>
              <div class="wait-msg" style="font-size:12px; margin-top:4px; color:#555;"></div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire up Approve buttons
  listEl.querySelectorAll('.wait-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.wait-row');
      if (row) approveWaitlistEntry(row);
    });
  });

  // Wire up Delete buttons
  listEl.querySelectorAll('.wait-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row   = btn.closest('.wait-row');
      const rowId = row?.getAttribute('data-id');
      if (!rowId) return;

      if (!confirm('Remove this person from the waitlist? This will NOT change approved_agents.')) {
        return;
      }

      const { error: delErr } = await supabase
        .from('agent_waitlist')
        .delete()
        .eq('id', rowId);

      if (delErr) {
        alert('❌ Failed to delete from waitlist.');
        console.error(delErr);
        return;
      }

      // Remove row from DOM
      row.remove();

      // If no rows left, show empty message
      if (!document.querySelector('#waitlist-container .wait-row')) {
        listEl.innerHTML = '<p>No agents in the waitlist yet.</p>';
      }
    });
  });
}
async function approveWaitlistEntry(row) {
  const rowId       = row.getAttribute('data-id');
  const agentId     = row.getAttribute('data-agent-id') || '';
  const firstName   = row.getAttribute('data-first-name') || '';
  const lastName    = row.getAttribute('data-last-name') || '';
  const email       = row.getAttribute('data-email') || '';
  const phone       = row.getAttribute('data-phone') || '';
  const recruiterId = row.getAttribute('data-recruiter-id') || '';
  const level       = row.getAttribute('data-level') || '';
  const recruitId   = row.getAttribute('data-recruit-id') || null;

  const msgEl  = row.querySelector('.wait-msg');
  const licCb  = row.querySelector('.wait-lic');
  const icaCb  = row.querySelector('.wait-ica');
  const bankCb = row.querySelector('.wait-bank');

  if (msgEl) msgEl.textContent = '';

  if (!agentId || !email || !recruiterId || !level) {
    if (msgEl) msgEl.textContent =
      '⚠️ Missing key info (agent ID, email, recruiter, or level). Fix in waitlist first.';
    return;
  }

  if (!licCb?.checked || !icaCb?.checked || !bankCb?.checked) {
    if (msgEl) msgEl.textContent =
      '⚠️ Check licensing, ICA signed, and banking/Stripe ok before approving.';
    return;
  }

  // 1) Upsert into approved_agents
  const approvedPayload = {
    agent_id: agentId,
    is_registered: false,
    email,
    phone,
    first_name: firstName,
    last_name: lastName,
    recruiter_id: recruiterId,
    level,
    ica_signed: true,
    banking_approved: true,
    licensing_approved: true
  };

  if (msgEl) msgEl.textContent = 'Saving to approved_agents…';

  const { error: appErr } = await supabase
    .from('approved_agents')
    .upsert(approvedPayload, { onConflict: 'agent_id' });

  if (appErr) {
    console.error('Error upserting approved_agents:', appErr);
    if (msgEl) msgEl.textContent =
      '❌ Could not save to approved_agents: ' + appErr.message;
    return;
  }

  // 2) If this came from recruits table, mark them as contracting
  if (recruitId) {
    const updates = {
      stage: 'contracting',
      stage_updated_at: new Date().toISOString()
    };

    const { error: recErr } = await supabase
      .from('recruits')
      .update(updates)
      .eq('id', recruitId);

    if (recErr) {
      console.error('Error updating recruit stage:', recErr);
      if (msgEl) msgEl.textContent =
        '⚠️ Agent approved, but could not update recruit stage.';
      // keep going, approval already happened
    }
  }

  // 3) Update waitlist flags (for consistency if anything looks later)
  const { error: wErr } = await supabase
    .from('agent_waitlist')
    .update({
      licensing_approved: true,
      ica_signed: true,
      banking_approved: true
    })
    .eq('id', rowId);

  if (wErr) {
    console.error('Error updating waitlist flags:', wErr);
    if (msgEl) msgEl.textContent =
      '⚠️ Agent approved, but failed to update waitlist flags.';
  } else if (msgEl) {
    msgEl.textContent = '✅ Agent approved and added to approved_agents.';
  }

  // 4) Now remove them from the waitlist table entirely
  const { error: delErr } = await supabase
    .from('agent_waitlist')
    .delete()
    .eq('id', rowId);

  if (delErr) {
    console.error('Error deleting from waitlist:', delErr);
    if (msgEl) {
      msgEl.textContent += '\n⚠️ Approved, but could not remove from waitlist.';
    }
  } else if (msgEl) {
    msgEl.textContent += '\n✅ Removed from waitlist.';
  }

  // 5) Reload list to reflect current status
  try {
    await loadWaitlist();
  } catch (err) {
    console.error('Error reloading waitlist after approval:', err);
  }
}
/* =========================
   Remove Agent: Search + Delete
   ========================= */

// Called when user hits the Search button in the Remove Agent modal
async function searchAgentsForRemoval() {
  const input = document.getElementById('remove-agent-search');
  const resultsEl = document.getElementById('remove-agent-results');
  const msgEl = document.getElementById('remove-agent-msg');
  if (!input || !resultsEl) return;

  const term = input.value.trim();
  resultsEl.innerHTML = '';
  msgEl.textContent = '';

  if (!term) {
    msgEl.textContent = 'Type an NPN or name to search.';
    return;
  }

  msgEl.textContent = 'Searching…';

  // Search by NPN OR name (case-insensitive)
  const { data, error } = await supabase
    .from('agents')
    .select('id, agent_id, full_name, email, recruiter_id, first_name, last_name')
    .or(
      `agent_id.ilike.%${term}%,` +
      `full_name.ilike.%${term}%`
    )
    .limit(20);

  if (error) {
    console.error('Error searching agents for removal:', error);
    msgEl.textContent = '❌ Error searching agents.';
    return;
  }

  if (!data || !data.length) {
    msgEl.textContent = 'No agents found matching that search.';
    return;
  }

  // Map recruiter_id → name using allAgents (already loaded for admin)
  const recruiterNameById = new Map(
    (allAgents || []).map(a => [a.id, a.full_name])
  );

  msgEl.textContent = `Found ${data.length} result(s).`;

  resultsEl.innerHTML = data
    .map(a => {
      const recruiterName = recruiterNameById.get(a.recruiter_id) || 'Unknown recruiter';
      return `
        <div class="remove-agent-row"
             data-agent-id="${a.id}"
             data-agent-npn="${a.agent_id || ''}"
             data-agent-name="${a.full_name || ''}"
             style="border:1px solid #eee; border-radius:6px; padding:8px 10px; margin-bottom:8px; display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
          <div>
            <div><strong>${a.full_name || '(no name)'}</strong></div>
            <div>NPN: ${a.agent_id || '—'}</div>
            <div>Email: ${a.email || '—'}</div>
            <div>Recruiter: ${recruiterName}</div>
          </div>
          <div style="display:flex; flex-direction:column; justify-content:center; gap:4px;">
            <button type="button"
                    class="remove-agent-confirm-btn"
                    style="padding:4px 8px; font-size:12px; background:#ffe6e6; border:1px solid #ffb3b3;">
              Remove Agent
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire up per-row Remove buttons
  resultsEl.querySelectorAll('.remove-agent-confirm-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.remove-agent-row');
      if (!row) return;
      await confirmAndRemoveAgent(row);
    });
  });
}

// Confirm + call Netlify function
async function confirmAndRemoveAgent(row) {
  const msgEl = document.getElementById('remove-agent-msg');
  const agentAuthId = row.getAttribute('data-agent-id');    // agents.id == auth.user.id
  const agentNpn    = row.getAttribute('data-agent-npn') || '';
  const agentName   = row.getAttribute('data-agent-name') || '';

  const label = `${agentName || 'this agent'}${agentNpn ? ' (NPN ' + agentNpn + ')' : ''}`;

  const ok = confirm(
    `This will permanently remove ${label}, including:\n\n` +
    `• agent_nipr_appointments\n` +
    `• agent_nipr_licenses\n` +
    `• agent_nipr_profile\n` +
    `• agent_nipr_snapshot\n` +
    `• approved_agents row\n` +
    `• agents row\n` +
    `• their own recruits row (the one that represents them)\n` +
    `• auth user (login)\n\n` +
    `This cannot be undone. Continue?`
  );
  if (!ok) return;

  if (msgEl) msgEl.textContent = 'Removing agent…';

  try {
    const res = await fetch('/.netlify/functions/remove-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        auth_user_id: agentAuthId,
        agent_id: agentNpn || null
      })
    });

    if (!res.ok) {
      const txt = await res.text();
      console.error('remove-agent function error:', txt);
      if (msgEl) msgEl.textContent = '❌ Failed to remove agent: ' + txt;
      return;
    }

    const json = await res.json().catch(() => ({}));
    console.log('remove-agent result:', json);

    if (msgEl) msgEl.textContent = '✅ Agent removed.';

    // Refresh in-memory agents + waitlist, etc.
    try {
      await loadAgentsForAdmin();
    } catch (_) {}

    try {
      await loadWaitlist();
    } catch (_) {}

    // Refresh the search results list so they disappear
    await searchAgentsForRemoval();
  } catch (err) {
    console.error('Error calling remove-agent function:', err);
    if (msgEl) msgEl.textContent = '❌ Error calling remove-agent function.';
  }
}
  // Remove Agent modal: search button
  document.getElementById('remove-agent-search-btn')?.addEventListener('click', () => {
    searchAgentsForRemoval();
  });

  // Allow pressing Enter in the search field
  document.getElementById('remove-agent-search')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      searchAgentsForRemoval();
    }
  });
