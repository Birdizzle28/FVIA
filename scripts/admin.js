//// Import Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'eyJh...TDT5Ho');  // keys truncated for brevity

// Global state variables
let agentLeadsAll = [];
let sortField = 'created_at';
let sortAsc = false;
let notesFilterTimeout;

function updateAgentPaginationControls() {
  document.getElementById('agent-current-page').textContent = `Page ${agentCurrentPage}`;
  document.getElementById('agent-prev-page').disabled = agentCurrentPage === 1;
  document.getElementById('agent-next-page').disabled = agentCurrentPage === agentTotalPages;
}
let agentCurrentPage = 1;
let agentTotalPages = 1;
const pageSize = 25;
let agentProfile = null;

async function fetchAgentProfile() {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    console.error("User not found or not logged in.");
    return;
  }
  const { data, error } = await supabase.from('agents').select('*').eq('id', user.id).single();
  if (error) {
    console.error('Error fetching agent profile:', error);
  } else {
    agentProfile = data;
  }
}

// Populate product type dropdown (for lead forms and filters)
async function populateProductTypeDropdown(dropdownId) {
  const { data: userRes } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from('agents').select('product_types').eq('id', userRes.data.user.id).single();
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  if (dropdownId.includes('filter') || dropdownId.includes('agent-product-type')) {
    dropdown.innerHTML = '<option value="">Any</option>';
  } else {
    dropdown.innerHTML = '<option value="">Select product type</option>';
  }
  if (profile?.product_types?.length > 0) {
    profile.product_types.forEach(type => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = type;
      dropdown.appendChild(option);
    });
  }
}

// ✅ Session check and initial setup
document.addEventListener('DOMContentLoaded', async () => {
  const stateSelect1 = document.getElementById('lead-state');
  const stateSelect2 = document.getElementById('request-state');

  const toggle = document.getElementById("agent-hub-toggle");
  const menu = document.getElementById("agent-hub-menu");
  // Ensure dropdown menu hidden initially
  menu.style.display = "none";
  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      menu.style.display = "none";
    }
  });

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
  const user = session.user;

  // Load profile info and populate dropdowns
  const { data: profile } = await supabase.from('agents').select('*').eq('id', user.id).single();
  console.log("Fetched profile:", profile);
  if (!profile.is_admin) {
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) adminLink.style.display = 'none';
  }

  // Populate product type options for forms and filters
  await populateProductTypeDropdown('lead-product-type');    // Lead submission form
  await populateProductTypeDropdown('filter-product-type');  // Lead request form
  await populateProductTypeDropdown('agent-product-type-filter');  // Lead viewer filter
  await fetchAgentProfile();

  // Format phone number inputs as (123) 456-7890 while typing
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

  async function geocodeAddress(address) {
    const apiKey = 'AIzaSyC...';  // 🔁 Replace with actual API key
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'OK' && data.results.length > 0) {
        const location = data.results[0].geometry.location;
        return { lat: location.lat, lng: location.lng };
      } else {
        console.warn('Geocoding failed:', data.status);
        return { lat: null, lng: null };
      }
    } catch (error) {
      console.error('Error during geocoding:', error);
      return { lat: null, lng: null };
    }
  }

  // Lead submission form handler (insert or update)
  document.getElementById('lead-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const stateValue = document.getElementById('lead-state').value;
    if (!stateValue) {
      alert("Please select a valid state before submitting.");
      return;
    }
    const editingId = document.getElementById('editing-lead-id').value;
    if (editingId) {
      // Update existing lead
      const productType = document.getElementById('lead-product-type').value;
      const fullAddress = `${document.getElementById('lead-address').value}, ${document.getElementById('lead-city').value}, ${document.getElementById('lead-state').value} ${document.getElementById('lead-zip').value}`;
      const { lat, lng } = await geocodeAddress(fullAddress);
      const session = await supabase.auth.getSession();
      const user = session.data.session.user;
      const phones = Array.from(document.querySelectorAll('[name="lead-phone"]')).map(p => p.value);
      console.log("Updating lead ID:", editingId);
      const { error: updateError } = await supabase.from('leads').update({
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
        product_type: productType,
        lat, lng
      }).eq('id', editingId);
      document.getElementById('lead-message').textContent = updateError ? 'Failed to update lead.' : 'Lead updated!';
      if (!updateError) {
        await loadAgentLeads();  // Refresh the leads table
        // Reset form and editing state
        document.getElementById('lead-form').reset();
        document.querySelectorAll('#phone-inputs .phone-line').forEach((line, idx) => {
          if (idx > 0) line.remove();
        });
        document.getElementById('submit-section').style.display = 'none';
        document.getElementById('view-section').style.display = 'block';
        document.getElementById('nav-submit').classList.remove('active');
        document.getElementById('nav-view').classList.add('active');
        document.getElementById('editing-lead-id').value = '';
        document.querySelector('#submit-section h3').textContent = 'Submit a Lead';
      }
      return;
    }
    // Insert new lead
    const assignedAt = new Date().toISOString();
    const productType = document.getElementById('lead-product-type').value;
    const fullAddress = `${document.getElementById('lead-address').value}, ${document.getElementById('lead-city').value}, ${document.getElementById('lead-state').value} ${document.getElementById('lead-zip').value}`;
    const { lat, lng } = await geocodeAddress(fullAddress);
    const session = await supabase.auth.getSession();
    const user = session.data.session.user;
    const phones = Array.from(document.querySelectorAll('[name="lead-phone"]')).map(p => p.value);
    console.log("Submitting with product type:", productType);
    const { error } = await supabase.from('leads').insert({
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
      submitted_by: user.id,
      submitted_by_name: agentProfile?.full_name || 'Unknown',
      product_type: productType,
      lat,
      lng,
      assigned_at: assignedAt
    });
    document.getElementById('lead-message').textContent = error ? 'Failed to submit lead.' : 'Lead submitted!';
  });

  // Lead request form submit handler
  document.getElementById('lead-request-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const stateValue = document.getElementById('request-state').value;
    if (!stateValue) {
      alert("Please select a valid state before submitting.");
      return;
    }
    const messageEl = document.getElementById('request-message');
    messageEl.textContent = '';
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
        product_type: document.getElementById('filter-product-type').value,
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

  // Load agent leads (with filters, sorting, and pagination)
  async function loadAgentLeads() {
    const session = await supabase.auth.getSession();
    const user = session.data.session.user;
    let query = supabase.from('leads').select('*').eq('assigned_to', user.id).eq('archived', false);

    // ✅ Gather filter values
    const filters = {
      first_name: document.getElementById('agent-first-name-filter')?.value.trim(),
      last_name: document.getElementById('agent-last-name-filter')?.value.trim(),
      zip: document.getElementById('agent-zip-filter')?.value.trim(),
      city: document.getElementById('agent-city-filter')?.value.trim(),
      state: document.getElementById('agent-state-filter')?.value.trim(),
      lead_type: document.getElementById('agent-lead-type-filter')?.value.trim(),
      product_type: document.getElementById('agent-product-type-filter')?.value.trim(),
      notes: document.getElementById('agent-notes-filter')?.value.trim()
    };
    const dateRange = document.getElementById('agent-date-range')?.value;
    const order = document.getElementById('agent-date-order')?.value || 'desc';

    // ✅ Apply string filters (case-insensitive partial match)
    for (const [key, value] of Object.entries(filters)) {
      if (value) query = query.ilike(key, `%${value}%`);
    }

    // ✅ Apply date range if selected
    if (dateRange && dateRange.includes(' to ')) {
      const [start, end] = dateRange.split(/\s*to\s*/);
      const startDate = new Date(start);
      const endDate = new Date(end);
      endDate.setHours(23, 59, 59, 999);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        console.warn('⛔ Invalid date format detected');
      } else if (startDate > endDate) {
        console.warn('⛔ Start date is after end date!');
      } else {
        query = query.gte('created_at', startDate.toISOString()).lte('created_at', endDate.toISOString());
      }
    }

    // ✅ Apply default order (by date created)
    query = query.order('created_at', { ascending: order === 'asc' });

    // ✅ Fetch data
    const { data: leads, error } = await query;
    if (error) {
      console.error('❌ Error loading leads:', error);
      return;
    }

    // ✅ Prepare data for display (apply any custom sorting)
    agentLeadsAll = leads || [];
    if (sortField && sortField !== 'created_at') {
      agentLeadsAll.sort((a, b) => {
        let aVal = a[sortField], bVal = b[sortField];
        if (aVal === null || aVal === undefined) aVal = '';
        if (bVal === null || bVal === undefined) bVal = '';
        if (sortField === 'created_at') {
          // Compare by date
          return sortAsc ? new Date(aVal) - new Date(bVal) : new Date(bVal) - new Date(aVal);
        }
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
        }
        // numeric or other types
        return sortAsc ? aVal - bVal : bVal - aVal;
      });
    }

    // ✅ Paginate and render table
    agentTotalPages = Math.ceil(agentLeadsAll.length / pageSize) || 1;
    if (agentCurrentPage > agentTotalPages) agentCurrentPage = agentTotalPages;
    const start = (agentCurrentPage - 1) * pageSize;
    const paginatedLeads = agentLeadsAll.slice(start, start + pageSize);
    const tbody = document.querySelector('#agent-leads-table tbody');
    tbody.innerHTML = '';
    paginatedLeads.forEach(lead => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td><input type="checkbox" class="lead-checkbox" data-lead-id="${lead.id}"></td>
        <td class="lead-date">${new Date(lead.created_at).toLocaleDateString()}</td>
        <td class="lead-agent">${lead.submitted_by_name || ''}</td>
        <td class="lead-name">${lead.first_name || ''}</td>
        <td class="lead-last">${lead.last_name || ''}</td>
        <td class="lead-age">${lead.age ?? ''}</td>
        <td class="lead-phone">${(lead.phone || []).join(', ')}</td>
        <td class="lead-address">${lead.address || ''}</td>
        <td class="lead-city">${lead.city || ''}</td>
        <td class="lead-state">${lead.state || ''}</td>
        <td class="lead-zip">${lead.zip || ''}</td>
        <td class="lead-type">${lead.lead_type || ''}</td>
        <td class="lead-product-type">${lead.product_type || ''}</td>
        <td class="lead-notes">${lead.notes || ''}</td>
      `;
      tbody.appendChild(row);
    });
    updateAgentPaginationControls();
    console.log('Date range value:', document.getElementById('agent-date-range').value);
    // Uncheck master checkbox after reload
    const selectAllCb = document.getElementById('select-all');
    if (selectAllCb) selectAllCb.checked = false;
  }

  // Initial load
  await loadAgentLeads();

  // Initialize date range picker
  flatpickr("#agent-date-range", {
    mode: "range",
    dateFormat: "Y-m-d",
    rangeSeparator: " to "
  });

  // Filter apply/reset event handlers
  document.getElementById('agent-apply-filters')?.addEventListener('click', async () => {
    agentCurrentPage = 1;
    await loadAgentLeads();
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
    document.getElementById('agent-product-type-filter').value = '';
    document.getElementById('agent-notes-filter').value = '';
    agentCurrentPage = 1;
    loadAgentLeads();
  });

  // Enable Choices.js for state filter dropdown
  const agentStateFilter = document.getElementById('agent-state-filter');
  if (agentStateFilter) new Choices(agentStateFilter, {
    searchEnabled: true,
    shouldSort: false,
    placeholder: true,
    searchPlaceholderValue: 'Type to filter…'
  });

  // Pagination controls
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

  // Phone field add/remove (already formatted via formatPhoneInput)
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
  document.getElementById('phone-inputs')?.addEventListener('click', (e) => {
    if (e.target.classList.contains('remove-phone-btn')) {
      e.target.parentElement.remove();
    }
  });
  //Active page highlight tab
  const agentHubBtn = document.getElementById('admin-tab');
  const hubPages = ['admin']; // Add more if needed 
  console.log("Page Path:", window.location.pathname); // debug
  console.log("Found Agent Hub Button:", agentHubBtn); // debug
  if (hubPages.some(page => window.location.pathname.includes(page))) {
    agentHubBtn?.classList.add('active-page');
  } else {
    agentHubBtn?.classList.remove('active-page');
  }
});

// Logout button handler
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signOut();
  if (error) {
    alert('Logout failed!');
    console.error(error);
  } else {
    window.location.href = '../index.html';
  }
});

// === New Event Handlers for Navigation, Sorting, Filters ===

// Cached element references for nav and sections
const navView = document.getElementById('nav-view');
const navSubmit = document.getElementById('nav-submit');
const navRequest = document.getElementById('nav-request');
const viewSection = document.getElementById('view-section');
const submitSection = document.getElementById('submit-section');
const requestSection = document.getElementById('request-section');
const editingLeadIdInput = document.getElementById('editing-lead-id');

// Navigation tab click events
navView?.addEventListener('click', () => {
  viewSection.style.display = 'block';
  submitSection.style.display = 'none';
  requestSection.style.display = 'none';
  navView.classList.add('active');
  navSubmit.classList.remove('active');
  navRequest.classList.remove('active');
  // Cancel edit mode if leaving submit section
  if (editingLeadIdInput.value) {
    editingLeadIdInput.value = '';
    document.querySelector('#submit-section h3').textContent = 'Submit a Lead';
  }
});
navSubmit?.addEventListener('click', () => {
  viewSection.style.display = 'none';
  submitSection.style.display = 'block';
  requestSection.style.display = 'none';
  navView.classList.remove('active');
  navSubmit.classList.add('active');
  navRequest.classList.remove('active');
  if (editingLeadIdInput.value) {
    // If an edit was in progress and user explicitly clicked "Submit", reset form to fresh
    editingLeadIdInput.value = '';
    document.querySelector('#submit-section h3').textContent = 'Submit a Lead';
    document.getElementById('lead-form').reset();
    // Remove extra phone fields except the first one
    const phoneLines = document.querySelectorAll('#phone-inputs .phone-line');
    phoneLines.forEach((line, idx) => {
      if (idx > 0) line.remove();
      else line.querySelector('input').value = '';
    });
  }
});
navRequest?.addEventListener('click', () => {
  viewSection.style.display = 'none';
  submitSection.style.display = 'none';
  requestSection.style.display = 'block';
  navView.classList.remove('active');
  navSubmit.classList.remove('active');
  navRequest.classList.add('active');
  if (editingLeadIdInput.value) {
    // Cancel any edit mode if switching to Request section
    editingLeadIdInput.value = '';
    document.querySelector('#submit-section h3').textContent = 'Submit a Lead';
    document.getElementById('lead-form').reset();
    document.querySelectorAll('#phone-inputs .phone-line').forEach((line, idx) => {
      if (idx > 0) line.remove();
      else line.querySelector('input').value = '';
    });
  }
});

// Master checkbox event
document.getElementById('select-all')?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.lead-checkbox').forEach(cb => { cb.checked = checked; });
});

// Dynamic notes filter: filter leads as user types
document.getElementById('agent-notes-filter')?.addEventListener('input', () => {
  clearTimeout(notesFilterTimeout);
  notesFilterTimeout = setTimeout(() => {
    agentCurrentPage = 1;
    loadAgentLeads();
  }, 300);
});

// Clickable column sorting
function sortAgentLeadsBy(field) {
  if (field === sortField) {
    // Toggle sort direction if same field clicked
    sortAsc = !sortAsc;
  } else {
    // New sort field
    sortField = field;
    sortAsc = true;
  }
  // Apply sorting on the full list and re-render
  agentLeadsAll.sort((a, b) => {
    let aVal = a[field], bVal = b[field];
    if (aVal === null || aVal === undefined) aVal = '';
    if (bVal === null || bVal === undefined) bVal = '';
    if (field === 'created_at') {
      return sortAsc ? new Date(aVal) - new Date(bVal) : new Date(bVal) - new Date(aVal);
    }
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }
    return sortAsc ? aVal - bVal : bVal - aVal;
  });
  agentCurrentPage = 1;
  // Re-render current page of sorted data
  const tbody = document.querySelector('#agent-leads-table tbody');
  tbody.innerHTML = '';
  agentTotalPages = Math.ceil(agentLeadsAll.length / pageSize) || 1;
  const paginatedLeads = agentLeadsAll.slice(0, pageSize);
  paginatedLeads.forEach(lead => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="checkbox" class="lead-checkbox" data-lead-id="${lead.id}"></td>
      <td class="lead-date">${new Date(lead.created_at).toLocaleDateString()}</td>
      <td class="lead-agent">${lead.submitted_by_name || ''}</td>
      <td class="lead-name">${lead.first_name || ''}</td>
      <td class="lead-last">${lead.last_name || ''}</td>
      <td class="lead-age">${lead.age ?? ''}</td>
      <td class="lead-phone">${(lead.phone || []).join(', ')}</td>
      <td class="lead-address">${lead.address || ''}</td>
      <td class="lead-city">${lead.city || ''}</td>
      <td class="lead-state">${lead.state || ''}</td>
      <td class="lead-zip">${lead.zip || ''}</td>
      <td class="lead-type">${lead.lead_type || ''}</td>
      <td class="lead-product-type">${lead.product_type || ''}</td>
      <td class="lead-notes">${lead.notes || ''}</td>
    `;
    tbody.appendChild(row);
  });
  updateAgentPaginationControls();
  document.getElementById('select-all').checked = false;
}

// Attach sorting event to all table headers (except the master checkbox column)
const headerCells = document.querySelectorAll('#agent-leads-table thead th');
headerCells.forEach(th => {
  const colName = th.textContent.trim();
  let field;
  switch (colName) {
    case 'Submitted': field = 'created_at'; break;
    case 'Agent': field = 'submitted_by_name'; break;
    case 'First': field = 'first_name'; break;
    case 'Last': field = 'last_name'; break;
    case 'Age': field = 'age'; break;
    case 'Phone(s)': field = 'phone'; break;
    case 'Address': field = 'address'; break;
    case 'City': field = 'city'; break;
    case 'State': field = 'state'; break;
    case 'ZIP': field = 'zip'; break;
    case 'Type': field = 'lead_type'; break;
    case 'Product Type': field = 'product_type'; break;
    case 'Notes': field = 'notes'; break;
    default: field = null;
  }
  if (field) {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => sortAgentLeadsBy(field));
  }
});

// Edit and Archive actions for selected leads
document.getElementById('agent-edit-btn')?.addEventListener('click', () => {
  const checkboxes = document.querySelectorAll('.lead-checkbox:checked');
  if (!checkboxes.length) {
    alert("No leads selected.");
    return;
  }
  if (checkboxes.length > 1) {
    alert("Please select only one lead to edit at a time.");
    return;
  }
  const leadId = checkboxes[0].dataset.leadId;
  const lead = agentLeadsAll.find(l => l.id === leadId);
  if (!lead) {
    alert("Lead data not found.");
    return;
  }
  // Switch to Submit section for editing
  navSubmit.click();
  document.querySelector('#submit-section h3').textContent = 'Edit Lead';
  editingLeadIdInput.value = leadId;
  // Populate form fields with lead data
  document.getElementById('lead-first').value = lead.first_name || '';
  document.getElementById('lead-last').value = lead.last_name || '';
  document.getElementById('lead-age').value = lead.age ?? '';
  document.getElementById('lead-address').value = lead.address || '';
  document.getElementById('lead-city').value = lead.city || '';
  document.getElementById('lead-state').value = lead.state || '';
  document.getElementById('lead-zip').value = lead.zip || '';
  document.getElementById('lead-type').value = lead.lead_type || '';
  document.getElementById('lead-product-type').value = lead.product_type || '';
  document.getElementById('lead-notes').value = lead.notes || '';
  // Reset phone inputs and populate phone numbers
  const phoneInputsDiv = document.getElementById('phone-inputs');
  phoneInputsDiv.querySelectorAll('.phone-line').forEach((line, idx) => {
    if (idx > 0) line.remove();
  });
  const firstPhoneInput = phoneInputsDiv.querySelector('input[name="lead-phone"]');
  if (lead.phone && lead.phone.length > 0) {
    firstPhoneInput.value = lead.phone[0] || '';
    for (let i = 1; i < lead.phone.length; i++) {
      document.querySelector('.add-phone-btn').click();
      const phoneFields = phoneInputsDiv.querySelectorAll('input[name="lead-phone"]');
      phoneFields[phoneFields.length - 1].value = lead.phone[i];
    }
  } else {
    firstPhoneInput.value = '';
  }
});
document.getElementById('agent-archive-btn')?.addEventListener('click', async () => {
  const checkboxes = document.querySelectorAll('.lead-checkbox:checked');
  if (!checkboxes.length) {
    alert("No leads selected.");
    return;
  }
  if (!confirm("Archive selected leads?")) {
    return;
  }
  const ids = Array.from(checkboxes).map(cb => cb.dataset.leadId);
  const { error } = await supabase.from('leads').update({ archived: true }).in('id', ids);
  if (error) {
    console.error('Error archiving leads:', error);
    alert('Failed to archive selected leads.');
  } else {
    await loadAgentLeads();
    alert('Selected leads archived.');
  }
});

// Extend data export to include Product Type
window.getSelectedLeadsData = function () {
  return Array.from(document.querySelectorAll('input[type="checkbox"].lead-checkbox:checked')).map(cb => {
    const row = cb.closest("tr");
    return {
      first_name: row.querySelector(".lead-name")?.textContent.trim() || "",
      last_name: row.querySelector(".lead-last")?.textContent.trim() || "",
      age: row.querySelector(".lead-age")?.textContent.trim() || "",
      phone: row.querySelector(".lead-phone")?.textContent.trim() || "",
      leadType: row.querySelector(".lead-type")?.textContent.trim() || "",
      productType: row.querySelector(".lead-product-type")?.textContent.trim() || "",
      city: row.querySelector(".lead-city")?.textContent.trim() || "",
      state: row.querySelector(".lead-state")?.textContent.trim() || "",
      zip: row.querySelector(".lead-zip")?.textContent.trim() || "",
      address: row.querySelector(".lead-address")?.textContent.trim() || "",
      agent: row.querySelector(".lead-agent")?.textContent.trim() || "",
      submittedAt: row.querySelector(".lead-date")?.textContent.trim() || ""
    };
  });
};

// CSV Export
const csvBtn = document.getElementById('agent-export-csv');
const printBtn = document.getElementById('agent-export-print');
const pdfBtn = document.getElementById('agent-export-pdf');
const exportBtn = document.getElementById('agent-export-btn');
const exportOptions = document.getElementById('agent-export-options');
exportBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  exportOptions.style.display = exportOptions.style.display === 'block' ? 'none' : 'block';
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#agent-export-controls')) {
    exportOptions.style.display = 'none';
  }
});
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
      <p><span class="label">Product Type:</span> ${lead.productType}</p>
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
          .title {
            font-size: 20px;
            font-weight: bold;
          }
          .subtitle {
            font-size: 16px;
            margin-bottom: 20px;
          }
          .label {
            display: inline-block;
            font-weight: bold;
            width: 150px;
            text-align: right;
            margin-right: 10px;
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
            <h3>Lead Confirmation Form</h3>
            <p><span class="label">First Name:</span> ${lead.first_name}</p>
            <p><span class="label">Last Name:</span> ${lead.last_name}</p>
            <p><span class="label">Age:</span> ${lead.age}</p>
            <p><span class="label">Phone:</span> ${lead.phone}</p>
            <p><span class="label">Lead Type:</span> ${lead.leadType}</p>
            <p><span class="label">Product Type:</span> ${lead.productType}</p>
            <p><span class="label">City:</span> ${lead.city}</p>
            <p><span class="label">State:</span> ${lead.state}</p>
            <p><span class="label">ZIP:</span> ${lead.zip}</p>
            <p><span class="label">Address:</span> ${lead.address}</p>
            <p><span class="label">Agent Assigned:</span> ${lead.agent}</p>
            <p><span class="label">Submitted At:</span> ${lead.submittedAt}</p>
            <div class="footer">Generated on ${new Date().toLocaleDateString()}</div>
          </div>
        `).join("")}
      </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 1000);
});

// PDF Export (using jsPDF and autoTable)
pdfBtn?.addEventListener("click", async () => {
  const leads = getSelectedLeadsData();
  if (!leads.length) return alert("No leads selected.");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const columns = [
    "First Name", "Last Name", "Age", "Phone", "Lead Type", "Product Type",
    "City", "State", "ZIP", "Address", "Agent", "Submitted At"
  ];
  const rows = leads.map(lead => [
    lead.first_name, lead.last_name, lead.age, lead.phone, lead.leadType, lead.productType,
    lead.city, lead.state, lead.zip, lead.address, lead.agent, lead.submittedAt
  ]);
  doc.autoTable({ head: [columns], body: rows, startY: 20 });
  doc.text("Leads Export", 14, 15);
  doc.save("leads.pdf");
});
