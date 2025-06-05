import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

/*alert("Step 3: Checking session from dashboard...");*/
document.addEventListener("DOMContentLoaded", async () => {
  alert("✅ DOM fully loaded and JS is running.");
  const loadingScreen = document.getElementById('loading-screen');

  try {
    alert("🔍 Checking session...");
    const sessionResult = await supabase.auth.getSession();
    const session = sessionResult.data.session;
    alert("📦 Session result: " + (session ? "Found" : "Missing"));

    if (!session) {
      document.body.innerHTML = "<h1>Session not found. Please log in again.</h1>";
      return;
    }

    const user = session.user;
    const isAdmin =
      user.email === 'fvinsuranceagency@gmail.com' ||
      user.email === 'johnsondemesi@gmail.com';

    alert("👤 Logged in as: " + user.email + "\nAdmin? " + isAdmin);

    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin ? 'inline' : 'none';
    });

    if (loadingScreen) {
      alert("🧹 Hiding loading screen...");
      loadingScreen.style.display = 'none';
      loadingScreen.style.visibility = 'hidden';
      loadingScreen.style.opacity = '0';
      loadingScreen.style.zIndex = '-1';
    }

    alert("🗂️ Hiding all tabs and showing default...");
    document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
    const defaultTab = document.getElementById('profile-tab');
    if (defaultTab) defaultTab.style.display = 'block';

    alert("📥 Loading agents...");
    await loadAgentsForAdmin();
    alert("📥 Loading leads...");
    await loadLeadsWithFilters();

    if (isAdmin) {
      alert("📥 Loading requested leads...");
      await loadRequestedLeads();

      setTimeout(() => {
        alert("📖 Loading assignment history...");
        loadAssignmentHistory();
      }, 100);
    }

    alert("✅ Dashboard finished loading.");
  } catch (err) {
    if (loadingScreen) loadingScreen.style.display = 'none';
    document.body.innerHTML = "<h1>Error checking session. Please log in again.</h1>";
    alert("❌ Exception caught: " + err.message);
    console.error(err);
  }
});
/*setTimeout(() => {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) {
    loadingScreen.style.display = 'none';
    loadingScreen.style.visibility = 'hidden';
    loadingScreen.style.opacity = '0';
    loadingScreen.style.zIndex = '-1';
    alert("⚠️ Fallback triggered: forcibly hid the loader.");
  }
}, 8000); // 8 seconds
let currentPage = 1;
const PAGE_SIZE = 25;
let rangeStart = null;
let rangeEnd = null;

flatpickr("#date-range", {
  mode: "range",
  dateFormat: "Y-m-d",
  onChange: function(selectedDates) {
    rangeStart = selectedDates[0] ? selectedDates[0].toISOString().split('T')[0] : null;
    rangeEnd = selectedDates[1] ? selectedDates[1].toISOString().split('T')[0] : null;
    loadLeadsWithFilters();
  }
});
function formatPhone(input) {
  input.addEventListener('input', () => {
    let numbers = input.value.replace(/\D/g, '');
    let formatted = '';

    if (numbers.length > 0) formatted += '(' + numbers.substring(0, 3);
    if (numbers.length >= 4) formatted += ') ' + numbers.substring(3, 6);
    if (numbers.length >= 7) formatted += '-' + numbers.substring(6, 10);

    input.value = formatted;
  });
}

function addPhoneInput() {
  const container = document.getElementById('phone-inputs');
  const line = document.createElement('div');
  line.className = 'phone-line';

  const input = document.createElement('input');
  input.type = 'tel';
  input.name = 'lead-phone';
  input.placeholder = '(123) 456-7890';
  input.maxLength = 14;
  formatPhone(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '–';
  btn.addEventListener('click', () => line.remove());

  line.appendChild(input);
  line.appendChild(btn);
  container.appendChild(line);
}

// Initialize format + add button on page load
document.querySelectorAll('input[name="lead-phone"]').forEach(formatPhone);

const addBtn = document.querySelector('.add-phone-btn');
if (addBtn) {
  addBtn.addEventListener('click', () => {
    addPhoneInput();
  });
}

// ✅ Step 11: Tab switching logic
document.querySelectorAll('nav a[data-tab]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();

    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.style.display = 'none';
    });

    // Remove active class from all nav links
    document.querySelectorAll('nav a').forEach(link => {
      link.classList.remove('active');
    });

    // Show the selected tab
    const tabId = link.getAttribute('data-tab');
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.style.display = 'block';
    }

    // Add active class to clicked nav link
    link.classList.add('active');
  });
});

// Optional: show the first tab by default


// ✅ Step 12: Lead form submission
const leadForm = document.getElementById('lead-form');
if (leadForm) {
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
      const user = (await supabase.auth.getSession()).data.session.user;

      const leadData = {
        first_name: document.getElementById('lead-first').value.trim(),
        last_name: document.getElementById('lead-last').value.trim(),
        age: parseInt(document.getElementById('lead-age').value),
        address: document.getElementById('lead-address').value.trim(),
        city: document.getElementById('lead-city').value.trim(),
        zip: document.getElementById('lead-zip').value.trim(),
        phone: Array.from(document.querySelectorAll('input[name="lead-phone"]'))
  .map(input => input.value.trim())
  .filter(num => num !== ''),
        lead_type: document.getElementById('lead-type').value,
        notes: document.getElementById('lead-notes').value.trim(),
        submitted_by: user.id,
        assigned_to: user.id, // ✅ already correct
assigned_at: new Date().toISOString(), // ✅ add this line
      };

      const { error } = await supabase.from('leads').insert(leadData);

      if (error) {
        alert("Error submitting lead: " + error.message);
      } else {
        alert("Lead submitted successfully!");
        leadForm.reset();
      }

    } catch (err) {
      alert("Unexpected error: " + err.message);
    }
  });
}
// ✅ Step 13: Lead request form submission
const leadRequestForm = document.getElementById('lead-request-form');
const requestMessage = document.getElementById('request-message');

if (leadRequestForm) {
  leadRequestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    requestMessage.textContent = "Submitting request...";

    try {
      const session = await supabase.auth.getSession();
      const user = session.data.session.user;

      const requestData = {
        city: document.getElementById('request-city').value.trim(),
        zip: document.getElementById('request-zip').value.trim(),
        lead_type: document.getElementById('request-type').value,
        requested_count: parseInt(document.getElementById('request-count').value),
        notes: document.getElementById('request-notes').value.trim(),
        submitted_by: user.id,
        submitted_by_name: profileData?.full_name || 'Unknown'
      };

      const { error } = await supabase.from('lead_requests').insert(requestData);

      if (error) {
        requestMessage.textContent = "Error: " + error.message;
        requestMessage.style.color = "red";
      } else {
        requestMessage.textContent = "Request submitted successfully!";
        requestMessage.style.color = "green";
        leadRequestForm.reset();
      }
    } catch (err) {
      requestMessage.textContent = "Unexpected error: " + err.message;
      requestMessage.style.color = "red";
    }
  });
}
// ✅ Step 15: Display lead requests to admin (no assignment UI)
async function loadRequestedLeads() {
  const session = await supabase.auth.getSession();
  const user = session.data.session.user;

  const isAdmin =
    user.email === 'fvinsuranceagency@gmail.com' ||
    user.email === 'johnsondemesi@gmail.com';

  if (!isAdmin) return;

  const container = document.getElementById('requested-leads-container');
  container.innerHTML = '<p>Loading requested leads...</p>';

  const { data, error } = await supabase
    .from('lead_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    container.innerHTML = `<p style="color:red;">Error: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = '<p>No requested leads found.</p>';
    return;
  }

  const leadCards = data.map(lead => {
  return `
    <div class="lead-request-card" style="border:1px solid #ccc; padding:10px; margin:10px 0; position:relative;">
      <p><strong>Agent:</strong> ${lead.submitted_by_name || 'Unknown Agent'}</p>
      <p><strong>City:</strong> ${lead.city || 'N/A'}</p>
      <p><strong>ZIP:</strong> ${lead.zip || 'N/A'}</p>
      <p><strong>Type:</strong> ${lead.lead_type || 'N/A'}</p>
      <p><strong>Count:</strong> ${lead.requested_count || '1'}</p>
      <p><strong>Notes:</strong> ${lead.notes || 'None'}</p>
      <button class="delete-request-btn" data-id="${lead.id}" style="position:absolute; top:10px; right:10px;">🗑️</button>
    </div>
  `;
});

  container.innerHTML = leadCards.join('');

  // Add delete functionality
  document.querySelectorAll('.delete-request-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const leadId = btn.dataset.id;
      const confirmDelete = confirm("Are you sure you want to delete this request?");
      if (!confirmDelete) return;

      const { error } = await supabase
        .from('lead_requests')
        .delete()
        .eq('id', leadId);

      if (error) {
        alert("Error deleting request: " + error.message);
      } else {
        alert("Request deleted.");
        await loadRequestedLeads(); // Refresh list
      }
    });
  });
}

// ========== ADMIN TAB: Load Agents and Leads ==========
let allAgents = [];
let selectedLeads = new Set();

async function loadAgentsForAdmin() {
  const { data, error } = await supabase.from('agents').select('id, full_name').eq('is_active', true);
  if (!error && data) {
    allAgents = data;
    const dropdowns = [
  { el: document.getElementById('agent-filter'), placeholder: 'All Agents' },
  { el: document.getElementById('bulk-assign-agent'), placeholder: 'Select Agent' }
];

dropdowns.forEach(({ el, placeholder }) => {
  el.innerHTML = `<option value="">${placeholder}</option>`;
  data.forEach(agent => {
    const opt = document.createElement('option');
    opt.value = agent.id;
    opt.textContent = agent.full_name;
    el.appendChild(opt);
  });

  new Choices(el, {
    shouldSort: false,
    searchEnabled: true,
    placeholder: true,
    itemSelectText: '',
  });
});
  }
}

async function loadLeadsWithFilters() {
  const tbody = document.querySelector('#leads-table tbody');
  tbody.innerHTML = '';

  let query = supabase.from('leads').select('*', { count: 'exact' });

  const start = rangeStart;
  const end = rangeEnd;
  const order = document.getElementById('date-order').value;
  const agent = document.getElementById('agent-filter').value;
  const zip = document.getElementById('zip-filter').value;
  const city = document.getElementById('city-filter').value;
  const state = document.getElementById('state-filter').value;
  const first = document.getElementById('first-name-filter').value;
  const last = document.getElementById('last-name-filter').value;
  const type = document.getElementById('lead-type-filter').value;
  const assignedFilter = document.getElementById('assigned-filter').value;

  if (start) query = query.gte('created_at', start);
  if (end) query = query.lte('created_at', end);
  if (agent) query = query.eq('assigned_to', agent);
  if (zip) query = query.ilike('zip', `%${zip}%`);
  if (city) query = query.ilike('city', `%${city}%`);
  if (state) query = query.ilike('state', `%${state}%`);
  if (first) query = query.ilike('first_name', `%${first}%`);
  if (last) query = query.ilike('last_name', `%${last}%`);
  if (type) query = query.ilike('lead_type', `%${type}%`);
  if (assignedFilter) {
    if (assignedFilter === 'true') {
  query = query.not('assigned_to', 'is', null);
} else if (assignedFilter === 'false') {
  query = query.is('assigned_to', null);
}
  }

  const from = (currentPage - 1) * PAGE_SIZE;
const to = from + PAGE_SIZE - 1;

const { data: leads, error, count } = await supabase
  .from('leads')
  .select('*', { count: 'exact' })
  .order('created_at', { ascending: order === 'asc' })
  .range(from, to);
  
  if (error) return console.error('Error loading leads:', error);

const totalPages = Math.ceil(count / PAGE_SIZE);
document.getElementById('current-page').textContent = `Page ${currentPage} of ${totalPages}`;
document.getElementById('prev-page').disabled = currentPage === 1;
document.getElementById('next-page').disabled = currentPage >= totalPages;

  leads.forEach(lead => {
    const tr = document.createElement('tr');

    const checkboxTd = document.createElement('td');
const checkbox = document.createElement('input');
checkbox.type = 'checkbox';
checkbox.dataset.leadId = lead.id;

checkbox.addEventListener('change', (e) => {
  if (e.target.checked) {
    selectedLeads.add(lead.id);
  } else {
    selectedLeads.delete(lead.id);
  }
  document.getElementById('selected-count').textContent = selectedLeads.size;
  document.getElementById('bulk-assign-controls').style.display = selectedLeads.size > 0 ? 'block' : 'none';
});

checkboxTd.appendChild(checkbox);
tr.appendChild(checkboxTd);

    const agentName = allAgents.find(a => a.id === lead.assigned_to)?.full_name || 'Unassigned';

const cells = [
  new Date(lead.created_at).toLocaleDateString(),           // Submitted
  agentName,                                                // Agent
  lead.first_name || '',                                    // First Name
  lead.last_name || '',                                     // Last Name
  lead.age || '',                                           // Age
  (lead.phone || []).join(', '),                            // Phone(s)
  lead.address || '',                                       // Address
  lead.city || '',                                          // City
  lead.state || '',                                         // State
  lead.zip || '',                                           // ZIP
  lead.lead_type || '',                                     // Lead Type
  lead.notes || ''                                          // Notes
];

    cells.forEach(text => {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
  // Add sortable header listeners (only once after table is filled)
document.querySelectorAll('#leads-table thead th').forEach((th, index) => {
  th.style.cursor = 'pointer';
  th.addEventListener('click', () => {
    const direction = th.dataset.sort === 'asc' ? 'desc' : 'asc';
    th.dataset.sort = direction;
    sortTableByColumn(index, direction);
  });
  
});
}

// ========== APPLY FILTERS ==========
// Auto-refresh filters when any filter input changes
document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => {
  el.addEventListener('change', loadLeadsWithFilters);
});
// ========== BULK ASSIGN ==========
document.getElementById('bulk-assign-btn').addEventListener('click', async () => {
  const agentId = document.getElementById('bulk-assign-agent').value;
  if (!agentId || selectedLeads.size === 0) return alert('Select agent and at least one lead.');

  // Check if any selected leads are already assigned
  const { data: selectedData, error } = await supabase
    .from('leads')
    .select('id, assigned_to')
    .in('id', Array.from(selectedLeads));

  if (error) return alert("Error checking selected leads: " + error.message);

  const hasAssignedLeads = selectedData.some(lead => lead.assigned_to !== null);
  if (hasAssignedLeads) {
    // Show warning modal
    document.getElementById('reassign-warning-modal').style.display = 'flex';
    return;
  }

  // No already-assigned leads in selection — assign immediately
  await assignLeads(agentId);
});

// ========== INITIAL ADMIN LOAD ==========
// ========== REASSIGN WARNING MODAL BUTTONS ==========
document.getElementById('cancel-reassign-btn').addEventListener('click', () => {
  document.getElementById('reassign-warning-modal').style.display = 'none';
});

document.getElementById('confirm-reassign-btn').addEventListener('click', async () => {
  const agentId = document.getElementById('bulk-assign-agent').value;
  if (!agentId) return alert("No agent selected");
  await assignLeads(agentId);
});
async function assignLeads(agentId) {
  const leadIds = Array.from(selectedLeads);
  const session = await supabase.auth.getSession();
  const adminId = session.data.session.user.id;

  alert("Assigning " + leadIds.length + " leads to: " + agentId);

  const updates = {
    assigned_to: agentId,
    assigned_at: new Date().toISOString()
  };

  const { error } = await supabase
    .from('leads')
    .update(updates)
    .in('id', leadIds);

  if (error) {
    console.error('Assign error:', error);
    alert('Failed to assign leads: ' + error.message);
    return;
  }

  // ✅ Log assignment history
  const logs = leadIds.map(leadId => ({
    lead_id: leadId,
    assigned_to: agentId,
    assigned_by: adminId,
    assigned_at: new Date().toISOString()
  }));

  const { error: logError } = await supabase.from('lead_assignments').insert(logs);
  if (logError) {
    console.error('Audit trail error:', logError);
    alert('Leads assigned, but logging failed.');
  }

  selectedLeads.clear();
  document.getElementById('selected-count').textContent = '0';
  document.getElementById('bulk-assign-controls').style.display = 'none';
  document.getElementById('reassign-warning-modal').style.display = 'none';
  await loadLeadsWithFilters();
}

  if (error) {
    console.error('Assign error:', error);
    alert('Failed to assign leads: ' + error.message);
    return;
  }

  selectedLeads.clear();
  document.getElementById('selected-count').textContent = '0';
  document.getElementById('bulk-assign-controls').style.display = 'none';
  document.getElementById('reassign-warning-modal').style.display = 'none';
  await loadLeadsWithFilters();
}
document.getElementById('reset-filters').addEventListener('click', () => {
  document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => {
    el.value = '';
  });
  loadLeadsWithFilters();
});

function sortTableByColumn(columnIndex, direction = 'asc') {
  const tbody = document.querySelector('#leads-table tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));

  const sortedRows = rows.sort((a, b) => {
    const aText = a.children[columnIndex].textContent.trim().toLowerCase();
    const bText = b.children[columnIndex].textContent.trim().toLowerCase();

    if (!isNaN(aText) && !isNaN(bText)) {
      return direction === 'asc' ? aText - bText : bText - aText;
    }

    return direction === 'asc'
      ? aText.localeCompare(bText)
      : bText.localeCompare(aText);
  });

  tbody.innerHTML = '';
  sortedRows.forEach(row => tbody.appendChild(row));
}
document.getElementById('next-page').addEventListener('click', () => {
  currentPage++;
  loadLeadsWithFilters();
});

document.getElementById('prev-page').addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    loadLeadsWithFilters();
  }
});
async function loadAssignmentHistory() {
  const { data, error } = await supabase
    .from('lead_assignments')
    .select('lead_id, assigned_to, assigned_by, assigned_at')
    .order('assigned_at', { ascending: false });

  const tableBody = document.querySelector('#assignment-history-table tbody');
  tableBody.innerHTML = '';

  if (error) {
    console.error('Error loading assignment history:', error);
    tableBody.innerHTML = '<tr><td colspan="4">Error loading history</td></tr>';
    return;
  }

  for (const row of data) {
    // Get assigned_to and assigned_by names
    const [toAgent, fromAgent] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', row.assigned_to).single(),
      supabase.from('profiles').select('full_name').eq('id', row.assigned_by).single()
    ]);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${new Date(row.assigned_at).toLocaleString()}</td>
      <td>${row.lead_id}</td>
      <td>${toAgent.data?.full_name || 'Unknown'}</td>
      <td>${fromAgent.data?.full_name || 'Unknown'}</td>
    `;
    tableBody.appendChild(tr);
  }
}*/
