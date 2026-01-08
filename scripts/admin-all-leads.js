// scripts/admin-all-leads.js

const supabase = window.supabaseClient;

let allAgents = [];
let selectedLeads = new Set();
let currentPage = 1;
const PAGE_SIZE = 25;

let rangeStart = null; // YYYY-MM-DD
let rangeEnd = null;   // YYYY-MM-DD
let allowedProductsFilter = null;

function toggleExportVisibility() {
  const anyChecked = document.querySelectorAll('input.lead-checkbox:checked').length > 0;
  const exportControls = document.getElementById('export-controls');
  if (exportControls) exportControls.style.display = anyChecked ? 'block' : 'none';
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

async function loadAgentsForAdmin() {
  let { data, error } = await supabase
    .from('agents')
    .select('id, full_name, product_types')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error loading agents:', error);
    return;
  }

  allAgents = data || [];

  allAgents.forEach(agent => {
    if (agent.product_types) {
      if (Array.isArray(agent.product_types)) {
        // ok
      } else if (typeof agent.product_types === 'string') {
        agent.product_types = agent.product_types.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        agent.product_types = null;
      }
    }
  });

  const agentFilterEl = document.getElementById('agent-filter');
  const bulkAssignEl  = document.getElementById('bulk-assign-agent');

  if (agentFilterEl) agentFilterEl.innerHTML = '<option value="">All Agents</option>';
  if (bulkAssignEl)  bulkAssignEl.innerHTML  = '<option value="">Select Agent</option>';

  allAgents.forEach(agent => {
    if (agentFilterEl) {
      const opt1 = document.createElement('option');
      opt1.value = agent.id;
      opt1.textContent = agent.full_name || agent.id;
      agentFilterEl.appendChild(opt1);
    }
    if (bulkAssignEl) {
      const opt2 = document.createElement('option');
      opt2.value = agent.id;
      opt2.textContent = agent.full_name || agent.id;
      bulkAssignEl.appendChild(opt2);
    }
  });

  try {
    if (agentFilterEl) new Choices(agentFilterEl, { shouldSort:false, searchEnabled:true, placeholder:true, itemSelectText:'' });
  } catch (_) {}
  try {
    if (bulkAssignEl) new Choices(bulkAssignEl, { shouldSort:false, searchEnabled:true, placeholder:true, itemSelectText:'' });
  } catch (_) {}
}

async function loadLeadsWithFilters() {
  const tbody = document.querySelector('#leads-table tbody');
  if (!tbody) return;

  const prevSelection = new Set(selectedLeads);

  tbody.innerHTML = '';
  const selectedCountEl = document.getElementById('selected-count');
  if (selectedCountEl) selectedCountEl.textContent = '0';

  let query = supabase.from('leads').select('*', { count: 'exact' });

  const orderDir = document.getElementById('date-order')?.value || 'desc';
  const sortBy   = document.getElementById('sort-by')?.value || 'created_at';

  const agentVal    = document.getElementById('agent-filter')?.value || '';
  const zip         = document.getElementById('zip-filter')?.value.trim() || '';
  const city        = document.getElementById('city-filter')?.value.trim() || '';
  const state       = document.getElementById('state-filter')?.value || '';
  const first       = document.getElementById('first-name-filter')?.value.trim() || '';
  const last        = document.getElementById('last-name-filter')?.value.trim() || '';
  const type        = document.getElementById('lead-type-filter')?.value || '';
  const assignedVal = document.getElementById('assigned-filter')?.value || '';

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
  const to   = from + PAGE_SIZE - 1;

  const { data: leads, error, count } = await query
    .order(sortBy, { ascending: orderDir === 'asc' })
    .range(from, to);

  if (error) {
    console.error('Error loading leads:', error);
    tbody.innerHTML = '<tr><td colspan="14">Error loading leads.</td></tr>';
    return;
  }

  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  const pageLabel = document.getElementById('current-page');
  if (pageLabel) pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

  const prevBtn = document.getElementById('prev-page');
  const nextBtn = document.getElementById('next-page');

  if (prevBtn) prevBtn.disabled = currentPage <= 1;
  if (nextBtn) nextBtn.disabled = currentPage >= totalPages;

  (leads || []).forEach(lead => {
    const tr = document.createElement('tr');

    // Checkbox
    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.classList.add('lead-checkbox');
    checkbox.dataset.leadId = lead.id;

    checkbox.addEventListener('change', e => {
      const id = String(lead.id);
      if (e.target.checked) selectedLeads.add(id);
      else selectedLeads.delete(id);

      const sc = document.getElementById('selected-count');
      if (sc) sc.textContent = String(selectedLeads.size);

      toggleExportVisibility();
    });

    checkboxTd.appendChild(checkbox);
    tr.appendChild(checkboxTd);

    // Restore selection across reload
    if (prevSelection.has(String(lead.id))) {
      checkbox.checked = true;
      selectedLeads.add(String(lead.id));
    }

    const agentName = lead.assigned_to
      ? (allAgents.find(a => a.id === lead.assigned_to)?.full_name || 'Unassigned')
      : 'Unassigned';

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

  const sc = document.getElementById('selected-count');
  if (sc) sc.textContent = String(selectedLeads.size);

  toggleExportVisibility();
}

async function assignLeads(agentId) {
  if (!agentId || selectedLeads.size === 0) {
    alert('Please select leads and an agent.');
    return;
  }

  const leadIds = Array.from(selectedLeads);
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from('leads')
    .update({ assigned_to: agentId, assigned_at: now })
    .in('id', leadIds);

  if (updateError) {
    alert('❌ Failed to assign leads: ' + updateError.message);
    return;
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const currentUserId = sessionData?.session?.user?.id || null;

  const logs = leadIds.map(leadId => ({
    lead_id: leadId,
    assigned_to: agentId,
    assigned_by: currentUserId,
    assigned_at: now
  }));

  const { error: logError } = await supabase.from('lead_assignments').insert(logs);

  if (logError) alert('⚠️ Leads assigned, but failed to log history: ' + logError.message);
  else alert('✅ Lead(s) successfully assigned.');

  selectedLeads.clear();

  const sc = document.getElementById('selected-count');
  if (sc) sc.textContent = '0';

  await loadLeadsWithFilters();
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!supabase) {
    console.warn('Missing window.supabaseClient (supabase-client.js not loaded?)');
    return;
  }

  // Date range picker
  flatpickr('#date-range', {
    mode: 'range',
    dateFormat: 'Y-m-d',
    onChange: (ds) => {
      rangeStart = ds[0]?.toISOString().split('T')[0] || null;
      rangeEnd   = ds[1]?.toISOString().split('T')[0] || null;
      currentPage = 1;
      loadLeadsWithFilters();
    }
  });

  // State dropdown
  try { new Choices('#state-filter', { searchEnabled:true, itemSelectText:'' }); } catch (_) {}

  await loadAgentsForAdmin();
  await loadLeadsWithFilters();

  // Auto reload on filter changes
  document.querySelectorAll('#admin-filters input, #admin-filters select')
    .forEach(el => el.addEventListener('change', () => {
      currentPage = 1;
      loadLeadsWithFilters();
    }));

  document.getElementById('apply-filters')?.addEventListener('click', () => {
    currentPage = 1;
    loadLeadsWithFilters();
  });

  document.getElementById('reset-filters')?.addEventListener('click', () => {
    document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => {
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });

    rangeStart = null;
    rangeEnd = null;
    allowedProductsFilter = null;
    currentPage = 1;

    loadLeadsWithFilters();
  });

  // Table sorting (click headers)
  let currentSortColumn = null;
  let currentSortDirection = 'asc';

  document.querySelectorAll('#leads-table th[data-column]').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.getAttribute('data-column');
      if (currentSortColumn === column) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortColumn = column;
        currentSortDirection = 'asc';
      }
      const sortByEl = document.getElementById('sort-by');
      const orderEl = document.getElementById('date-order');
      if (sortByEl) sortByEl.value = column;
      if (orderEl) orderEl.value = currentSortDirection;

      currentPage = 1;
      loadLeadsWithFilters();
    });
  });

  // Pagination
  document.getElementById('next-page')?.addEventListener('click', async () => {
    currentPage++;
    await loadLeadsWithFilters();
  });

  document.getElementById('prev-page')?.addEventListener('click', async () => {
    if (currentPage > 1) {
      currentPage--;
      await loadLeadsWithFilters();
    }
  });

  // Select all
  document.getElementById('select-all')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.lead-checkbox').forEach(cb => {
      cb.checked = checked;
      cb.dispatchEvent(new Event('change'));
    });
  });

  // Bulk assign agent change (eligibility memory)
  document.getElementById('bulk-assign-agent')?.addEventListener('change', e => {
    const agentId = e.target.value;

    selectedLeads = new Set(
      Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => cb.dataset.leadId)
    );

    if (!agentId) {
      allowedProductsFilter = null;
      return;
    }

    const agent = allAgents.find(a => a.id === agentId);
    if (agent && agent.product_types) {
      allowedProductsFilter = Array.isArray(agent.product_types)
        ? agent.product_types.slice()
        : String(agent.product_types).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      allowedProductsFilter = null;
    }
  });

  // Bulk assign click
  document.getElementById('bulk-assign-btn')?.addEventListener('click', async () => {
    const selectedIds = Array.from(selectedLeads);
    if (!selectedIds.length) { alert('⚠️ No leads selected'); return; }

    const agentId = document.getElementById('bulk-assign-agent')?.value || '';
    if (!agentId) { alert('⚠️ No agent selected'); return; }

    const agentInfo = allAgents.find(a => a.id === agentId);

    // Product eligibility check
    if (agentInfo && Array.isArray(agentInfo.product_types) && agentInfo.product_types.length) {
      let ineligibleFound = false;

      for (let id of selectedLeads) {
        const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
        const product = row?.querySelector('.lead-product')?.textContent.trim();
        if (product && !agentInfo.product_types.includes(product)) {
          ineligibleFound = true;
          break;
        }
      }

      if (ineligibleFound) {
        alert('❌ One or more selected leads have product types this agent is not eligible for.');
        return;
      }
    }

    // Reassign warning if any are already assigned
    const needsReassignConfirm = selectedIds.some(id => {
      const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
      const currentAgent = row?.querySelector('td:nth-child(3)')?.textContent;
      return currentAgent && currentAgent !== 'Unassigned';
    });

    if (needsReassignConfirm) {
      const modal = document.getElementById('reassign-warning-modal');
      if (modal) modal.style.display = 'flex';
    } else {
      alert('✅ Assigning leads…');
      await assignLeads(agentId);
    }
  });

  document.getElementById('submit-anyway-btn')?.addEventListener('click', async () => {
    const agentId = document.getElementById('bulk-assign-agent')?.value || '';
    await assignLeads(agentId);

    const modal = document.getElementById('reassign-warning-modal');
    if (modal) modal.style.display = 'none';
  });

  document.getElementById('cancel-reassign-btn')?.addEventListener('click', () => {
    const modal = document.getElementById('reassign-warning-modal');
    if (modal) modal.style.display = 'none';
  });

  // Export dropdown toggle
  const exportBtn = document.getElementById('export-btn');
  const exportOptions = document.getElementById('export-options');

  if (exportBtn && exportOptions) {
    exportBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      exportOptions.style.display = (exportOptions.style.display === 'block') ? 'none' : 'block';
    });

    exportOptions.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { exportOptions.style.display = 'none'; });
  }

  ['export-csv','export-pdf','export-print'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', () => {
      if (exportOptions) exportOptions.style.display = 'none';
    });
  });

  // CSV
  document.getElementById('export-csv')?.addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) { alert('No leads selected.'); return; }

    const headers = Object.keys(leads[0]).join(',');
    const rows = leads.map(lead => Object.values(lead).map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(','));
    const csvContent = [headers, ...rows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'leads.csv';
    link.click();
  });

  // Print
  document.getElementById('export-print')?.addEventListener('click', () => {
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
    win.document.close();
    win.print();
  });

  // PDF
  document.getElementById('export-pdf')?.addEventListener('click', () => {
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

        const startY = 80;
        const lineH = 10;
        const labelX = 20;
        const valueX = 70;

        const fields = [
          ['First Name', lead.first_name],
          ['Last Name', lead.last_name],
          ['Age', lead.age],
          ['Phone', lead.phone],
          ['Lead Type', lead.leadType],
          ['City', lead.city],
          ['State', lead.state],
          ['ZIP', lead.zip],
          ['Address', lead.address],
          ['Agent Assigned', lead.agent],
          ['Submitted At', lead.submittedAt]
        ];

        fields.forEach(([label, value], idx) => {
          const y = startY + idx * lineH;
          doc.setFont('helvetica', 'bold');
          doc.text(`${label}:`, labelX, y);
          doc.setFont('helvetica', 'normal');
          doc.text(value || '—', valueX, y);
        });

        doc.setFontSize(10);
        doc.setTextColor(120);
        doc.text(`Generated on ${new Date().toLocaleDateString()}`, 105, 285, { align: 'center' });
      });

      doc.save('FVIA_Leads.pdf');
    };

    logoImg.onerror = () => alert('❌ Failed to load logo for PDF.');
  });

  // Start hidden until something is selected
  toggleExportVisibility();
});
