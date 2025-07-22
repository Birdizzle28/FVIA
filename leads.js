// Import Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho');

let agentCurrentPage = 1;
let agentTotalPages = 1;
const pageSize = 25;

function updateAgentPaginationControls() {
  document.getElementById('agent-current-page').textContent = `Page ${agentCurrentPage}`;
  document.getElementById('agent-prev-page').disabled = agentCurrentPage === 1;
  document.getElementById('agent-next-page').disabled = agentCurrentPage === agentTotalPages;
}

// ✅ Session check
document.addEventListener('DOMContentLoaded', async () => {
  const stateSelect1 = document.getElementById('lead-state');
  const stateSelect2 = document.getElementById('request-state');

  if (stateSelect1) new Choices(stateSelect1, {
    searchEnabled: true,
    shouldSort: false,
    placeholder: true,
    searchPlaceholderValue: 'Type to filter…'
  });

  if (stateSelect2) new Choices(stateSelect2, {
    searchEnabled: true,
    shouldSort: false,
    placeholder: true,
    searchPlaceholderValue: 'Type to filter…'
  });
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

// Format phone number as (123) 456-7890 while typing
function formatPhoneInput(input) {
  input.addEventListener('input', () => {
    let numbers = input.value.replace(/\D/g, '');
    if (numbers.length > 10) numbers = numbers.slice(0, 10);
    const parts = [];

    if (numbers.length > 0) parts.push('(' + numbers.slice(0, 3));
    if (numbers.length >= 4) parts.push(') ' + numbers.slice(3, 6));
    if (numbers.length >= 7) parts.push('-' + numbers.slice(6, 10));

    input.value = parts.join('');
  });
}
document.querySelectorAll('input[name="lead-phone"]').forEach(formatPhoneInput);

// Lead submission
document.getElementById('lead-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = await supabase.auth.getSession();
  const user = session.data.session.user;
  const phones = Array.from(document.querySelectorAll('[name="lead-phone"]')).map(p => p.value);
  const { data, error } = await supabase.from('leads').insert({
    first_name: document.getElementById('lead-first').value,
    last_name: document.getElementById('lead-last').value,
    age: parseInt(document.getElementById('lead-age').value),
    address: document.getElementById('lead-address').value,
    city: document.getElementById('lead-city').value,
    state: document.getElementById('lead-state').value,
    zip: document.getElementById('lead-zip').value,
    phone: phones,
    lead_type: document.getElementById('lead-type').value,
    notes: document.getElementById('lead-notes').value,
    assigned_to: user.id,
    submitted_by: user.id
  });
  document.getElementById('lead-message').textContent = error ? 'Failed to submit lead.' : 'Lead submitted!';
});

// LEAD REQUEST SUBMIT (fixed to match your Supabase schema)
document.getElementById('lead-request-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const messageEl = document.getElementById('request-message');
  messageEl.textContent = ''; // Clear any previous message

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;

    if (!user) {
      messageEl.textContent = '❌ You must be logged in.';
      return;
    }

    const requestData = {
      submitted_by: user.id,
      city: document.getElementById('request-city').value,
      state: document.getElementById('request-state').value,
      zip: document.getElementById('request-zip').value,
      lead_type: document.getElementById('request-type').value,
      requested_count: parseInt(document.getElementById('request-count').value),
      notes: document.getElementById('request-notes').value
    };

    const { error } = await supabase.from('lead_requests').insert(requestData);

    if (error) {
      console.error('❌ Request insert failed:', error);
      messageEl.textContent = '❌ Failed to submit request.';
    } else {
      messageEl.textContent = '✅ Request submitted!';
    }
  } catch (err) {
    console.error('Unexpected error:', err);
    messageEl.textContent = '❌ Something went wrong.';
  }
});
  
// Load agent leads
async function loadAgentLeads() {
  const session = await supabase.auth.getSession();
  const user = session.data.session.user;

  let query = supabase
    .from('leads')
    .select('*')
    .eq('assigned_to', user.id);

  // ✅ Gather filter values
  const filters = {
    first_name: document.getElementById('agent-first-name-filter')?.value.trim(),
    last_name: document.getElementById('agent-last-name-filter')?.value.trim(),
    zip: document.getElementById('agent-zip-filter')?.value.trim(),
    city: document.getElementById('agent-city-filter')?.value.trim(),
    state: document.getElementById('agent-state-filter')?.value.trim(),
    lead_type: document.getElementById('agent-lead-type-filter')?.value.trim()
  };

  const dateRange = document.getElementById('agent-date-range')?.value;
  const order = document.getElementById('agent-date-order')?.value || 'desc';

  // ✅ Apply string filters
  for (const [key, value] of Object.entries(filters)) {
    if (value) query = query.ilike(key, `%${value}%`);
  }

  // ✅ Apply date range if selected
  if (dateRange) {
    const [start, end] = dateRange.split(' - ');
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (!isNaN(startDate) && !isNaN(endDate)) {
      query = query.gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString());
    }
  }

  // ✅ Apply order
  query = query.order('created_at', { ascending: order === 'asc' });

  // ✅ Fetch data
  const { data: leads, error } = await query;
  if (error) {
    console.error('❌ Error loading leads:', error);
    return;
  }

  // ✅ Paginate
  agentTotalPages = Math.ceil(leads.length / pageSize);
  const start = (agentCurrentPage - 1) * pageSize;
  const paginatedLeads = leads.slice(start, start + pageSize);

  // ✅ Render table
  const tbody = document.querySelector('#agent-leads-table tbody');
  tbody.innerHTML = '';

  paginatedLeads.forEach(lead => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="lead-select-checkbox" data-lead-id="${lead.id}"></td>
      <td>${new Date(lead.created_at).toLocaleDateString()}</td>
      <td>${lead.submitted_by_name || ''}</td>
      <td>${lead.first_name}</td>
      <td>${lead.last_name}</td>
      <td>${lead.age}</td>
      <td>${(lead.phone || []).join(', ')}</td>
      <td>${lead.address || ''}</td>
      <td>${lead.city || ''}</td>
      <td>${lead.state || ''}</td>
      <td>${lead.zip || ''}</td>
      <td>${lead.lead_type || ''}</td>
      <td>${lead.notes || ''}</td>
    `;
    tbody.appendChild(row);
  });

  updateAgentPaginationControls();
}

document.getElementById('agent-apply-filters')?.addEventListener('click', async () => {
  agentCurrentPage = 1;
  await loadAgentLeads(); // Reload leads with current filters applied
});
loadAgentLeads();

flatpickr("#agent-date-range", {
  mode: "range",
  dateFormat: "Y-m-d",
  rangeSeparator: " - " // ✅ CORRECT placement
});
  
document.getElementById('agent-reset-filters')?.addEventListener('click', () => {
  document.getElementById('agent-date-range').value = '';
  document.getElementById('agent-date-order').value = 'desc';
  document.getElementById('agent-zip-filter').value = '';
  document.getElementById('agent-city-filter').value = '';
  document.getElementById('agent-state-filter').value = '';
  document.getElementById('agent-first-name-filter').value = '';
  document.getElementById('agent-last-name-filter').value = '';
  document.getElementById('agent-lead-type-filter').value = '';

  agentCurrentPage = 1;
  loadAgentLeads();
});

const agentStateFilter = document.getElementById('agent-state-filter');
if (agentStateFilter) new Choices(agentStateFilter, {
  searchEnabled: true,
  shouldSort: false,
  placeholder: true,
  searchPlaceholderValue: 'Type to filter…'
});

// Export to PDF, CSV, Print
document.getElementById('agent-export-btn')?.addEventListener('click', () => {
  const exportBox = document.getElementById('agent-export-options');
  exportBox.style.display = exportBox.style.display === 'block' ? 'none' : 'block';
});

document.getElementById('agent-export-pdf')?.addEventListener('click', () => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.autoTable({ html: '#agent-leads-table' });
  doc.save('agent-leads.pdf');
});

document.getElementById('agent-export-csv')?.addEventListener('click', () => {
  const table = document.getElementById('agent-leads-table');
  const rows = Array.from(table.querySelectorAll('tr'));
  const csv = rows.map(row => Array.from(row.children).map(cell => `"${cell.textContent.trim()}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'agent-leads.csv';
  a.click();
});

document.getElementById('agent-export-print')?.addEventListener('click', () => {
  const printWindow = window.open('', '', 'width=800,height=600');
  printWindow.document.write(`<html><head><title>Print Leads</title></head><body>${document.getElementById('agent-leads-table').outerHTML}</body></html>`);
  printWindow.document.close();
  printWindow.print();
});

// Add phone field
document.querySelector('.add-phone-btn')?.addEventListener('click', () => {
  const phoneInputs = document.getElementById('phone-inputs');
  const div = document.createElement('div');
  div.className = 'phone-line';
  div.innerHTML = `
    <input type="tel" name="lead-phone" placeholder="(123) 456-7890" maxlength="14" required />
    <button type="button" class="remove-phone-btn">-</button>
  `;
  phoneInputs.appendChild(div);

  // Apply formatter to new input
  const newInput = div.querySelector('input');
  formatPhoneInput(newInput);
});

// Remove phone field
document.getElementById('phone-inputs')?.addEventListener('click', (e) => {
  if (e.target.classList.contains('remove-phone-btn')) {
    e.target.parentElement.remove();
  }
});
});
