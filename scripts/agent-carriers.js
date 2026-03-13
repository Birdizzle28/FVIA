document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.supabaseClient;
  if (!supabase) {
    console.error('Supabase client not found.');
    return;
  }

  const form = document.getElementById('agent-carriers-form');
  const agentSelect = document.getElementById('agent-id');
  const carrierSelect = document.getElementById('carrier-id');
  const statusSelect = document.getElementById('status');
  const writingNumberInput = document.getElementById('writing-number');
  const npnInput = document.getElementById('npn');
  const effectiveDateInput = document.getElementById('effective-date');
  const terminatedDateInput = document.getElementById('terminated-date');
  const isContractedInput = document.getElementById('is-contracted');
  const isAppointedInput = document.getElementById('is-appointed');
  const statesSelect = document.getElementById('states');
  const productTypesSelect = document.getElementById('product-types');
  const formMessage = document.getElementById('form-message');
  const resetBtn = document.getElementById('reset-form-btn');
  const searchInput = document.getElementById('search-input');
  const tbody = document.getElementById('agent-carriers-tbody');

  let allRows = [];

  function getMultiValues(selectEl) {
    return Array.from(selectEl.selectedOptions).map(opt => opt.value);
  }

  function setMessage(text, type = '') {
    formMessage.textContent = text;
    formMessage.className = 'form-message';
    if (type) formMessage.classList.add(type);
  }

  function resetForm() {
    form.reset();
    statusSelect.value = 'inactive';
    isContractedInput.checked = true;
    isAppointedInput.checked = false;

    Array.from(statesSelect.options).forEach(opt => (opt.selected = false));
    Array.from(productTypesSelect.options).forEach(opt => (opt.selected = false));

    setMessage('');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString();
  }

  function makeBadge(status) {
    const normalized = (status || 'inactive').toLowerCase();
    return `<span class="badge ${normalized}">${normalized}</span>`;
  }

  function makeBoolPill(value) {
    if (value) {
      return `<span class="bool-pill yes"><i class="fa-solid fa-circle-check"></i> Yes</span>`;
    }
    return `<span class="bool-pill no"><i class="fa-solid fa-circle-xmark"></i> No</span>`;
  }

  function makeInlineChips(items) {
    if (!items || !items.length) return '—';
    return `
      <div class="inline-list">
        ${items.map(item => `<span class="inline-chip">${item}</span>`).join('')}
      </div>
    `;
  }

  async function loadAgents() {
    const { data, error } = await supabase
      .from('agents')
      .select('id, full_name, email')
      .order('full_name', { ascending: true });

    if (error) {
      console.error('Error loading agents:', error);
      return;
    }

    agentSelect.innerHTML = '<option value="">Select agent</option>';

    (data || []).forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.full_name || agent.email || agent.id;
      agentSelect.appendChild(opt);
    });
  }

  async function loadCarriers() {
    const { data, error } = await supabase
      .from('carriers')
      .select('id, carrier_name')
      .order('carrier_name', { ascending: true });

    if (error) {
      console.error('Error loading carriers:', error);
      return;
    }

    carrierSelect.innerHTML = '<option value="">Select carrier</option>';

    (data || []).forEach(carrier => {
      const opt = document.createElement('option');
      opt.value = carrier.id;
      opt.textContent = carrier.carrier_name || carrier.id;
      carrierSelect.appendChild(opt);
    });
  }

  async function loadAgentCarriers() {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">Loading...</td></tr>';

    const { data, error } = await supabase
      .from('agent_carriers')
      .select(`
        id,
        created_at,
        agent_id,
        carrier_id,
        is_contracted,
        is_appointed,
        status,
        writing_number,
        npn,
        states,
        product_types,
        effective_date,
        terminated_date,
        agents:agent_id ( full_name, email ),
        carriers:carrier_id ( carrier_name )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading agent_carriers:', error);
      tbody.innerHTML = '<tr><td colspan="12" class="empty-row">Error loading rows.</td></tr>';
      return;
    }

    allRows = data || [];
    renderRows(allRows);
  }

  function renderRows(rows) {
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No agent carrier rows found.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const agentName = row.agents?.full_name || row.agents?.email || row.agent_id;
      const carrierName = row.carriers?.carrier_name || row.carrier_id;

      return `
        <tr>
          <td>${agentName}</td>
          <td>${carrierName}</td>
          <td>${makeBadge(row.status)}</td>
          <td>${makeBoolPill(row.is_contracted)}</td>
          <td>${makeBoolPill(row.is_appointed)}</td>
          <td>${makeInlineChips(row.states)}</td>
          <td>${makeInlineChips(row.product_types)}</td>
          <td>${row.writing_number || '—'}</td>
          <td>${row.npn || '—'}</td>
          <td>${formatDate(row.effective_date)}</td>
          <td>${formatDate(row.terminated_date)}</td>
          <td>
            <button class="delete-btn" data-id="${row.id}" type="button">
              <i class="fa-solid fa-trash"></i> Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');

    attachDeleteHandlers();
  }

  function applySearch() {
    const term = (searchInput.value || '').trim().toLowerCase();

    if (!term) {
      renderRows(allRows);
      return;
    }

    const filtered = allRows.filter(row => {
      const haystack = [
        row.agents?.full_name,
        row.agents?.email,
        row.carriers?.carrier_name,
        row.status,
        row.writing_number,
        row.npn,
        ...(row.states || []),
        ...(row.product_types || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });

    renderRows(filtered);
  }

  async function handleDelete(id) {
    const confirmed = confirm('Delete this agent carrier row?');
    if (!confirmed) return;

    const { error } = await supabase
      .from('agent_carriers')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting row:', error);
      alert('Could not delete row: ' + error.message);
      return;
    }

    await loadAgentCarriers();
  }

  function attachDeleteHandlers() {
    document.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;
        await handleDelete(id);
      });
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMessage('');

    const agent_id = agentSelect.value;
    const carrier_id = carrierSelect.value;

    if (!agent_id || !carrier_id) {
      setMessage('Please select both an agent and a carrier.', 'error');
      return;
    }

    const payload = {
      agent_id,
      carrier_id,
      is_contracted: isContractedInput.checked,
      is_appointed: isAppointedInput.checked,
      status: statusSelect.value || 'inactive',
      writing_number: writingNumberInput.value.trim() || null,
      npn: npnInput.value.trim() || null,
      states: getMultiValues(statesSelect),
      product_types: getMultiValues(productTypesSelect),
      effective_date: effectiveDateInput.value || null,
      terminated_date: terminatedDateInput.value || null
    };

    const { error } = await supabase
      .from('agent_carriers')
      .upsert(payload, { onConflict: 'agent_id,carrier_id' });

    if (error) {
      console.error('Error saving agent carrier:', error);
      setMessage(error.message, 'error');
      return;
    }

    setMessage('Agent carrier saved successfully.', 'success');
    resetForm();
    await loadAgentCarriers();
  });

  resetBtn.addEventListener('click', resetForm);
  searchInput.addEventListener('input', applySearch);

  await loadAgents();
  await loadCarriers();
  await loadAgentCarriers();
});
