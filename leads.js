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
  if (dateRange && dateRange.includes(' to ')) {
    const [start, end] = dateRange.split(/\s*to\s*/);
    const startDate = new Date(start);
    const endDate = new Date(end);
    endDate.setHours(23, 59, 59, 999);

    console.log('Parsed start:', startDate.toISOString());
    console.log('Parsed end:', endDate.toISOString());

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      console.warn('⛔ Invalid date format detected');
    } else if (startDate > endDate) {
      console.warn('⛔ Start date is after end date!');
    } else {
      query = query
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());
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
  console.log('Date range value:', document.getElementById('agent-date-range').value);

}

document.getElementById('agent-apply-filters')?.addEventListener('click', async () => {
  agentCurrentPage = 1;
  await loadAgentLeads(); // Reload leads with current filters applied
});
loadAgentLeads();

flatpickr("#agent-date-range", {
  mode: "range",
  dateFormat: "Y-m-d",
  rangeSeparator: " to " // ✅ CORRECT placement
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

document.getElementById('agent-next-page')?.addEventListener('click', async () => {
  if (agentCurrentPage < agentTotalPages) {
    agentCurrentPage++;
    await loadAgentLeads();
  }
});

document.getElementById('agent-prev-page')?.addEventListener('click', async () => {
  if (agentCurrentPage > 1) {
    agentCurrentPage--;
    await loadAgentLeads();
  }
});

//Print, CSV, and PDF Export
const csvBtn = document.getElementById('agent-export-csv');
const printBtn = document.getElementById('agent-export-print');
const pdfBtn = document.getElementById('agent-export-pdf');

// CSV Export
csvBtn?.addEventListener("click", () => {
  const leads = getSelectedLeadsData();
  if (!leads.length) return alert("No leads selected.");

  const headers = Object.keys(leads[0]).join(",");
  const rows = leads.map(lead => Object.values(lead).map(v => `"${v}"`).join(","));
  const csv = [headers, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "leads.csv";
  link.click();
});

// Print Export
printBtn?.addEventListener("click", () => {
  const leads = getSelectedLeadsData();
  if (!leads.length) return alert("No leads selected.");

  const printWindow = window.open("", "_blank");
  const content = leads.map(lead => `
    <div class="page">
      <img src="/Pics/img6.png" class="logo" />
      <div class="title">Family Values Insurance Agency</div>
      <div class="subtitle">Lead Confirmation Form</div>
      <p><span class="label">First Name:</span> ${lead.first_name}</p>
      <p><span class="label">Last Name:</span> ${lead.last_name}</p>
      <p><span class="label">Age:</span> ${lead.age}</p>
      <p><span class="label">Phone:</span> ${lead.phone}</p>
      <p><span class="label">Lead Type:</span> ${lead.leadType}</p>
      <p><span class="label">City:</span> ${lead.city}</p>
      <p><span class="label">State:</span> ${lead.state}</p>
      <p><span class="label">ZIP:</span> ${lead.zip}</p>
      <p><span class="label">Address:</span> ${lead.address}</p>
      <p><span class="label">Agent Assigned:</span> ${lead.agent}</p>
      <p><span class="label">Submitted At:</span> ${lead.submittedAt}</p>
      <div class="footer">Generated on ${new Date().toLocaleDateString()}</div>
    </div>
  `).join("");

  printWindow.document.write(`
    <html>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Bellota+Text&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Bellota Text', sans-serif;
            padding: 30px;
            text-align: center;
          }
          .logo {
            width: 60px;
            height: 60px;
            object-fit: contain;
            display: block;
            margin: 0 auto 10px auto;
          }
          .label {
            display: inline-block;
            font-weight: bold;
            width: 150px;
            text-align: right;
            margin-right: 10px;
          }
          .value {
            display: inline-block;
            text-align: left;
          }
          p {
            text-align: left;
            margin: 6px 0 6px 100px;
          }
          .footer {
            margin-top: 30px;
            font-size: 10px;
            text-align: center;
            color: #777;
          }
          .lead-page {
            page-break-after: always;
          }
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
        `).join("")}
      </body>
    </html>
  `);
  
  printWindow.document.close();
  printWindow.print();
});

// PDF Export
pdfBtn?.addEventListener("click", () => {
  const leads = getSelectedLeadsData();
  if (!leads.length) return alert("No leads selected.");

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const logo = new Image();
  logo.src = "/Pics/img6.png";

  logo.onload = () => {
    leads.forEach((lead, index) => {
      if (index !== 0) doc.addPage();

      doc.addImage(logo, "PNG", 90, 10, 30, 30); // centered
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text("Family Values Insurance Agency", 105, 50, { align: "center" });

      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.text("Lead Confirmation Form", 105, 60, { align: "center" });

      const startY = 80;
      const lineHeight = 10;
      const labelX = 20;
      const valueX = 70;

      const fields = [
        ["First Name", lead.first_name],
        ["Last Name", lead.last_name],
        ["Age", lead.age],
        ["Phone", lead.phone],
        ["Lead Type", lead.leadType],
        ["City", lead.city],
        ["State", lead.state],
        ["ZIP", lead.zip],
        ["Address", lead.address],
        ["Agent Assigned", lead.agent],
        ["Submitted At", lead.submittedAt],
      ];

      fields.forEach(([label, value], i) => {
        const y = startY + i * lineHeight;
        doc.setFont("helvetica", "bold");
        doc.text(`${label}:`, labelX, y);
        doc.setFont("helvetica", "normal");
        doc.text(value || "—", valueX, y);
      });

      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text(`Generated on ${new Date().toLocaleDateString()}`, 105, 285, { align: "center" });
    });

    doc.save("FVIA_Leads.pdf");
  };

  logo.onerror = () => alert("❌ Failed to load logo.");
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
