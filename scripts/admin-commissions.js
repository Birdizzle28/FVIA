// scripts/admin-commissions.js
const sb = window.supabaseClient || window.supabase;

let userId = null;

// Choices instances (optional)
let policyAgentChoices = null;
let adjustmentAgentChoices = null;
let policyContactChoices = null;
let policyCarrierChoices = null;
let adjustmentPolicyChoices = null;
let adjustmentLeadChoices = null;

// Carrier products cache: { carrierId: { lines:Set, typesByLine: Map(line->Set(types)) } }
let carrierProductCache = {};

/* ---------- Helpers ---------- */

function openModal(el) { if (el) el.style.display = 'flex'; }
function closeModal(el) { if (el) el.style.display = 'none'; }

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ---------- Loaders: Agents / Contacts / Carriers / Carrier Products ---------- */

async function loadAgentsForCommissions() {
  const policyAgentSel = document.getElementById('policy-agent');
  const adjustmentAgentSel = document.getElementById('adjustment-agent');
  if (!policyAgentSel && !adjustmentAgentSel) return;

  const { data, error } = await sb
    .from('agents')
    .select('id, full_name')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('loadAgentsForCommissions error', error);
    return;
  }

  const agents = data || [];

  // Fill both selects
  [policyAgentSel, adjustmentAgentSel].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = `<option value="">Select agent…</option>`;
    agents.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.full_name || a.id;
      sel.appendChild(opt);
    });
  });

  // Enhance with Choices (optional)
  if (window.Choices) {
    try {
      if (policyAgentSel) {
        if (policyAgentChoices) policyAgentChoices.destroy();
        policyAgentChoices = new Choices(policyAgentSel, {
          searchEnabled: true,
          itemSelectText: '',
          shouldSort: false
        });
      }
    } catch (_) {}

    try {
      if (adjustmentAgentSel) {
        if (adjustmentAgentChoices) adjustmentAgentChoices.destroy();
        adjustmentAgentChoices = new Choices(adjustmentAgentSel, {
          searchEnabled: true,
          itemSelectText: '',
          shouldSort: false
        });
      }
    } catch (_) {}
  }
}

async function loadContactsForPolicy(agentId = null) {
  const sel = document.getElementById('policy-contact');
  if (!sel) return;

  // Reset
  sel.innerHTML = `
    <option value="">Select contact…</option>
    <option value="__new__">➕ New contact (enter below)</option>
  `;

  // If no agent selected, we still allow manual new contact, but we won’t load the list
  if (!agentId) {
    if (window.Choices) {
      try {
        if (policyContactChoices) policyContactChoices.destroy();
        policyContactChoices = new Choices(sel, {
          searchEnabled: true,
          itemSelectText: '',
          shouldSort: false
        });
      } catch (_) {}
    }
    return;
  }

  // Matches admin.js: contacts filtered by owning_agent_id
  const { data, error } = await sb
    .from('contacts')
    .select('id, first_name, last_name, phones, emails')
    .eq('owning_agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error('loadContactsForPolicy error', error);
    return;
  }

  (data || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unnamed';
    const phone = Array.isArray(c.phones) && c.phones[0] ? c.phones[0] : '';
    const email = Array.isArray(c.emails) && c.emails[0] ? c.emails[0] : '';
    opt.textContent = `${name}${phone ? ` • ${phone}` : ''}${email ? ` • ${email}` : ''}`;
    sel.appendChild(opt);
  });

  if (window.Choices) {
    try {
      if (policyContactChoices) policyContactChoices.destroy();
      policyContactChoices = new Choices(sel, {
        searchEnabled: true,
        itemSelectText: '',
        shouldSort: false
      });
    } catch (_) {}
  }
}

async function loadCarriersForPolicy() {
  const carrierSel = document.getElementById('policy-carrier');
  if (!carrierSel) return;

  const { data, error } = await sb
    .from('carriers')
    .select('id, carrier_name')
    .order('carrier_name', { ascending: true });

  if (error) {
    console.error('loadCarriersForPolicy error', error);
    return;
  }

  carrierSel.innerHTML = `<option value="">Select carrier…</option>`;
  (data || []).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.carrier_name || c.id;
    carrierSel.appendChild(opt);
  });

  if (window.Choices) {
    try {
      if (policyCarrierChoices) policyCarrierChoices.destroy();
      policyCarrierChoices = new Choices(carrierSel, {
        searchEnabled: true,
        itemSelectText: '',
        shouldSort: true
      });
    } catch (_) {}
  }
}

async function loadProductLinesAndTypesForCarrier(carrierId) {
  const lineSel = document.getElementById('policy-product-line');
  const typeSel = document.getElementById('policy-policy-type');
  if (!lineSel || !typeSel) return;

  // reset
  lineSel.disabled = true;
  typeSel.disabled = true;
  lineSel.innerHTML = `<option value="">Select carrier first…</option>`;
  typeSel.innerHTML = `<option value="">Select product line first…</option>`;
  carrierProductCache = carrierProductCache || {};

  if (!carrierId) return;

  const { data, error } = await sb
    .from('commission_schedules')
    .select('product_line, policy_type')
    .eq('carrier_id', carrierId);

  if (error) {
    console.error('loadProductLinesAndTypesForCarrier error', error);
    return;
  }

  const lines = new Set();
  const typesByLine = new Map();

  (data || []).forEach(r => {
    const line = r.product_line || null;
    const type = r.policy_type || null;
    if (!line) return;

    lines.add(line);
    if (!typesByLine.has(line)) typesByLine.set(line, new Set());
    if (type) typesByLine.get(line).add(type);
  });

  carrierProductCache[carrierId] = { lines, typesByLine };

  // populate product lines
  const lineArr = Array.from(lines).sort();
  lineSel.innerHTML = `<option value="">Select product line…</option>` + lineArr
    .map(v => `<option value="${v}">${v}</option>`)
    .join('');

  lineSel.disabled = false;
  typeSel.disabled = false;

  // clear policy types until a line is chosen
  typeSel.innerHTML = `<option value="">Select product line first…</option>`;
}

function hydratePolicyTypesForSelectedLine() {
  const carrierId = document.getElementById('policy-carrier')?.value || '';
  const lineSel = document.getElementById('policy-product-line');
  const typeSel = document.getElementById('policy-policy-type');
  if (!lineSel || !typeSel) return;

  const line = lineSel.value || '';
  if (!carrierId || !line) {
    typeSel.innerHTML = `<option value="">Select product line first…</option>`;
    return;
  }

  const cache = carrierProductCache?.[carrierId];
  const set = cache?.typesByLine?.get(line);
  const types = set ? Array.from(set).sort() : [];

  typeSel.innerHTML = `<option value="">Select policy type…</option>` + types
    .map(v => `<option value="${v}">${v}</option>`)
    .join('');
}

/* ---------- Lists: Policies / Ledger (Debits & Credits) / Batches ---------- */

async function loadPoliciesIntoList() {
  const list = document.getElementById('policy-list');
  if (!list) return;

  list.innerHTML = `<div style="padding:10px;">Loading…</div>`;

  const { data, error } = await sb
    .from('policies')
    .select('id, policy_number, carrier_name, policy_type, product_line, premium_annual, issued_at, status, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('loadPoliciesIntoList error', error);
    list.innerHTML = `<div style="padding:10px;">Error loading policies.</div>`;
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    list.innerHTML = `<div style="padding:10px;">No policies yet.</div>`;
    return;
  }

  list.innerHTML = rows.map(p => {
    const prem = safeNum(p.premium_annual).toFixed(2);
    const dt = p.issued_at ? String(p.issued_at) : '—';
    const st = p.status ? String(p.status).replace(/_/g, ' ') : '—';
    const carrier = p.carrier_name || '—';
    const line = p.product_line || '—';
    const type = p.policy_type || '—';

    return `
      <div class="mini-row">
        <div><strong>${p.policy_number || '—'}</strong></div>
        <div>${carrier} • ${line} • ${type}</div>
        <div>$${prem} • ${st} • Issue: ${dt}</div>
      </div>
    `;
  }).join('');
}

async function loadAdjustmentsIntoList() {
  const container = document.getElementById('debit-credit-list');
  if (!container) return;
  container.textContent = 'Loading...';

  const { data, error } = await sb
    .from('commission_ledger')
    .select('id, agent_id, amount, category, period_start')
    .order('period_start', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error loading debits/credits', error);
    container.textContent = 'Error loading debits / credits.';
    return;
  }

  if (!data || data.length === 0) {
    container.textContent = 'No debits or credits yet.';
    return;
  }

  container.innerHTML = '';
  data.forEach(row => {
    const div = document.createElement('div');
    div.className = 'mini-row';

    const amtNumber = Number(row.amount || 0);

    // Determine sign just from the stored amount
    const sign = amtNumber >= 0 ? '+' : '-';
    const amt = Math.abs(amtNumber).toFixed(2);
    const cat = row.category || '';
    const date = row.period_start
      ? new Date(row.period_start).toLocaleDateString()
      : '';

    div.textContent = `${sign}$${amt} — ${cat} (${date})`;
    container.appendChild(div);
  });
}

async function loadPayoutBatchesIntoList() {
  const list = document.getElementById("batch-list");
  if (!supabase || !list) return;

  const money = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  };

  const fmtDate = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString();
  };

  const setBusy = (el, busy, labelBusy) => {
    if (!el) return;
    el.disabled = !!busy;
    el.dataset._oldText ??= el.textContent;
    if (busy) el.textContent = labelBusy || "Working…";
    else el.textContent = el.dataset._oldText;
  };

  list.innerHTML = `<div style="opacity:.8;font-size:13px;">Loading payout batches…</div>`;

  // Load batches
  const { data: batches, error } = await supabase
    .from("payout_batches")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    list.innerHTML = `<div style="color:#b00020;font-size:13px;">Failed to load batches: ${error.message}</div>`;
    return;
  }

  if (!batches || batches.length === 0) {
    list.innerHTML = `<div style="opacity:.8;font-size:13px;">No payout batches yet.</div>`;
    return;
  }

  list.innerHTML = "";

  for (const b of batches) {
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
        <div><span style="opacity:.75;">Created:</span> ${fmtDate(b.created_at)}</div>
        ${b.run_at ? `<div><span style="opacity:.75;">Run At:</span> ${fmtDate(b.run_at)}</div>` : ``}
        ${b.status ? `<div><span style="opacity:.75;">Status:</span> ${String(b.status)}</div>` : ``}
      </div>
      <div class="edit-wrap" style="margin-top:8px; display:none; gap:8px; align-items:center; flex-wrap:wrap;">
        <input class="edit-total-net" type="number" step="0.01" min="0"
          value="${Number.isFinite(Number(b.total_net)) ? Number(b.total_net) : ""}"
          style="width:140px; padding:6px 8px; border:1px solid #ddd; border-radius:8px; font-size:13px;">
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

    const btnPay = document.createElement("button");
    btnPay.type = "button";
    btnPay.textContent = "Pay";
    btnPay.style.padding = "6px 12px";
    btnPay.style.borderRadius = "8px";

    right.appendChild(btnPay);
    right.appendChild(btnEdit);
    right.appendChild(btnDelete);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);

    // Elements for editing
    const editWrap = left.querySelector(".edit-wrap");
    const editInput = left.querySelector(".edit-total-net");
    const saveBtn = left.querySelector(".save-edit");
    const cancelBtn = left.querySelector(".cancel-edit");
    const editMsg = left.querySelector(".edit-msg");
    const totalNetText = left.querySelector(".total-net-text");

    // EDIT toggle
    btnEdit.addEventListener("click", () => {
      const open = editWrap.style.display !== "none";
      editWrap.style.display = open ? "none" : "flex";
      editMsg.textContent = "";
      if (!open) {
        // reset to current value
        const current = Number(b.total_net);
        editInput.value = Number.isFinite(current) ? String(current) : "";
        editInput.focus();
      }
    });

    cancelBtn.addEventListener("click", () => {
      editWrap.style.display = "none";
      editMsg.textContent = "";
    });

    // SAVE edit total_net
    saveBtn.addEventListener("click", async () => {
      const nextVal = Number(editInput.value);
      if (!Number.isFinite(nextVal) || nextVal < 0) {
        editMsg.style.color = "#b00020";
        editMsg.textContent = "Enter a valid total_net (0 or higher).";
        return;
      }

      setBusy(saveBtn, true, "Saving…");
      setBusy(btnEdit, true);
      setBusy(btnDelete, true);
      setBusy(btnPay, true);

      const { error: upErr } = await supabase
        .from("payout_batches")
        .update({ total_net: nextVal })
        .eq("id", b.id);

      setBusy(saveBtn, false);
      setBusy(btnEdit, false);
      setBusy(btnDelete, false);
      setBusy(btnPay, false);

      if (upErr) {
        editMsg.style.color = "#b00020";
        editMsg.textContent = `Save failed: ${upErr.message}`;
        return;
      }

      // update local + UI
      b.total_net = nextVal;
      totalNetText.textContent = money(nextVal);
      editMsg.style.color = "#0a7a0a";
      editMsg.textContent = "Saved.";
      setTimeout(() => {
        editWrap.style.display = "none";
        editMsg.textContent = "";
      }, 600);
    });

    // DELETE batch row
    btnDelete.addEventListener("click", async () => {
      const ok = confirm("Delete this payout batch? This cannot be undone.");
      if (!ok) return;

      setBusy(btnDelete, true, "Deleting…");
      setBusy(btnEdit, true);
      setBusy(btnPay, true);

      const { error: delErr } = await supabase
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
        list.innerHTML = `<div style="opacity:.8;font-size:13px;">No payout batches yet.</div>`;
      }
    });

    // PAY (run Netlify function)
    btnPay.addEventListener("click", async () => {
      const ok = confirm("Run this payout batch now?");
      if (!ok) return;

      setBusy(btnPay, true, "Paying…");
      setBusy(btnEdit, true);
      setBusy(btnDelete, true);

      try {
        const { data: { session } = {} } = await supabase.auth.getSession();
        const token = session?.access_token;

        const res = await fetch("/.netlify/functions/sendPayoutBatch", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            batch_id: b.id,
            // optional extras in case your function wants them:
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
          const msg = payload?.message || "Batch sent successfully.";
          alert(msg);
          // Refresh list so status/paid_at changes show up if your function updates the row
          await loadPayoutBatchesIntoList();
          return;
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

/* ---------- Adjustment helpers (policy/lead selects) ---------- */

function syncAdjustmentCategoryUI() {
  const cat = document.getElementById('adjustment-category')?.value || '';
  const wrapPolicy = document.getElementById('chargeback-policy-wrapper');
  const wrapLead = document.getElementById('lead-debt-lead-wrapper');

  if (wrapPolicy) wrapPolicy.style.display = (cat === 'chargeback') ? 'block' : 'none';
  if (wrapLead) wrapLead.style.display = (cat === 'lead_debt') ? 'block' : 'none';
}

async function loadPoliciesForChargeback(agentId) {
  const policySel = document.getElementById('adjustment-policy');
  if (!policySel) return;

  policySel.innerHTML = `<option value="">Search or select policy…</option>`;

  if (!agentId) {
    if (adjustmentPolicyChoices) {
      try { adjustmentPolicyChoices.setChoices([], 'value', 'label', true); } catch (_) {}
    }
    return;
  }

  const { data, error } = await sb
    .from('policies')
    .select('id, policy_number')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('loadPoliciesForChargeback error', error);
    return;
  }

  const rows = (data || []).map(p => ({
    value: p.id,
    label: p.policy_number || p.id
  }));

  if (window.Choices) {
    try {
      if (adjustmentPolicyChoices) adjustmentPolicyChoices.destroy();
      adjustmentPolicyChoices = new Choices(policySel, {
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
      policySel.appendChild(opt);
    });
  }
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

/* ---------- Run payouts button (matches admin.js) ---------- */

async function wireRunPayoutsButton() {
  const btn = document.getElementById('run-payouts-btn');
  const status = document.getElementById('run-payouts-status');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true;
      if (status) status.textContent = 'Running…';

      // Matches admin.js behavior: run weekly advance, then monthly pay-thru
      await fetch('/.netlify/functions/runWeeklyAdvance', { method: 'POST' });
      await fetch('/.netlify/functions/runMonthlyPayThru', { method: 'POST' });

      if (status) status.textContent = 'Done.';
      await loadPayoutBatchesIntoList();
    } catch (e) {
      console.error('wireRunPayoutsButton error', e);
      if (status) status.textContent = 'Failed. Check logs.';
    } finally {
      btn.disabled = false;
      setTimeout(() => { if (status) status.textContent = ''; }, 5000);
    }
  });
}

/* ---------- Wire modal open/close ---------- */

function wireModalButtons() {
  const policyModal = document.getElementById('policy-modal');
  const adjustmentModal = document.getElementById('adjustment-modal');

  const openPolicyBtn = document.getElementById('open-policy-modal');
  const openAdjustmentBtn = document.getElementById('open-debit-credit-modal');
  const policyCancelBtn = document.getElementById('policy-cancel');
  const adjustmentCancelBtn = document.getElementById('adjustment-cancel');

  openPolicyBtn?.addEventListener('click', async () => {
    await loadAgentsForCommissions();
    await loadCarriersForPolicy();

    // contacts are agent-scoped; if an agent is already selected, load their contacts
    const agentId = document.getElementById('policy-agent')?.value || null;
    await loadContactsForPolicy(agentId);

    openModal(policyModal);
  });

  openAdjustmentBtn?.addEventListener('click', async () => {
    await loadAgentsForCommissions();
    syncAdjustmentCategoryUI();
    openModal(adjustmentModal);
  });

  policyCancelBtn?.addEventListener('click', () => closeModal(policyModal));
  adjustmentCancelBtn?.addEventListener('click', () => closeModal(adjustmentModal));
}

/* ---------- Forms: Policy + Adjustment ---------- */

function wirePolicyContactNewToggle() {
  const policyContactSel = document.getElementById('policy-contact');
  const newContactWrap = document.getElementById('policy-new-contact-wrap');
  if (!policyContactSel || !newContactWrap) return;

  policyContactSel.addEventListener('change', () => {
    newContactWrap.style.display = (policyContactSel.value === '__new__') ? 'block' : 'none';
  });
}

function wirePolicyDependencies() {
  // agent changes -> reload contacts for that agent
  document.getElementById('policy-agent')?.addEventListener('change', (e) => {
    const agentId = e.target.value || null;
    loadContactsForPolicy(agentId);
  });

  // carrier changes -> load product lines / types
  document.getElementById('policy-carrier')?.addEventListener('change', (e) => {
    const carrierId = e.target.value || null;
    loadProductLinesAndTypesForCarrier(carrierId);
  });

  // product line changes -> hydrate types
  document.getElementById('policy-product-line')?.addEventListener('change', () => {
    hydratePolicyTypesForSelectedLine();
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

function wirePolicySubmit() {
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
      const annualPremium = safeNum(document.getElementById('policy-annual-premium')?.value);
      const issueDate = document.getElementById('policy-issue-date')?.value || null;
      const status = document.getElementById('policy-status')?.value || 'in_force';

      if (!agentId || !carrierId || !productLine || !policyType || !policyNumber || !issueDate) {
        if (errEl) errEl.textContent = 'Please complete all required fields.';
        return;
      }

      let contactId = contactIdSel;

      // Create new contact if requested (matches admin.js structure: phones/emails arrays, owning_agent_id)
      if (contactIdSel === '__new__') {
        const first = document.getElementById('policy-contact-first')?.value?.trim() || '';
        const last  = document.getElementById('policy-contact-last')?.value?.trim() || '';

        const phone1 = document.getElementById('policy-contact-phone')?.value?.trim() || '';
        const phone2 = document.getElementById('policy-contact-phone2')?.value?.trim() || '';
        const email1 = document.getElementById('policy-contact-email')?.value?.trim() || '';
        const email2 = document.getElementById('policy-contact-email2')?.value?.trim() || '';

        const addr1 = document.getElementById('policy-contact-address1')?.value?.trim() || '';
        const addr2 = document.getElementById('policy-contact-address2')?.value?.trim() || '';
        const city  = document.getElementById('policy-contact-city')?.value?.trim() || '';
        const state = document.getElementById('policy-contact-state')?.value?.trim() || '';
        const zip   = document.getElementById('policy-contact-zip')?.value?.trim() || '';

        if (!first || !last) {
          if (errEl) errEl.textContent = 'New contact requires first + last name.';
          return;
        }

        const { data: newContact, error: cErr } = await sb
          .from('contacts')
          .insert([{
            owning_agent_id: agentId,
            first_name: first,
            last_name: last,
            phones: [phone1, phone2].filter(Boolean),
            emails: [email1, email2].filter(Boolean),
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

        contactId = newContact?.id || null;
      }

      if (!contactId) {
        if (errEl) errEl.textContent = 'Please select or create a contact.';
        return;
      }

      // Get carrier name (admin.js stores carrier_name on policy for easy display)
      let carrier_name = null;
      try {
        const { data: carrierRow } = await sb
          .from('carriers')
          .select('carrier_name')
          .eq('id', carrierId)
          .maybeSingle();
        carrier_name = carrierRow?.carrier_name || null;
      } catch (_) {}

      const { error: pErr } = await sb
        .from('policies')
        .insert([{
          agent_id: agentId,
          contact_id: contactId,
          carrier_id: carrierId,
          carrier_name,
          product_line: productLine,
          policy_type: policyType,
          policy_number: policyNumber,
          premium_annual: annualPremium,
          issued_at: issueDate,
          status,
          created_by: userId
        }]);

      if (pErr) {
        console.error('Create policy error', pErr);
        if (errEl) errEl.textContent = 'Could not save policy.';
        return;
      }

      closeModal(document.getElementById('policy-modal'));
      document.getElementById('policy-form')?.reset();
      const wrap = document.getElementById('policy-new-contact-wrap');
      if (wrap) wrap.style.display = 'none';

      await loadPoliciesIntoList();
    } catch (ex) {
      console.error('policy submit error', ex);
      const errEl = document.getElementById('policy-error');
      if (errEl) errEl.textContent = 'Could not save policy.';
    }
  });
}

function wireAdjustmentSubmit() {
  document.getElementById('adjustment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errEl = document.getElementById('adjustment-error');
    if (errEl) errEl.textContent = '';

    try {
      const agentId = document.getElementById('adjustment-agent')?.value || '';
      const type = document.getElementById('adjustment-type')?.value || '';
      const category = document.getElementById('adjustment-category')?.value || '';
      const amount = safeNum(document.getElementById('adjustment-amount')?.value);
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

      // Admin.js commissions uses commission_ledger
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
        console.error('Create ledger entry error', error);
        if (errEl) errEl.textContent = 'Could not save debit/credit.';
        return;
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

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb) {
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  // commissions-only pages usually already gate admin in HTML,
  // but we keep the session read for created_by/userId consistency
  const { data: { session } = {} } = await sb.auth.getSession();
  userId = session?.user?.id || null;

  // Basic wiring
  await wireRunPayoutsButton();
  wireModalButtons();
  wirePolicyContactNewToggle();
  wirePolicyDependencies();
  wireAdjustmentDependencies();
  wirePolicySubmit();
  wireAdjustmentSubmit();

  // Preload dropdowns + lists (matches commissions behavior)
  await loadAgentsForCommissions();
  await loadCarriersForPolicy();

  // If agent already selected, load their contacts
  const agentId = document.getElementById('policy-agent')?.value || null;
  await loadContactsForPolicy(agentId);

  // Preload lists
  await loadPoliciesIntoList();
  await loadAdjustmentsIntoList();
  await loadPayoutBatchesIntoList();
});
