// scripts/admin-all-leads.js
(() => {
  const supabase = window.supabaseClient;
  if (!supabase) {
    console.warn('Supabase client missing on admin-all-leads.html');
    return;
  }

  let allAgents = [];
  let selectedLeads = new Set();
  let allowedProductsFilter = null;

  const PAGE_SIZE = 25;
  let currentPage = 1;
  let totalPages = 1;

  let rangeStart = null; // ISO string
  let rangeEnd = null;   // ISO string

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  }

  function normalizePhones(phoneVal) {
    if (!phoneVal) return '';
    if (Array.isArray(phoneVal)) return phoneVal.filter(Boolean).join(', ');
    return String(phoneVal);
  }

  function setSelectedCount() {
    const el = document.getElementById('selected-count');
    if (el) el.textContent = String(selectedLeads.size);
  }

  function toggleExportVisibility() {
    const exportControls = document.getElementById('export-controls');
    if (!exportControls) return;
    const anyChecked = document.querySelectorAll('input.lead-checkbox:checked').length > 0;
    exportControls.style.display = anyChecked ? 'block' : 'none';
  }

  function getSelectedLeadsData() {
    return Array.from(document.querySelectorAll('input.lead-checkbox:checked')).map(cb => {
      const row = cb.closest('tr');
      return {
        submittedAt: row.querySelector('.lead-date')?.textContent.trim() || '',
        agent: row.querySelector('.lead-agent')?.textContent.trim() || '',
        first_name: row.querySelector('.lead-name')?.textContent.trim() || '',
        last_name: row.querySelector('.lead-last')?.textContent.trim() || '',
        age: row.querySelector('.lead-age')?.textContent.trim() || '',
        phone: row.querySelector('.lead-phone')?.textContent.trim() || '',
        address: row.querySelector('.lead-address')?.textContent.trim() || '',
        city: row.querySelector('.lead-city')?.textContent.trim() || '',
        state: row.querySelector('.lead-state')?.textContent.trim() || '',
        zip: row.querySelector('.lead-zip')?.textContent.trim() || '',
        type: row.querySelector('.lead-type')?.textContent.trim() || '',
        notes: row.querySelector('.lead-notes')?.textContent.trim() || '',
        product: row.querySelector('.lead-product')?.textContent.trim() || ''
      };
    });
  }

  async function loadAgentsForAdmin() {
    const { data, error } = await supabase
      .from('agents')
      .select('id, full_name, product_types')
      .order('full_name', { ascending: true });

    if (error) {
      console.error(error);
      return;
    }

    allAgents = data || [];

    const agentFilterEl = document.getElementById('agent-filter');
    const bulkAssignEl = document.getElementById('bulk-assign-agent');
    if (!agentFilterEl || !bulkAssignEl) return;

    agentFilterEl.innerHTML = '<option value="">All Agents</option>';
    bulkAssignEl.innerHTML = '<option value="">Select Agent</option>';

    allAgents.forEach(agent => {
      const opt1 = document.createElement('option');
      opt1.value = agent.id;
      opt1.textContent = agent.full_name || agent.id;
      agentFilterEl.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = agent.id;
      opt2.textContent = agent.full_name || agent.id;
      bulkAssignEl.appendChild(opt2);
    });

    // Choices.js enhancement (same pattern you use)
    try {
      new Choices(agentFilterEl, {
        shouldSort: false,
        searchEnabled: true,
        placeholder: true,
        itemSelectText: ''
      });
    } catch {}

    try {
      new Choices(bulkAssignEl, {
        shouldSort: false,
        searchEnabled: true,
        placeholder: true,
        itemSelectText: ''
      });
    } catch {}
  }

  async function loadLeadsWithFilters() {
    const tbody = document.querySelector('#leads-table tbody');
    if (!tbody) return;

    const prevSelection = new Set(selectedLeads);

    tbody.innerHTML = '';
    selectedLeads.clear();
    setSelectedCount();
    toggleExportVisibility();

    let query = supabase.from('leads').select('*', { count: 'exact' });

    const orderDir = document.getElementById('date-order')?.value || 'desc';
    const sortBy = document.getElementById('sort-by')?.value || 'created_at';

    const agentVal = document.getElementById('agent-filter')?.value || '';
    const assignedVal = document.getElementById('assigned-filter')?.value || '';

    const zip = document.getElementById('zip-filter')?.value.trim() || '';
    const city = document.getElementById('city-filter')?.value.trim() || '';
    const state = document.getElementById('state-filter')?.value || '';
    const first = document.getElementById('first-name-filter')?.value.trim() || '';
    const last = document.getElementById('last-name-filter')?.value.trim() || '';
    const productType = document.getElementById('lead-type-filter')?.value || '';

    // NOTE: your existing admin.js filters "Agent" by assigned_to (not submitted_by)
    if (agentVal) query = query.eq('assigned_to', agentVal);

    if (rangeStart) query = query.gte('created_at', rangeStart);
    if (rangeEnd) query = query.lte('created_at', rangeEnd);

    if (zip) query = query.ilike('zip', `%${zip}%`);
    if (city) query = query.ilike('city', `%${city}%`);
    if (state) query = query.ilike('state', `%${state}%`);
    if (first) query = query.ilike('first_name', `%${first}%`);
    if (last) query = query.ilike('last_name', `%${last}%`);
    if (productType) query = query.ilike('product_type', `%${productType}%`);

    if (assignedVal === 'true') {
      query = query.not('assigned_to', 'is', null);
    } else if (assignedVal === 'false') {
      query = query.is('assigned_to', null);
    }

    query = query.order(sortBy, { ascending: orderDir === 'asc' });

    const from = (currentPage - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data: leads, error, count } = await query.range(from, to);

    if (error) {
      console.error(error);
      tbody.innerHTML = `<tr><td colspan="14">Error loading leads.</td></tr>`;
      return;
    }

    const total = Number(count || 0);
    totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const pageLabel = document.getElementById('current-page');
    if (pageLabel) pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

    if (!leads || leads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14">No leads found.</td></tr>`;
      return;
    }

    for (const lead of leads) {
      const id = lead.id;

      const phones = normalizePhones(lead.phone);
      const submitted = formatDate(lead.created_at);

      const assignedAgentName =
        (lead.assigned_to_name || lead.submitted_by_name || '').trim() ||
        'Unassigned';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="lead-checkbox" data-lead-id="${escapeHtml(id)}"></td>
        <td class="lead-date">${escapeHtml(submitted)}</td>
        <td class="lead-agent">${escapeHtml(lead.submitted_by_name || assignedAgentName)}</td>
        <td class="lead-name">${escapeHtml(lead.first_name || '')}</td>
        <td class="lead-last">${escapeHtml(lead.last_name || '')}</td>
        <td class="lead-age">${escapeHtml(lead.age ?? '')}</td>
        <td class="lead-phone">${escapeHtml(phones)}</td>
        <td class="lead-address">${escapeHtml(lead.address || '')}</td>
        <td class="lead-city">${escapeHtml(lead.city || '')}</td>
        <td class="lead-state">${escapeHtml(lead.state || '')}</td>
        <td class="lead-zip">${escapeHtml(lead.zip || '')}</td>
        <td class="lead-type">${escapeHtml(lead.lead_type || '')}</td>
        <td class="lead-notes">${escapeHtml(lead.notes || '')}</td>
        <td class="lead-product">${escapeHtml(lead.product_type || '')}</td>
      `;

      const cb = tr.querySelector('input.lead-checkbox');
      if (cb) {
        // Restore selection if it was checked before
        if (prevSelection.has(id)) {
          cb.checked = true;
          selectedLeads.add(id);
        }

        cb.addEventListener('change', () => {
          if (cb.checked) selectedLeads.add(id);
          else selectedLeads.delete(id);
          setSelectedCount();
          toggleExportVisibility();
        });
      }

      tbody.appendChild(tr);
    }

    setSelectedCount();
    toggleExportVisibility();
  }

  async function assignLeads(agentId) {
    if (!agentId || selectedLeads.size === 0) {
      alert('Please select leads and an agent.');
      return;
    }

    const leadIds = Array.from(selectedLeads);
    const now = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('leads')
      .update({ assigned_to: agentId, assigned_at: now })
      .in('id', leadIds);

    if (updateError) {
      alert('❌ Failed to assign leads: ' + updateError.message);
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const currentUserId = sessionData?.session?.user?.id || null;

    const logs = leadIds.map(leadId => ({
      lead_id: leadId,
      assigned_to: agentId,
      assigned_by: currentUserId,
      assigned_at: now
    }));

    const { error: logError } = await supabase.from('lead_assignments').insert(logs);

    if (logError) {
      alert('⚠️ Leads assigned, but failed to log history: ' + logError.message);
    } else {
      alert('✅ Lead(s) successfully assigned.');
    }

    selectedLeads.clear();
    setSelectedCount();
    await loadLeadsWithFilters();
  }

  function wireUI() {
    // Date range picker (same element id you already use)
    const dateInput = document.getElementById('date-range');
    if (dateInput && window.flatpickr) {
      window.flatpickr(dateInput, {
        mode: 'range',
        dateFormat: 'Y-m-d',
        onChange: (dates) => {
          if (!dates || dates.length === 0) {
            rangeStart = null;
            rangeEnd = null;
            return;
          }
          const start = dates[0];
          const end = dates[1] || dates[0];

          // inclusive end like your current build (gte/lte)
          rangeStart = new Date(start).toISOString();
          rangeEnd = new Date(end).toISOString();
        }
      });
    }

    document.getElementById('apply-filters')?.addEventListener('click', async () => {
      currentPage = 1;
      await loadLeadsWithFilters();
    });

    document.getElementById('reset-filters')?.addEventListener('click', async () => {
      rangeStart = null;
      rangeEnd = null;

      const ids = [
        'date-range','date-order','agent-filter','assigned-filter','zip-filter',
        'city-filter','state-filter','first-name-filter','last-name-filter','lead-type-filter'
      ];

      ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.tagName === 'SELECT') el.value = '';
        else el.value = '';
      });

      // reset order default
      const order = document.getElementById('date-order');
      if (order) order.value = 'desc';

      currentPage = 1;
      await loadLeadsWithFilters();
    });

    document.getElementById('next-page')?.addEventListener('click', async () => {
      if (currentPage < totalPages) {
        currentPage++;
        await loadLeadsWithFilters();
      }
    });

    document.getElementById('prev-page')?.addEventListener('click', async () => {
      if (currentPage > 1) {
        currentPage--;
        await loadLeadsWithFilters();
      }
    });

    document.getElementById('select-all')?.addEventListener('change', (e) => {
      const checked = !!e.target.checked;
      document.querySelectorAll('input.lead-checkbox').forEach(cb => {
        cb.checked = checked;
        const id = cb.dataset.leadId;
        if (checked) selectedLeads.add(id);
        else selectedLeads.delete(id);
      });
      setSelectedCount();
      toggleExportVisibility();
    });

    // Bulk assign agent change → keep your allowedProductsFilter behavior
    document.getElementById('bulk-assign-agent')?.addEventListener('change', (e) => {
      const agentId = e.target.value;
      selectedLeads = new Set(Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => cb.dataset.leadId));
      setSelectedCount();

      if (!agentId) { allowedProductsFilter = null; return; }

      const agent = allAgents.find(a => a.id === agentId);
      if (agent && agent.product_types) {
        if (Array.isArray(agent.product_types)) {
          allowedProductsFilter = agent.product_types.slice();
        } else {
          allowedProductsFilter = String(agent.product_types).split(',').map(s => s.trim()).filter(Boolean);
        }
      } else {
        allowedProductsFilter = null;
      }
    });

    // Bulk assign click (kept same logic: eligibility + reassign confirm)
    document.getElementById('bulk-assign-btn')?.addEventListener('click', async () => {
      const selectedIds = Array.from(selectedLeads);
      if (!selectedIds.length) { alert('⚠️ No leads selected'); return; }

      const agentId = document.getElementById('bulk-assign-agent')?.value;
      if (!agentId) { alert('⚠️ No agent selected'); return; }

      const agentInfo = allAgents.find(a => a.id === agentId);

      // Product eligibility check
      if (agentInfo && Array.isArray(agentInfo.product_types) && agentInfo.product_types.length) {
        let ineligibleFound = false;
        for (let id of selectedLeads) {
          const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
          const product = row?.querySelector('.lead-product')?.textContent.trim();
          if (product && !agentInfo.product_types.includes(product)) { ineligibleFound = true; break; }
        }
        if (ineligibleFound) {
          alert('❌ One or more selected leads have product types this agent is not eligible for.');
          return;
        }
      }

      const needsReassignConfirm = selectedIds.some(id => {
        const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
        const currentAgent = row?.querySelector('td:nth-child(3)')?.textContent;
        return currentAgent && currentAgent !== 'Unassigned';
      });

      if (needsReassignConfirm) {
        document.getElementById('reassign-warning-modal').style.display = 'flex';
      } else {
        alert('✅ Assigning leads…');
        await assignLeads(agentId);
      }
    });

    document.getElementById('submit-anyway-btn')?.addEventListener('click', async () => {
      const agentId = document.getElementById('bulk-assign-agent')?.value;
      await assignLeads(agentId);
      document.getElementById('reassign-warning-modal').style.display = 'none';
    });

    document.getElementById('cancel-reassign-btn')?.addEventListener('click', () => {
      document.getElementById('reassign-warning-modal').style.display = 'none';
    });

    // Export dropdown toggle (same robust pattern)
    const exportBtn = document.getElementById('export-btn');
    const exportOptions = document.getElementById('export-options');
    if (exportBtn && exportOptions) {
      exportBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        exportOptions.style.display = (exportOptions.style.display === 'block') ? 'none' : 'block';
      });
      exportOptions.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', () => { exportOptions.style.display = 'none'; });
      ['export-csv','export-pdf','export-print'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
          exportOptions.style.display = 'none';
        });
      });
    }

    // CSV
    document.getElementById('export-csv')?.addEventListener('click', () => {
      const leads = getSelectedLeadsData();
      if (!leads.length) return alert('No leads selected.');

      const headers = Object.keys(leads[0]).join(',');
      const rows = leads.map(lead => Object.values(lead).map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(','));
      const csvContent = [headers, ...rows].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'leads.csv';
      link.click();
    });

    // Print (certificate-style simple page per lead, like your current approach)
    document.getElementById('export-print')?.addEventListener('click', () => {
      const leads = getSelectedLeadsData();
      if (!leads.length) return alert('No leads selected.');

      const win = window.open('', '_blank');
      win.document.write(`
        <html><head>
          <link href="https://fonts.googleapis.com/css2?family=Bellota+Text&display=swap" rel="stylesheet">
          <style>
            body { font-family: 'Bellota Text', sans-serif; padding: 30px; }
            .page { page-break-after: always; border: 2px solid #eee; border-radius: 14px; padding: 18px; }
            .logo { width: 70px; height: 70px; object-fit: contain; display:block; margin: 0 auto 10px auto; }
            h2 { text-align:center; margin: 6px 0 14px 0; }
            p { margin: 6px 0; }
            .label { font-weight:bold; display:inline-block; width: 140px; }
            .footer { margin-top: 16px; font-size: 11px; color:#777; text-align:center; }
          </style>
        </head><body>
      `);

      leads.forEach(lead => {
        win.document.write(`
          <div class="page">
            <img class="logo" src="/Pics/img17.png" />
            <h2>Lead Summary</h2>
            <p><span class="label">Submitted:</span> ${escapeHtml(lead.submittedAt)}</p>
            <p><span class="label">Agent:</span> ${escapeHtml(lead.agent)}</p>
            <p><span class="label">Name:</span> ${escapeHtml(lead.first_name)} ${escapeHtml(lead.last_name)}</p>
            <p><span class="label">Age:</span> ${escapeHtml(lead.age)}</p>
            <p><span class="label">Phone(s):</span> ${escapeHtml(lead.phone)}</p>
            <p><span class="label">Address:</span> ${escapeHtml(lead.address)}</p>
            <p><span class="label">City/State/ZIP:</span> ${escapeHtml(lead.city)}, ${escapeHtml(lead.state)} ${escapeHtml(lead.zip)}</p>
            <p><span class="label">Type:</span> ${escapeHtml(lead.type)}</p>
            <p><span class="label">Product:</span> ${escapeHtml(lead.product)}</p>
            <p><span class="label">Notes:</span> ${escapeHtml(lead.notes)}</p>
            <div class="footer">© Family Values Group</div>
          </div>
        `);
      });

      win.document.write(`</body></html>`);
      win.document.close();
      win.focus();
      win.print();
    });

    // PDF (uses jsPDF + autoTable)
    document.getElementById('export-pdf')?.addEventListener('click', () => {
      const leads = getSelectedLeadsData();
      if (!leads.length) return alert('No leads selected.');

      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) return alert('jsPDF not loaded.');

      const doc = new jsPDF();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text('Family Values Group - Leads Export', 14, 16);

      const rows = leads.map(l => ([
        l.submittedAt,
        l.agent,
        `${l.first_name} ${l.last_name}`.trim(),
        l.age,
        l.phone,
        l.address,
        l.city,
        l.state,
        l.zip,
        l.type,
        l.product,
        l.notes
      ]));

      doc.autoTable({
        startY: 22,
        head: [[
          'Submitted','Agent','Name','Age','Phone(s)','Address','City','State','ZIP','Type','Product','Notes'
        ]],
        body: rows,
        styles: { fontSize: 8 },
        headStyles: { fillColor: [53, 52, 104] } // matches your vibe; remove if you don't want any color
      });

      doc.save('leads.pdf');
    });
  }

  async function init() {
    // (admin gate is already handled by inline script in HTML; this is just the page logic)
    await loadAgentsForAdmin();
    wireUI();
    await loadLeadsWithFilters();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
