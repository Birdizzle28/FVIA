// scripts/admin-all-leads.js
const sb = window.supabaseClient || window.supabase;

const PAGE_SIZE = 25;

let me = null;
let allAgents = [];              // [{ id, full_name }]
let agentNameById = {};          // { [id]: full_name }

let currentPage = 1;
let totalRows = 0;

let dateStartISO = null;         // YYYY-MM-DD
let dateEndISO = null;           // YYYY-MM-DD

let selectedLeads = new Set();   // lead ids
let selectedLeadRows = {};       // { [id]: leadRowData } (for export)

let pendingAssignAgentId = null;

function $(id) { return document.getElementById(id); }

function escapeHtml(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dt) {
  if (!dt) return '—';
  try {
    return new Date(dt).toLocaleString();
  } catch {
    return String(dt);
  }
}

function normalizePhones(phoneField) {
  if (!phoneField) return '—';
  if (Array.isArray(phoneField)) return phoneField.filter(Boolean).join(', ');
  return String(phoneField);
}

function isoEndExclusive(endISO) {
  const d = new Date(endISO + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function setSelectedCountUI() {
  const el = $('selected-count');
  if (el) el.textContent = String(selectedLeads.size);
}

function clearSelectionUI() {
  selectedLeads.clear();
  selectedLeadRows = {};
  const selectAll = $('select-all');
  if (selectAll) selectAll.checked = false;
  setSelectedCountUI();
}

async function loadMe() {
  const { data: { session } = {} } = await sb.auth.getSession();
  me = session?.user || null;
}

async function loadAgentsForDropdowns() {
  const { data, error } = await sb
    .from('agents')
    .select('id, full_name')
    .order('full_name', { ascending: true });

  if (error) {
    console.warn('loadAgentsForDropdowns error:', error);
    return;
  }

  allAgents = (data || []).filter(a => a?.id);
  agentNameById = {};
  allAgents.forEach(a => { agentNameById[a.id] = a.full_name || '—'; });

  const agentFilter = $('agent-filter');
  const bulkAgent = $('bulk-assign-agent');

  if (agentFilter) {
    agentFilter.innerHTML = `<option value="">All Agents</option>` + allAgents
      .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.full_name || '—')}</option>`)
      .join('');
  }

  if (bulkAgent) {
    bulkAgent.innerHTML = `<option value="">Select agent…</option>` + allAgents
      .map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.full_name || '—')}</option>`)
      .join('');
  }
}

function initDateRangePicker() {
  const input = $('date-range');
  if (!input || !window.flatpickr) return;

  window.flatpickr(input, {
    mode: 'range',
    dateFormat: 'Y-m-d',
    onClose: (dates) => {
      if (!dates || dates.length < 2) {
        dateStartISO = null;
        dateEndISO = null;
        return;
      }
      const [start, end] = dates;
      dateStartISO = new Date(start).toISOString().slice(0, 10);
      dateEndISO = new Date(end).toISOString().slice(0, 10);
    }
  });
}

function getFilters() {
  return {
    order: $('date-order')?.value || 'desc',
    agentId: $('agent-filter')?.value || '',
    assigned: $('assigned-filter')?.value || '',
    zip: ($('zip-filter')?.value || '').trim(),
    city: ($('city-filter')?.value || '').trim(),
    state: $('state-filter')?.value || '',
    first: ($('first-name-filter')?.value || '').trim(),
    last: ($('last-name-filter')?.value || '').trim(),
    leadType: $('lead-type-filter')?.value || ''
  };
}

async function loadLeads() {
  const tbody = $('leads-table')?.querySelector('tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;">Loading…</td></tr>`;

  const f = getFilters();

  let q = sb
    .from('leads')
    .select('*', { count: 'exact' });

  if (dateStartISO && dateEndISO) {
    q = q.gte('created_at', dateStartISO)
         .lt('created_at', isoEndExclusive(dateEndISO));
  }

  // NOTE: your original UI label says "Agent" but this filters by assigned_to (same as your code)
  if (f.agentId) q = q.eq('assigned_to', f.agentId);

  if (f.assigned === 'true') q = q.not('assigned_to', 'is', null);
  if (f.assigned === 'false') q = q.is('assigned_to', null);

  if (f.zip) q = q.ilike('zip', `%${f.zip}%`);
  if (f.city) q = q.ilike('city', `%${f.city}%`);
  if (f.state) q = q.eq('state', f.state);
  if (f.first) q = q.ilike('first_name', `%${f.first}%`);
  if (f.last) q = q.ilike('last_name', `%${f.last}%`);
  if (f.leadType) q = q.eq('lead_type', f.leadType);

  q = q.order('created_at', { ascending: f.order === 'asc' });

  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  q = q.range(from, to);

  const { data, error, count } = await q;

  if (error) {
    console.warn('loadLeads error:', error);
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;">Error loading leads.</td></tr>`;
    return;
  }

  totalRows = count || 0;
  const leads = data || [];

  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;">No leads found.</td></tr>`;
    $('current-page').textContent = `Page ${currentPage}`;
    return;
  }

  const prevSelection = new Set(selectedLeads);
  selectedLeadRows = {};
  tbody.innerHTML = '';

  for (const lead of leads) {
    const id = lead.id;

    const phones = normalizePhones(lead.phone);
    const submitted = formatDate(lead.created_at);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="lead-checkbox" data-id="${escapeHtml(id)}"></td>
      <td class="lead-date">${escapeHtml(submitted)}</td>
      <td class="lead-agent">
        ${lead.assigned_to
          ? escapeHtml(agentNameById[lead.assigned_to] || '—')
          : `Unassigned (by ${escapeHtml(lead.submitted_by_name || '—')})`
        }
      </td>
      <td class="lead-name">${escapeHtml(lead.first_name || '')}</td>
      <td class="lead-last">${escapeHtml(lead.last_name || '')}</td>
      <td class="lead-age">${escapeHtml(lead.age ?? '')}</td>
      <td class="lead-phone">${escapeHtml(phones)}</td>
      <td class="lead-address">${escapeHtml(lead.address || '')}</td>
      <td class="lead-city">${escapeHtml(lead.city || '')}</td>
      <td class="lead-state">${escapeHtml(lead.state || '')}</td>
      <td class="lead-zip">${escapeHtml(lead.zip || '')}</td>
      <td class="lead-type">${escapeHtml(lead.lead_type || '')}</td>
      <td class="lead-notes">${escapeHtml(lead.notes || '')}</td>
      <td class="lead-product">${escapeHtml(lead.product_type || '')}</td>
    `;

    const cb = tr.querySelector('.lead-checkbox');
    if (cb) {
      if (prevSelection.has(id)) {
        cb.checked = true;
        selectedLeads.add(id);
      } else {
        selectedLeads.delete(id);
      }

      selectedLeadRows[id] = {
        id,
        first_name: lead.first_name || '',
        last_name: lead.last_name || '',
        age: lead.age ?? '',
        phone: normalizePhones(lead.phone),
        address: lead.address || '',
        city: lead.city || '',
        state: lead.state || '',
        zip: lead.zip || '',
        leadType: lead.lead_type || '',
        product_type: lead.product_type || '',
        agent: lead.submitted_by_name || '',
        submittedAt: submitted
      };

      cb.addEventListener('change', () => {
        const leadId = cb.getAttribute('data-id');
        if (!leadId) return;
        if (cb.checked) selectedLeads.add(leadId);
        else selectedLeads.delete(leadId);
        setSelectedCountUI();
      });
    }

    tbody.appendChild(tr);
  }

  setSelectedCountUI();
  $('current-page').textContent = `Page ${currentPage}`;
}

function resetFiltersUI() {
  $('date-order').value = 'desc';
  $('agent-filter').value = '';
  $('assigned-filter').value = '';
  $('zip-filter').value = '';
  $('city-filter').value = '';
  $('state-filter').value = '';
  $('first-name-filter').value = '';
  $('last-name-filter').value = '';
  $('lead-type-filter').value = '';

  $('date-range').value = '';
  dateStartISO = null;
  dateEndISO = null;
}

function getSelectedLeadsData() {
  const out = [];
  selectedLeads.forEach(id => {
    if (selectedLeadRows[id]) out.push(selectedLeadRows[id]);
  });
  return out;
}

async function assignLeads(agentId) {
  if (!agentId) { alert('Select an agent first.'); return; }
  if (!selectedLeads.size) { alert('Select at least one lead.'); return; }

  const leadIds = Array.from(selectedLeads);

  const { data: existingAssigned, error: checkErr } = await sb
    .from('leads')
    .select('id, assigned_to')
    .in('id', leadIds);

  if (checkErr) {
    console.warn('assign check error:', checkErr);
    alert('Could not verify assignment status.');
    return;
  }

  const hasAlreadyAssigned = (existingAssigned || []).some(r => r.assigned_to);
  if (hasAlreadyAssigned) {
    pendingAssignAgentId = agentId;
    $('reassign-warning-modal').style.display = 'flex';
    return;
  }

  await doAssign(agentId);
}

async function doAssign(agentId) {
  const leadIds = Array.from(selectedLeads);
  if (!agentId) { alert('Select an agent first.'); return; }
  if (!leadIds.length) { alert('Select at least one lead.'); return; }

  const { data, error } = await sb.rpc('transfer_leads_clone_contacts', {
    p_lead_ids: leadIds,
    p_agent_id: agentId
  });

  if (error) {
    console.warn('transfer_leads_clone_contacts error:', error);
    alert(error.message || 'Assign failed.');
    return;
  }

  // optional: show a nice result message in console
  console.log('[TRANSFER OK]', data);

  clearSelectionUI();
  await loadLeads();
}

function wireSelectionAndPagination() {
  $('select-all')?.addEventListener('change', () => {
    const checked = $('select-all').checked;
    document.querySelectorAll('.lead-checkbox').forEach(cb => {
      cb.checked = checked;
      const id = cb.getAttribute('data-id');
      if (!id) return;
      if (checked) selectedLeads.add(id);
      else selectedLeads.delete(id);
    });
    setSelectedCountUI();
  });

  $('prev-page')?.addEventListener('click', async () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    await loadLeads();
  });

  $('next-page')?.addEventListener('click', async () => {
    const maxPage = Math.max(1, Math.ceil((totalRows || 0) / PAGE_SIZE));
    if (currentPage >= maxPage) return;
    currentPage += 1;
    await loadLeads();
  });
}

function wireFilters() {
  $('apply-filters')?.addEventListener('click', async (e) => {
    e.preventDefault();
    currentPage = 1;
    await loadLeads();
  });

  $('reset-filters')?.addEventListener('click', async (e) => {
    e.preventDefault();
    resetFiltersUI();
    currentPage = 1;
    clearSelectionUI();
    await loadLeads();
  });
}

function wireAssignAndWarningModal() {
  $('bulk-assign-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const agentId = $('bulk-assign-agent')?.value || '';
    await assignLeads(agentId);
  });

  $('submit-anyway-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const agentId = pendingAssignAgentId || ($('bulk-assign-agent')?.value || '');
    $('reassign-warning-modal').style.display = 'none';
    pendingAssignAgentId = null;
    await doAssign(agentId);
  });

  $('cancel-reassign-btn')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    $('reassign-warning-modal').style.display = 'none';
    pendingAssignAgentId = null;
  });
}

function wireExport() {
  const exportBtn = $('export-btn');
  const exportOptions = $('export-options');

  if (exportBtn && exportOptions) {
    exportBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      exportOptions.style.display = (exportOptions.style.display === 'block') ? 'none' : 'block';
    });
    exportOptions.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { exportOptions.style.display = 'none'; });
  }

  const closeExport = () => { if (exportOptions) exportOptions.style.display = 'none'; };
  $('export-csv')?.addEventListener('click', () => { closeExport(); exportCSV(); });
  $('export-print')?.addEventListener('click', () => { closeExport(); exportPrint(); });
  $('export-pdf')?.addEventListener('click', () => { closeExport(); exportPDF(); });
}

function exportCSV() {
  const leads = getSelectedLeadsData();
  if (!leads.length) { alert('No leads selected.'); return; }

  const headers = Object.keys(leads[0]).join(',');
  const rows = leads.map(lead => Object.values(lead).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  const csvContent = [headers, ...rows].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'leads.csv';
  link.click();
}

function exportPrint() {
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
          <p><span class="label">First Name:</span> <span class="value">${escapeHtml(lead.first_name)}</span></p>
          <p><span class="label">Last Name:</span> <span class="value">${escapeHtml(lead.last_name)}</span></p>
          <p><span class="label">Age:</span> <span class="value">${escapeHtml(lead.age)}</span></p>
          <p><span class="label">Phone:</span> <span class="value">${escapeHtml(lead.phone)}</span></p>
          <p><span class="label">Lead Type:</span> <span class="value">${escapeHtml(lead.leadType)}</span></p>
          <p><span class="label">City:</span> <span class="value">${escapeHtml(lead.city)}</span></p>
          <p><span class="label">State:</span> <span class="value">${escapeHtml(lead.state)}</span></p>
          <p><span class="label">ZIP:</span> <span class="value">${escapeHtml(lead.zip)}</span></p>
          <p><span class="label">Address:</span> <span class="value">${escapeHtml(lead.address)}</span></p>
          <p><span class="label">Agent Assigned:</span> <span class="value">${escapeHtml(lead.agent)}</span></p>
          <p><span class="label">Submitted At:</span> <span class="value">${escapeHtml(lead.submittedAt)}</span></p>
          <div class="footer">Generated on ${new Date().toLocaleDateString()}</div>
        </div>
      `).join('')}
    </body></html>
  `);
  win.document.close();
  win.print();
}

function exportPDF() {
  const leads = getSelectedLeadsData();
  if (!leads.length) { alert('No leads selected.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const logoImg = new Image();
  logoImg.src = '/Pics/img6.png';

  logoImg.onload = () => {
    leads.forEach((lead, i) => {
      if (i) doc.addPage();

      doc.addImage(logoImg, 'PNG', 90, 10, 30, 30);

      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Family Values Insurance Agency', 105, 50, { align: 'center' });

      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.text('Lead Confirmation Form', 105, 60, { align: 'center' });

      doc.setFontSize(12);
      const lines = [
        `First Name: ${lead.first_name}`,
        `Last Name: ${lead.last_name}`,
        `Age: ${lead.age}`,
        `Phone: ${lead.phone}`,
        `Lead Type: ${lead.leadType}`,
        `Product: ${lead.product_type}`,
        `Address: ${lead.address}`,
        `City: ${lead.city}`,
        `State: ${lead.state}`,
        `ZIP: ${lead.zip}`,
        `Agent: ${lead.agent}`,
        `Submitted At: ${lead.submittedAt}`,
      ];

      let y = 75;
      lines.forEach(t => { doc.text(String(t), 20, y); y += 8; });

      doc.setFontSize(10);
      doc.text(`Generated on ${new Date().toLocaleDateString()}`, 105, 285, { align: 'center' });
    });

    doc.save('leads.pdf');
  };

  logoImg.onerror = () => {
    leads.forEach((lead, i) => {
      if (i) doc.addPage();
      doc.setFontSize(16);
      doc.text('Family Values Insurance Agency - Lead', 20, 20);
      doc.setFontSize(12);
      doc.text(JSON.stringify(lead, null, 2), 20, 30);
    });
    doc.save('leads.pdf');
  };
}
function wireAdminNav() {
  const nav = document.getElementById('admin-page-nav');
  if (!nav) return;

  // highlight active based on current file name
  const current = (location.pathname.split('/').pop() || '').toLowerCase();

  nav.querySelectorAll('button[data-href]').forEach(btn => {
    const href = (btn.getAttribute('data-href') || '').toLowerCase();
    if (!href) return;

    // set active
    if (href === current) btn.classList.add('active');
    else btn.classList.remove('active');

    // click -> navigate
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      location.href = btn.getAttribute('data-href');
    });
  });
}
document.addEventListener('DOMContentLoaded', async () => {
  if (!sb) {
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }
  wireAdminNav();
  const section = $('admin-all-section');
  if (section) section.style.display = 'block';
  await loadMe();

  initDateRangePicker();
  wireFilters();
  wireSelectionAndPagination();
  wireAssignAndWarningModal();
  wireExport();

  await loadAgentsForDropdowns();
  await loadLeads();
});
