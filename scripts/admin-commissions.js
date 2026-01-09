// scripts/admin-commissions.js
const sb = window.supabaseClient || window.supabase;

let userId = null;

// Choices instances (optional; safe if Choices is loaded)
let adjustmentPolicyChoices = null;
let adjustmentLeadChoices = null;
let policyContactChoices = null;
let policyCarrierChoices = null;
let policyProductLineChoices = null;
let policyPolicyTypeChoices = null;

const policyModal = document.getElementById('policy-modal');
const adjustmentModal = document.getElementById('adjustment-modal');
const openPolicyBtn = document.getElementById('open-policy-modal');
const openAdjustmentBtn = document.getElementById('open-debit-credit-modal');
const policyCancelBtn = document.getElementById('policy-cancel');
const adjustmentCancelBtn = document.getElementById('adjustment-cancel');

function openModal(el) { if (el) el.style.display = 'flex'; }
function closeModal(el) { if (el) el.style.display = 'none'; }

let commissionAgentsLoaded = false;

async function loadAgentsForCommissions(force = false) {
  if (commissionAgentsLoaded && !force) return;

  const { data, error } = await sb
    .from('agents')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error loading agents for commissions', error);
    return;
  }

  const selects = [
    document.getElementById('policy-agent'),
    document.getElementById('adjustment-agent'),
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

  commissionAgentsLoaded = true;
}

async function loadContactsForPolicy() {
  const sel = document.getElementById('policy-contact');
  if (!sel) return;

  const { data, error } = await sb
    .from('contacts')
    .select('id, first_name, last_name, phone, email')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('Error loading contacts', error);
    return;
  }

  sel.innerHTML = `
    <option value="">Select contact…</option>
    <option value="__new__">➕ New contact (enter below)</option>
  `;

  (data || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unnamed';
    const phone = Array.isArray(c.phone) ? c.phone.filter(Boolean).join(', ') : (c.phone || '');
    const email = Array.isArray(c.email) ? c.email.filter(Boolean).join(', ') : (c.email || '');
    opt.textContent = `${name}${phone ? ` • ${phone}` : ''}${email ? ` • ${email}` : ''}`;
    sel.appendChild(opt);
  });

  if (window.Choices) {
    if (policyContactChoices) policyContactChoices.destroy();
    policyContactChoices = new Choices(sel, {
      searchEnabled: true,
      itemSelectText: '',
      shouldSort: false
    });
  }
}

async function loadCarriersForPolicy() {
  const carrierSel = document.getElementById('policy-carrier');
  if (!carrierSel) return;

  const { data, error } = await sb
    .from('carriers')
    .select('id, name')
    .order('name', { ascending: true });

  if (error) {
    console.error('Error loading carriers', error);
    return;
  }

  carrierSel.innerHTML = `<option value="">Select carrier…</option>`;
  (data || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name || c.id;
    carrierSel.appendChild(opt);
  });

  if (window.Choices) {
    if (policyCarrierChoices) policyCarrierChoices.destroy();
    policyCarrierChoices = new Choices(carrierSel, {
      searchEnabled: true,
      itemSelectText: '',
      shouldSort: true
    });
  }
}

async function loadCarrierDependentPolicySelects(carrierId) {
  const productLineSel = document.getElementById('policy-product-line');
  const policyTypeSel = document.getElementById('policy-policy-type');
  if (!productLineSel || !policyTypeSel) return;

  productLineSel.disabled = true;
  policyTypeSel.disabled = true;
  productLineSel.innerHTML = `<option value="">Select carrier first…</option>`;
  policyTypeSel.innerHTML = `<option value="">Select carrier first…</option>`;

  if (!carrierId) return;

  const { data: cps, error } = await sb
    .from('carrier_products')
    .select('product_line, policy_type')
    .eq('carrier_id', carrierId);

  if (error) {
    console.error('Error loading carrier_products', error);
    return;
  }

  const productLines = Array.from(new Set((cps || []).map(r => r.product_line).filter(Boolean))).sort();
  const policyTypes  = Array.from(new Set((cps || []).map(r => r.policy_type).filter(Boolean))).sort();

  productLineSel.innerHTML =
    `<option value="">Select product line…</option>` +
    productLines.map(v => `<option value="${v}">${v}</option>`).join('');

  policyTypeSel.innerHTML =
    `<option value="">Select policy type…</option>` +
    policyTypes.map(v => `<option value="${v}">${v}</option>`).join('');

  productLineSel.disabled = false;
  policyTypeSel.disabled = false;

  if (window.Choices) {
    if (policyProductLineChoices) policyProductLineChoices.destroy();
    if (policyPolicyTypeChoices) policyPolicyTypeChoices.destroy();

    policyProductLineChoices = new Choices(productLineSel, {
      searchEnabled: true,
      itemSelectText: '',
      shouldSort: true
    });
    policyPolicyTypeChoices = new Choices(policyTypeSel, {
      searchEnabled: true,
      itemSelectText: '',
      shouldSort: true
    });
  }
}

async function loadPoliciesIntoList() {
  const list = document.getElementById('policy-list');
  if (!list) return;

  list.innerHTML = `<div style="padding:10px;">Loading…</div>`;

  const { data, error } = await sb
    .from('policies')
    .select('id, policy_number, annual_premium, status, issue_date, agent_id, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error loading policies list', error);
    list.innerHTML = `<div style="padding:10px;">Error loading policies.</div>`;
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    list.innerHTML = `<div style="padding:10px;">No policies yet.</div>`;
    return;
  }

  list.innerHTML = rows.map(p => {
    const prem = Number(p.annual_premium || 0).toFixed(2);
    const dt = p.issue_date ? String(p.issue_date) : '—';
    const st = p.status ? String(p.status).replace(/_/g, ' ') : '—';
    return `
      <div class="mini-row">
        <div><strong>${p.policy_number || '—'}</strong></div>
        <div>$${prem} • ${st} • Issue: ${dt}</div>
      </div>
    `;
  }).join('');
}

async function loadDebitCreditIntoList() {
  const list = document.getElementById('debit-credit-list');
  if (!list) return;

  list.innerHTML = `<div style="padding:10px;">Loading…</div>`;

  const { data, error } = await sb
    .from('agent_adjustments')
    .select('id, agent_id, type, category, amount, effective_date, description, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error loading adjustments list', error);
    list.innerHTML = `<div style="padding:10px;">Error loading debits/credits.</div>`;
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    list.innerHTML = `<div style="padding:10px;">No debits/credits yet.</div>`;
    return;
  }

  list.innerHTML = rows.map(a => {
    const amt = Number(a.amount || 0).toFixed(2);
    const t = a.type || '—';
    const c = a.category || '—';
    const dt = a.effective_date ? String(a.effective_date) : '—';
    return `
      <div class="mini-row">
        <div><strong>${String(t).toUpperCase()}</strong> • ${c}</div>
        <div>$${amt} • ${dt}</div>
      </div>
    `;
  }).join('');
}

async function loadPayoutBatches() {
  const list = document.getElementById('batch-list');
  if (!list) return;

  list.innerHTML = `<div style="padding:10px;">Loading…</div>`;

  const { data, error } = await sb
    .from('payout_batches')
    .select('id, run_date, status, created_at')
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) {
    console.error('Error loading payout batches', error);
    list.innerHTML = `<div style="padding:10px;">Error loading payout batches.</div>`;
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    list.innerHTML = `<div style="padding:10px;">No payout batches yet.</div>`;
    return;
  }

  list.innerHTML = rows.map(b => {
    const dt = b.run_date ? String(b.run_date) : '—';
    const st = b.status ? String(b.status).replace(/_/g, ' ') : '—';
    return `
      <div class="mini-row">
        <div><strong>${dt}</strong></div>
        <div>${st}</div>
      </div>
    `;
  }).join('');
}

async function loadPoliciesForChargeback(agentId) {
  const policySel = document.getElementById('adjustment-policy');
  if (!policySel) return;

  policySel.innerHTML = `<option value="">Search or select policy…</option>`;

  if (!agentId) {
    if (adjustmentPolicyChoices) adjustmentPolicyChoices.setChoices([], 'value', 'label', true);
    return;
  }

  const { data, error } = await sb
    .from('policies')
    .select('id, policy_number')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Error loading policies for chargeback select', error);
    return;
  }

  const rows = (data || []).map(p => ({ value: p.id, label: p.policy_number || p.id }));

  if (window.Choices) {
    if (adjustmentPolicyChoices) adjustmentPolicyChoices.destroy();
    adjustmentPolicyChoices = new Choices(policySel, {
      searchEnabled: true,
      itemSelectText: '',
      shouldSort: false,
      choices: rows
    });
  } else {
    rows.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      policySel.appendChild(opt);
    });
  }
}

async function loadLeadsForLeadDebt(agentId) {
  const leadSel = document.getElementById('adjustment-lead');
  if (!leadSel) return;

  leadSel.innerHTML = `<option value="">Search or select lead…</option>`;

  if (!agentId) {
    if (adjustmentLeadChoices) adjustmentLeadChoices.setChoices([], 'value', 'label', true);
    return;
  }

  const { data, error } = await sb
    .from('leads')
    .select('id, first_name, last_name, created_at')
    .eq('assigned_to', agentId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Error loading leads for lead debt select', error);
    return;
  }

  const rows = (data || []).map(l => ({
    value: l.id,
    label: `${(l.first_name || '')} ${(l.last_name || '')}`.trim() || l.id
  }));

  if (window.Choices) {
    if (adjustmentLeadChoices) adjustmentLeadChoices.destroy();
    adjustmentLeadChoices = new Choices(leadSel, {
      searchEnabled: true,
      itemSelectText: '',
      shouldSort: false,
      choices: rows
    });
  } else {
    rows.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      leadSel.appendChild(opt);
    });
  }
}

function syncAdjustmentCategoryUI() {
  const cat = document.getElementById('adjustment-category')?.value || '';
  const wrapPolicy = document.getElementById('chargeback-policy-wrapper');
  const wrapLead = document.getElementById('lead-debt-lead-wrapper');

  if (wrapPolicy) wrapPolicy.style.display = (cat === 'chargeback') ? 'block' : 'none';
  if (wrapLead) wrapLead.style.display = (cat === 'lead_debt') ? 'block' : 'none';
}

async function wireRunPayoutsButton() {
  const btn = document.getElementById('run-payouts-btn');
  const status = document.getElementById('run-payouts-status');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true;
      if (status) status.textContent = 'Running…';

      const { data: { session } = {} } = await sb.auth.getSession();
      const token = session?.access_token;

      const resp = await fetch('/.netlify/functions/runScheduledPayouts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({})
      });

      const text = await resp.text();
      if (!resp.ok) {
        console.error('runScheduledPayouts failed', text);
        if (status) status.textContent = 'Failed. Check logs.';
        return;
      }

      if (status) status.textContent = 'Done.';
      await loadPayoutBatches();
    } catch (e) {
      console.error('run payouts error', e);
      if (status) status.textContent = 'Failed. Check logs.';
    } finally {
      btn.disabled = false;
      setTimeout(() => { if (status) status.textContent = ''; }, 5000);
    }
  });
}

/* ---------- Wire UI ---------- */

openPolicyBtn?.addEventListener('click', async () => {
  await loadAgentsForCommissions();
  await loadContactsForPolicy();
  await loadCarriersForPolicy();
  openModal(policyModal);
});

openAdjustmentBtn?.addEventListener('click', async () => {
  await loadAgentsForCommissions();
  syncAdjustmentCategoryUI();
  openModal(adjustmentModal);
});

policyCancelBtn?.addEventListener('click', () => closeModal(policyModal));
adjustmentCancelBtn?.addEventListener('click', () => closeModal(adjustmentModal));

document.getElementById('policy-carrier')?.addEventListener('change', async (e) => {
  const carrierId = e.target.value || '';
  await loadCarrierDependentPolicySelects(carrierId);
});

document.getElementById('policy-contact')?.addEventListener('change', (e) => {
  const wrap = document.getElementById('policy-new-contact-wrap');
  if (!wrap) return;
  wrap.style.display = (e.target.value === '__new__') ? 'block' : 'none';
});

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

document.getElementById('policy-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const errEl = document.getElementById('policy-error');
  if (errEl) errEl.textContent = '';

  try {
    const agentId = document.getElementById('policy-agent')?.value || '';
    const contactIdSel = document.getElementById('policy-contact')?.value || '';
    const carrierId = document.getElementById('policy-carrier')?.value || '';
    const productLine = document.getElementById('policy-product-line')?.value || '';
    const policyType = document.getElementById('policy-policy-type')?.value || '';

    const policyNumber = document.getElementById('policy-number')?.value?.trim() || '';
    const annualPremium = Number(document.getElementById('policy-annual-premium')?.value || 0);
    const issueDate = document.getElementById('policy-issue-date')?.value || null;
    const status = document.getElementById('policy-status')?.value || 'in_force';

    if (!agentId || !carrierId || !productLine || !policyType || !policyNumber || !issueDate) {
      if (errEl) errEl.textContent = 'Please complete all required fields.';
      return;
    }

    let contactId = contactIdSel;

    if (contactIdSel === '__new__') {
      const first = document.getElementById('policy-contact-first')?.value?.trim() || '';
      const last = document.getElementById('policy-contact-last')?.value?.trim() || '';

      const phone1 = document.getElementById('policy-contact-phone')?.value?.trim() || '';
      const phone2 = document.getElementById('policy-contact-phone2')?.value?.trim() || '';
      const email1 = document.getElementById('policy-contact-email')?.value?.trim() || '';
      const email2 = document.getElementById('policy-contact-email2')?.value?.trim() || '';

      const addr1 = document.getElementById('policy-contact-address1')?.value?.trim() || '';
      const addr2 = document.getElementById('policy-contact-address2')?.value?.trim() || '';
      const city = document.getElementById('policy-contact-city')?.value?.trim() || '';
      const state = document.getElementById('policy-contact-state')?.value?.trim() || '';
      const zip = document.getElementById('policy-contact-zip')?.value?.trim() || '';

      if (!first || !last) {
        if (errEl) errEl.textContent = 'New contact requires first + last name.';
        return;
      }

      const { data: newContact, error: cErr } = await sb
        .from('contacts')
        .insert([{
          first_name: first,
          last_name: last,
          phone: [phone1, phone2].filter(Boolean),
          email: [email1, email2].filter(Boolean),
          address1: addr1,
          address2: addr2,
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

      contactId = newContact?.id;
    }

    if (!contactId) {
      if (errEl) errEl.textContent = 'Please select or create a contact.';
      return;
    }

    const { error: pErr } = await sb
      .from('policies')
      .insert([{
        agent_id: agentId,
        contact_id: contactId,
        carrier_id: carrierId,
        product_line: productLine,
        policy_type: policyType,
        policy_number: policyNumber,
        annual_premium: annualPremium,
        issue_date: issueDate,
        status,
        created_by: userId
      }]);

    if (pErr) {
      console.error('Create policy error', pErr);
      if (errEl) errEl.textContent = 'Could not save policy.';
      return;
    }

    closeModal(policyModal);
    document.getElementById('policy-form')?.reset();
    const wrap = document.getElementById('policy-new-contact-wrap');
    if (wrap) wrap.style.display = 'none';

    await loadPoliciesIntoList();
  } catch (ex) {
    console.error('policy submit error', ex);
    if (errEl) errEl.textContent = 'Could not save policy.';
  }
});

document.getElementById('adjustment-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const errEl = document.getElementById('adjustment-error');
  if (errEl) errEl.textContent = '';

  try {
    const agentId = document.getElementById('adjustment-agent')?.value || '';
    const type = document.getElementById('adjustment-type')?.value || '';
    const category = document.getElementById('adjustment-category')?.value || '';
    const amount = Number(document.getElementById('adjustment-amount')?.value || 0);
    const effectiveDate = document.getElementById('adjustment-date')?.value || null;
    const description = document.getElementById('adjustment-description')?.value?.trim() || '';

    const policyId = (category === 'chargeback') ? (document.getElementById('adjustment-policy')?.value || null) : null;
    const leadId   = (category === 'lead_debt')  ? (document.getElementById('adjustment-lead')?.value || null) : null;

    if (!agentId || !type || !category || !effectiveDate || !(amount > 0)) {
      if (errEl) errEl.textContent = 'Please complete all required fields.';
      return;
    }

    if (category === 'chargeback' && !policyId) {
      if (errEl) errEl.textContent = 'Select a policy for chargeback.';
      return;
    }

    if (category === 'lead_debt' && !leadId) {
      if (errEl) errEl.textContent = 'Select a lead for lead debt.';
      return;
    }

    const { error } = await sb
      .from('agent_adjustments')
      .insert([{
        agent_id: agentId,
        type,
        category,
        amount,
        effective_date: effectiveDate,
        description,
        policy_id: policyId,
        lead_id: leadId,
        created_by: userId
      }]);

    if (error) {
      console.error('Create adjustment error', error);
      if (errEl) errEl.textContent = 'Could not save debit/credit.';
      return;
    }

    closeModal(adjustmentModal);
    document.getElementById('adjustment-form')?.reset();
    syncAdjustmentCategoryUI();

    await loadDebitCreditIntoList();
  } catch (ex) {
    console.error('adjustment submit error', ex);
    if (errEl) errEl.textContent = 'Could not save debit/credit.';
  }
});

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb) {
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  const { data: { session } = {} } = await sb.auth.getSession();
  userId = session?.user?.id || null;

  await wireRunPayoutsButton();

  // preload lists
  await loadPoliciesIntoList();
  await loadDebitCreditIntoList();
  await loadPayoutBatches();
});
