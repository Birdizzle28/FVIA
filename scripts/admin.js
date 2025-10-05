import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let userId = null;
let userRole = null;
let allAgents = [];
let selectedLeads = new Set();
let currentPage = 1;
const PAGE_SIZE = 25;
let rangeStart = null;
let rangeEnd = null;
let allowedProductsFilter = null;

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
  
    // Optional: enhance with Choices.js (you already load it elsewhere)
    try {
      new Choices(sel, { shouldSort: false, searchEnabled: true, itemSelectText: '' });
    } catch (_) {}
  }
document.addEventListener('DOMContentLoaded', async () => {
  const toggle = document.getElementById("agent-hub-toggle");

  // Require login session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  userId = session.user.id;
  // Check if current user is admin
  const { data: profile, error: profileError } = await supabase.from('agents').select('is_admin').eq('id', userId).single();
  if (profileError) {
    console.error('Failed to check admin status:', profileError);
  }
  if (!profile || profile.is_admin !== true) {
    alert('Access denied.');
    window.location.href = 'profile.html';
    return;
  }
  userRole = 'admin';

  // Initialize date range picker
  flatpickr('#date-range', {
    mode: 'range',
    dateFormat: 'Y-m-d',
    onChange: function(selectedDates) {
      rangeStart = selectedDates[0] ? selectedDates[0].toISOString().split('T')[0] : null;
      rangeEnd = selectedDates[1] ? selectedDates[1].toISOString().split('T')[0] : null;
      loadLeadsWithFilters();
    }
  });
  // Enhance state filter with Choices.js
  new Choices('#state-filter', { searchEnabled: true, itemSelectText: '' });

  // Load agents list and populate dropdowns
  await loadAgentsForAdmin();
  populateStatAgentSelect();
  // Initial data load
  await loadLeadsWithFilters();
  await loadRequestedLeads();
  await loadAssignmentHistory();
  
  // ---- Agent Stats date-range picker (default last 30 days) ----
  let statPicker;  // make this accessible to loadAgentStats()
  
  (function initStatRange(){
    const thirtyDaysAgo = new Date(Date.now() - 30*864e5);
  
    statPicker = flatpickr('#stat-range-wrap', {
      mode: 'range',
      dateFormat: 'Y-m-d',
      defaultDate: [thirtyDaysAgo, new Date()],
      wrap: true,              // lets the button open the calendar
      onChange: () => {
        // only reload when NOT "All time"
        if (!document.getElementById('stat-all-time').checked) {
          loadAgentStats();
        }
      }
    });
  
    // All time toggle
    const allCb = document.getElementById('stat-all-time');
    allCb.addEventListener('change', () => {
      const disabled = allCb.checked;
      // visually/semantically disable the picker when All time
      document.getElementById('stat-range').disabled = disabled;
      document.querySelector('#stat-range-wrap .calendar-btn').disabled = disabled;
      loadAgentStats();
    });
  })();
  document.getElementById('stat-agent')?.addEventListener('change', loadAgentStats);
  document.getElementById('stat-range')?.addEventListener('change', loadAgentStats);

  // Filter change events
  document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => {
    el.addEventListener('change', loadLeadsWithFilters);
  });
  document.getElementById('apply-filters').addEventListener('click', () => loadLeadsWithFilters());
  document.getElementById('reset-filters').addEventListener('click', () => {
    document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => {
      if (el.tagName === 'SELECT') el.selectedIndex = 0;
      else el.value = '';
    });
    rangeStart = null;
    rangeEnd = null;
    allowedProductsFilter = null;
    loadLeadsWithFilters();
  });
  // Column header sorting
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
      document.getElementById('sort-by').value = column;
      document.getElementById('date-order').value = currentSortDirection;
      loadLeadsWithFilters();
    });
  });

  // Bulk-assign: choosing an agent should NOT reload the table.
  // We only store which products they’re eligible for (used at assign time).
  document.getElementById('bulk-assign-agent').addEventListener('change', e => {
    const agentId = e.target.value;
  
    // Keep existing checked rows
    selectedLeads = new Set(
      Array.from(document.querySelectorAll('.lead-checkbox:checked'))
        .map(cb => cb.dataset.leadId)
    );
  
    if (!agentId) {
      allowedProductsFilter = null;
      return;
    }
  
    const agent = allAgents.find(a => a.id === agentId);
    if (agent && agent.product_types) {
      // normalize to array
      allowedProductsFilter = Array.isArray(agent.product_types)
        ? agent.product_types.slice()
        : String(agent.product_types).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      allowedProductsFilter = null;
    }
  });

  // Bulk assign leads button
  document.getElementById('bulk-assign-btn').addEventListener('click', async () => {
    const selectedIds = Array.from(selectedLeads);
    if (selectedIds.length === 0) {
      alert('⚠️ No leads selected');
      return;
    }
    const agentId = document.getElementById('bulk-assign-agent').value;
    if (!agentId) {
      alert('⚠️ No agent selected');
      return;
    }
    // Validate product eligibility for selected leads
    const agentInfo = allAgents.find(a => a.id === agentId);
    if (agentInfo && Array.isArray(agentInfo.product_types) && agentInfo.product_types.length) {
      let ineligibleFound = false;
      for (let id of selectedLeads) {
        const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
        const product = row?.querySelector('.lead-product')?.textContent.trim(); // <-- was .lead-type
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
    // Check if any selected lead is already assigned to someone (reassign warning)
    const needsReassignConfirm = selectedIds.some(id => {
      const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
      const currentAgent = row?.querySelector('td:nth-child(3)')?.textContent;
      return currentAgent && currentAgent !== 'Unassigned';
    });
    if (needsReassignConfirm) {
      // Show confirmation modal
      document.getElementById('reassign-warning-modal').style.display = 'flex';
    } else {
      alert('✅ Assigning leads to agent ID: ' + agentId);
      await assignLeads(agentId);
    }
  });
  // Modal confirmation handlers
  document.getElementById('submit-anyway-btn').addEventListener('click', async () => {
    const agentId = document.getElementById('bulk-assign-agent').value;
    await assignLeads(agentId);
    document.getElementById('reassign-warning-modal').style.display = 'none';
  });
  document.getElementById('cancel-reassign-btn').addEventListener('click', () => {
    document.getElementById('reassign-warning-modal').style.display = 'none';
  });

  // --- Export dropdown toggle (robust) ---
  const exportBtn = document.getElementById('export-btn');
  const exportOptions = document.getElementById('export-options');
  
  if (exportBtn && exportOptions) {
    exportBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      exportOptions.style.display = (exportOptions.style.display === 'block') ? 'none' : 'block';
    });
  
    // prevent inside clicks from bubbling to document (which hides the menu)
    exportOptions.addEventListener('click', (e) => e.stopPropagation());
  
    // close when clicking anywhere else
    document.addEventListener('click', () => {
      exportOptions.style.display = 'none';
    });
  }
  
  // After each export action, hide the menu:
  ['export-csv','export-pdf','export-print'].forEach(id => {
    const btn = document.getElementById(id);
    btn?.addEventListener('click', () => {
      exportOptions.style.display = 'none';
    });
  });

  // CSV Export
  document.getElementById('export-csv').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) {
      alert('No leads selected.');
      return;
    }
    const headers = Object.keys(leads[0]).join(',');
    const rows = leads.map(lead => Object.values(lead).map(v => `"${v}"`).join(','));
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'leads.csv';
    link.click();
  });
  // Print Export
  document.getElementById('export-print').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) {
      alert('No leads selected.');
      return;
    }
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
        <head>
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
        </head>
        <body>
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
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  });
  // PDF Export
  document.getElementById('export-pdf').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) {
      alert('No leads selected.');
      return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logoImg = new Image();
    logoImg.src = '/Pics/img6.png';
    logoImg.onload = () => {
      leads.forEach((lead, index) => {
        if (index !== 0) doc.addPage();
        doc.addImage(logoImg, 'PNG', 90, 10, 30, 30);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text('Family Values Insurance Agency', 105, 50, { align: 'center' });
        doc.setFontSize(14);
        doc.setFont('helvetica', 'normal');
        doc.text('Lead Confirmation Form', 105, 60, { align: 'center' });
        const startY = 80;
        const lineHeight = 10;
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
        fields.forEach(([label, value], i) => {
          const y = startY + i * lineHeight;
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
  const agentHubBtn = document.getElementById('admin-tab');
  const hubPages = ['admin']; // Add more if needed 
  console.log("Page Path:", window.location.pathname); // debug
  console.log("Found Agent Hub Button:", agentHubBtn); // debug
  if (hubPages.some(page => window.location.pathname.includes(page))) {
    agentHubBtn?.classList.add('active-page');
  } else {
    agentHubBtn?.classList.remove('active-page');
  }
  const navButtons = {
    all: document.getElementById('nav-all'),
    requests: document.getElementById('nav-requests'),
    history: document.getElementById('nav-history'),
    stats: document.getElementById('nav-stats'),
  };

  // Map sections to their IDs
  const sections = {
    all: document.getElementById('admin-all-section'),
    requests: document.getElementById('admin-requests-section'),
    history: document.getElementById('admin-history-section'),
    stats: document.getElementById('admin-stats-section'),
  };

  function hideAllAdminSections() {
    Object.values(sections).forEach(sec => sec.style.display = 'none');
    Object.values(navButtons).forEach(btn => btn.classList.remove('active'));
  }

  function showAdminSection(name) {
    hideAllAdminSections();
    sections[name].style.display = 'block';
    navButtons[name].classList.add('active');
    if (name === 'history') loadAssignmentHistory();
    if (name === 'stats')   loadAgentStats();
  }

  // Initial view
  showAdminSection('all');

  // Attach click handlers
  navButtons.all.addEventListener('click', () => showAdminSection('all'));
  navButtons.requests.addEventListener('click', () => showAdminSection('requests'));
  navButtons.history.addEventListener('click', () => showAdminSection('history'));
  navButtons.stats.addEventListener('click', () => showAdminSection('stats'));

  // Hook up pagination buttons (place near the bottom of admin.js or inside DOMContentLoaded)
  const nextBtn = document.getElementById('next-page');
  const prevBtn = document.getElementById('prev-page');
  
  nextBtn?.addEventListener('click', async () => {
    // You can optionally check currentPage against the totalPages, but the disabled
    // attribute already prevents clicks when at the last page.
    currentPage++;
    await loadLeadsWithFilters();
  });
  
  prevBtn?.addEventListener('click', async () => {
    if (currentPage > 1) {
      currentPage--;
      await loadLeadsWithFilters();
    }
  });
}); // end DOMContentLoaded

// Load active agents and populate filters
async function loadAgentsForAdmin() {
  // Try to select allowed product categories if such field exists
  let { data, error } = await supabase.from('agents').select('id, full_name, product_types').eq('is_active', true);
  if (error) {
    // Fallback without products field if query failed
    const { data: dataFallback, error: err2 } = await supabase.from('agents').select('id, full_name').eq('is_active', true);
    if (err2) {
      console.error('Error loading agents:', err2);
      return;
    }
    data = dataFallback;
  }
  allAgents = data || [];
  // Normalize products field to array of strings
  allAgents.forEach(agent => {
    if (agent.product_types) {
      if (Array.isArray(agent.product_types)) {
        // already array
      } else if (typeof agent.product_types === 'string') {
        agent.product_types = agent.product_types.split(',').map(s => s.trim());
      } else {
        agent.product_types = null;
      }
    }
  });
  // Populate agent filter and bulk-assign dropdowns
  const agentFilterEl = document.getElementById('agent-filter');
  const bulkAssignEl = document.getElementById('bulk-assign-agent');
  agentFilterEl.innerHTML = '<option value="">All Agents</option>';
  bulkAssignEl.innerHTML = '<option value="">Select Agent</option>';
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
  // Enhance selects with Choices.js
  new Choices(agentFilterEl, { shouldSort: false, searchEnabled: true, placeholder: true, itemSelectText: '' });
  new Choices(bulkAssignEl, { shouldSort: false, searchEnabled: true, placeholder: true, itemSelectText: '' });
}
// Load leads with current filters and pagination
async function loadLeadsWithFilters() {
  const tbody = document.querySelector('#leads-table tbody');
  if (!tbody) return;
  const prevSelection = new Set(selectedLeads);
  tbody.innerHTML = '';
  document.getElementById('selected-count').textContent = '0';
  // Build query based on filters
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
  if (assignedVal === 'true') {
    query = query.not('assigned_to', 'is', null);
  } else if (assignedVal === 'false') {
    query = query.is('assigned_to', null);
  }
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
  // Populate leads table
  (leads || []).forEach(lead => {
    const tr = document.createElement('tr');
    // Selection checkbox cell
    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.classList.add('lead-checkbox');
    checkbox.dataset.leadId = lead.id;
    checkbox.addEventListener('change', e => {
      const id = String(lead.id);
      if (e.target.checked) {
        selectedLeads.add(id);
      } else {
        selectedLeads.delete(id);
      }
      document.getElementById('selected-count').textContent = selectedLeads.size;
      toggleExportVisibility();
    });
    checkboxTd.appendChild(checkbox);
    tr.appendChild(checkboxTd);
    // restore checkbox state if it was previously selected
    if (prevSelection.has(String(lead.id))) {
      checkbox.checked = true;
      selectedLeads.add(String(lead.id));
    }
    // Assigned agent name (or Unassigned)
    const agentName = lead.assigned_to ? (allAgents.find(a => a.id === lead.assigned_to)?.full_name || 'Unassigned') : 'Unassigned';
    // Other fields
    const phoneText = Array.isArray(lead.phone) ? lead.phone.join(', ') : (lead.phone || '');
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
    // fire the change event to update selectedLeads and UI
    cb.dispatchEvent(new Event('change'));
  });
});
// Load lead requests list (admin view of all requests)
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
  if (!requests || requests.length === 0) {
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
  `).join('') || '<p>No lead requests found.</p>';
  // Delete request handlers
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

// Load assignment history table
async function loadAssignmentHistory() {
  const tbody = document.querySelector('#assignment-history-table tbody');
  if (!tbody) return;
  tbody.innerHTML = 'Loading...';
  const { data: history, error } = await supabase.from('lead_assignments')
    .select(`
      lead_id,
      assigned_at,
      assigned_to_agent:assigned_to(full_name),
      assigned_by_agent:assigned_by(full_name)
    `)
    .order('assigned_at', { ascending: false });
  if (error) {
    console.error('Error loading history:', error);
    tbody.innerHTML = '<tr><td colspan="4">Error loading history.</td></tr>';
    return;
  }
  if (!history || history.length === 0) {
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
  
  let start = null, end = null;
  if (!isAll) {
    // get the two dates from the flatpickr range (statPicker is created in DOMContentLoaded)
    const dates = statPicker?.selectedDates || [];
    if (dates.length === 2) {
      [start, end] = dates;
    } else {
      // fallback: last 30 days
      end = new Date();
      start = new Date(end.getTime() - 30 * 864e5);
    }
  }
  const startISO = start ? start.toISOString() : null;
  // include the full end-day until 23:59:59.999
  const endISO = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).toISOString() : null;
  
  // base query
  let q = supabase
    .from('leads')
    .select('id, created_at, age, product_type, assigned_to, assigned_at', { count: 'exact' });
  
  // only constrain by date when NOT all-time
  if (!isAll && startISO && endISO) {
    q = q.gte('created_at', startISO).lte('created_at', endISO);
  }
  
  // filter by agent if chosen (keep as assigned_to; switch to submitted_by if you prefer)
  if (agentId) {
    q = q.eq('assigned_to', agentId);
  }
  
  const { data: leads, error } = await q;
  if (error) {
    console.error('Stats load error:', error);
    return;
  }

  // ---------- KPIs ----------
  const kNew = leads.length;
  const assignedInWindow = leads.filter(l => l.assigned_at && new Date(l.assigned_at) >= start);
  const kAssigned = assignedInWindow.length;

  const ages = leads.map(l => Number(l.age)).filter(n => Number.isFinite(n) && n > 0);
  const avgAge = ages.length ? (ages.reduce((a,b)=>a+b,0)/ages.length) : NaN;
  const distinctAgents = new Set(assignedInWindow.map(l => l.assigned_to).filter(Boolean));
  const kAgents = distinctAgents.size;

  document.getElementById('kpi-new').textContent = String(kNew);
  document.getElementById('kpi-assigned').textContent = String(kAssigned);
  document.getElementById('kpi-avg-age').textContent = Number.isFinite(avgAge) ? (Math.round(avgAge * 10) / 10) : '—';
  document.getElementById('kpi-agents').textContent = String(kAgents);

  // ---------- Weekly buckets ----------
  const weekMs = 7 * 864e5;
  const bucketCount = Math.min(12, Math.max(1, Math.ceil(rangeDays / 7)));
  const bucketStarts = Array.from({length: bucketCount}, (_,i) => new Date(start.getTime() + i * weekMs));
  const weeklyCounts = new Array(bucketCount).fill(0);

  for (const l of leads) {
    const t = new Date(l.created_at).getTime();
    const idx = Math.floor((t - start.getTime()) / weekMs);
    if (idx >= 0 && idx < bucketCount) weeklyCounts[idx]++;
  }
  const weekLabels = bucketStarts.map(d => `${(d.getMonth()+1).toString().padStart(2,'0')}/${d.getDate().toString().padStart(2,'0')}`);

  // ---------- Product mix ----------
  const productCounts = {};
  for (const l of leads) {
    const key = (l.product_type || 'Unknown').trim() || 'Unknown';
    productCounts[key] = (productCounts[key] || 0) + 1;
  }
  const productLabels = Object.keys(productCounts);
  const productValues = productLabels.map(k => productCounts[k]);

  // ---------- Assignments by agent (in window) ----------
  const nameById = new Map(allAgents.map(a => [a.id, a.full_name]));
  const assigns = {};
  for (const l of assignedInWindow) {
    const id = l.assigned_to || 'Unknown';
    assigns[id] = (assigns[id] || 0) + 1;
  }
  const assignLabels = Object.keys(assigns).map(id => nameById.get(id) || 'Unassigned/Unknown');
  const assignValues = Object.keys(assigns).map(id => assigns[id]);

  // ---------- Draw / Update charts ----------
  // destroy old charts to avoid duplicates
  chartWeekly?.destroy();
  chartProducts?.destroy();
  chartAssignments?.destroy();

  const weeklyCtx = document.getElementById('chart-weekly').getContext('2d');
  chartWeekly = new Chart(weeklyCtx, {
    type: 'line',
    data: { labels: weekLabels, datasets: [{ label: 'New Leads', data: weeklyCounts, tension: 0.3 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { precision:0 } } }
    }
  });

  const productsCtx = document.getElementById('chart-products').getContext('2d');
  chartProducts = new Chart(productsCtx, {
    type: 'doughnut',
    data: { labels: productLabels, datasets: [{ data: productValues }] },
    options: { responsive:true, maintainAspectRatio:false, plugins: { legend: { position: 'bottom' } } }
  });

  const assignsCtx = document.getElementById('chart-assignments').getContext('2d');
  chartAssignments = new Chart(assignsCtx, {
    type: 'bar',
    data: { labels: assignLabels, datasets: [{ label: 'Assignments', data: assignValues }] },
    options: {
      responsive:true,
      maintainAspectRatio:false,
      plugins: { legend: { display:false } },
      scales: { y: { beginAtZero:true, ticks: { precision:0 } } }
    }
  });
}
// Toggle export controls visibility
function toggleExportVisibility() {
  const anyChecked = document.querySelectorAll('input.lead-checkbox:checked').length > 0;
  document.getElementById('export-controls').style.display = anyChecked ? 'block' : 'none';
}

// Collect selected leads data for export
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

// Assign selected leads to the given agent and log the assignments
async function assignLeads(agentId) {
  if (!agentId || selectedLeads.size === 0) {
    alert('Please select leads and an agent.');
    return;
  }
  const leadIds = Array.from(selectedLeads);
  const now = new Date().toISOString();
  // Update leads table
  const { error: updateError } = await supabase.from('leads')
    .update({ assigned_to: agentId, assigned_at: now })
    .in('id', leadIds);
  if (updateError) {
    alert('❌ Failed to assign leads: ' + updateError.message);
    return;
  }
  // Log assignment history
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
  // Reset selection and refresh data
  selectedLeads.clear();
  document.getElementById('selected-count').textContent = '0';
  await loadLeadsWithFilters();
  await loadAssignmentHistory();
}
/*AgentStatsPayload = {
  period: { startISO, endISO },           // based on #stat-range
  scope: 'team' | 'mine',                 // based on #stat-scope

  kpis: {
    newLeads: { value, deltaPct, spark: number[] },        // spark = mini trend points
    contactRate: { valuePct, deltaPct, spark: number[] },
    quoteRate:   { valuePct, deltaPct, spark: number[] },
    closeRate:   { valuePct, deltaPct, spark: number[] },
  },

  weeklyCloses: { labels: string[], values: number[] },    // 12 buckets (week starts)
  funnelDonut:  { labels: ['New','Contacted','Quoted','Closed'], values: number[] },
  assignments:  { labels: string[], values: number[] },    // agents; last 30 days
  progress:     { pct: number, label: string, targetText: string } // e.g., “37% of 50 closes”
}
*/
