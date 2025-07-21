// === Supabase Setup ===
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'YOUR_PUBLIC_ANON_KEY');

// === DOMContentLoaded ===
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return (window.location.href = '../login.html');
  const user = session.user;

  // Admin check
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (!profile?.is_admin) return window.location.href = '../leads.html';

  document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'block');

  loadLeadRequests();
  loadAllLeads();
  loadAssignmentHistory();
  setupFilters();
  setupBulkAssign();
  setupExport();
  setupReassignModal();
});

// === Load Lead Requests ===
async function loadLeadRequests() {
  const { data, error } = await supabase.from('lead_requests').select('*').order('created_at', { ascending: false });
  if (error) return console.error('Failed to load lead requests:', error);

  const container = document.getElementById('requested-leads-container');
  container.innerHTML = data.map(r => `
    <div class="requested-lead">
      <strong>${r.requested_by_name}</strong> requested ${r.request_count} lead(s) in ${r.city}, ${r.state} (${r.lead_type || 'N/A'})<br/>
      <small>${new Date(r.created_at).toLocaleString()}</small>
      <p>${r.notes || ''}</p>
    </div>
  `).join('');
}

// === Load All Leads ===
async function loadAllLeads(page = 1) {
  // You can implement pagination and filtering logic here as needed
  // For simplicity, just load 50 for now
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(50);
  if (error) return console.error('Failed to load leads:', error);

  const tbody = document.querySelector('#leads-table tbody');
  tbody.innerHTML = '';

  for (const lead of data) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="lead-checkbox" data-id="${lead.id}" /></td>
      <td>${new Date(lead.created_at).toLocaleDateString()}</td>
      <td>${lead.submitted_by_name || 'Unassigned'}</td>
      <td>${lead.first_name || ''}</td>
      <td>${lead.last_name || ''}</td>
      <td>${lead.age || ''}</td>
      <td>${(lead.phone || []).join(', ')}</td>
      <td>${lead.address || ''}</td>
      <td>${lead.city || ''}</td>
      <td>${lead.state || ''}</td>
      <td>${lead.zip || ''}</td>
      <td>${lead.lead_type || ''}</td>
      <td>${lead.notes || ''}</td>
      <td>–</td>
    `;
    tbody.appendChild(row);
  }
}

// === Load Assignment History ===
async function loadAssignmentHistory() {
  const { data, error } = await supabase.from('lead_assignments').select('*').order('assigned_at', { ascending: false }).limit(50);
  if (error) return console.error('Failed to load assignment history:', error);

  const tbody = document.querySelector('#assignment-history-table tbody');
  tbody.innerHTML = data.map(entry => `
    <tr>
      <td>${new Date(entry.assigned_at).toLocaleDateString()}</td>
      <td>${entry.lead_id}</td>
      <td>${entry.assigned_to_name}</td>
      <td>${entry.assigned_by_name}</td>
    </tr>
  `).join('');
}

// === Setup Filters ===
function setupFilters() {
  flatpickr("#date-range", { mode: "range" });

  document.getElementById('apply-filters').addEventListener('click', () => {
    // Call loadAllLeads with filtered query
    loadAllLeads();
  });

  document.getElementById('reset-filters').addEventListener('click', () => {
    document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(input => input.value = '');
    loadAllLeads();
  });
}

// === Bulk Assignment ===
const selectedLeads = new Set();

document.addEventListener('change', e => {
  if (e.target.classList.contains('lead-checkbox')) {
    const leadId = e.target.dataset.id;
    e.target.checked ? selectedLeads.add(leadId) : selectedLeads.delete(leadId);
    document.getElementById('selected-count').textContent = selectedLeads.size;
    document.getElementById('bulk-assign-controls').style.display = selectedLeads.size > 0 ? 'block' : 'none';
  }
});

async function assignLeads(agentId) {
  const updates = Array.from(selectedLeads).map(leadId => ({
    id: leadId,
    assigned_to: agentId,
    assigned_at: new Date().toISOString()
  }));

  const { error } = await supabase.from('leads').upsert(updates, { onConflict: 'id' });
  if (error) return alert('Failed to assign leads.');

  selectedLeads.clear();
  document.getElementById('selected-count').textContent = '0';
  document.getElementById('bulk-assign-controls').style.display = 'none';
  document.getElementById('reassign-warning-modal').style.display = 'none';
  await loadAllLeads();
}

function setupBulkAssign() {
  document.getElementById('bulk-assign-btn').addEventListener('click', () => {
    const dropdown = document.getElementById('bulk-assign-agent');
    const agentId = dropdown.value;

    // If any selected leads already have assignments, show modal
    // You can expand this with logic if needed
    document.getElementById('reassign-warning-modal').style.display = 'flex';
  });

  document.getElementById('cancel-reassign-btn').addEventListener('click', () => {
    document.getElementById('reassign-warning-modal').style.display = 'none';
  });

  document.getElementById('submit-anyway-btn').addEventListener('click', async () => {
    const agentId = document.getElementById('bulk-assign-agent').value;
    await assignLeads(agentId);
  });
}

// === Export Buttons ===
function setupExport() {
  document.getElementById('export-btn').addEventListener('click', () => {
    const opts = document.getElementById('export-options');
    opts.style.display = opts.style.display === 'block' ? 'none' : 'block';
  });

  document.getElementById('export-csv').addEventListener('click', () => {
    alert('Export to CSV logic coming soon');
  });

  document.getElementById('export-pdf').addEventListener('click', () => {
    alert('Export to PDF logic coming soon');
  });

  document.getElementById('export-print').addEventListener('click', () => {
    window.print();
  });
}

// === Reassign Modal Setup ===
function setupReassignModal() {
  document.getElementById('reassign-warning-modal').style.display = 'none';
}
