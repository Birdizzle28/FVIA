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
let commissionAgentsLoaded = false;

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
    data.forEach(agent => {
      const opt = document.createElement('option');
      opt.value = agent.id;
      opt.textContent = agent.full_name || agent.id;
      sel.appendChild(opt);
    });
  });

  commissionAgentsLoaded = true;
}

async function loadContactsForPolicy(agentId = null) {
  const sel = document.getElementById('policy-contact');
  if (!sel) return;

  sel.disabled = true;
  sel.innerHTML = '<option value="">Loading contacts…</option>';

  // Base query
  let query = sb
    .from('contacts')
    .select(
      'id, first_name, last_name, phones, emails, email, city, state, zip, address_line1, owning_agent_id'
    )
    .order('created_at', { ascending: false })
    .limit(200);

  // ✅ filter by owning_agent_id (NOT agent_id)
  if (agentId) {
    query = query.eq('owning_agent_id', agentId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error loading contacts for policy:', error);
    sel.innerHTML = '<option value="">Error loading contacts</option>';
    return;
  }

  // Rebuild options
  sel.innerHTML = '';

  // Placeholder
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select contact…';
  sel.appendChild(placeholder);

  // Existing contacts
  if (data && data.length) {
    data.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;

      const name = [c.first_name, c.last_name].filter(Boolean).join(' ');
      const cityState = [c.city, c.state].filter(Boolean).join(', ');
      const addr = c.address_line1 || '';
      const phone =
        Array.isArray(c.phones) && c.phones.length ? c.phones[0] : '';
      const email =
        c.email ||
        (Array.isArray(c.emails) && c.emails.length ? c.emails[0] : '');

      const parts = [
        name || `Contact ${String(c.id).slice(0, 8)}`,
        addr,
        cityState,
        phone,
        email
      ].filter(Boolean);

      opt.textContent = parts.join(' · ');
      sel.appendChild(opt);
    });
  }

  // Always add the "New contact" option at the bottom
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '➕ New contact (enter below)';
  sel.appendChild(newOpt);

  sel.disabled = false;
}

async function loadCarriersForPolicy() {
  const sel = document.getElementById('policy-carrier');
  if (!sel) return;

  sel.disabled = true;
  sel.innerHTML = '<option value="">Loading carriers…</option>';

  let carriers = [];

  try {
    const { data, error } = await sb
      .from('carriers')
      .select('id, carrier_name')
      .order('carrier_name', { ascending: true });

    console.log('Carrier data result:', data, error);

    if (error) {
      console.error('Error loading carriers:', error);
    } else {
      carriers = data || [];
    }
  } catch (err) {
    console.error('Carrier Supabase lookup failed:', err);
  }

  if (!carriers.length) {
    sel.innerHTML = '<option value="">No carriers found</option>';
    sel.disabled = true;
    return;
  }

  // Populate
  sel.innerHTML = '';
  carriers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.carrier_name;
    sel.appendChild(opt);
  });

  sel.disabled = false;
}

async function loadProductLinesAndTypesForCarrier(carrierId) {
  const lineSel = document.getElementById('policy-product-line');
  const typeSel = document.getElementById('policy-policy-type');
  if (!lineSel || !typeSel) return;

  // Reset helpers
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

  // Loading state
  destroyChoices();
  lineSel.disabled = true;
  typeSel.disabled = true;
  lineSel.innerHTML = '<option value="">Loading…</option>';
  typeSel.innerHTML = '<option value="">Loading…</option>';

  // Pull schedules for this carrier
  let rows = [];
  const { data, error } = await sb
    .from('commission_schedules')
    .select('product_line, policy_type')
    .eq('carrier_id', carrierId);

  if (error) {
    console.error('Error loading commission_schedules for carrier:', error);
    resetAll('Error loading schedules…');
    return;
  }

  rows = data || [];
  if (!rows.length) {
    resetAll('No schedules configured…');
    return;
  }

  // Build product_line => policy_types map
  const typesByLine = new Map();
  for (const r of rows) {
    const line = (r.product_line || '').trim();
    const type = (r.policy_type || '').trim();
    if (!line) continue;

    if (!typesByLine.has(line)) typesByLine.set(line, new Set());
    if (type) typesByLine.get(line).add(type);
  }

  const productLines = Array.from(typesByLine.keys()).sort((a, b) => a.localeCompare(b));
  _carrierScheduleMap = {
    lines: productLines,
    typesByLine
  };

  // Populate Product Lines
  lineSel.innerHTML = '';
  const linePH = document.createElement('option');
  linePH.value = '';
  linePH.textContent = 'Select product line…';
  lineSel.appendChild(linePH);

  productLines.forEach(line => {
    const opt = document.createElement('option');
    opt.value = line;
    opt.textContent = line;
    lineSel.appendChild(opt);
  });

  lineSel.disabled = false;

  // Policy type starts disabled until product line chosen
  typeSel.innerHTML = '<option value="">Select product line first…</option>';
  typeSel.disabled = true;

  // Enhance Product Line dropdown
  try {
    policyProductLineChoices = new Choices(lineSel, {
      searchEnabled: true,
      shouldSort: false,
      itemSelectText: ''
    });
  } catch (e) {
    console.warn('Choices init failed for product line:', e);
  }

  // NOTE: policy types will be hydrated by a separate handler when line changes
}

function hydratePolicyTypesForSelectedLine() {
  const lineSel = document.getElementById('policy-product-line');
  const typeSel = document.getElementById('policy-policy-type');
  if (!lineSel || !typeSel) return;

  // Destroy old Choices for policy type
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
  } catch (e) {
    console.warn('Choices init failed for policy type:', e);
  }
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
  if (!sb || !list) return;

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
  const { data: batches, error } = await sb
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

      const { error: upErr } = await sb
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

  // --- same helpers as admin.js ---
  const toIsoDate = (d) => d.toISOString().slice(0, 10);

  // Friday of current week
  function getWeeklyScheduledDate(today) {
    const d = new Date(today);
    const day = d.getDay();            // 0 Sun ... 5 Fri
    const diffToFriday = (5 - day + 7) % 7;
    d.setDate(d.getDate() + diffToFriday);
    return d;
  }

  // 5th of current month
  function getMonthlyScheduledDate(today) {
    return new Date(today.getFullYear(), today.getMonth(), 5);
  }

  btn.addEventListener('click', async () => {
    const today = new Date();
    const weeklyDate  = getWeeklyScheduledDate(today);
    const monthlyDate = getMonthlyScheduledDate(today);

    const weeklyPayDate  = toIsoDate(weeklyDate);
    const monthlyPayDate = toIsoDate(monthlyDate);

    btn.disabled = true;
    if (status) status.textContent = 'Running payouts...';

    let statusText = '';
    const tasks = [];

    try {
      // Weekly advance
      tasks.push(
        fetch(`/.netlify/functions/runWeeklyAdvance?pay_date=${weeklyPayDate}`, { method: 'POST' })
          .then(res => res.json())
          .then(data => {
            statusText += `Weekly advance run for ${weeklyPayDate}: ${data.message || 'OK'}\n`;
            return { type: 'weekly', data };
          })
          .catch(err => {
            statusText += `Weekly advance error: ${err.message}\n`;
            return { type: 'weekly', error: err };
          })
      );

      // Monthly pay-thru
      tasks.push(
        fetch(`/.netlify/functions/runMonthlyPayThru?pay_date=${monthlyPayDate}`, { method: 'POST' })
          .then(res => res.json())
          .then(data => {
            statusText += `Monthly pay-thru run for ${monthlyPayDate}: ${data.message || 'OK'}\n`;
            return { type: 'monthly', data };
          })
          .catch(err => {
            statusText += `Monthly pay-thru error: ${err.message}\n`;
            return { type: 'monthly', error: err };
          })
      );

      await Promise.all(tasks);

      if (status) status.textContent = statusText.trim() || 'Done.';
      
      // keep your improvement: refresh batches after running
      await loadPayoutBatchesIntoList();

    } catch (err) {
      console.error('Error running payouts:', err);
      if (status) status.textContent = `Unexpected error: ${err.message}`;
    } finally {
      btn.disabled = false;
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
      const policy_agent_id = document.getElementById('policy-agent')?.value || null;
      const contact_id_sel  = document.getElementById('policy-contact')?.value || null;
  
      const carrierSel = document.getElementById('policy-carrier');
      const carrier_name = carrierSel?.options?.[carrierSel.selectedIndex]?.text || null;
  
      const product_line  = document.getElementById('policy-product-line')?.value || null;
      const policy_type   = document.getElementById('policy-policy-type')?.value || null;
      const policy_number = document.getElementById('policy-number')?.value?.trim() || null;
  
      const premium_annual = Number(document.getElementById('policy-annual-premium')?.value || 0);
  
      const issue_date_raw = document.getElementById('policy-issue-date')?.value || null;
      const issue_date = issue_date_raw ? new Date(issue_date_raw).toISOString() : null;
  
      const status = document.getElementById('policy-status')?.value || 'pending';
  
      if (!policy_agent_id || !carrier_name || !product_line || !policy_type || !policy_number || !premium_annual || !issue_date) {
        if (errEl) errEl.textContent = 'Please complete all required fields.';
        return;
      }
  
      let contact_id = contact_id_sel;
  
      if (contact_id_sel === '__new__') {
        const first_name = document.getElementById('policy-contact-first')?.value?.trim() || '';
        const last_name  = document.getElementById('policy-contact-last')?.value?.trim() || '';
  
        const phone = document.getElementById('policy-contact-phone')?.value?.trim() || '';
        const email = document.getElementById('policy-contact-email')?.value?.trim() || '';
  
        const address_line1 = document.getElementById('policy-contact-address1')?.value?.trim() || '';
        const address_line2 = document.getElementById('policy-contact-address2')?.value?.trim() || '';
        const city  = document.getElementById('policy-contact-city')?.value?.trim() || '';
        const state = document.getElementById('policy-contact-state')?.value?.trim() || '';
        const zip   = document.getElementById('policy-contact-zip')?.value?.trim() || '';
  
        if (!first_name || !last_name) {
          if (errEl) errEl.textContent = 'New contact requires first + last name.';
          return;
        }
  
        const { data: newContact, error: cErr } = await sb
          .from('contacts')
          .insert([{
            owning_agent_id: policy_agent_id,
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
          policy_agent_id,
          contact_id,
          carrier_name,
          product_line,
          policy_type,
          policy_number,
          premium_annual,
          issue_date,
          status
        }])
        .select('id')
        .single();
  
      if (pErr) {
        console.error('Create policy error', pErr);
        if (errEl) errEl.textContent = 'Could not save policy.';
        return;
      }
  
      // IMPORTANT: admin.js does this right after creating the policy
      if (typeof window.runPolicyCommissionFlow === 'function') {
        await window.runPolicyCommissionFlow(newPolicy.id);
      } else if (typeof runPolicyCommissionFlow === 'function') {
        await runPolicyCommissionFlow(newPolicy.id);
      }
  
      alert('Policy created + commissions processed.');
  
      closeModal(document.getElementById('policy-modal'));
      document.getElementById('policy-form')?.reset();
  
      const wrap = document.getElementById('policy-new-contact-wrap');
      if (wrap) wrap.style.display = 'none';
  
      await loadPoliciesIntoList();
    } catch (ex) {
      console.error('policy submit error', ex);
      if (errEl) errEl.textContent = 'Could not save policy.';
    }
  });
}

function wireAdjustmentSubmit() {
  document.getElementById('adjustment-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const errorEl = document.getElementById('adjustment-error');
    if (errorEl) errorEl.textContent = '';

    try {
      const agent_id       = document.getElementById('adjustment-agent')?.value || null;
      const type           = document.getElementById('adjustment-type')?.value || '';      // Debit / Credit
      const category       = document.getElementById('adjustment-category')?.value || '';  // lead_debt / chargeback / other
      const rawAmount      = parseFloat(document.getElementById('adjustment-amount')?.value || '0');
      const effective_date = document.getElementById('adjustment-date')?.value || '';      // YYYY-MM-DD
      const description    = document.getElementById('adjustment-description')?.value?.trim() || '';

      const policy_id = (category === 'chargeback')
        ? (document.getElementById('adjustment-policy')?.value || null)
        : null;

      const lead_id = (category === 'lead_debt')
        ? (document.getElementById('adjustment-lead')?.value || null)
        : null;

      if (!agent_id || !type || !category || !effective_date || !Number.isFinite(rawAmount) || rawAmount <= 0) {
        if (errorEl) errorEl.textContent = 'Please fill in all required fields.';
        return;
      }

      const normType = String(type).toLowerCase(); // 'debit' or 'credit'

      // signed amount like admin.js
      const signedAmount = normType === 'debit'
        ? -Math.abs(rawAmount)
        :  Math.abs(rawAmount);

      // entry_type mapping like admin.js
      let entry_type;
      if (normType === 'debit') {
        entry_type = (category === 'chargeback') ? 'chargeback' : 'lead_charge';
      } else {
        entry_type = 'override';
      }

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

      // debit + lead_debt => also create lead_debts row
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
          if (errorEl) errorEl.textContent =
            'Saved to ledger, but lead debt record failed: ' + ldErr.message;
          return;
        }
      }

      // debit + chargeback => also create policy_chargebacks row
      if (normType === 'debit' && category === 'chargeback') {
        if (!policy_id) {
          if (errorEl) errorEl.textContent = 'Please choose a policy for this chargeback.';
          return;
        }

        // load carrier + policyholder name
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
          if (errorEl) errorEl.textContent =
            'Saved to ledger, but chargeback record failed: ' + cbErr.message;
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
