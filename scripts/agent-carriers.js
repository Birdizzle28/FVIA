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
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const searchInput = document.getElementById('search-input');
  const tbody = document.getElementById('agent-carriers-tbody');
  const editingRowIdInput = document.getElementById('editing-row-id');
  const formTitle = document.getElementById('form-title');
  const formSubtitle = document.getElementById('form-subtitle');
  const saveBtn = document.getElementById('save-btn');

  let allRows = [];
  let currentlyEditingId = null;

  function getMultiValues(selectEl) {
    return Array.from(selectEl.selectedOptions).map(opt => opt.value);
  }

  function setSelectedValues(selectEl, values = []) {
    const valueSet = new Set(values || []);
    Array.from(selectEl.options).forEach(option => {
      option.selected = valueSet.has(option.value);
    });
  }

  function setMessage(text, type = '') {
    formMessage.textContent = text;
    formMessage.className = 'form-message';
    if (type) formMessage.classList.add(type);
  }

  function clearEditingHighlight() {
    document.querySelectorAll('#agent-carriers-tbody tr').forEach(tr => {
      tr.classList.remove('editing-row');
    });
  }

  function enterCreateMode() {
    currentlyEditingId = null;
    editingRowIdInput.value = '';
    formTitle.textContent = 'Add Agent Carrier';
    formSubtitle.innerHTML = 'Create a new row in <code>agent_carriers</code>.';
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Agent Carrier';
    cancelEditBtn.classList.add('hidden');
    clearEditingHighlight();
  }

  function resetFormFields() {
    form.reset();
    statusSelect.value = 'inactive';
    isContractedInput.checked = true;
    isAppointedInput.checked = false;
    setSelectedValues(statesSelect, []);
    setSelectedValues(productTypesSelect, []);
  }

  function resetForm() {
    resetFormFields();
    enterCreateMode();
    setMessage('');
  }

  function enterEditMode(row) {
    currentlyEditingId = row.id;
    editingRowIdInput.value = row.id;

    formTitle.textContent = 'Edit Agent Carrier';
    formSubtitle.innerHTML = 'Update this existing <code>agent_carriers</code> row.';
    saveBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Update Agent Carrier';
    cancelEditBtn.classList.remove('hidden');

    agentSelect.value = row.agent_id || '';
    carrierSelect.value = row.carrier_id || '';
    statusSelect.value = row.status || 'inactive';
    writingNumberInput.value = row.writing_number || '';
    npnInput.value = row.npn || '';
    effectiveDateInput.value = row.effective_date || '';
    terminatedDateInput.value = row.terminated_date || '';
    isContractedInput.checked = !!row.is_contracted;
    isAppointedInput.checked = !!row.is_appointed;

    setSelectedValues(statesSelect, row.states || []);
    setSelectedValues(productTypesSelect, row.product_types || []);

    setMessage('Editing row. Make changes and click Update Agent Carrier.', 'success');

    clearEditingHighlight();
    const targetRow = document.querySelector(`#agent-carriers-tbody tr[data-row-id="${row.id}"]`);
    if (targetRow) {
      targetRow.classList.add('editing-row');
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        <tr data-row-id="${row.id}">
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
            <div class="row-actions">
              <button class="edit-btn" data-id="${row.id}" type="button">
                <i class="fa-solid fa-pen"></i> Edit
              </button>
              <button class="delete-btn" data-id="${row.id}" type="button">
                <i class="fa-solid fa-trash"></i> Delete
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    attachRowActionHandlers();

    if (currentlyEditingId) {
      const editingRow = document.querySelector(`#agent-carriers-tbody tr[data-row-id="${currentlyEditingId}"]`);
      if (editingRow) editingRow.classList.add('editing-row');
    }
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

    if (currentlyEditingId === id) {
      resetForm();
    }

    await loadAgentCarriers();
    applySearch();
  }

  function attachRowActionHandlers() {
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const row = allRows.find(item => item.id === id);
        if (!row) return;
        enterEditMode(row);
      });
    });

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

    const editingId = editingRowIdInput.value || null;

    if (editingId) {
      const { error } = await supabase
        .from('agent_carriers')
        .update(payload)
        .eq('id', editingId);

      if (error) {
        console.error('Error updating agent carrier:', error);
        setMessage(error.message, 'error');
        return;
      }

      setMessage('Agent carrier updated successfully.', 'success');
      resetForm();
      await loadAgentCarriers();
      applySearch();
      return;
    }

    const { error } = await supabase
      .from('agent_carriers')
      .insert([payload]);

    if (error) {
      console.error('Error saving agent carrier:', error);
      setMessage(error.message, 'error');
      return;
    }

    setMessage('Agent carrier saved successfully.', 'success');
    resetFormFields();
    await loadAgentCarriers();
    applySearch();
  });

  resetBtn.addEventListener('click', () => {
    resetForm();
  });

  cancelEditBtn.addEventListener('click', () => {
    resetForm();
  });

  searchInput.addEventListener('input', applySearch);

  await loadAgents();
  await loadCarriers();
  resetForm();
  await loadAgentCarriers();
});
