// scripts/admin-commissions.js
const sb = window.supabaseClient || window.supabase;

let userId = null;
let adjustmentPolicyChoices = null;
let adjustmentLeadChoices = null;
let policyContactChoices = null;
let policyCarrierChoices = null;
let policyProductLineChoices = null;
let policyPolicyTypeChoices = null;
let _carrierScheduleMap = null;
let commissionAgentsLoaded = false;
let policyAgentChoices = null;
let policyLeadsChoices = null;
let adjustmentAgentChoices = null;
let policyEditAgentChoices = null;
let _policiesCache = [];
let _policiesFp = null;
let _ledgerCache = [];
let _ledgerFp = null;

let _commissionAgentsMap = new Map();
let _eligiblePolicyAttachmentSchedules = [];
let _policyAttachmentRowChoices = [];
let policyAttachmentModalChoices = null;
let _activeAttachmentModalSchedules = [];

/* ---------- Helpers ---------- */

function openModal(el) { if (el) el.style.display = 'flex'; }
function closeModal(el) { if (el) el.style.display = 'none'; }

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function destroyChoicesInstance(inst) {
  try { inst?.destroy(); } catch (_) {}
}

function ensureChoicesForSelect(selectEl, existingInstance, opts = {}) {
  if (!window.Choices || !selectEl) return existingInstance;

  destroyChoicesInstance(existingInstance);

  try {
    return new Choices(selectEl, {
      searchEnabled: true,
      shouldSort: false,
      itemSelectText: '',
      ...opts
    });
  } catch (_) {
    return existingInstance;
  }
}

function getAgentLevel(agentId) {
  return _commissionAgentsMap.get(agentId)?.level || null;
}

function getCarrierNameFromPolicyModal() {
  const carrierSel = document.getElementById('policy-carrier');
  return carrierSel?.options?.[carrierSel.selectedIndex]?.text?.trim() || '';
}

function getAttachmentScheduleLabel(s) {
  const parts = [];
  if (s.policy_type) parts.push(s.policy_type);
  if (s.product_line) parts.push(s.product_line);
  return parts.join(' • ') || 'Attachment';
}

function resetPolicyAttachmentUI() {
  const wrap = document.getElementById('policy-attachments-wrap');
  const list = document.getElementById('policy-attachments-list');

  _eligiblePolicyAttachmentSchedules = [];
  _policyAttachmentRowChoices.forEach(inst => destroyChoicesInstance(inst));
  _policyAttachmentRowChoices = [];

  if (list) list.innerHTML = '';
  if (wrap) wrap.style.display = 'none';
}

function buildUniqueAttachmentSchedules(rows) {
  const map = new Map();

  (rows || []).forEach(r => {
    const key = `${r.policy_type || ''}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, r);
      return;
    }

    const existingDate = existing.effective_from || '0000-00-00';
    const rowDate = r.effective_from || '0000-00-00';
    if (rowDate > existingDate) {
      map.set(key, r);
    }
  });

  return Array.from(map.values()).sort((a, b) => {
    const aa = a.policy_type || '';
    const bb = b.policy_type || '';
    return aa.localeCompare(bb);
  });
}

async function fetchEligibleAttachmentSchedulesForPolicyContext({
  agentId,
  carrierName,
  productLine,
  parentPolicyType
}) {
  const agentLevel = getAgentLevel(agentId);
  if (!agentLevel || !carrierName || !productLine || !parentPolicyType) return [];

  const { data, error } = await sb
    .from('commission_schedules')
    .select(`
      id,
      carrier_name,
      product_line,
      policy_type,
      parent_policy_type,
      agent_level,
      commission_item_type,
      effective_from,
      effective_to
    `)
    .eq('commission_item_type', 'attachment')
    .eq('carrier_name', carrierName)
    .eq('product_line', productLine)
    .eq('parent_policy_type', parentPolicyType)
    .eq('agent_level', agentLevel)
    .order('effective_from', { ascending: false });

  if (error) {
    console.error('Error loading eligible attachment schedules:', error);
    return [];
  }

  return buildUniqueAttachmentSchedules(data || []);
}

function addPolicyAttachmentRow(prefill = {}) {
  const list = document.getElementById('policy-attachments-list');
  if (!list || !_eligiblePolicyAttachmentSchedules.length) return;

  const row = document.createElement('div');
  row.className = 'policy-attachment-row';
  row.style.display = 'grid';
  row.style.gridTemplateColumns = '1.4fr 1fr auto';
  row.style.gap = '8px';
  row.style.alignItems = 'end';
  row.style.marginBottom = '8px';

  const optionsHtml = [
    `<option value="">Select attachment…</option>`,
    ..._eligiblePolicyAttachmentSchedules.map(s => `
      <option value="${s.id}">
        ${getAttachmentScheduleLabel(s)}
      </option>
    `)
  ].join('');

  row.innerHTML = `
    <label style="margin:0;">
      Attachment Type
      <select class="policy-attachment-type-select">${optionsHtml}</select>
    </label>

    <label style="margin:0;">
      Annual Premium
      <input class="policy-attachment-annual-premium" type="number" min="0" step="0.01" placeholder="0.00">
    </label>

    <button type="button" class="policy-attachment-remove"
            style="padding:8px 10px; border-radius:8px;">
      Remove
    </button>
  `;

  list.appendChild(row);

  const selectEl = row.querySelector('.policy-attachment-type-select');
  const choicesInst = ensureChoicesForSelect(selectEl, null);
  _policyAttachmentRowChoices.push(choicesInst);

  if (prefill.scheduleId) {
    selectEl.value = prefill.scheduleId;
    if (choicesInst) choicesInst.setChoiceByValue(prefill.scheduleId);
  }
  if (prefill.premiumAnnual != null) {
    row.querySelector('.policy-attachment-annual-premium').value = prefill.premiumAnnual;
  }
}

function collectPolicyAttachmentRows() {
  const rows = Array.from(document.querySelectorAll('#policy-attachments-list .policy-attachment-row'));
  const out = [];

  for (const row of rows) {
    const scheduleId = row.querySelector('.policy-attachment-type-select')?.value || '';
    const annualPremium = Number(row.querySelector('.policy-attachment-annual-premium')?.value || 0);

    if (!scheduleId && !annualPremium) continue;

    if (!scheduleId || !(annualPremium > 0)) {
      throw new Error('Each attachment row needs an attachment type and annual premium.');
    }

    const schedule = _eligiblePolicyAttachmentSchedules.find(s => String(s.id) === String(scheduleId));
    if (!schedule) {
      throw new Error('One of the selected attachment schedules could not be found.');
    }

    out.push({
      schedule,
      premium_annual: annualPremium,
      premium_modal: annualPremium / 12
    });
  }

  return out;
}

async function refreshPolicyAttachmentOptions() {
  const agentId = document.getElementById('policy-agent')?.value || '';
  const carrierName = getCarrierNameFromPolicyModal();
  const productLine = document.getElementById('policy-product-line')?.value || '';
  const parentPolicyType = document.getElementById('policy-policy-type')?.value || '';

  resetPolicyAttachmentUI();

  if (!agentId || !carrierName || !productLine || !parentPolicyType) return;

  const schedules = await fetchEligibleAttachmentSchedulesForPolicyContext({
    agentId,
    carrierName,
    productLine,
    parentPolicyType
  });

  _eligiblePolicyAttachmentSchedules = schedules;

  if (!schedules.length) return;

  const wrap = document.getElementById('policy-attachments-wrap');
  if (wrap) wrap.style.display = 'block';

  addPolicyAttachmentRow();
}

function renderAdjustmentsList(rows) {
  const container = document.getElementById('debit-credit-list');
  if (!container) return;

  if (!rows || rows.length === 0) {
    container.innerHTML = `<div style="padding:10px;">No matching debits/credits.</div>`;
    return;
  }

  container.innerHTML = '';

  rows.forEach(row => {
    const div = document.createElement('div');
    div.className = 'mini-row';

    const amtNumber = Number(row.amount || 0);
    const sign = amtNumber >= 0 ? '+' : '-';
    const amt = Math.abs(amtNumber).toFixed(2);

    const cat = row.category || '';
    const entryType = row.entry_type || '—';
    const settled = (row.is_settled === true) ? '✅ Settled' : '⏳ Open';

    const date = row.period_start ? new Date(row.period_start).toLocaleDateString() : '';
    const agentName = row.agent_name || '—';
    const policyNum = row.policy_number ? ` • Policy: ${row.policy_number}` : '';

    div.textContent = `${sign}$${amt} — ${cat} • ${entryType} • ${settled} • ${agentName}${policyNum} (${date})`;
    container.appendChild(div);
  });
}

function applyAdjustmentFilters() {
  const q = (document.getElementById('debit-credit-search')?.value || '').trim().toLowerCase();

  let start = null;
  let end = null;

  if (_ledgerFp && Array.isArray(_ledgerFp.selectedDates)) {
    if (_ledgerFp.selectedDates[0]) start = new Date(_ledgerFp.selectedDates[0]);
    if (_ledgerFp.selectedDates[1]) end = new Date(_ledgerFp.selectedDates[1]);
    if (end) end.setHours(23, 59, 59, 999);
  }

  const filtered = (_ledgerCache || []).filter(r => {
    const agentName = (r.agent_name || '').toLowerCase();
    const policyNum = (r.policy_number || '').toLowerCase();
    const entryType = (r.entry_type || '').toLowerCase();

    const matchesText = !q || (
      agentName.includes(q) ||
      policyNum.includes(q) ||
      entryType.includes(q)
    );

    if (!matchesText) return false;

    if (!start && !end) return true;

    const raw = r.period_start;
    if (!raw) return false;

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;

    if (start && d < start) return false;
    if (end && d > end) return false;

    return true;
  });

  renderAdjustmentsList(filtered);
}

/* ---------- Loaders: Agents / Contacts / Carriers / Carrier Schedules ---------- */

async function loadAgentsForCommissions(force = false) {
  if (commissionAgentsLoaded && !force) return;

  const { data, error } = await sb
    .from('agents')
    .select('id, full_name, level')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error loading agents for commissions', error);
    return;
  }

  _commissionAgentsMap = new Map();
  (data || []).forEach(a => _commissionAgentsMap.set(a.id, a));

  const selects = [
    document.getElementById('policy-agent'),
    document.getElementById('adjustment-agent'),
    document.getElementById('policy-edit-agent'),
  ];

  selects.forEach(sel => {
    if (!sel) return;

    sel.innerHTML = '<option value="">Select agent…</option>';

    (data || []).forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.full_name || agent.id;
      sel.appendChild(opt);
    });
  });

  policyAgentChoices = ensureChoicesForSelect(document.getElementById('policy-agent'), policyAgentChoices);
  adjustmentAgentChoices = ensureChoicesForSelect(document.getElementById('adjustment-agent'), adjustmentAgentChoices);
  policyEditAgentChoices = ensureChoicesForSelect(document.getElementById('policy-edit-agent'), policyEditAgentChoices);

  commissionAgentsLoaded = true;
}

async function loadContactsForPolicy(agentId = null) {
  const sel = document.getElementById('policy-contact');
  if (!sel) return;

  sel.disabled = true;
  sel.innerHTML = '<option value="">Loading contacts…</option>';

  let query = sb
    .from('contacts')
    .select('id, first_name, last_name, phones, emails, email, city, state, zip, address_line1, owning_agent_id')
    .order('created_at', { ascending: false })
    .limit(200);

  if (agentId) query = query.eq('owning_agent_id', agentId);

  const { data, error } = await query;

  if (error) {
    console.error('Error loading contacts for policy:', error);
    sel.innerHTML = '<option value="">Error loading contacts</option>';
    sel.disabled = true;
    return;
  }

  sel.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select contact…';
  sel.appendChild(placeholder);

  (data || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;

    const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
    const cityState = [c.city, c.state].filter(Boolean).join(', ');
    const addr = c.address_line1 || '';
    const phone = Array.isArray(c.phones) && c.phones.length ? c.phones[0] : '';
    const email = c.email || (Array.isArray(c.emails) && c.emails.length ? c.emails[0] : '');

    const parts = [name || `Contact ${String(c.id).slice(0, 8)}`, addr, cityState, phone, email].filter(Boolean);
    opt.textContent = parts.join(' · ');
    sel.appendChild(opt);
  });

  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '➕ New contact (enter below)';
  sel.appendChild(newOpt);
  sel.disabled = false;
  policyContactChoices = ensureChoicesForSelect(sel, policyContactChoices);
}

async function loadCarriersForPolicy() {
  const sel = document.getElementById('policy-carrier');
  if (!sel) return;

  sel.disabled = true;
  sel.innerHTML = '<option value="">Loading carriers…</option>';

  const { data, error } = await sb
    .from('carriers')
    .select('id, carrier_name')
    .order('carrier_name', { ascending: true });

  if (error) {
    console.error('Error loading carriers:', error);
    sel.innerHTML = '<option value="">Error loading carriers</option>';
    sel.disabled = true;
    return;
  }

  const carriers = data || [];
  if (!carriers.length) {
    sel.innerHTML = '<option value="">No carriers found</option>';
    sel.disabled = true;
    return;
  }

  sel.innerHTML = '';
  carriers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.carrier_name;
    sel.appendChild(opt);
  });
  sel.disabled = false;
  policyCarrierChoices = ensureChoicesForSelect(sel, policyCarrierChoices);
}

async function loadProductLinesAndTypesForCarrier(carrierId) {
  const lineSel = document.getElementById('policy-product-line');
  const typeSel = document.getElementById('policy-policy-type');
  if (!lineSel || !typeSel) return;

  const destroyChoices = () => {
    try {
      if (policyProductLineChoices) { policyProductLineChoices.destroy(); policyProductLineChoices = null; }
      if (policyPolicyTypeChoices) { policyPolicyTypeChoices.destroy(); policyPolicyTypeChoices = null; }
    } catch (_) {}
  };

  const resetAll = (msg = 'Select carrier first…') => {
    destroyChoices();
    _carrierScheduleMap = null;

    lineSel.innerHTML = `<option value="">${msg}</option>`;
    lineSel.disabled = true;

    typeSel.innerHTML = `<option value="">${msg}</option>`;
    typeSel.disabled = true;
  };

  if (!carrierId) {
    resetAll('Select carrier first…');
    return;
  }

  destroyChoices();
  lineSel.disabled = true;
  typeSel.disabled = true;
  lineSel.innerHTML = '<option value="">Loading…</option>';
  typeSel.innerHTML = '<option value="">Loading…</option>';

  const { data, error } = await sb
    .from('commission_schedules')
    .select('product_line, policy_type')
    .eq('carrier_id', carrierId)
    .eq('commission_item_type', 'policy');

  if (error) {
    console.error('Error loading commission_schedules for carrier:', error);
    resetAll('Error loading schedules…');
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    resetAll('No schedules configured…');
    return;
  }

  const typesByLine = new Map();
  for (const r of rows) {
    const line = (r.product_line || '').trim();
    const type = (r.policy_type || '').trim();
    if (!line) continue;

    if (!typesByLine.has(line)) typesByLine.set(line, new Set());
    if (type) typesByLine.get(line).add(type);
  }

  const productLines = Array.from(typesByLine.keys()).sort((a, b) => a.localeCompare(b));
  _carrierScheduleMap = { lines: productLines, typesByLine };

  lineSel.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Select product line…';
  lineSel.appendChild(ph);

  productLines.forEach(line => {
    const opt = document.createElement('option');
    opt.value = line;
    opt.textContent = line;
    lineSel.appendChild(opt);
  });

  lineSel.disabled = false;

  typeSel.innerHTML = '<option value="">Select product line first…</option>';
  typeSel.disabled = true;

  try {
    policyProductLineChoices = new Choices(lineSel, {
      searchEnabled: true,
      shouldSort: false,
      itemSelectText: ''
    });
  } catch (_) {}
}

function hydratePolicyTypesForSelectedLine() {
  const lineSel = document.getElementById('policy-product-line');
  const typeSel = document.getElementById('policy-policy-type');
  if (!lineSel || !typeSel) return;

  try {
    if (policyPolicyTypeChoices) {
      policyPolicyTypeChoices.destroy();
      policyPolicyTypeChoices = null;
    }
  } catch (_) {}

  const selectedLine = (lineSel.value || '').trim();

  if (!_carrierScheduleMap || !selectedLine) {
    typeSel.innerHTML = '<option value="">Select product line first…</option>';
    typeSel.disabled = true;
    return;
  }

  const setOrEmpty = _carrierScheduleMap.typesByLine.get(selectedLine);
  const types = setOrEmpty ? Array.from(setOrEmpty).sort((a, b) => a.localeCompare(b)) : [];

  typeSel.innerHTML = '';

  if (!types.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No policy types for this product line';
    typeSel.appendChild(opt);
    typeSel.disabled = true;
    return;
  }

  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Select policy type…';
  typeSel.appendChild(ph);

  types.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t;
    opt.textContent = t;
    typeSel.appendChild(opt);
  });

  typeSel.disabled = false;

  try {
    policyPolicyTypeChoices = new Choices(typeSel, {
      searchEnabled: true,
      shouldSort: false,
      itemSelectText: ''
    });
  } catch (_) {}
}

/* ---------- Lists ---------- */

function renderPoliciesList(rows) {
  const list = document.getElementById('policy-list');
  if (!list) return;

  if (!rows || rows.length === 0) {
    list.innerHTML = `<div style="padding:10px;">No matching policies.</div>`;
    return;
  }

  list.innerHTML = rows.map(p => {
    const agentName = p.agent_name || '—';
    const prem = safeNum(p.premium_annual).toFixed(2);
    const dt = p.issued_at ? String(p.issued_at).slice(0, 10) : '—';
    const st = p.status ? String(p.status).replace(/_/g, ' ') : '—';
    const carrier = p.carrier_name || '—';
    const line = p.product_line || '—';
    const type = p.policy_type || '—';

    return `
      <div class="mini-row" style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px;">
        <div style="min-width:0;">
          <div><strong>${p.policy_number || '—'}</strong> <span style="opacity:.75;">(${agentName})</span></div>
          <div>${carrier} • ${line} • ${type}</div>
          <div>$${prem} • ${st} • Issue: ${dt}</div>
        </div>
    
        <div style="flex:0 0 auto; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button type="button"
            class="policy-edit-btn"
            data-policy-id="${p.id}"
            style="padding:6px 10px; border-radius:8px;">
            Edit
          </button>

          <button type="button"
            class="policy-add-attachment-btn"
            data-policy-id="${p.id}"
            style="padding:6px 10px; border-radius:8px;">
            Add attachment
          </button>
    
          <button type="button"
            class="policy-renew-btn"
            data-policy-id="${p.id}"
            style="padding:6px 10px; border-radius:8px;">
            Add renewal
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function applyPolicyFilters() {
  const q = (document.getElementById('policy-search')?.value || '').trim().toLowerCase();

  let start = null;
  let end = null;
  if (_policiesFp && Array.isArray(_policiesFp.selectedDates)) {
    if (_policiesFp.selectedDates[0]) start = new Date(_policiesFp.selectedDates[0]);
    if (_policiesFp.selectedDates[1]) end = new Date(_policiesFp.selectedDates[1]);
    if (end) end.setHours(23, 59, 59, 999);
  }

  const filtered = (_policiesCache || []).filter(p => {
    const agentName = (p.agent_name || '').toLowerCase();
    const policyNum = (p.policy_number || '').toLowerCase();
    const carrier = (p.carrier_name || '').toLowerCase();
    const line = (p.product_line || '').toLowerCase();
    const type = (p.policy_type || '').toLowerCase();

    const matchesText = !q || (
      agentName.includes(q) ||
      policyNum.includes(q) ||
      carrier.includes(q) ||
      line.includes(q) ||
      type.includes(q)
    );

    if (!matchesText) return false;

    if (!start && !end) return true;

    const raw = p.submitted_at || p.created_at;
    if (!raw) return false;

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;

    if (start && d < start) return false;
    if (end && d > end) return false;

    return true;
  });

  renderPoliciesList(filtered);
}

async function loadPoliciesIntoList() {
  const list = document.getElementById('policy-list');
  if (!list) return;

  list.innerHTML = `<div style="padding:10px;">Loading…</div>`;

  const { data: policies, error } = await sb
    .from('policies')
    .select(`
      id,
      agent_id,
      policy_number,
      carrier_name,
      policy_type,
      product_line,
      premium_annual,
      issued_at,
      submitted_at,
      status,
      created_at
    `)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('loadPoliciesIntoList error', error);
    list.innerHTML = `<div style="padding:10px;">Error loading policies.</div>`;
    return;
  }

  const rows = policies || [];
  const agentIds = [...new Set(rows.map(r => r.agent_id).filter(Boolean))];

  let agentNameMap = {};
  if (agentIds.length) {
    const { data: agents, error: aErr } = await sb
      .from('agents')
      .select('id, full_name')
      .in('id', agentIds);

    if (aErr) {
      console.warn('Could not load agent names:', aErr);
    } else {
      (agents || []).forEach(a => { agentNameMap[a.id] = a.full_name || a.id; });
    }
  }

  _policiesCache = rows.map(p => ({
    ...p,
    agent_name: agentNameMap[p.agent_id] || '—'
  }));

  applyPolicyFilters();
}

async function loadLeadsForSelectedContact(contactId) {
  const wrap = document.getElementById('policy-leads-wrap');
  const sel = document.getElementById('policy-leads');
  if (!wrap || !sel) return;

  wrap.style.display = 'none';
  sel.innerHTML = '';
  destroyChoicesInstance(policyLeadsChoices);
  policyLeadsChoices = null;

  if (!contactId || contactId === '__new__') return;

  const { data, error } = await sb
    .from('leads')
    .select('id, first_name, last_name, created_at, lead_type, product_type')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Error loading leads for contact:', error);
    return;
  }

  const rows = data || [];
  if (!rows.length) return;

  wrap.style.display = 'block';

  rows.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id;

    const name = [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || `Lead ${String(l.id).slice(0, 8)}`;
    const meta = [
      l.product_type || '',
      l.lead_type || '',
      l.created_at ? new Date(l.created_at).toLocaleDateString() : ''
    ].filter(Boolean).join(' • ');

    opt.textContent = meta ? `${name} — ${meta}` : name;
    sel.appendChild(opt);
  });

  policyLeadsChoices = ensureChoicesForSelect(sel, policyLeadsChoices, {
    removeItemButton: true,
    placeholder: true,
    placeholderValue: 'Select one or more leads…'
  });
}

async function loadAdjustmentsIntoList() {
  const container = document.getElementById('debit-credit-list');
  if (!container) return;

  container.innerHTML = `<div style="padding:10px;">Loading…</div>`;

  const { data: rows, error } = await sb
    .from('commission_ledger')
    .select('id, agent_id, amount, category, entry_type, is_settled, policy_id, period_start')
    .order('period_start', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error loading debits/credits', error);
    container.innerHTML = `<div style="padding:10px;">Error loading debits / credits.</div>`;
    return;
  }

  if (!rows || rows.length === 0) {
    _ledgerCache = [];
    container.innerHTML = `<div style="padding:10px;">No debits or credits yet.</div>`;
    return;
  }

  const agentIds = [...new Set(rows.map(r => r.agent_id).filter(Boolean))];
  const policyIds = [...new Set(rows.map(r => r.policy_id).filter(Boolean))];

  let agentNameMap = {};
  if (agentIds.length) {
    const { data: agents, error: aErr } = await sb
      .from('agents')
      .select('id, full_name')
      .in('id', agentIds);

    if (aErr) console.warn('Could not load agent names:', aErr);
    else (agents || []).forEach(a => { agentNameMap[a.id] = a.full_name || a.id; });
  }

  let policyNumMap = {};
  if (policyIds.length) {
    const { data: policies, error: pErr } = await sb
      .from('policies')
      .select('id, policy_number')
      .in('id', policyIds);

    if (pErr) console.warn('Could not load policy numbers:', pErr);
    else (policies || []).forEach(p => { policyNumMap[p.id] = p.policy_number || p.id; });
  }

  _ledgerCache = rows.map(r => ({
    ...r,
    agent_name: agentNameMap[r.agent_id] || '—',
    policy_number: r.policy_id ? (policyNumMap[r.policy_id] || '—') : null
  }));

  applyAdjustmentFilters();
}

/* ---------- Payout batches ---------- */

async function loadPayoutBatchesIntoList() {
  const list = document.getElementById("batch-list");
  if (!sb || !list) return;

  const statusFilterEl = document.getElementById("batch-status-filter");
  const activeFilter = (statusFilterEl?.value || "both").toLowerCase();

  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  };

  const fmtDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  };
  
  const fmtDateOnly = (v) => {
    if (!v) return "—";
    return String(v).slice(0, 10);
  };

  const fmtDate = fmtDateTime;
  
  const setBusy = (el, busy, labelBusy) => {
    if (!el) return;
    el.disabled = !!busy;
    el.dataset._oldText ??= el.textContent;
    if (busy) el.textContent = labelBusy || "Working…";
    else el.textContent = el.dataset._oldText;
  };

  list.innerHTML = `<div style="opacity:.8;font-size:13px;">Loading payout batches…</div>`;

  const { data: batches, error } = await sb
    .from("payout_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    list.innerHTML = `<div style="color:#b00020;font-size:13px;">Failed to load batches: ${error.message}</div>`;
    return;
  }

  let rows = batches || [];

  if (activeFilter !== "both") {
    rows = rows.filter(b => String(b.status || "pending").toLowerCase() === activeFilter);
  }

  if (!rows.length) {
    list.innerHTML = `<div style="opacity:.8;font-size:13px;">No payout batches found.</div>`;
    return;
  }

  list.innerHTML = "";

  for (const b of rows) {
    const currentStatus = String(b.status || "pending").toLowerCase();
    const isSent = currentStatus === "sent";

    const row = document.createElement("div");
    row.className = "batch-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "1fr auto";
    row.style.gap = "10px";
    row.style.padding = "10px";
    row.style.border = "1px solid #e6e6e6";
    row.style.borderRadius = "10px";
    row.style.marginBottom = "8px";
    row.style.background = "#fff";

    const left = document.createElement("div");
    left.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <strong style="font-size:14px;">Batch</strong>
        <span style="font-size:12px; opacity:.75;">${b.id ?? "—"}</span>
      </div>

      <div style="margin-top:6px; font-size:13px; line-height:1.35;">
        <div><span style="opacity:.75;">Total Net:</span> <span class="total-net-text">${money(b.total_net)}</span></div>
        <div><span style="opacity:.75;">Pay Date:</span> ${fmtDate(b.pay_date)}</div>
        ${b.run_at ? `<div><span style="opacity:.75;">Run At:</span> ${fmtDate(b.run_at)}</div>` : ``}
        <div><span style="opacity:.75;">Status:</span> <span class="status-text">${currentStatus}</span></div>
      </div>

      <div class="edit-wrap" style="margin-top:8px; display:none; gap:8px; align-items:center; flex-wrap:wrap;">
        <label style="font-size:12px; opacity:.8;">Status:</label>
        <select class="edit-status"
          style="width:160px; padding:6px 8px; border:1px solid #ddd; border-radius:8px; font-size:13px;">
          <option value="pending">pending</option>
          <option value="sent">sent</option>
        </select>
        <button class="save-edit" type="button" style="padding:6px 10px; border-radius:8px;">Save</button>
        <button class="cancel-edit" type="button" style="padding:6px 10px; border-radius:8px;">Cancel</button>
        <small class="edit-msg" style="display:block; width:100%; font-size:12px; opacity:.75;"></small>
      </div>
    `;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "flex-start";
    right.style.flexWrap = "wrap";
    right.style.justifyContent = "flex-end";

    const btnPay = document.createElement("button");
    btnPay.type = "button";
    btnPay.textContent = isSent ? "Paid" : "Pay";
    btnPay.style.padding = "6px 12px";
    btnPay.style.borderRadius = "8px";
    btnPay.disabled = isSent;

    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.textContent = "Edit";
    btnEdit.style.padding = "6px 10px";
    btnEdit.style.borderRadius = "8px";

    const btnDelete = document.createElement("button");
    btnDelete.type = "button";
    btnDelete.textContent = "Delete";
    btnDelete.style.padding = "6px 10px";
    btnDelete.style.borderRadius = "8px";
    btnDelete.style.borderColor = "#ffb3b3";

    right.appendChild(btnPay);
    right.appendChild(btnEdit);
    right.appendChild(btnDelete);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);

    const editWrap = left.querySelector(".edit-wrap");
    const editStatus = left.querySelector(".edit-status");
    const saveBtn = left.querySelector(".save-edit");
    const cancelBtn = left.querySelector(".cancel-edit");
    const editMsg = left.querySelector(".edit-msg");
    const statusText = left.querySelector(".status-text");

    editStatus.value = currentStatus;

    btnEdit.addEventListener("click", () => {
      const open = editWrap.style.display !== "none";
      editWrap.style.display = open ? "none" : "flex";
      editMsg.textContent = "";
      if (!open) {
        editStatus.value = String(b.status || "pending").toLowerCase();
        editStatus.focus();
      }
    });

    cancelBtn.addEventListener("click", () => {
      editWrap.style.display = "none";
      editMsg.textContent = "";
    });

    saveBtn.addEventListener("click", async () => {
      const nextStatus = String(editStatus.value || "pending").toLowerCase();
      if (!["pending", "sent"].includes(nextStatus)) {
        editMsg.style.color = "#b00020";
        editMsg.textContent = "Choose pending or sent.";
        return;
      }

      setBusy(saveBtn, true, "Saving…");
      setBusy(btnEdit, true);
      setBusy(btnDelete, true);
      setBusy(btnPay, true);

      const { error: upErr } = await sb
        .from("payout_batches")
        .update({ status: nextStatus })
        .eq("id", b.id);

      setBusy(saveBtn, false);
      setBusy(btnEdit, false);
      setBusy(btnDelete, false);

      if (upErr) {
        setBusy(btnPay, false);
        editMsg.style.color = "#b00020";
        editMsg.textContent = `Save failed: ${upErr.message}`;
        return;
      }

      b.status = nextStatus;
      statusText.textContent = nextStatus;

      const nowSent = nextStatus === "sent";
      btnPay.disabled = nowSent;
      btnPay.textContent = nowSent ? "Paid" : "Pay";

      editMsg.style.color = "#0a7a0a";
      editMsg.textContent = "Saved.";
      setTimeout(() => {
        editWrap.style.display = "none";
        editMsg.textContent = "";
      }, 600);

      if (activeFilter !== "both" && nextStatus !== activeFilter) {
        await loadPayoutBatchesIntoList();
      }
    });

    btnDelete.addEventListener("click", async () => {
      const ok = confirm("Delete this payout batch? This cannot be undone.");
      if (!ok) return;

      setBusy(btnDelete, true, "Deleting…");
      setBusy(btnEdit, true);
      setBusy(btnPay, true);

      const { error: delErr } = await sb
        .from("payout_batches")
        .delete()
        .eq("id", b.id);

      setBusy(btnDelete, false);
      setBusy(btnEdit, false);
      setBusy(btnPay, false);

      if (delErr) {
        alert(`Delete failed: ${delErr.message}`);
        return;
      }

      row.remove();
      if (!list.querySelector(".batch-row")) {
        list.innerHTML = `<div style="opacity:.8;font-size:13px;">No payout batches found.</div>`;
      }
    });

    btnPay.addEventListener("click", async () => {
      const statusNow = String(b.status || "pending").toLowerCase();
      if (statusNow === "sent") {
        alert("This batch is already marked as sent/paid.");
        return;
      }

      const ok = confirm("Run this payout batch now?");
      if (!ok) return;

      setBusy(btnPay, true, "Paying…");
      setBusy(btnEdit, true);
      setBusy(btnDelete, true);

      try {
        const { data: { session } = {} } = await sb.auth.getSession();
        const token = session?.access_token;

        const res = await fetch("/.netlify/functions/sendPayoutBatch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            batch_id: b.id,
            total_net: b.total_net ?? null,
            run_at: b.run_at ?? null
          })
        });

        const text = await res.text();
        let payload = null;
        try { payload = JSON.parse(text); } catch (_) {}

        if (!res.ok) {
          const msg = payload?.error || payload?.message || text || `HTTP ${res.status}`;
          alert(`Pay failed: ${msg}`);
        } else {
          alert(payload?.message || "Batch sent successfully.");

          await sb.from("payout_batches").update({ status: "sent" }).eq("id", b.id);
          await loadPayoutBatchesIntoList();
        }
      } catch (e) {
        alert(`Pay failed: ${e?.message || e}`);
      } finally {
        setBusy(btnPay, false);
        setBusy(btnEdit, false);
        setBusy(btnDelete, false);
      }
    });
  }
}

/* ---------- Adjustment helpers ---------- */

function syncAdjustmentCategoryUI() {
  const cat = document.getElementById('adjustment-category')?.value || '';
  const wrapPolicy = document.getElementById('chargeback-policy-wrapper');
  const wrapLead = document.getElementById('lead-debt-lead-wrapper');

  if (wrapPolicy) wrapPolicy.style.display = (cat === 'chargeback') ? 'block' : 'none';
  if (wrapLead) wrapLead.style.display = (cat === 'lead_debt') ? 'block' : 'none';
}

async function loadPoliciesForChargeback(agentId) {
  const sel = document.getElementById('adjustment-policy');
  if (!sel) return;

  sel.disabled = true;
  sel.innerHTML = '<option value="">Loading policies…</option>';

  const { data, error } = await sb
    .from('policies')
    .select('id, policy_number, carrier_name, premium_annual, issued_at, status')
    .eq('agent_id', agentId)
    .order('issued_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Error loading policies for chargeback:', error);
    sel.innerHTML = '<option value="">Error loading policies</option>';
    sel.disabled = true;
    return;
  }

  sel.innerHTML = '';

  if (!data || !data.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No policies found for this agent';
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = 'Search or select policy…';
  sel.appendChild(ph);

  data.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;

    const premium = typeof p.premium_annual === 'number' ? `$${p.premium_annual.toFixed(2)}` : '';
    const issued = p.issued_at ? new Date(p.issued_at).toLocaleDateString() : '';
    const status = p.status || '';

    const parts = [
      p.policy_number || `Policy #${p.id}`,
      p.carrier_name || '',
      premium,
      issued,
      status
    ].filter(Boolean);

    opt.textContent = parts.join(' · ');
    sel.appendChild(opt);
  });

  sel.disabled = false;

  try {
    if (adjustmentPolicyChoices) {
      adjustmentPolicyChoices.destroy();
      adjustmentPolicyChoices = null;
    }
    adjustmentPolicyChoices = new Choices(sel, {
      searchEnabled: true,
      shouldSort: false,
      itemSelectText: ''
    });
  } catch (_) {}
}

async function loadLeadsForLeadDebt(agentId) {
  const leadSel = document.getElementById('adjustment-lead');
  if (!leadSel) return;

  leadSel.innerHTML = `<option value="">Search or select lead…</option>`;

  if (!agentId) {
    if (adjustmentLeadChoices) {
      try { adjustmentLeadChoices.setChoices([], 'value', 'label', true); } catch (_) {}
    }
    return;
  }

  const { data, error } = await sb
    .from('leads')
    .select('id, first_name, last_name, created_at')
    .eq('assigned_to', agentId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('loadLeadsForLeadDebt error', error);
    return;
  }

  const rows = (data || []).map(l => ({
    value: l.id,
    label: `${(l.first_name || '')} ${(l.last_name || '')}`.trim() || l.id
  }));

  if (window.Choices) {
    try {
      if (adjustmentLeadChoices) adjustmentLeadChoices.destroy();
      adjustmentLeadChoices = new Choices(leadSel, {
        searchEnabled: true,
        itemSelectText: '',
        shouldSort: false,
        choices: rows
      });
    } catch (_) {}
  } else {
    rows.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      leadSel.appendChild(opt);
    });
  }
}

/* ---------- Run payouts ---------- */

function wirePayoutBatchFilters() {
  const filter = document.getElementById("batch-status-filter");
  if (!filter) return;
  filter.addEventListener("change", () => loadPayoutBatchesIntoList());
}

function wireAdjustmentListFilters() {
  const searchEl = document.getElementById('debit-credit-search');
  const rangeEl = document.getElementById('debit-credit-date-range');
  const clearBtn = document.getElementById('debit-credit-filters-clear');

  searchEl?.addEventListener('input', () => applyAdjustmentFilters());

  if (window.flatpickr && rangeEl) {
    _ledgerFp = flatpickr(rangeEl, {
      mode: "range",
      dateFormat: "Y-m-d",
      allowInput: false,
      onChange: () => applyAdjustmentFilters()
    });
  }

  clearBtn?.addEventListener('click', () => {
    if (searchEl) searchEl.value = '';
    if (_ledgerFp) _ledgerFp.clear();
    applyAdjustmentFilters();
  });
}

async function wireRunPayoutsButton() {
  const btn = document.getElementById('run-payouts-btn');
  const status = document.getElementById('run-payouts-status');
  if (!btn) return;

  const PAY_TZ = 'America/Chicago';
  const toIsoDate = (d) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: PAY_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
  
    const y = parts.find(p => p.type === 'year').value;
    const m = parts.find(p => p.type === 'month').value;
    const day = parts.find(p => p.type === 'day').value;
    return `${y}-${m}-${day}`;
  };

  function getWeeklyScheduledDate(today) {
    const d = new Date(today);
    const day = d.getDay();
    const diffToFriday = (5 - day + 7) % 7;
    d.setDate(d.getDate() + diffToFriday);
    return d;
  }

  function getMonthlyScheduledDate(today) {
    const d = new Date(today);
    const fifthThisMonth = new Date(d.getFullYear(), d.getMonth(), 5);
  
    if (d > fifthThisMonth) {
      return new Date(d.getFullYear(), d.getMonth() + 1, 5);
    }
    return fifthThisMonth;
  }

  btn.addEventListener('click', async () => {
    const today = new Date();
    const weeklyPayDate = toIsoDate(getWeeklyScheduledDate(today));
    const monthlyPayDate = toIsoDate(getMonthlyScheduledDate(today));

    btn.disabled = true;
    if (status) status.textContent = 'Running payouts...';

    let statusText = '';
    const tasks = [];

    try {
      tasks.push(
        fetch(`/.netlify/functions/runWeeklyAdvance?pay_date=${weeklyPayDate}`, { method: 'POST' })
          .then(res => res.json())
          .then(data => { statusText += `Weekly advance run for ${weeklyPayDate}: ${data.message || 'OK'}\n`; })
          .catch(err => { statusText += `Weekly advance error: ${err.message}\n`; })
      );

      tasks.push(
        fetch(`/.netlify/functions/runMonthlyPayThru?pay_date=${monthlyPayDate}`, { method: 'POST' })
          .then(res => res.json())
          .then(data => { statusText += `Monthly pay-thru run for ${monthlyPayDate}: ${data.message || 'OK'}\n`; })
          .catch(err => { statusText += `Monthly pay-thru error: ${err.message}\n`; })
      );

      await Promise.all(tasks);

      if (status) status.textContent = statusText.trim() || 'Done.';
      await loadPayoutBatchesIntoList();
    } catch (err) {
      console.error('Error running payouts:', err);
      if (status) status.textContent = `Unexpected error: ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  });
}

async function openEditPolicyModal(policyId) {
  const modal = document.getElementById('policy-edit-modal');
  const errEl = document.getElementById('policy-edit-error');
  if (errEl) errEl.textContent = '';

  const { data: p, error } = await sb
    .from('policies')
    .select(`
      id,
      agent_id,
      carrier_name,
      product_line,
      policy_type,
      policy_number,
      premium_annual,
      submitted_at,
      issued_at,
      status,
      as_earned
    `)
    .eq('id', policyId)
    .single();

  if (error || !p) {
    if (errEl) errEl.textContent = error?.message || 'Could not load policy.';
    return;
  }

  document.getElementById('policy-edit-id').value = p.id;

  await loadAgentsForCommissions();

  const agentSel = document.getElementById('policy-edit-agent');
  if (agentSel) {
    const agentId = p.agent_id || '';
    agentSel.value = agentId;

    if (window.Choices && policyEditAgentChoices) {
      policyEditAgentChoices.setChoiceByValue(agentId);
    }
  }

  document.getElementById('policy-edit-number').value = p.policy_number || '';
  document.getElementById('policy-edit-annual-premium').value = Number(p.premium_annual || 0);
  document.getElementById('policy-edit-carrier').value = p.carrier_name || '';
  document.getElementById('policy-edit-product-line').value = p.product_line || '';
  document.getElementById('policy-edit-policy-type').value = p.policy_type || '';
  document.getElementById('policy-edit-as-earned').value = p.as_earned ? 'true' : 'false';
  document.getElementById('policy-edit-status').value = p.status || 'pending';

  const toYMD = (iso) => iso ? String(iso).slice(0, 10) : '';
  document.getElementById('policy-edit-submitted-date').value = toYMD(p.submitted_at);
  const issuedEl = document.getElementById('policy-edit-issued-date');
  if (issuedEl) issuedEl.value = toYMD(p.issued_at);

  openModal(modal);
}

/* ---------- Add attachment later ---------- */

async function openPolicyAttachmentModal(policyId) {
  const modal = document.getElementById('policy-attachment-modal');
  const errEl = document.getElementById('policy-attachment-error');
  const contextEl = document.getElementById('policy-attachment-context');
  const sel = document.getElementById('policy-attachment-type');
  const premiumEl = document.getElementById('policy-attachment-annual-premium');
  const issuedEl = document.getElementById('policy-attachment-issued-date');

  if (errEl) errEl.textContent = '';
  if (premiumEl) premiumEl.value = '';
  if (issuedEl) issuedEl.value = ymdToday();
  destroyChoicesInstance(policyAttachmentModalChoices);
  policyAttachmentModalChoices = null;
  _activeAttachmentModalSchedules = [];

  const { data: policy, error } = await sb
    .from('policies')
    .select('id, agent_id, policy_number, carrier_name, product_line, policy_type, issued_at')
    .eq('id', policyId)
    .single();

  if (error || !policy) {
    if (errEl) errEl.textContent = error?.message || 'Could not load policy.';
    return;
  }

  document.getElementById('policy-attachment-policy-id').value = policy.id;

  if (contextEl) {
    contextEl.innerHTML = `
      <div><strong>Policy #:</strong> ${policy.policy_number || '—'}</div>
      <div><strong>Carrier:</strong> ${policy.carrier_name || '—'}</div>
      <div><strong>Product Line:</strong> ${policy.product_line || '—'}</div>
      <div><strong>Policy Type:</strong> ${policy.policy_type || '—'}</div>
    `;
  }

  const schedules = await fetchEligibleAttachmentSchedulesForPolicyContext({
    agentId: policy.agent_id,
    carrierName: policy.carrier_name,
    productLine: policy.product_line,
    parentPolicyType: policy.policy_type
  });

  _activeAttachmentModalSchedules = schedules;

  sel.innerHTML = '';
  if (!schedules.length) {
    sel.innerHTML = '<option value="">No attachment schedules found</option>';
    sel.disabled = true;
    if (errEl) errEl.textContent = 'No matching attachment schedules were found for this policy and agent level.';
  } else {
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select attachment…</option>';
    schedules.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = getAttachmentScheduleLabel(s);
      sel.appendChild(opt);
    });
  }

  policyAttachmentModalChoices = ensureChoicesForSelect(sel, policyAttachmentModalChoices);
  openModal(modal);
}

function wirePolicyAttachmentButtons() {
  const list = document.getElementById('policy-list');
  if (!list) return;

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('.policy-add-attachment-btn');
    if (!btn) return;

    const policyId = btn.dataset.policyId;
    if (!policyId) return;

    await openPolicyAttachmentModal(policyId);
  });
}

function wirePolicyAttachmentModalButtons() {
  document.getElementById('policy-attachment-cancel')?.addEventListener('click', () => {
    closeModal(document.getElementById('policy-attachment-modal'));
  });

  document.getElementById('policy-attachment-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'policy-attachment-modal') closeModal(e.currentTarget);
  });
}

function wirePolicyAttachmentSubmit() {
  document.getElementById('policy-attachment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl = document.getElementById('policy-attachment-error');
    if (errEl) errEl.textContent = '';

    try {
      const policyId = document.getElementById('policy-attachment-policy-id')?.value || '';
      const scheduleId = document.getElementById('policy-attachment-type')?.value || '';
      const annualPremium = Number(document.getElementById('policy-attachment-annual-premium')?.value || 0);
      const issuedRaw = document.getElementById('policy-attachment-issued-date')?.value || '';

      if (!policyId || !scheduleId || !(annualPremium > 0) || !issuedRaw) {
        if (errEl) errEl.textContent = 'Please complete all required fields.';
        return;
      }

      const schedule = _activeAttachmentModalSchedules.find(s => String(s.id) === String(scheduleId));
      if (!schedule) {
        if (errEl) errEl.textContent = 'Could not find the selected attachment schedule.';
        return;
      }

      const { data: policy, error: polErr } = await sb
        .from('policies')
        .select('id, policy_number, carrier_name, product_line, policy_type')
        .eq('id', policyId)
        .single();

      if (polErr || !policy) {
        if (errEl) errEl.textContent = polErr?.message || 'Could not load policy.';
        return;
      }

      const issued_at = new Date(issuedRaw).toISOString();

      const payload = {
        policy_id: policy.id,
        attachment_name: schedule.policy_type,
        attachment_type: schedule.policy_type,
        carrier_name: policy.carrier_name,
        product_line: policy.product_line,
        policy_type: schedule.policy_type,
        policy_number: policy.policy_number,
        status: 'active',
        issued_at,
        effective_at: issued_at,
        premium_annual: annualPremium,
        premium_modal: annualPremium / 12,
        commissionable_premium_annual: annualPremium,
        commissionable_premium_modal: annualPremium / 12,
        metadata: {
          attachment_schedule_id: schedule.id,
          parent_policy_type: policy.policy_type,
          created_from: 'admin_commissions_attachment_modal',
          created_by: userId || null
        }
      };

      const { error: insErr } = await sb
        .from('policy_attachments')
        .insert([payload]);

      if (insErr) {
        if (errEl) errEl.textContent = insErr.message || 'Could not save attachment.';
        return;
      }

      closeModal(document.getElementById('policy-attachment-modal'));
      alert('Attachment added.');
    } catch (ex) {
      console.error('policy attachment submit error', ex);
      if (errEl) errEl.textContent = 'Could not save attachment.';
    }
  });
}

/* ---------- Wire modal open/close ---------- */

function wirePolicyEditButtons() {
  const list = document.getElementById('policy-list');
  if (!list) return;

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('.policy-edit-btn');
    if (!btn) return;

    const policyId = btn.dataset.policyId;
    if (!policyId) return;

    await openEditPolicyModal(policyId);
  });
}

function wirePolicyEditSubmit() {
  document.getElementById('policy-edit-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl = document.getElementById('policy-edit-error');
    if (errEl) errEl.textContent = '';

    const id = document.getElementById('policy-edit-id')?.value;
    if (!id) return;

    const agent_id = document.getElementById('policy-edit-agent')?.value || null;
    const policy_number = document.getElementById('policy-edit-number')?.value?.trim() || null;
    const premium_annual = Number(document.getElementById('policy-edit-annual-premium')?.value || 0);
    const premium_modal = premium_annual > 0 ? (premium_annual / 12) : null;
    
    const carrier_name = document.getElementById('policy-edit-carrier')?.value?.trim() || null;
    const product_line = document.getElementById('policy-edit-product-line')?.value?.trim() || null;
    const policy_type = document.getElementById('policy-edit-policy-type')?.value?.trim() || null;

    const as_earned = (document.getElementById('policy-edit-as-earned')?.value === 'true');
    const status = document.getElementById('policy-edit-status')?.value || 'pending';

    const submitted_raw = document.getElementById('policy-edit-submitted-date')?.value || null;
    const submitted_at = submitted_raw ? new Date(submitted_raw).toISOString() : null;

    const issued_raw = document.getElementById('policy-edit-issued-date')?.value || null;
    const issued_at = issued_raw ? new Date(issued_raw).toISOString() : null;

    if (!agent_id || !carrier_name || !product_line || !policy_type || !policy_number || !(premium_annual > 0) || !submitted_at) {
      if (errEl) errEl.textContent = 'Please complete all required fields.';
      return;
    }

    const updatePayload = {
      agent_id,
      carrier_name,
      product_line,
      policy_type,
      policy_number,
      premium_annual,
      premium_modal,
      submitted_at,
      status,
      as_earned,
      ...(issued_raw ? { issued_at } : {})
    };

    const { error } = await sb
      .from('policies')
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      if (errEl) errEl.textContent = error.message || 'Update failed.';
      return;
    }

    closeModal(document.getElementById('policy-edit-modal'));
    await loadPoliciesIntoList();
  });
}

function wireModalButtons() {
  const policyModal = document.getElementById('policy-modal');
  const adjustmentModal = document.getElementById('adjustment-modal');

  const openPolicyBtn = document.getElementById('open-policy-modal');
  const openAdjustmentBtn = document.getElementById('open-debit-credit-modal');
  const policyCancelBtn = document.getElementById('policy-cancel');
  const adjustmentCancelBtn = document.getElementById('adjustment-cancel');

  openPolicyBtn?.addEventListener('click', async () => {
    await loadAgentsForCommissions();

    const agentId = document.getElementById('policy-agent')?.value || null;
    await loadContactsForPolicy(agentId);
    await loadCarriersForPolicy();

    const lineSel = document.getElementById('policy-product-line');
    const typeSel = document.getElementById('policy-policy-type');

    if (lineSel) { lineSel.innerHTML = '<option value="">Select carrier first…</option>'; lineSel.disabled = true; }
    if (typeSel) { typeSel.innerHTML = '<option value="">Select carrier first…</option>'; typeSel.disabled = true; }

    try {
      if (policyProductLineChoices) { policyProductLineChoices.destroy(); policyProductLineChoices = null; }
      if (policyPolicyTypeChoices) { policyPolicyTypeChoices.destroy(); policyPolicyTypeChoices = null; }
    } catch (_) {}

    const newWrap = document.getElementById('policy-new-contact-wrap');
    if (newWrap) newWrap.style.display = 'none';

    const leadsWrap = document.getElementById('policy-leads-wrap');
    const leadsSel = document.getElementById('policy-leads');
    if (leadsWrap) leadsWrap.style.display = 'none';
    if (leadsSel) leadsSel.innerHTML = '';
    destroyChoicesInstance(policyLeadsChoices);
    policyLeadsChoices = null;

    resetPolicyAttachmentUI();

    const ae = document.getElementById('policy-as-earned');
    if (ae) ae.value = 'false';
    
    const sd = document.getElementById('policy-submitted-date');
    if (sd) {
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, '0');
      const dd = String(today.getDate()).padStart(2, '0');
      sd.value = `${yyyy}-${mm}-${dd}`;
    }

    const idt = document.getElementById('policy-issued-date');
    if (idt) idt.value = '';

    openModal(policyModal);
  });

  openAdjustmentBtn?.addEventListener('click', async () => {
    await loadAgentsForCommissions();
    syncAdjustmentCategoryUI();
    openModal(adjustmentModal);
  });

  document.getElementById('policy-edit-cancel')?.addEventListener('click', () => {
    closeModal(document.getElementById('policy-edit-modal'));
  });
  document.getElementById('policy-edit-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'policy-edit-modal') closeModal(e.currentTarget);
  });
  
  policyCancelBtn?.addEventListener('click', () => closeModal(policyModal));
  adjustmentCancelBtn?.addEventListener('click', () => closeModal(adjustmentModal));
}

/* ---------- Dependencies ---------- */

function wirePolicyListFilters() {
  const searchEl = document.getElementById('policy-search');
  const rangeEl = document.getElementById('policy-date-range');
  const clearBtn = document.getElementById('policy-filters-clear');

  if (searchEl) {
    searchEl.addEventListener('input', () => applyPolicyFilters());
  }

  if (window.flatpickr && rangeEl) {
    _policiesFp = flatpickr(rangeEl, {
      mode: "range",
      dateFormat: "Y-m-d",
      allowInput: false,
      onChange: () => applyPolicyFilters()
    });
  }

  clearBtn?.addEventListener('click', () => {
    if (searchEl) searchEl.value = '';
    if (_policiesFp) _policiesFp.clear();
    applyPolicyFilters();
  });
}

function wirePolicyContactNewToggle() {
  const policyContactSel = document.getElementById('policy-contact');
  const newContactWrap = document.getElementById('policy-new-contact-wrap');
  if (!policyContactSel || !newContactWrap) return;

  policyContactSel.addEventListener('change', async () => {
    const v = policyContactSel.value;
  
    newContactWrap.style.display = (v === '__new__') ? 'block' : 'none';
    await loadLeadsForSelectedContact(v);
  });
}

function wirePolicyDependencies() {
  document.getElementById('policy-agent')?.addEventListener('change', async (e) => {
    await loadContactsForPolicy(e.target.value || null);
  
    const leadsWrap = document.getElementById('policy-leads-wrap');
    const leadsSel = document.getElementById('policy-leads');
    if (leadsWrap) leadsWrap.style.display = 'none';
    if (leadsSel) leadsSel.innerHTML = '';
    destroyChoicesInstance(policyLeadsChoices);
    policyLeadsChoices = null;
  
    const contactId = document.getElementById('policy-contact')?.value || '';
    if (contactId && contactId !== '__new__') {
      await loadLeadsForSelectedContact(contactId);
    }

    await refreshPolicyAttachmentOptions();
  });

  document.getElementById('policy-carrier')?.addEventListener('change', async (e) => {
    await loadProductLinesAndTypesForCarrier(e.target.value || null);
    resetPolicyAttachmentUI();
  });

  document.getElementById('policy-product-line')?.addEventListener('change', async () => {
    hydratePolicyTypesForSelectedLine();
    resetPolicyAttachmentUI();
  });

  document.getElementById('policy-policy-type')?.addEventListener('change', async () => {
    await refreshPolicyAttachmentOptions();
  });

  document.getElementById('add-policy-attachment-row')?.addEventListener('click', () => {
    addPolicyAttachmentRow();
  });

  document.getElementById('policy-attachments-list')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.policy-attachment-remove');
    if (!btn) return;

    const row = btn.closest('.policy-attachment-row');
    const selectEl = row?.querySelector('.policy-attachment-type-select');
    if (selectEl) {
      const idx = Array.from(document.querySelectorAll('.policy-attachment-type-select')).indexOf(selectEl);
      if (idx > -1 && _policyAttachmentRowChoices[idx]) {
        destroyChoicesInstance(_policyAttachmentRowChoices[idx]);
        _policyAttachmentRowChoices.splice(idx, 1);
      }
    }

    row?.remove();
  });
}

function wireAdjustmentDependencies() {
  document.getElementById('adjustment-category')?.addEventListener('change', async () => {
    syncAdjustmentCategoryUI();
    const agentId = document.getElementById('adjustment-agent')?.value || '';
    const cat = document.getElementById('adjustment-category')?.value || '';
    if (cat === 'chargeback') await loadPoliciesForChargeback(agentId);
    if (cat === 'lead_debt') await loadLeadsForLeadDebt(agentId);
  });

  document.getElementById('adjustment-agent')?.addEventListener('change', async (e) => {
    const agentId = e.target.value || '';
    const cat = document.getElementById('adjustment-category')?.value || '';
    if (cat === 'chargeback') await loadPoliciesForChargeback(agentId);
    if (cat === 'lead_debt') await loadLeadsForLeadDebt(agentId);
  });
}

/* ---------- Policy submit ---------- */

async function attachLeadsToPolicy({ policyId, leadIds, submitted_at_iso, policy_number, created_by }) {
  const ids = Array.isArray(leadIds) ? leadIds.filter(Boolean) : [];
  if (!policyId || !ids.length) return;

  const rows = ids.map(lead_id => ({
    policy_id: policyId,
    lead_id,
    created_by: created_by || null
  }));

  const { error: linkErr } = await sb
    .from('policy_leads')
    .insert(rows);

  if (linkErr) {
    console.error('policy_leads insert error:', linkErr);
  }

  const { error: leadUpErr } = await sb
    .from('leads')
    .update({
      closed_at: submitted_at_iso,
      closed_status: 'won',
      closed_reason: `Sold policy ${policy_number || ''}`.trim()
    })
    .in('id', ids);

  if (leadUpErr) {
    console.error('leads close update error:', leadUpErr);
  }

  const primaryLeadId = ids[0] || null;
  if (primaryLeadId) {
    const { error: polUpErr } = await sb
      .from('policies')
      .update({ lead_id: primaryLeadId })
      .eq('id', policyId);

    if (polUpErr) {
      console.warn('policy primary lead update error:', polUpErr);
    }
  }
}

function wirePolicySubmit() {
  document.getElementById('policy-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl = document.getElementById('policy-error');
    if (errEl) errEl.textContent = '';

    try {
      const agent_id = document.getElementById('policy-agent')?.value || null;
      const contact_id_sel = document.getElementById('policy-contact')?.value || null;

      const carrierSel = document.getElementById('policy-carrier');
      const carrier_name = carrierSel?.options?.[carrierSel.selectedIndex]?.text || null;

      const product_line = document.getElementById('policy-product-line')?.value || null;
      const policy_type = document.getElementById('policy-policy-type')?.value || null;
      const policy_number = document.getElementById('policy-number')?.value?.trim() || null;

      const premium_annual = Number(document.getElementById('policy-annual-premium')?.value || 0);
      const premium_modal = premium_annual > 0 ? (premium_annual / 12) : null;
      
      const submitted_raw = document.getElementById('policy-submitted-date')?.value || null;
      const submitted_at = submitted_raw ? new Date(submitted_raw).toISOString() : null;
      
      const issued_raw = document.getElementById('policy-issued-date')?.value || null;
      const issued_at = issued_raw ? new Date(issued_raw).toISOString() : null;
      
      const as_earned = (document.getElementById('policy-as-earned')?.value === 'true');
      const status = document.getElementById('policy-status')?.value || 'pending';
      
      if (!agent_id || !carrier_name || !product_line || !policy_type || !policy_number || !(premium_annual > 0) || !submitted_at) {
        if (errEl) errEl.textContent = 'Please complete all required fields.';
        return;
      }

      let attachmentRows = [];
      try {
        attachmentRows = collectPolicyAttachmentRows();
      } catch (attachErr) {
        if (errEl) errEl.textContent = attachErr.message || 'Invalid attachment rows.';
        return;
      }

      let contact_id = contact_id_sel;

      if (contact_id_sel === '__new__') {
        const first_name = document.getElementById('policy-contact-first')?.value?.trim() || '';
        const last_name = document.getElementById('policy-contact-last')?.value?.trim() || '';
        const phone = document.getElementById('policy-contact-phone')?.value?.trim() || '';
        const email = document.getElementById('policy-contact-email')?.value?.trim() || '';

        const address_line1 = document.getElementById('policy-contact-address1')?.value?.trim() || '';
        const address_line2 = document.getElementById('policy-contact-address2')?.value?.trim() || '';
        const city = document.getElementById('policy-contact-city')?.value?.trim() || '';
        const state = document.getElementById('policy-contact-state')?.value?.trim() || '';
        const zip = document.getElementById('policy-contact-zip')?.value?.trim() || '';

        if (!first_name || !last_name) {
          if (errEl) errEl.textContent = 'New contact requires first + last name.';
          return;
        }

        const { data: newContact, error: cErr } = await sb
          .from('contacts')
          .insert([{
            owning_agent_id: agent_id,
            first_name,
            last_name,
            phones: [phone].filter(Boolean),
            emails: [email].filter(Boolean),
            address_line1,
            address_line2,
            city,
            state,
            zip
          }])
          .select('id')
          .single();

        if (cErr) {
          console.error('Create contact error', cErr);
          if (errEl) errEl.textContent = 'Could not create contact.';
          return;
        }

        contact_id = newContact?.id || null;
      }

      if (!contact_id) {
        if (errEl) errEl.textContent = 'Please select or create a contact.';
        return;
      }

      const { data: newPolicy, error: pErr } = await sb
        .from('policies')
        .insert([{
          agent_id,
          contact_id,
          carrier_name,
          product_line,
          policy_type,
          policy_number,
          premium_annual,
          premium_modal,
          submitted_at,
          issued_at,
          status,
          as_earned
        }])
        .select('id')
        .single();

      if (pErr) {
        console.error('Create policy error', pErr);
        if (errEl) errEl.textContent = 'Could not save policy.';
        return;
      }

      if (attachmentRows.length) {
        const policyAttachmentsPayload = attachmentRows.map(a => ({
          policy_id: newPolicy.id,
          attachment_name: a.schedule.policy_type,
          attachment_type: a.schedule.policy_type,
          carrier_name,
          product_line,
          policy_type: a.schedule.policy_type,
          policy_number,
          status: 'active',
          issued_at,
          effective_at: issued_at,
          premium_annual: a.premium_annual,
          premium_modal: a.premium_modal,
          commissionable_premium_annual: a.premium_annual,
          commissionable_premium_modal: a.premium_modal,
          metadata: {
            attachment_schedule_id: a.schedule.id,
            parent_policy_type: policy_type,
            created_from: 'admin_commissions_policy_modal',
            created_by: userId || null
          }
        }));

        const { error: paErr } = await sb
          .from('policy_attachments')
          .insert(policyAttachmentsPayload);

        if (paErr) {
          console.error('Create policy attachments error', paErr);
          if (errEl) errEl.textContent = 'Policy saved, but attachments could not be saved.';
          return;
        }
      }
      
      const leadsSelEl = document.getElementById('policy-leads');
      const selectedLeadIds = (window.Choices && policyLeadsChoices)
        ? (policyLeadsChoices.getValue(true) || [])
        : Array.from(leadsSelEl?.selectedOptions || []).map(o => o.value);
      
      const leadIds = Array.isArray(selectedLeadIds) ? selectedLeadIds.filter(Boolean) : [];
      
      await attachLeadsToPolicy({
        policyId: newPolicy.id,
        leadIds,
        submitted_at_iso: submitted_at,
        policy_number,
        created_by: userId
      });

      if (typeof window.runPolicyCommissionFlow === 'function') {
        await window.runPolicyCommissionFlow(newPolicy.id);
      } else if (typeof runPolicyCommissionFlow === 'function') {
        await runPolicyCommissionFlow(newPolicy.id);
      }

      alert('Policy created.');

      closeModal(document.getElementById('policy-modal'));
      document.getElementById('policy-form')?.reset();

      const wrap = document.getElementById('policy-new-contact-wrap');
      if (wrap) wrap.style.display = 'none';

      resetPolicyAttachmentUI();

      await loadPoliciesIntoList();
    } catch (ex) {
      console.error('policy submit error', ex);
      const errEl = document.getElementById('policy-error');
      if (errEl) errEl.textContent = 'Could not save policy.';
    }
  });
}

/* ---------- Adjustment submit ---------- */

function wireAdjustmentSubmit() {
  document.getElementById('adjustment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errorEl = document.getElementById('adjustment-error');
    if (errorEl) errorEl.textContent = '';

    try {
      const agent_id = document.getElementById('adjustment-agent')?.value || null;
      const type = document.getElementById('adjustment-type')?.value || '';
      const category = document.getElementById('adjustment-category')?.value || '';
      const rawAmount = parseFloat(document.getElementById('adjustment-amount')?.value || '0');
      const effective_date = document.getElementById('adjustment-date')?.value || '';
      const description = document.getElementById('adjustment-description')?.value?.trim() || '';

      const policy_id = (category === 'chargeback') ? (document.getElementById('adjustment-policy')?.value || null) : null;
      const lead_id = (category === 'lead_debt') ? (document.getElementById('adjustment-lead')?.value || null) : null;

      if (!agent_id || !type || !category || !effective_date || !Number.isFinite(rawAmount) || rawAmount <= 0) {
        if (errorEl) errorEl.textContent = 'Please fill in all required fields.';
        return;
      }

      const normType = String(type).toLowerCase();
      const signedAmount = normType === 'debit' ? -Math.abs(rawAmount) : Math.abs(rawAmount);

      let entry_type;
      if (normType === 'debit') entry_type = (category === 'chargeback') ? 'chargeback' : 'lead_charge';
      else entry_type = 'override';

      const payload = {
        agent_id,
        amount: signedAmount,
        entry_type,
        category,
        description: description || null,
        period_start: effective_date,
        period_end: effective_date,
        policy_id: category === 'chargeback' ? policy_id : null,
        lead_id: category === 'lead_debt' ? lead_id : null,
        meta: {
          ui_type: normType,
          ui_category: category,
          created_by: userId || null
        }
      };

      const { data: ledgerRow, error: ledgerErr } = await sb
        .from('commission_ledger')
        .insert([payload])
        .select()
        .single();

      if (ledgerErr) {
        console.error('Error inserting ledger adjustment', ledgerErr);
        if (errorEl) errorEl.textContent = 'Error saving debit/credit: ' + ledgerErr.message;
        return;
      }

      if (normType === 'debit' && category === 'lead_debt') {
        if (!lead_id) {
          if (errorEl) errorEl.textContent = 'Please choose a lead for this lead debt.';
          return;
        }

        const { error: ldErr } = await sb.from('lead_debts').insert([{
          agent_id,
          lead_id,
          description: description || null,
          source: 'manual_adjustment',
          amount: rawAmount,
          status: 'open',
          metadata: {
            effective_date,
            commission_ledger_id: ledgerRow.id,
            lead_id
          }
        }]);

        if (ldErr) {
          console.error('Error inserting lead_debts', ldErr);
          if (errorEl) errorEl.textContent = 'Saved to ledger, but lead debt record failed: ' + ldErr.message;
          return;
        }
      }

      if (normType === 'debit' && category === 'chargeback') {
        if (!policy_id) {
          if (errorEl) errorEl.textContent = 'Please choose a policy for this chargeback.';
          return;
        }

        const { data: pol, error: polErr } = await sb
          .from('policies')
          .select(`
            id,
            carrier_name,
            contact:contacts (
              first_name,
              last_name
            )
          `)
          .eq('id', policy_id)
          .single();

        if (polErr) {
          console.error('Error loading policy for chargeback:', polErr);
          if (errorEl) errorEl.textContent = 'Could not load policy details: ' + polErr.message;
          return;
        }

        const carrier_name = pol?.carrier_name || null;
        const policyholder_name = pol?.contact
          ? [pol.contact.first_name, pol.contact.last_name].filter(Boolean).join(' ').trim() || null
          : null;

        const { error: cbErr } = await sb.from('policy_chargebacks').insert([{
          agent_id,
          policy_id,
          carrier_name,
          policyholder_name,
          amount: rawAmount,
          status: 'open',
          reason: description || null,
          metadata: {
            effective_date,
            commission_ledger_id: ledgerRow.id
          }
        }]);

        if (cbErr) {
          console.error('Error inserting policy_chargebacks', cbErr);
          if (errorEl) errorEl.textContent = 'Saved to ledger, but chargeback record failed: ' + cbErr.message;
          return;
        }
      }

      closeModal(document.getElementById('adjustment-modal'));
      document.getElementById('adjustment-form')?.reset();
      syncAdjustmentCategoryUI();

      await loadAdjustmentsIntoList();
    } catch (ex) {
      console.error('adjustment submit error', ex);
      const errEl = document.getElementById('adjustment-error');
      if (errEl) errEl.textContent = 'Could not save debit/credit.';
    }
  });
}

/* ---------- Init ---------- */

function ymdToday(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

function openRenewalModal(policyId){
  const modal = document.getElementById('renewal-modal');
  const errEl = document.getElementById('renewal-error');
  if (errEl) errEl.textContent = '';

  document.getElementById('renewal-policy-id').value = policyId || '';
  const startEl = document.getElementById('renewal-term-start');
  const endEl = document.getElementById('renewal-term-end');
  const monthsEl = document.getElementById('renewal-term-months');
  const premEl = document.getElementById('renewal-term-premium');
  const noteEl = document.getElementById('renewal-note');

  if (startEl) startEl.value = ymdToday();
  if (endEl) endEl.value = '';
  if (monthsEl) monthsEl.value = 12;
  if (premEl) premEl.value = '';
  if (noteEl) noteEl.value = '';

  openModal(modal);
}

function wireRenewalButtons(){
  const list = document.getElementById('policy-list');
  if (!list) return;

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.policy-renew-btn');
    if (!btn) return;
    const policyId = btn.dataset.policyId;
    if (!policyId) return;
    openRenewalModal(policyId);
  });
}

function wireRenewalModalButtons(){
  document.getElementById('renewal-cancel')?.addEventListener('click', () => {
    closeModal(document.getElementById('renewal-modal'));
  });

  document.getElementById('renewal-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'renewal-modal') closeModal(e.currentTarget);
  });
}

function wireRenewalSubmit(){
  document.getElementById('renewal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl = document.getElementById('renewal-error');
    if (errEl) errEl.textContent = '';

    const policy_id = document.getElementById('renewal-policy-id')?.value || null;
    const term_start = document.getElementById('renewal-term-start')?.value || null;
    const term_end = document.getElementById('renewal-term-end')?.value || null;
    const term_months = Number(document.getElementById('renewal-term-months')?.value || 0);
    const term_premium = Number(document.getElementById('renewal-term-premium')?.value || 0);
    const note = document.getElementById('renewal-note')?.value?.trim() || null;

    if (!policy_id || !term_start || !(term_months > 0) || !(term_premium >= 0)) {
      if (errEl) errEl.textContent = 'Please complete required fields.';
      return;
    }

    const payload = {
      policy_id,
      term_start,
      term_end: term_end || null,
      term_months,
      term_premium,
      note
    };

    const { error } = await sb
      .from('policy_terms')
      .insert([payload]);

    if (error) {
      console.error('Add renewal error:', error);
      if (errEl) errEl.textContent = error.message || 'Could not add renewal.';
      return;
    }

    closeModal(document.getElementById('renewal-modal'));
    alert('Renewal term added.');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb) {
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  const { data: { session } = {} } = await sb.auth.getSession();
  userId = session?.user?.id || null;

  await wireRunPayoutsButton();
  wireModalButtons();
  wirePolicyContactNewToggle();
  wirePolicyDependencies();
  wireAdjustmentDependencies();
  wirePolicySubmit();
  wireAdjustmentSubmit();
  wirePolicyEditButtons();
  wirePolicyEditSubmit();
  wirePolicyAttachmentButtons();
  wirePolicyAttachmentModalButtons();
  wirePolicyAttachmentSubmit();
  await loadAgentsForCommissions();
  await loadCarriersForPolicy();
  wireAdjustmentListFilters();
  const agentId = document.getElementById('policy-agent')?.value || null;
  await loadContactsForPolicy(agentId);
  wirePolicyListFilters();
  await loadPoliciesIntoList();
  await loadAdjustmentsIntoList();
  await loadPayoutBatchesIntoList();
  wirePayoutBatchFilters();
  await loadPayoutBatchesIntoList();
  wireRenewalButtons();
  wireRenewalModalButtons();
  wireRenewalSubmit();
});
