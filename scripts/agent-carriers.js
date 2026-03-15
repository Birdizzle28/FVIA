document.addEventListener('DOMContentLoaded', async () => {
  const supabase = window.supabaseClient;
  if (!supabase) {
    console.error('Supabase client not found.');
    return;
  }

  let currentAdminId = null;

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

  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  const startAgentSelect = document.getElementById('start-agent-select');
  const startCarrierSearch = document.getElementById('start-carrier-search');
  const buildContractingBatchBtn = document.getElementById('build-contracting-batch-btn');
  const clearContractingBatchBtn = document.getElementById('clear-contracting-batch-btn');
  const startContractingMessage = document.getElementById('start-contracting-message');
  const startCarrierRulesGrid = document.getElementById('start-carrier-rules-grid');
  const pendingBatchWrap = document.getElementById('pending-batch-wrap');
  const createContractingRequestsBtn = document.getElementById('create-contracting-requests-btn');
  const launchContractingActionsBtn = document.getElementById('launch-contracting-actions-btn');
  const selectedAgentReadiness = document.getElementById('selected-agent-readiness');
  const contractingRequestsTbody = document.getElementById('contracting-requests-tbody');

  const rulesForm = document.getElementById('contracting-rules-form');
  const ruleCarrierId = document.getElementById('rule-carrier-id');
  const ruleStartMethod = document.getElementById('rule-start-method');
  const ruleDestinationGroup = document.getElementById('rule-destination-group');
  const ruleStartUrl = document.getElementById('rule-start-url');
  const ruleEmailTo = document.getElementById('rule-email-to');
  const ruleEmailCc = document.getElementById('rule-email-cc');
  const ruleEmailBcc = document.getElementById('rule-email-bcc');
  const ruleEmailSubjectTemplate = document.getElementById('rule-email-subject-template');
  const ruleEmailBodyTemplate = document.getElementById('rule-email-body-template');
  const ruleInstructions = document.getElementById('rule-instructions');
  const ruleSortOrder = document.getElementById('rule-sort-order');
  const ruleIsActive = document.getElementById('rule-is-active');
  const ruleSupportsMultiAgent = document.getElementById('rule-supports-multi-agent');
  const ruleSupportsMultiCarrier = document.getElementById('rule-supports-multi-carrier');
  const rulesFormMessage = document.getElementById('rules-form-message');
  const rulesResetBtn = document.getElementById('rules-reset-btn');
  const rulesCancelEditBtn = document.getElementById('rules-cancel-edit-btn');
  const rulesSaveBtn = document.getElementById('rules-save-btn');
  const rulesEditingId = document.getElementById('rules-editing-id');
  const rulesFormTitle = document.getElementById('rules-form-title');
  const rulesFormSubtitle = document.getElementById('rules-form-subtitle');
  const rulesSearchInput = document.getElementById('rules-search-input');
  const contractingRulesTbody = document.getElementById('contracting-rules-tbody');
  const ruleSendAgentPacket = document.getElementById('rule-send-agent-packet');
  const ruleAttachmentUrls = document.getElementById('rule-attachment-urls');
  const ruleAgentPacketSubjectTemplate = document.getElementById('rule-agent-packet-subject-template');
  const ruleAgentPacketBodyTemplate = document.getElementById('rule-agent-packet-body-template');
  const sendAgentPacketsBtn = document.getElementById('send-agent-packets-btn');

  let allRows = [];
  let currentlyEditingId = null;

  let allAgents = [];
  let allCarriers = [];
  let allContractingRules = [];
  let pendingSelections = [];
  let pendingSavedRequests = [];

  let allRulesRows = [];
  let currentlyEditingRuleId = null;

  function getMultiValues(selectEl) {
    return Array.from(selectEl.selectedOptions).map(opt => opt.value);
  }

  function setSelectedValues(selectEl, values = []) {
    const valueSet = new Set(values || []);
    Array.from(selectEl.options).forEach(option => {
      option.selected = valueSet.has(option.value);
    });
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function setMessage(text, type = '') {
    formMessage.textContent = text;
    formMessage.className = 'form-message';
    if (type) formMessage.classList.add(type);
  }

  function setStartMessage(text, type = '') {
    startContractingMessage.textContent = text;
    startContractingMessage.className = 'form-message';
    if (type) startContractingMessage.classList.add(type);
  }

  function clearEditingHighlight() {
    document.querySelectorAll('#agent-carriers-tbody tr').forEach(tr => {
      tr.classList.remove('editing-row');
    });
  }

  function parseLineList(value) {
    return String(value || '')
      .split('\n')
      .map(v => v.trim())
      .filter(Boolean);
  }
  
  function fillPacketTemplate(template, agent, carrierNames, destinationEmail = '') {
    const namesList = carrierNames.map(name => `- ${name}`).join('\n');
  
    return String(template || '')
      .replaceAll('{{agent_name}}', agent.full_name || '')
      .replaceAll('{{agent_email}}', agent.email || '')
      .replaceAll('{{agent_id}}', agent.agent_id || '')
      .replaceAll('{{carrier_names}}', carrierNames.join(', '))
      .replaceAll('{{carrier_names_list}}', namesList)
      .replaceAll('{{destination_email}}', destinationEmail || '');
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

  function parseEmailList(value) {
    return String(value || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }
  
  function setRulesMessage(text, type = '') {
    rulesFormMessage.textContent = text;
    rulesFormMessage.className = 'form-message';
    if (type) rulesFormMessage.classList.add(type);
  }
  
  function resetRulesFormFields() {
    rulesForm.reset();
    ruleIsActive.checked = true;
    ruleSupportsMultiAgent.checked = false;
    ruleSupportsMultiCarrier.checked = false;
    ruleSortOrder.value = 0;
    ruleSendAgentPacket.checked = false;
    ruleAttachmentUrls.value = '';
    ruleAgentPacketSubjectTemplate.value = '';
    ruleAgentPacketBodyTemplate.value = '';
  }
  
  function enterRulesCreateMode() {
    currentlyEditingRuleId = null;
    rulesEditingId.value = '';
    rulesFormTitle.textContent = 'Add Contracting Rule';
    rulesFormSubtitle.textContent = 'Define how a carrier gets started in the Start Contracting tab.';
    rulesSaveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Rule';
    rulesCancelEditBtn.classList.add('hidden');
  
    document.querySelectorAll('#contracting-rules-tbody tr').forEach(tr => {
      tr.classList.remove('editing-row');
    });
  }
  
  function resetRulesForm() {
    resetRulesFormFields();
    enterRulesCreateMode();
    setRulesMessage('');
  }
  
  function enterRulesEditMode(row) {
    currentlyEditingRuleId = row.id;
    rulesEditingId.value = row.id;
  
    rulesFormTitle.textContent = 'Edit Contracting Rule';
    rulesFormSubtitle.textContent = 'Update this carrier contracting rule.';
    rulesSaveBtn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Update Rule';
    rulesCancelEditBtn.classList.remove('hidden');
  
    ruleCarrierId.value = row.carrier_id || '';
    ruleStartMethod.value = row.start_method || 'link';
    ruleDestinationGroup.value = row.destination_group || '';
    ruleStartUrl.value = row.start_url || '';
    ruleEmailTo.value = (row.email_to || []).join(', ');
    ruleEmailCc.value = (row.email_cc || []).join(', ');
    ruleEmailBcc.value = (row.email_bcc || []).join(', ');
    ruleEmailSubjectTemplate.value = row.email_subject_template || '';
    ruleEmailBodyTemplate.value = row.email_body_template || '';
    ruleInstructions.value = row.instructions || '';
    ruleSortOrder.value = row.sort_order ?? 0;
    ruleIsActive.checked = !!row.is_active;
    ruleSupportsMultiAgent.checked = !!row.supports_multi_agent_batch;
    ruleSupportsMultiCarrier.checked = !!row.supports_multi_carrier_batch;

    ruleSendAgentPacket.checked = !!row.send_agent_packet;
    ruleAttachmentUrls.value = (row.attachment_urls || []).join('\n');
    ruleAgentPacketSubjectTemplate.value = row.agent_packet_subject_template || '';
    ruleAgentPacketBodyTemplate.value = row.agent_packet_body_template || '';
  
    document.querySelectorAll('#contracting-rules-tbody tr').forEach(tr => {
      tr.classList.remove('editing-row');
    });
  
    const targetRow = document.querySelector(`#contracting-rules-tbody tr[data-rule-id="${row.id}"]`);
    if (targetRow) {
      targetRow.classList.add('editing-row');
      targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  
    rulesForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setRulesMessage('Editing rule. Make changes and click Update Rule.', 'success');
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

  function makeMethodBadge(method) {
    const normalized = (method || 'manual').toLowerCase();
    return `<span class="method-badge ${normalized}">${escapeHtml(normalized)}</span>`;
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
        ${items.map(item => `<span class="inline-chip">${escapeHtml(item)}</span>`).join('')}
      </div>
    `;
  }

  function getSelectedStartAgentIds() {
    return Array.from(startAgentSelect.selectedOptions).map(option => option.value);
  }

  function getSelectedStartAgents() {
    const ids = new Set(getSelectedStartAgentIds());
    return allAgents.filter(agent => ids.has(agent.id));
  }

  function checkAgentReadiness(agent) {
    const missing = [];
    if (!agent.full_name) missing.push('Full Name');
    if (!agent.email) missing.push('Email');
    if (!agent.agent_id) missing.push('Agent ID');
    if (!agent.phone) missing.push('Phone');
    return {
      ready: missing.length === 0,
      missing
    };
  }

  function renderSelectedAgentReadiness() {
    const selectedAgents = getSelectedStartAgents();

    if (!selectedAgents.length) {
      selectedAgentReadiness.innerHTML = '<p class="empty-row">Select one or more agents to review readiness.</p>';
      return;
    }

    selectedAgentReadiness.innerHTML = selectedAgents.map(agent => {
      const readiness = checkAgentReadiness(agent);
      return `
        <div class="readiness-card ${readiness.ready ? 'ready' : 'not-ready'}">
          <div class="readiness-top">
            <strong>${escapeHtml(agent.full_name || agent.email || 'Unnamed Agent')}</strong>
            <span class="readiness-status ${readiness.ready ? 'ready' : 'not-ready'}">
              ${readiness.ready ? 'Ready' : 'Missing Info'}
            </span>
          </div>
          <div class="readiness-meta">
            <span><strong>Email:</strong> ${escapeHtml(agent.email || '—')}</span>
            <span><strong>Agent ID:</strong> ${escapeHtml(agent.agent_id || '—')}</span>
            <span><strong>Phone:</strong> ${escapeHtml(agent.phone || '—')}</span>
          </div>
          ${
            readiness.ready
              ? '<p class="readiness-good">This agent has the main info needed to start the process.</p>'
              : `<p class="readiness-bad"><strong>Missing:</strong> ${escapeHtml(readiness.missing.join(', '))}</p>`
          }
        </div>
      `;
    }).join('');
  }

  async function loadCurrentAdmin() {
    const { data: { session } = {} } = await supabase.auth.getSession();
    currentAdminId = session?.user?.id || null;
  }

  async function loadAgents() {
    const { data, error } = await supabase
      .from('agents')
      .select('id, full_name, email, phone, agent_id, is_active')
      .order('full_name', { ascending: true });
  
    if (error) {
      console.error('Error loading agents:', error);
      return;
    }
  
    allAgents = data || [];
  
    agentSelect.innerHTML = '<option value="">Select agent</option>';
    startAgentSelect.innerHTML = '';
  
    allAgents.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.full_name || agent.email || agent.id;
      agentSelect.appendChild(opt);
  
      const opt2 = document.createElement('option');
      opt2.value = agent.id;
      opt2.textContent = `${agent.full_name || agent.email || agent.id}${agent.is_active ? '' : ' (Inactive)'}`;
      startAgentSelect.appendChild(opt2);
    });
  }

  async function sendAgentPackets() {
    const { selectedAgents, selectedRules } = buildBatchSummary();
  
    if (!selectedAgents.length || !selectedRules.length) {
      setStartMessage('Select agents and add carriers first.', 'error');
      return;
    }
  
    const packetRules = selectedRules.filter(rule => !!rule.send_agent_packet);
  
    if (!packetRules.length) {
      setStartMessage('None of the selected carriers are configured to send agent packets.', 'error');
      return;
    }
  
    await loadContractingRequests();
  
    const matchingRequestIds = pendingSavedRequests
      .filter(req =>
        selectedAgents.some(agent => agent.id === req.agent_id) &&
        packetRules.some(rule => rule.id === req.rule_id)
      )
      .map(req => req.id);
  
    if (!matchingRequestIds.length) {
      setStartMessage('Save Requests first so packets can be matched to saved requests.', 'error');
      return;
    }
  
    try {
      const response = await fetch('/.netlify/functions/send-agent-packets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_ids: matchingRequestIds })
      });
  
      const result = await response.json();
  
      if (!response.ok) {
        throw new Error(result.error || 'Could not send agent packets.');
      }
  
      const failed = (result.results || []).filter(item => !item.success);
      const successCount = (result.results || []).filter(item => item.success).length;
  
      if (failed.length) {
        console.error('Some agent packets failed:', failed);
        setStartMessage(`Sent ${successCount} packet email(s), but ${failed.length} failed.`, successCount ? 'success' : 'error');
        return;
      }
  
      setStartMessage(`Sent ${successCount} agent packet email(s) successfully.`, 'success');
    } catch (error) {
      console.error('Error sending agent packets:', error);
      setStartMessage(error.message || 'Could not send agent packets.', 'error');
    }
  }
  
  sendAgentPacketsBtn.addEventListener('click', async () => {
  
    sendAgentPacketsBtn.disabled = true;
    sendAgentPacketsBtn.innerText = 'Sending...';
  
    await sendAgentPackets();
  
    sendAgentPacketsBtn.disabled = false;
    sendAgentPacketsBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Agent Packets';
  
  });
  
  async function loadCarriers() {
    const { data, error } = await supabase
      .from('carriers')
      .select('id, carrier_name')
      .order('carrier_name', { ascending: true });

    if (error) {
      console.error('Error loading carriers:', error);
      return;
    }

    allCarriers = data || [];
    carrierSelect.innerHTML = '<option value="">Select carrier</option>';

    allCarriers.forEach(carrier => {
      const opt = document.createElement('option');
      opt.value = carrier.id;
      opt.textContent = carrier.carrier_name || carrier.id;
      carrierSelect.appendChild(opt);
    });

    ruleCarrierId.innerHTML = '<option value="">Select carrier</option>';

    allCarriers.forEach(carrier => {
      const opt = document.createElement('option');
      opt.value = carrier.id;
      opt.textContent = carrier.carrier_name || carrier.id;
      ruleCarrierId.appendChild(opt);
    });
  }

  async function loadRulesTable() {
    contractingRulesTbody.innerHTML = '<tr><td colspan="10" class="empty-row">Loading...</td></tr>';
  
    const { data, error } = await supabase
      .from('carrier_contracting_rules')
      .select(`
        id,
        carrier_id,
        is_active,
        start_method,
        destination_group,
        start_url,
        email_to,
        email_cc,
        email_bcc,
        email_subject_template,
        email_body_template,
        instructions,
        supports_multi_agent_batch,
        supports_multi_carrier_batch,
        sort_order,
        send_agent_packet,
        attachment_urls,
        agent_packet_subject_template,
        agent_packet_body_template,
        carriers:carrier_id (
          carrier_name
        )
      `)
      .order('sort_order', { ascending: true });
  
    if (error) {
      console.error('Error loading rules table:', error);
      contractingRulesTbody.innerHTML = '<tr><td colspan="10" class="empty-row">Could not load rules.</td></tr>';
      return;
    }
  
    allRulesRows = data || [];
    renderRulesTable(allRulesRows);
  }

  function renderRulesTable(rows) {
    if (!rows.length) {
      contractingRulesTbody.innerHTML = '<tr><td colspan="10" class="empty-row">No contracting rules found.</td></tr>';
      return;
    }
  
    contractingRulesTbody.innerHTML = rows.map(row => `
      <tr data-rule-id="${row.id}">
        <td>${escapeHtml(row.carriers?.carrier_name || 'FMO Packet')}</td>
        <td>${makeMethodBadge(row.start_method)}</td>
        <td>${escapeHtml(row.destination_group || '—')}</td>
        <td>${escapeHtml((row.email_to || []).join(', ') || '—')}</td>
        <td>
          ${row.start_url ? `<a href="${escapeHtml(row.start_url)}" target="_blank" rel="noopener noreferrer">Open</a>` : '—'}
        </td>
        <td>${makeBoolPill(row.is_active)}</td>
        <td>${makeBoolPill(row.supports_multi_agent_batch)}</td>
        <td>${makeBoolPill(row.supports_multi_carrier_batch)}</td>
        <td>${escapeHtml(row.sort_order ?? 0)}</td>
        <td>
          <div class="row-actions">
            <button class="edit-rule-btn" data-id="${row.id}" type="button">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button class="delete-rule-btn" data-id="${row.id}" type="button">
              <i class="fa-solid fa-trash"></i> Delete
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  
    document.querySelectorAll('.edit-rule-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const row = allRulesRows.find(item => item.id === btn.dataset.id);
        if (!row) return;
        enterRulesEditMode(row);
      });
    });
  
    document.querySelectorAll('.delete-rule-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        if (!id) return;
  
        const confirmed = confirm('Delete this contracting rule?');
        if (!confirmed) return;
  
        const { error } = await supabase
          .from('carrier_contracting_rules')
          .delete()
          .eq('id', id);
  
        if (error) {
          console.error('Error deleting contracting rule:', error);
          alert('Could not delete rule: ' + error.message);
          return;
        }
  
        if (currentlyEditingRuleId === id) {
          resetRulesForm();
        }
  
        await loadRulesTable();
        await loadContractingRules();
      });
    });
  }

  function applyRulesSearch() {
    const term = (rulesSearchInput.value || '').trim().toLowerCase();
  
    if (!term) {
      renderRulesTable(allRulesRows);
      return;
    }
  
    const filtered = allRulesRows.filter(row => {
      const haystack = [
        row.carriers?.carrier_name,
        row.start_method,
        row.destination_group,
        row.start_url,
        ...(row.email_to || []),
        ...(row.email_cc || []),
        ...(row.email_bcc || []),
        row.instructions,
        row.email_subject_template,
        row.email_body_template
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
  
      return haystack.includes(term);
    });
  
    renderRulesTable(filtered);
  }

  rulesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setRulesMessage('');
  
    const carrier_id = ruleCarrierId.value || null;
  
    const payload = {
      carrier_id,
      is_active: ruleIsActive.checked,
      start_method: ruleStartMethod.value,
      destination_group: ruleDestinationGroup.value.trim() || null,
      start_url: ruleStartUrl.value.trim() || null,
      email_to: parseEmailList(ruleEmailTo.value),
      email_cc: parseEmailList(ruleEmailCc.value),
      email_bcc: parseEmailList(ruleEmailBcc.value),
      email_subject_template: ruleEmailSubjectTemplate.value.trim() || null,
      email_body_template: ruleEmailBodyTemplate.value.trim() || null,
      instructions: ruleInstructions.value.trim() || null,
      supports_multi_agent_batch: ruleSupportsMultiAgent.checked,
      supports_multi_carrier_batch: ruleSupportsMultiCarrier.checked,
      send_agent_packet: ruleSendAgentPacket.checked,
      attachment_urls: parseLineList(ruleAttachmentUrls.value),
      agent_packet_subject_template: ruleAgentPacketSubjectTemplate.value.trim() || null,
      agent_packet_body_template: ruleAgentPacketBodyTemplate.value.trim() || null,
      sort_order: Number(ruleSortOrder.value || 0)
    };
  
    const editingId = rulesEditingId.value || null;
  
    if (editingId) {
      const { error } = await supabase
        .from('carrier_contracting_rules')
        .update(payload)
        .eq('id', editingId);
  
      if (error) {
        console.error('Error updating rule:', error);
        setRulesMessage(error.message, 'error');
        return;
      }
  
      setRulesMessage('Rule updated successfully.', 'success');
      resetRulesForm();
      await loadRulesTable();
      await loadContractingRules();
      return;
    }
  
    const { error } = await supabase
      .from('carrier_contracting_rules')
      .insert([payload]);
  
    if (error) {
      console.error('Error saving rule:', error);
      setRulesMessage(error.message, 'error');
      return;
    }
  
    setRulesMessage('Rule saved successfully.', 'success');
    resetRulesFormFields();
    await loadRulesTable();
    await loadContractingRules();
  });

  rulesResetBtn.addEventListener('click', () => {
    resetRulesForm();
  });
  
  rulesCancelEditBtn.addEventListener('click', () => {
    resetRulesForm();
  });
  
  rulesSearchInput.addEventListener('input', applyRulesSearch);
  
  async function loadContractingRules() {
    const { data, error } = await supabase
      .from('carrier_contracting_rules')
      .select(`
        id,
        carrier_id,
        is_active,
        start_method,
        destination_group,
        start_url,
        email_to,
        email_cc,
        email_bcc,
        email_subject_template,
        email_body_template,
        instructions,
        supports_multi_agent_batch,
        supports_multi_carrier_batch,
        sort_order,
        send_agent_packet,
        attachment_urls,
        agent_packet_subject_template,
        agent_packet_body_template,
        carriers:carrier_id (
          carrier_name
        )
      `)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error loading contracting rules:', error);
      startCarrierRulesGrid.innerHTML = '<p class="empty-row">Could not load carrier rules.</p>';
      return;
    }

    allContractingRules = data || [];
    renderCarrierRules();
  }

  function renderCarrierRules() {
    const term = (startCarrierSearch.value || '').trim().toLowerCase();

    const filtered = allContractingRules.filter(rule => {
      const haystack = [
        rule.carriers?.carrier_name,
        rule.start_method,
        rule.destination_group,
        rule.instructions,
        ...(rule.email_to || [])
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });

    if (!filtered.length) {
      startCarrierRulesGrid.innerHTML = '<p class="empty-row">No carrier rules found.</p>';
      return;
    }

    startCarrierRulesGrid.innerHTML = filtered.map(rule => {
      const isQueued = pendingSelections.some(item => item.rule_id === rule.id);
      return `
        <article class="rule-card">
          <div class="rule-card-top">
            <div>
              <h3>${escapeHtml(rule.carriers?.carrier_name || 'FMO Packet')}</h3>
              <p class="rule-destination">${escapeHtml(rule.destination_group || 'No group')}</p>
            </div>
            ${makeMethodBadge(rule.start_method)}
          </div>

          <div class="rule-card-body">
            <p><strong>Instructions:</strong> ${escapeHtml(rule.instructions || '—')}</p>
            <p><strong>Email To:</strong> ${escapeHtml((rule.email_to || []).join(', ') || '—')}</p>
            <p><strong>Link:</strong> ${rule.start_url ? `<a href="${escapeHtml(rule.start_url)}" target="_blank" rel="noopener noreferrer">Open Link</a>` : '—'}</p>
          </div>

          <div class="rule-card-actions">
            <button
              type="button"
              class="primary-btn add-rule-btn"
              data-rule-id="${rule.id}"
              ${isQueued ? 'disabled' : ''}
            >
              <i class="fa-solid fa-plus"></i>
              ${isQueued ? 'Added' : 'Add to Batch'}
            </button>
          </div>
        </article>
      `;
    }).join('');

    document.querySelectorAll('.add-rule-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const ruleId = btn.dataset.ruleId;
        const rule = allContractingRules.find(item => item.id === ruleId);
        if (!rule) return;

        if (pendingSelections.some(item => item.rule_id === rule.id)) {
          return;
        }

        pendingSelections.push({
          rule_id: rule.id,
          carrier_id: rule.carrier_id
        });

        renderCarrierRules();
        renderPendingBatch();
      });
    });
  }

  function buildEmailGroups(selectedAgents, selectedRules) {
    const groups = [];

    selectedAgents.forEach(agent => {
      selectedRules.forEach(rule => {
        if (rule.start_method !== 'email') return;

        const key = `${agent.id}__${rule.destination_group || rule.id}`;
        let existing = groups.find(group => group.key === key);

        if (!existing) {
          existing = {
            key,
            agent,
            method: 'email',
            destination_group: rule.destination_group || null,
            rules: [],
            email_to: rule.email_to || [],
            email_cc: rule.email_cc || [],
            email_bcc: rule.email_bcc || []
          };
          groups.push(existing);
        }

        existing.rules.push(rule);
      });
    });

    return groups;
  }

  function buildLinkItems(selectedAgents, selectedRules) {
    const items = [];
    selectedAgents.forEach(agent => {
      selectedRules.forEach(rule => {
        if (rule.start_method !== 'link') return;
        items.push({
          key: `${agent.id}__${rule.id}`,
          agent,
          rule
        });
      });
    });
    return items;
  }

  function buildManualItems(selectedAgents, selectedRules) {
    const items = [];
    selectedAgents.forEach(agent => {
      selectedRules.forEach(rule => {
        if (rule.start_method !== 'manual') return;
        items.push({
          key: `${agent.id}__${rule.id}`,
          agent,
          rule
        });
      });
    });
    return items;
  }

  function buildBatchSummary() {
    const selectedAgents = getSelectedStartAgents();
    const selectedRules = allContractingRules.filter(rule =>
      pendingSelections.some(item => item.rule_id === rule.id)
    );

    return {
      selectedAgents,
      selectedRules,
      emailGroups: buildEmailGroups(selectedAgents, selectedRules),
      linkItems: buildLinkItems(selectedAgents, selectedRules),
      manualItems: buildManualItems(selectedAgents, selectedRules)
    };
  }

  function renderPendingBatch() {
    const { selectedAgents, selectedRules, emailGroups, linkItems, manualItems } = buildBatchSummary();

    if (!selectedAgents.length) {
      pendingBatchWrap.innerHTML = '<p class="empty-row">Select one or more agents first.</p>';
      return;
    }

    if (!selectedRules.length) {
      pendingBatchWrap.innerHTML = '<p class="empty-row">No carriers added yet.</p>';
      return;
    }

    const emailHtml = emailGroups.length
      ? `
        <div class="pending-section">
          <h3>Email Groups</h3>
          ${emailGroups.map(group => {
            const carrierNames = group.rules.map(rule => rule.carriers?.carrier_name || 'Unknown Carrier');
            return `
              <div class="pending-item">
                <div class="pending-top">
                  <strong>${escapeHtml(group.agent.full_name || group.agent.email || 'Agent')}</strong>
                  ${makeMethodBadge('email')}
                </div>
                <p><strong>Destination Group:</strong> ${escapeHtml(group.destination_group || '—')}</p>
                <p><strong>To:</strong> ${escapeHtml((group.email_to || []).join(', ') || '—')}</p>
                <p><strong>Carriers:</strong> ${escapeHtml(carrierNames.join(', '))}</p>
              </div>
            `;
          }).join('')}
        </div>
      `
      : '';

    const linkHtml = linkItems.length
      ? `
        <div class="pending-section">
          <h3>Link Actions</h3>
          ${linkItems.map(item => `
            <div class="pending-item">
              <div class="pending-top">
                <strong>${escapeHtml(item.agent.full_name || item.agent.email || 'Agent')}</strong>
                ${makeMethodBadge('link')}
              </div>
              <p><strong>Carrier:</strong> ${escapeHtml(item.rule.carriers?.carrier_name || 'Unknown Carrier')}</p>
              <p><strong>Link:</strong> ${item.rule.start_url ? `<a href="${escapeHtml(item.rule.start_url)}" target="_blank" rel="noopener noreferrer">Open Link</a>` : '—'}</p>
            </div>
          `).join('')}
        </div>
      `
      : '';

    const manualHtml = manualItems.length
      ? `
        <div class="pending-section">
          <h3>Manual Actions</h3>
          ${manualItems.map(item => `
            <div class="pending-item">
              <div class="pending-top">
                <strong>${escapeHtml(item.agent.full_name || item.agent.email || 'Agent')}</strong>
                ${makeMethodBadge('manual')}
              </div>
              <p><strong>Carrier:</strong> ${escapeHtml(item.rule.carriers?.carrier_name || 'Unknown Carrier')}</p>
              <p><strong>Instructions:</strong> ${escapeHtml(item.rule.instructions || '—')}</p>
            </div>
          `).join('')}
        </div>
      `
      : '';

    pendingBatchWrap.innerHTML = `${emailHtml}${linkHtml}${manualHtml}`;
  }

  function buildBatchKey(agentId, rule) {
    return `${agentId}__${rule.destination_group || rule.id}__${Date.now()}`;
  }

  function fillTemplate(template, agent, carrierNames) {
    const namesList = carrierNames.map(name => `- ${name}`).join('%0D%0A');
    return String(template || '')
      .replaceAll('{{agent_name}}', agent.full_name || '')
      .replaceAll('{{agent_email}}', agent.email || '')
      .replaceAll('{{agent_id}}', agent.agent_id || '')
      .replaceAll('{{carrier_names}}', carrierNames.join(', '))
      .replaceAll('{{carrier_names_list}}', namesList);
  }

  async function saveContractingRequests() {
    const { selectedAgents, selectedRules } = buildBatchSummary();
  
    if (!currentAdminId) {
      setStartMessage('Could not determine current admin session.', 'error');
      return;
    }
  
    if (!selectedAgents.length) {
      setStartMessage('Select at least one agent first.', 'error');
      return;
    }
  
    if (!selectedRules.length) {
      setStartMessage('Add at least one carrier to the batch.', 'error');
      return;
    }
  
    await loadContractingRequests();
  
    const existingOpen = new Set(
      pendingSavedRequests
        .filter(req => ['draft', 'queued', 'sent'].includes((req.status || '').toLowerCase()))
        .map(req => `${req.agent_id}__${req.carrier_id}`)
    );
  
    const payload = [];
  
    selectedAgents.forEach(agent => {
      selectedRules.forEach(rule => {
        const dedupeKey = `${agent.id}__${rule.carrier_id}`;
        if (existingOpen.has(dedupeKey)) return;
  
        const carrierName = rule.carriers?.carrier_name || 'Unknown Carrier';
        const subject = fillTemplate(rule.email_subject_template, agent, [carrierName]);
        const body = fillTemplate(rule.email_body_template, agent, [carrierName]);
  
        payload.push({
          agent_id: agent.id,
          carrier_id: rule.carrier_id,
          rule_id: rule.id,
          requested_by: currentAdminId,
          status: 'draft',
          batch_key: buildBatchKey(agent.id, rule),
          start_method_snapshot: rule.start_method,
          destination_group_snapshot: rule.destination_group || null,
          start_url_snapshot: rule.start_url || null,
          email_to_snapshot: rule.email_to || [],
          email_cc_snapshot: rule.email_cc || [],
          email_bcc_snapshot: rule.email_bcc || [],
          email_subject_snapshot: subject || null,
          email_body_snapshot: body || null,
          notes: rule.instructions || null
        });
      });
    });
  
    if (!payload.length) {
      setStartMessage('All selected agent/carrier combinations already have open requests.', 'error');
      return;
    }
  
    const { error } = await supabase
      .from('carrier_contracting_requests')
      .insert(payload);
  
    if (error) {
      console.error('Error saving contracting requests:', error);
      setStartMessage(error.message || 'Could not save contracting requests.', 'error');
      return;
    }
  
    setStartMessage('Contracting requests saved successfully.', 'success');
    renderCarrierRules();
    renderPendingBatch();
    await loadContractingRequests();
  }

  async function launchContractingActions() {
    console.log('Launch Actions clicked');
  
    const { selectedAgents, selectedRules, emailGroups, linkItems } = buildBatchSummary();
  
    console.log('selectedAgents:', selectedAgents);
    console.log('selectedRules:', selectedRules);
    console.log('emailGroups:', emailGroups);
    console.log('linkItems:', linkItems);
  
    if (!selectedAgents.length || !selectedRules.length) {
      setStartMessage('Select agents and add carriers first.', 'error');
      alert('No selected agents or rules found in the current batch.');
      return;
    }
  
    for (const item of linkItems) {
      if (item.rule.start_url) {
        window.open(item.rule.start_url, '_blank', 'noopener,noreferrer');
      }
    }
  
    const emailRequestRows = [];
  
    selectedAgents.forEach(agent => {
      selectedRules.forEach(rule => {
        if ((rule.start_method || '').toLowerCase() !== 'email') return;
  
        const existing = pendingSavedRequests.find(req =>
          req.agent_id === agent.id &&
          req.carrier_id === rule.carrier_id &&
          ['draft', 'queued', 'sent'].includes((req.status || '').toLowerCase())
        );
  
        if (existing) {
          emailRequestRows.push(existing.id);
        }
      });
    });
  
    console.log('emailRequestRows:', emailRequestRows);
  
    if (!emailRequestRows.length) {
      if (emailGroups.length) {
        setStartMessage('No saved email requests were found yet. Click Save Requests first.', 'error');
        alert('No matching saved email requests were found.');
        return;
      }
  
      setStartMessage('Launched available link actions.', 'success');
      alert('Only link actions were available.');
      return;
    }
  
    try {
      alert('About to call send-contracting-emails function.');
  
      const response = await fetch('/.netlify/functions/send-contracting-emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          request_ids: emailRequestRows
        })
      });
  
      console.log('response status:', response.status);
      console.log('response ok:', response.ok);
  
      const rawText = await response.text();
      console.log('raw function response:', rawText);
  
      let result = {};
      try {
        result = rawText ? JSON.parse(rawText) : {};
      } catch (jsonErr) {
        console.error('Could not parse function response as JSON:', jsonErr);
        alert('Function returned non-JSON response. Check console.');
        setStartMessage('Function returned invalid response.', 'error');
        return;
      }
  
      if (!response.ok) {
        throw new Error(result.error || `Could not send contracting emails. HTTP ${response.status}`);
      }
  
      const failed = (result.results || []).filter(item => !item.success);
      const successCount = (result.results || []).filter(item => item.success).length;
  
      await loadContractingRequests();
  
      if (failed.length) {
        console.error('Some contracting emails failed:', failed);
        setStartMessage(
          `Sent ${successCount} email group(s), but ${failed.length} failed. Check console/logs.`,
          successCount ? 'success' : 'error'
        );
        alert(`Partial failure. Sent ${successCount}, failed ${failed.length}.`);
        return;
      }
  
      setStartMessage(`Sent ${successCount} email group(s) successfully.`, 'success');
      alert(`Success: sent ${successCount} email group(s).`);
    } catch (error) {
      console.error('Error launching contracting actions:', error);
      setStartMessage(error.message || 'Could not send contracting emails.', 'error');
      alert(`Launch failed: ${error.message || 'Unknown error'}`);
    }
  }

  async function loadContractingRequests() {
    contractingRequestsTbody.innerHTML = '<tr><td colspan="7" class="empty-row">Loading...</td></tr>';
  
    const { data, error } = await supabase
      .from('carrier_contracting_requests')
      .select(`
        id,
        created_at,
        agent_id,
        carrier_id,
        rule_id,
        status,
        start_method_snapshot,
        destination_group_snapshot,
        requested_by,
        agents:agent_id (
          full_name,
          email
        ),
        carriers:carrier_id (
          carrier_name
        ),
        requested_by_agent:requested_by (
          full_name,
          email
        )
      `)
      .order('created_at', { ascending: false })
      .limit(100);
  
    if (error) {
      console.error('Error loading contracting requests:', error);
      contractingRequestsTbody.innerHTML = '<tr><td colspan="7" class="empty-row">Could not load requests.</td></tr>';
      return;
    }
  
    const rows = data || [];
    pendingSavedRequests = rows;
  
    if (!rows.length) {
      contractingRequestsTbody.innerHTML = '<tr><td colspan="7" class="empty-row">No contracting requests found.</td></tr>';
      return;
    }
  
    contractingRequestsTbody.innerHTML = rows.slice(0, 25).map(row => `
      <tr>
        <td>${formatDate(row.created_at)}</td>
        <td>${escapeHtml(row.agents?.full_name || row.agents?.email || '—')}</td>
        <td>${escapeHtml(row.carriers?.carrier_name || '—')}</td>
        <td>${makeBadge(row.status)}</td>
        <td>${makeMethodBadge(row.start_method_snapshot || 'manual')}</td>
        <td>${escapeHtml(row.destination_group_snapshot || '—')}</td>
        <td>${escapeHtml(row.requested_by_agent?.full_name || row.requested_by_agent?.email || '—')}</td>
      </tr>
    `).join('');
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
          <td>${escapeHtml(agentName)}</td>
          <td>${escapeHtml(carrierName)}</td>
          <td>${makeBadge(row.status)}</td>
          <td>${makeBoolPill(row.is_contracted)}</td>
          <td>${makeBoolPill(row.is_appointed)}</td>
          <td>${makeInlineChips(row.states)}</td>
          <td>${makeInlineChips(row.product_types)}</td>
          <td>${escapeHtml(row.writing_number || '—')}</td>
          <td>${escapeHtml(row.npn || '—')}</td>
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

  function wireTabs() {
    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const target = button.dataset.tab;
        tabButtons.forEach(btn => btn.classList.remove('active'));
        tabPanels.forEach(panel => panel.classList.remove('active'));

        button.classList.add('active');
        document.getElementById(target)?.classList.add('active');
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

  startCarrierSearch.addEventListener('input', renderCarrierRules);

  startAgentSelect.addEventListener('change', () => {
    renderSelectedAgentReadiness();
    renderPendingBatch();
  });

  buildContractingBatchBtn.addEventListener('click', () => {
    const selectedAgents = getSelectedStartAgents();
    if (!selectedAgents.length) {
      setStartMessage('Select at least one agent first.', 'error');
      return;
    }
    setStartMessage('Batch ready. Add carriers below.', 'success');
    renderPendingBatch();
  });

  clearContractingBatchBtn.addEventListener('click', () => {
    pendingSelections = [];
    setSelectedValues(startAgentSelect, []);
    renderCarrierRules();
    renderSelectedAgentReadiness();
    renderPendingBatch();
    setStartMessage('', '');
  });

  createContractingRequestsBtn.addEventListener('click', async () => {
    await saveContractingRequests();
  });

  launchContractingActionsBtn.addEventListener('click', () => {
    launchContractingActions();
  });

  wireTabs();
  await loadCurrentAdmin();
  await loadAgents();
  await loadCarriers();
  await loadContractingRules();
  renderSelectedAgentReadiness();
  renderPendingBatch();
  resetForm();
  resetRulesForm();
  await loadAgentCarriers();
  await loadContractingRequests();
  await loadRulesTable();
});
