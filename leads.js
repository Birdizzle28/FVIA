// Import Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho');

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

// Lead request
document.getElementById('lead-request-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = await supabase.auth.getSession();
  const user = session.data.session.user;
  const { error } = await supabase.from('lead_requests').insert({
    agent_id: user.id,
    city: document.getElementById('request-city').value,
    state: document.getElementById('request-state').value,
    zip: document.getElementById('request-zip').value,
    lead_type: document.getElementById('request-type').value,
    quantity: parseInt(document.getElementById('request-count').value),
    notes: document.getElementById('request-notes').value
  });
  document.getElementById('request-message').textContent = error ? 'Failed to request leads.' : 'Request submitted!';
});

// Load agent leads
async function loadAgentLeads() {
  const session = await supabase.auth.getSession();
  const user = session.data.session.user;
  const { data: leads } = await supabase.from('leads').select('*').eq('assigned_to', user.id).order('created_at', { ascending: false });
  const tbody = document.querySelector('#agent-leads-table tbody');
  tbody.innerHTML = '';
  leads.forEach(lead => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td></td>
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
}
loadAgentLeads();

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
