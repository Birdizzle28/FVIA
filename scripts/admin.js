import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let statPicker;
let userId = null;
let userRole = null;
let allAgents = [];
let selectedLeads = new Set();
let currentPage = 1;
const PAGE_SIZE = 25;
let rangeStart = null;
let rangeEnd = null;
let allowedProductsFilter = null;
// ---- KPI helpers ----
const DAY_MS = 864e5;
const PERSISTENCY_DAYS = 90;

const safeDiv = (num, den) => (den > 0 ? num / den : NaN);
const fmtPct  = v => Number.isFinite(v) ? (Math.round(v * 1000) / 10) + '%' : '—';

const getStage = l => String(l.status || l.stage || '').toLowerCase();
const isContacted = l => !!l.contact_at || ['contacted','quoted','closed'].includes(getStage(l));
const isQuoted = l => !!l.quote_at || ['quoted','closed'].includes(getStage(l));
const isClosed = l => !!(l.issued_at || l.closed_at) || ['closed','issued','policy'].includes(getStage(l));
const issuedAt = l => l.issued_at ? new Date(l.issued_at) : (l.closed_at ? new Date(l.closed_at) : null);
const inRange = (d, start, end) => { if (!d) return false; const t = +d; return (!start || t >= +start) && (!end || t <= +end); };

// ===== Helpers for announcements =====
async function uploadAnnouncementImage(file, me) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `annc_${me || 'anon'}_${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('announcements').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'application/octet-stream'
  });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('announcements').getPublicUrl(path);
  return data?.publicUrl || null;
}

function summarizeAudience(aud) {
  if (!aud || !aud.scope) return 'All users';
  switch (aud.scope) {
    case 'admins': return 'Admins only';
    case 'by_product': return `Products: ${(aud.products||[]).join(', ') || '—'}`;
    case 'by_state': return `States: ${(aud.states||[]).join(', ') || '—'}`;
    case 'custom_agents': return `Agents: ${(aud.agent_ids||[]).length}`;
    default: return 'All users';
  }
}

function populateStatAgentSelect() {
  const sel = document.getElementById('stat-agent');
  if (!sel) return;
  sel.innerHTML = '<option value="">All agents</option>';
  allAgents.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.full_name;
    sel.appendChild(opt);
  });
  try { new Choices(sel, { shouldSort:false, searchEnabled:true, itemSelectText:'' }); } catch(_) {}
}

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  userId = session.user.id;

  const { data: profile } = await supabase.from('agents').select('is_admin').eq('id', userId).single();
  if (!profile || profile.is_admin !== true) {
    location.replace('dashboard.html'); // no alert, no history entry
    return;
  }
  userRole = 'admin';

  flatpickr('#date-range', { mode:'range', dateFormat:'Y-m-d',
    onChange: (ds)=>{ rangeStart = ds[0]?.toISOString().split('T')[0] || null; rangeEnd = ds[1]?.toISOString().split('T')[0] || null; loadLeadsWithFilters(); }
  });
  new Choices('#state-filter', { searchEnabled:true, itemSelectText:'' });

  await loadAgentsForAdmin();
  await populateRecruiterSelect();

  // Populate Announcement multi-selects
  (function hydrateAnncProducts(){
    const sel = document.getElementById('annc-products'); if (!sel) return;
    const set = new Set(); (allAgents||[]).forEach(a => (a.product_types||[]).forEach(p => set.add(p)));
    [...set].sort().forEach(p => { const o=document.createElement('option'); o.value=p; o.textContent=p; sel.appendChild(o); });
    try { new Choices(sel, { removeItemButton:true, shouldSort:true }); } catch(_) {}
  })();
  (function hydrateAnncAgents(){
    const sel = document.getElementById('annc-agent-ids'); if (!sel) return;
    (allAgents||[]).forEach(a => { const o=document.createElement('option'); o.value=a.id; o.textContent=a.full_name; sel.appendChild(o); });
    try { new Choices(sel, { removeItemButton:true, shouldSort:true, searchEnabled:true }); } catch(_) {}
  })();
  (function enhanceAnncStates(){
    const sel = document.getElementById('annc-states'); if (!sel) return;
    try { new Choices(sel, { removeItemButton:true, shouldSort:true, searchEnabled:true }); } catch(_) {}
  })();

  populateStatAgentSelect();
  await loadLeadsWithFilters();
  await loadRequestedLeads();
  await loadAssignmentHistory();
  await loadAnnouncements(); // NEW: load list on page load

  (function initStatRange(){
    const thirtyDaysAgo = new Date(Date.now() - 30*864e5);
    statPicker = flatpickr('#stat-range-wrap', {
      mode:'range', dateFormat:'Y-m-d', defaultDate:[thirtyDaysAgo, new Date()], wrap:true,
      onChange:()=>{ if (!document.getElementById('stat-all-time').checked) loadAgentStats(); }
    });
    const allCb = document.getElementById('stat-all-time');
    allCb.addEventListener('change', ()=> {
      const disabled = allCb.checked;
      document.getElementById('stat-range').disabled = disabled;
      document.querySelector('#stat-range-wrap .calendar-btn').disabled = disabled;
      loadAgentStats();
    });
  })();
  document.getElementById('stat-agent')?.addEventListener('change', loadAgentStats);
  document.getElementById('stat-range')?.addEventListener('change', loadAgentStats);

  // Filter changes
  document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => el.addEventListener('change', loadLeadsWithFilters));
  document.getElementById('apply-filters').addEventListener('click', () => loadLeadsWithFilters());
  document.getElementById('reset-filters').addEventListener('click', () => {
    document.querySelectorAll('#admin-filters input, #admin-filters select').forEach(el => { if (el.tagName==='SELECT') el.selectedIndex=0; else el.value=''; });
    rangeStart = null; rangeEnd = null; allowedProductsFilter = null; loadLeadsWithFilters();
  });

  // Table sorting
  let currentSortColumn = null, currentSortDirection = 'asc';
  document.querySelectorAll('#leads-table th[data-column]').forEach(th => {
    th.addEventListener('click', () => {
      const column = th.getAttribute('data-column');
      if (currentSortColumn === column) currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
      else { currentSortColumn = column; currentSortDirection = 'asc'; }
      document.getElementById('sort-by').value = column;
      document.getElementById('date-order').value = currentSortDirection;
      loadLeadsWithFilters();
    });
  });

  // Bulk assign
  document.getElementById('bulk-assign-agent').addEventListener('change', e => {
    const agentId = e.target.value;
    selectedLeads = new Set(Array.from(document.querySelectorAll('.lead-checkbox:checked')).map(cb => cb.dataset.leadId));
    if (!agentId) { allowedProductsFilter = null; return; }
    const agent = allAgents.find(a => a.id === agentId);
    if (agent && agent.product_types) {
      if (Array.isArray(agent.product_types)) {
        allowedProductsFilter = agent.product_types.slice();
      } else {
        allowedProductsFilter = String(agent.product_types).split(',').map(s=>s.trim()).filter(Boolean);
      }
    } else {
      allowedProductsFilter = null;
    }
  });

  document.getElementById('bulk-assign-btn').addEventListener('click', async () => {
    const selectedIds = Array.from(selectedLeads);
    if (!selectedIds.length) { alert('⚠️ No leads selected'); return; }
    const agentId = document.getElementById('bulk-assign-agent').value;
    if (!agentId) { alert('⚠️ No agent selected'); return; }
    const agentInfo = allAgents.find(a => a.id === agentId);
    if (agentInfo && Array.isArray(agentInfo.product_types) && agentInfo.product_types.length) {
      let ineligibleFound = false;
      for (let id of selectedLeads) {
        const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
        const product = row?.querySelector('.lead-product')?.textContent.trim();
        if (product && !agentInfo.product_types.includes(product)) { ineligibleFound = true; break; }
      }
      if (ineligibleFound) { alert('❌ One or more selected leads have product types this agent is not eligible for.'); return; }
    }
    const needsReassignConfirm = selectedIds.some(id => {
      const row = document.querySelector(`input[data-lead-id="${id}"]`)?.closest('tr');
      const currentAgent = row?.querySelector('td:nth-child(3)')?.textContent;
      return currentAgent && currentAgent !== 'Unassigned';
    });
    if (needsReassignConfirm) document.getElementById('reassign-warning-modal').style.display = 'flex';
    else { alert('✅ Assigning leads…'); await assignLeads(agentId); }
  });
  document.getElementById('submit-anyway-btn').addEventListener('click', async () => {
    const agentId = document.getElementById('bulk-assign-agent').value;
    await assignLeads(agentId);
    document.getElementById('reassign-warning-modal').style.display = 'none';
  });
  document.getElementById('cancel-reassign-btn').addEventListener('click', () => {
    document.getElementById('reassign-warning-modal').style.display = 'none';
  });

  // Export dropdown toggle
  const exportBtn = document.getElementById('export-btn');
  const exportOptions = document.getElementById('export-options');
  if (exportBtn && exportOptions) {
    exportBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      exportOptions.style.display = (exportOptions.style.display === 'block') ? 'none' : 'block';
    });
    exportOptions.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => { exportOptions.style.display = 'none'; });
  }
  ['export-csv','export-pdf','export-print'].forEach(id => document.getElementById(id)?.addEventListener('click', () => { exportOptions.style.display = 'none'; }));

  // CSV
  document.getElementById('export-csv').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) { alert('No leads selected.'); return; }
    const headers = Object.keys(leads[0]).join(',');
    const rows = leads.map(lead => Object.values(lead).map(v => `"${v}"`).join(','));
    const csvContent = [headers, ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'leads.csv'; link.click();
  });
  // Print
  document.getElementById('export-print').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) { alert('No leads selected.'); return; }
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head>
        <link href="https://fonts.googleapis.com/css2?family=Bellota+Text&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Bellota Text', sans-serif; padding: 30px; text-align: center; }
          .logo { width: 60px; height: 60px; object-fit: contain; display: block; margin: 0 auto 10px auto; }
          .label { display: inline-block; font-weight: bold; width: 150px; text-align: right; margin-right: 10px; }
          .value { display: inline-block; text-align: left; }
          p { text-align: left; margin: 6px 0 6px 100px; }
          .footer { margin-top: 30px; font-size: 10px; text-align: center; color: #777; }
          .lead-page { page-break-after: always; }
        </style>
        </head><body>
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
        `).join('')}
      </body></html>
    `);
    win.document.close(); win.print();
  });
  // PDF
  document.getElementById('export-pdf').addEventListener('click', () => {
    const leads = getSelectedLeadsData();
    if (!leads.length) { alert('No leads selected.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const logoImg = new Image(); logoImg.src = '/Pics/img6.png';
    logoImg.onload = () => {
      leads.forEach((lead, i) => {
        if (i) doc.addPage();
        doc.addImage(logoImg, 'PNG', 90, 10, 30, 30);
        doc.setFontSize(18); doc.setFont('helvetica', 'bold');
        doc.text('Family Values Insurance Agency', 105, 50, { align: 'center' });
        doc.setFontSize(14); doc.setFont('helvetica', 'normal');
        doc.text('Lead Confirmation Form', 105, 60, { align: 'center' });
        const startY = 80, lineH = 10, labelX = 20, valueX = 70;
        const fields = [
          ['First Name', lead.first_name], ['Last Name', lead.last_name], ['Age', lead.age],
          ['Phone', lead.phone], ['Lead Type', lead.leadType], ['City', lead.city],
          ['State', lead.state], ['ZIP', lead.zip], ['Address', lead.address],
          ['Agent Assigned', lead.agent], ['Submitted At', lead.submittedAt]
        ];
        fields.forEach(([label, value], idx) => {
          const y = startY + idx * lineH; doc.setFont('helvetica', 'bold'); doc.text(`${label}:`, labelX, y);
          doc.setFont('helvetica', 'normal'); doc.text(value || '—', valueX, y);
        });
        doc.setFontSize(10); doc.setTextColor(120);
        doc.text(`Generated on ${new Date().toLocaleDateString()}`, 105, 285, { align: 'center' });
      });
      doc.save('FVIA_Leads.pdf');
    };
    logoImg.onerror = () => alert('❌ Failed to load logo for PDF.');
  });

  const navButtons = {
    all: document.getElementById('nav-all'),
    requests: document.getElementById('nav-requests'),
    history: document.getElementById('nav-history'),
    stats: document.getElementById('nav-stats'),
    content: document.getElementById('nav-content'),
  };
  const sections = {
    all: document.getElementById('admin-all-section'),
    requests: document.getElementById('admin-requests-section'),
    history: document.getElementById('admin-history-section'),
    stats: document.getElementById('admin-stats-section'),
    content: document.getElementById('admin-content-section'),
  };
  function hideAllAdminSections(){
    Object.values(sections).forEach(sec => sec.style.display='none');
    Object.values(navButtons).forEach(btn => btn.classList.remove('active'));
  }
  function showAdminSection(name){
    hideAllAdminSections();
    sections[name].style.display='block';
    navButtons[name].classList.add('active');
    if (name === 'history') loadAssignmentHistory();
    if (name === 'stats') loadAgentStats();
    if (name === 'content') {
      loadAnnouncements();      // keep existing
      loadTrainingMaterials();  // NEW
    }
  }
  showAdminSection('all');
  navButtons.all.addEventListener('click', () => showAdminSection('all'));
  navButtons.requests.addEventListener('click', () => showAdminSection('requests'));
  navButtons.history.addEventListener('click', () => showAdminSection('history'));
  navButtons.stats.addEventListener('click', () => showAdminSection('stats'));
  navButtons.content.addEventListener('click', () => showAdminSection('content'));

  // Overlays
  document.getElementById('open-annc-modal')?.addEventListener('click', () => openOverlay('annc-modal'));
  document.getElementById('open-train-modal')?.addEventListener('click', () => openOverlay('train-modal'));
  document.getElementById('open-mkt-modal')?.addEventListener('click', () => openOverlay('mkt-modal'));
  document.getElementById('open-agent-modal')?.addEventListener('click', () => openOverlay('agent-modal'));
  function openOverlay(id){
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
    document.body.style.overflow='hidden';
  }
  function closeOverlay(el){
    el.classList.remove('open');
    el.setAttribute('aria-hidden','true');
    document.body.style.overflow='';
  }
  document.querySelectorAll('.overlay [data-close], .overlay .overlay-backdrop').forEach(btn=>{
    btn.addEventListener('click', (e)=> {
      const wrap = e.target.closest('.overlay');
      if (wrap) closeOverlay(wrap);
    });
  });

    try {
      flatpickr('#annc-publish', { enableTime:true, dateFormat:'Y-m-d H:i' });
      flatpickr('#annc-expires', { enableTime:true, dateFormat:'Y-m-d H:i' });
      flatpickr('#annc-repeat-end', { enableTime:true, dateFormat:'Y-m-d H:i' });
    } catch(_) {}
    
    // Announcements list collapse toggle
    const anncListEl   = document.getElementById('annc-list');
    const anncToggleEl = document.getElementById('toggle-annc-list');
    if (anncListEl && anncToggleEl) {
      anncToggleEl.addEventListener('click', () => {
        const isHidden = anncListEl.hasAttribute('hidden');
        if (isHidden) {
          anncListEl.removeAttribute('hidden');
          anncToggleEl.setAttribute('aria-expanded', 'true');
          anncToggleEl.querySelector('i')?.classList.replace('fa-chevron-down', 'fa-chevron-up');
        } else {
          anncListEl.setAttribute('hidden', '');
          anncToggleEl.setAttribute('aria-expanded', 'false');
          anncToggleEl.querySelector('i')?.classList.replace('fa-chevron-up', 'fa-chevron-down');
        }
      });
    }

  const scopeSel = document.getElementById('annc-scope');
  const wrapProducts = document.getElementById('annc-products-wrap');
  const wrapStates   = document.getElementById('annc-states-wrap');
  const wrapAgents   = document.getElementById('annc-agents-wrap');
  function refreshAudienceUI() {
    const v = scopeSel.value;
    wrapProducts.style.display = (v === 'by_product') ? 'block' : 'none';
    wrapStates.style.display   = (v === 'by_state')   ? 'block' : 'none';
    wrapAgents.style.display   = (v === 'custom_agents') ? 'block' : 'none';
  }
  scopeSel?.addEventListener('change', refreshAudienceUI);
  refreshAudienceUI();

  // === Announcements (Create/Upload) ===
  document.getElementById('annc-form')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const msg = document.getElementById('annc-msg');
    msg.textContent = '';

    const { data: { session } } = await supabase.auth.getSession();
    const me = session?.user?.id;

    const title   = document.getElementById('annc-title').value.trim();
    const body    = document.getElementById('annc-body').value.trim();
    const linkUrl = document.getElementById('annc-link').value.trim() || null;
    const imgFile = document.getElementById('annc-image').files[0] || null;

    const scope     = document.getElementById('annc-scope').value;
    const publishAt = document.getElementById('annc-publish').value.trim() || null;
    const expiresAt = document.getElementById('annc-expires').value.trim() || null;

    const repeatFreq = document.getElementById('annc-repeat')?.value || 'none';
    const repeatEnd  = document.getElementById('annc-repeat-end')?.value.trim() || null;

    const audience = { scope };
    if (scope === 'by_product') {
      audience.products = Array.from(document.getElementById('annc-products')?.selectedOptions || [])
        .map(o => o.value);
    }
    if (scope === 'by_state') {
      audience.states = Array.from(document.getElementById('annc-states')?.selectedOptions || [])
        .map(o => o.value);
    }
    if (scope === 'custom_agents') {
      audience.agent_ids = Array.from(document.getElementById('annc-agent-ids')?.selectedOptions || [])
        .map(o => o.value);
    }

    // Store recurrence info inside the audience JSON so no new DB columns are needed
    if (repeatFreq && repeatFreq !== 'none') {
      audience.repeat = {
        frequency: repeatFreq,
        until: repeatEnd ? new Date(repeatEnd).toISOString() : null
      };
    }

    let image_url = null;
    try {
      if (imgFile) {
        image_url = await uploadAnnouncementImage(imgFile, me);
      }
    } catch (err) {
      msg.textContent = '❌ Image upload failed: ' + (err?.message || err);
      return;
    }

    const { error } = await supabase.from('announcements').insert({
      title,
      body,
      link_url: linkUrl || null,
      image_url: image_url || null,
      created_by: me || null,
      audience,
      publish_at: publishAt ? new Date(publishAt).toISOString() : null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      is_active: true
    });

    if (error) {
      msg.textContent = '❌ ' + error.message;
      return;
    }

    msg.textContent = '✅ Saved.';
    await loadAnnouncements();

    setTimeout(() => {
      document.querySelector('#annc-modal .overlay-close')?.click();
    }, 600);

    // reset form
    e.target.reset();
  });
  document.getElementById('train-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('train-msg');
    if (msg) msg.textContent = '';

    const titleEl = document.getElementById('train-title');
    const descEl = document.getElementById('train-desc');
    const urlEl  = document.getElementById('train-url');
    const tagsEl = document.getElementById('train-tags');

    const title = titleEl?.value.trim() || '';
    const description = descEl?.value.trim() || '';
    const url = urlEl?.value.trim() || '';
    const rawTags = tagsEl?.value.trim() || '';

    if (!title) {
      if (msg) msg.textContent = 'Title is required.';
      return;
    }

    const tags = rawTags
      ? rawTags.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    const payload = {
      title,
      description: description || null,
      url: url || null,
      tags,
      created_by: userId || null,
      is_published: true
    };

    const { error } = await supabase.from('training_materials').insert(payload);
    if (error) {
      if (msg) msg.textContent = '❌ ' + error.message;
      return;
    }

    if (msg) msg.textContent = '✅ Training item saved.';

    await loadTrainingMaterials();

    e.target.reset();

    setTimeout(() => {
      document.querySelector('#train-modal [data-close]')?.click();
      if (msg) msg.textContent = '';
    }, 700);
  });

  // Pagination buttons
  const nextBtn = document.getElementById('next-page');
  const prevBtn = document.getElementById('prev-page');
  nextBtn?.addEventListener('click', async () => { currentPage++; await loadLeadsWithFilters(); });
  prevBtn?.addEventListener('click', async () => { if (currentPage > 1) { currentPage--; await loadLeadsWithFilters(); } });

  // === Add Agent form (NPN + recruiter + NIPR sync) ===
  document.getElementById('agent-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('agent-msg');
    msg.textContent = '';

    const npn = document.getElementById('agent-id').value.trim(); // NPN = agent_id
    const recruiterId = document.getElementById('agent-recruiter').value;

    if (!npn || !recruiterId) {
      msg.textContent = '⚠️ Enter NPN and choose recruiter.';
      return;
    }

    // 1) Pre-approve in approved_agents
    const { data: existing, error: existErr } = await supabase
      .from('approved_agents')
      .select('id, is_registered')
      .eq('agent_id', npn)
      .maybeSingle();

    if (existErr) {
      msg.textContent = '❌ Error checking approval: ' + existErr.message;
      return;
    }

    if (existing?.is_registered) {
      msg.textContent = '❌ That agent ID is already registered.';
      return;
    }

    const payload = {
      agent_id: npn,
      recruiter_id: recruiterId,
      is_registered: false
    };

    const { error: upErr } = existing
      ? await supabase.from('approved_agents').update(payload).eq('id', existing.id)
      : await supabase.from('approved_agents').insert(payload);

    if (upErr) {
      msg.textContent = '❌ Could not save pre-approval: ' + upErr.message;
      return;
    }

    // 2) NIPR sync + parse
    try {
      msg.textContent = '✅ Pre-approved. Syncing NIPR data…';

      const syncRes = await fetch('/.netlify/functions/nipr-sync-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: npn })
      });

      if (!syncRes.ok) {
        const txt = await syncRes.text();
        console.error('NIPR sync error:', txt);
        msg.textContent = '⚠️ Pre-approved, but NIPR sync failed. Check logs.';
        return;
      }

      const syncJson = await syncRes.json();
      console.log('NIPR sync result:', syncJson);

      const parseRes = await fetch('/.netlify/functions/nipr-parse-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: npn })
      });

      if (!parseRes.ok) {
        const txt = await parseRes.text();
        console.error('NIPR parse error:', txt);
        msg.textContent = '⚠️ Pre-approved & synced, but parse failed. Check logs.';
        return;
      }

      const parseJson = await parseRes.json();
      console.log('NIPR parse result:', parseJson);

      msg.textContent = '✅ Pre-approved and NIPR data synced (profile, licenses, appointments, snapshot).';
    } catch (err) {
      console.error('Error calling NIPR functions:', err);
      msg.textContent = '⚠️ Pre-approved, but there was an error syncing NIPR data.';
      return;
    }

    setTimeout(() => {
      document.querySelector('#agent-modal [data-close]')?.click();
    }, 900);
  });
}); // end DOMContentLoaded

// Load active agents
// Load active agents
async function loadAgentsForAdmin() {
  let { data, error } = await supabase
    .from('agents')
    .select('id, full_name, product_types')
    .eq('is_active', true);

  if (error) {
    console.error('Error loading agents (primary):', error);
    const { data: dataFallback, error: err2 } = await supabase
      .from('agents')
      .select('id, full_name')
      .eq('is_active', true);
    if (err2) {
      console.error('Error loading agents (fallback):', err2);
      return;
    }
    data = dataFallback;
  }

  // 🔍 DEBUG: see exactly which agents are visible to this logged-in admin
  console.log('loadAgentsForAdmin → data:', data);
  window._agentsDebug = data; // so you can inspect in the console

  allAgents = data || [];

  allAgents.forEach(agent => {
    if (agent.product_types) {
      if (Array.isArray(agent.product_types)) {
        // ok
      } else if (typeof agent.product_types === 'string') {
        agent.product_types = agent.product_types
          .split(',')
          .map(s => s.trim());
      } else {
        agent.product_types = null;
      }
    }
  });

  const agentFilterEl = document.getElementById('agent-filter');
  const bulkAssignEl  = document.getElementById('bulk-assign-agent');

  agentFilterEl.innerHTML = '<option value="">All Agents</option>';
  bulkAssignEl.innerHTML  = '<option value="">Select Agent</option>';

  allAgents.forEach(agent => {
    const opt1 = document.createElement('option');
    opt1.value = agent.id;
    opt1.textContent = agent.full_name;
    agentFilterEl.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = agent.id;
    opt2.textContent = agent.full_name;
    bulkAssignEl.appendChild(opt2);
  });

  new Choices(agentFilterEl, {
    shouldSort: false,
    searchEnabled: true,
    placeholder: true,
    itemSelectText: ''
  });

  new Choices(bulkAssignEl, {
    shouldSort: false,
    searchEnabled: true,
    placeholder: true,
    itemSelectText: ''
  });
}

function populateRecruiterSelect() {
  const sel = document.getElementById('agent-recruiter');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select recruiter…</option>';
  (allAgents || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.full_name || a.id;
    sel.appendChild(opt);
  });
}

// Leads table
async function loadLeadsWithFilters() {
  const tbody = document.querySelector('#leads-table tbody'); if (!tbody) return;
  const prevSelection = new Set(selectedLeads);
  tbody.innerHTML = ''; document.getElementById('selected-count').textContent = '0';

  let query = supabase.from('leads').select('*', { count: 'exact' });
  const orderDir = document.getElementById('date-order').value;
  const sortBy = document.getElementById('sort-by').value || 'created_at';
  const agentVal = document.getElementById('agent-filter').value;
  const zip = document.getElementById('zip-filter').value.trim();
  const city = document.getElementById('city-filter').value.trim();
  const state = document.getElementById('state-filter').value;
  const first = document.getElementById('first-name-filter').value.trim();
  const last = document.getElementById('last-name-filter').value.trim();
  const type = document.getElementById('lead-type-filter').value;
  const assignedVal = document.getElementById('assigned-filter').value;

  if (agentVal) query = query.eq('assigned_to', agentVal);
  if (rangeStart) query = query.gte('created_at', rangeStart);
  if (rangeEnd) query = query.lte('created_at', rangeEnd);
  if (zip) query = query.ilike('zip', `%${zip}%`);
  if (city) query = query.ilike('city', `%${city}%`);
  if (state) query = query.ilike('state', `%${state}%`);
  if (first) query = query.ilike('first_name', `%${first}%`);
  if (last) query = query.ilike('last_name', `%${last}%`);
  if (type) query = query.ilike('product_type', `%${type}%`);
  if (assignedVal === 'true') query = query.not('assigned_to', 'is', null);
  else if (assignedVal === 'false') query = query.is('assigned_to', null);

  const from = (currentPage - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data: leads, error, count } = await query.order(sortBy, { ascending: orderDir === 'asc' }).range(from, to);
  if (error) {
    console.error('Error loading leads:', error);
    tbody.innerHTML = '<tr><td colspan="14">Error loading leads.</td></tr>';
    return;
  }

  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;
  document.getElementById('current-page').textContent = `Page ${currentPage} of ${totalPages}`;
  document.getElementById('prev-page').disabled = currentPage <= 1;
  document.getElementById('next-page').disabled = currentPage >= totalPages;

  (leads || []).forEach(lead => {
    const tr = document.createElement('tr');
    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.classList.add('lead-checkbox'); checkbox.dataset.leadId = lead.id;
    checkbox.addEventListener('change', e => {
      const id = String(lead.id);
      if (e.target.checked) selectedLeads.add(id); else selectedLeads.delete(id);
      document.getElementById('selected-count').textContent = selectedLeads.size;
      toggleExportVisibility();
    });
    checkboxTd.appendChild(checkbox); tr.appendChild(checkboxTd);
    if (prevSelection.has(String(lead.id))) { checkbox.checked = true; selectedLeads.add(String(lead.id)); }
    const agentName = lead.assigned_to ? (allAgents.find(a => a.id === lead.assigned_to)?.full_name || 'Unassigned') : 'Unassigned';
    const cellMap = {
      'lead-date': new Date(lead.created_at).toLocaleDateString(),
      'lead-agent': agentName,
      'lead-name': lead.first_name || '',
      'lead-last': lead.last_name || '',
      'lead-age': lead.age || '',
      'lead-phone': (lead.phone || []).join(', '),
      'lead-address': lead.address || '',
      'lead-city': lead.city || '',
      'lead-state': lead.state || '',
      'lead-zip': lead.zip || '',
      'lead-type': lead.lead_type || '',
      'lead-notes': lead.notes || '',
      'lead-product': lead.product_type || ''
    };
    for (const [cls, text] of Object.entries(cellMap)) {
      const td = document.createElement('td');
      td.classList.add(cls);
      td.textContent = text;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  document.getElementById('selected-count').textContent = String(selectedLeads.size);
  toggleExportVisibility();
}

const selectAllBox = document.getElementById('select-all');
selectAllBox?.addEventListener('change', (e) => {
  const checked = e.target.checked;
  document.querySelectorAll('.lead-checkbox').forEach(cb => {
    cb.checked = checked;
    cb.dispatchEvent(new Event('change'));
  });
});

// Requests
async function loadRequestedLeads() {
  const container = document.getElementById('requested-leads-container');
  if (!container) return;
  container.innerHTML = 'Loading...';
  const { data: requests, error } = await supabase.from('lead_requests').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Error loading requests:', error);
    container.innerHTML = '<p>Error loading requests.</p>';
    return;
  }
  if (!requests?.length) {
    container.innerHTML = '<p>No lead requests found.</p>';
    return;
  }
  container.innerHTML = requests.map(req => `
    <div class="lead-request-box" data-request-id="${req.id}">
      <strong>Requested By:</strong> ${req.submitted_by_name || 'Unknown'}<br>
      <strong>City:</strong> ${req.city || 'N/A'}<br>
      <strong>ZIP:</strong> ${req.zip || 'N/A'}<br>
      <strong>State:</strong> ${req.state || 'N/A'}<br>
      <strong>Lead Type:</strong> ${req.lead_type || 'N/A'}<br>
      <strong>How many:</strong> ${req.requested_count || 'N/A'}<br>
      <strong>Notes:</strong> ${req.notes || 'None'}<br>
      <em>Submitted: ${req.created_at ? new Date(req.created_at).toLocaleString() : 'N/A'}</em><br>
      <button class="delete-request-btn">Delete</button>
      <hr>
    </div>
  `).join('');
  document.querySelectorAll('.delete-request-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      const box = e.target.closest('.lead-request-box');
      const requestId = box?.getAttribute('data-request-id');
      if (!requestId) return;
      if (!confirm('Are you sure you want to delete this request?')) return;
      const { error: deleteError } = await supabase.from('lead_requests').delete().eq('id', requestId);
      if (deleteError) {
        alert('❌ Failed to delete request.');
        console.error(deleteError);
      } else {
        box.remove();
        alert('✅ Request deleted.');
      }
    });
  });
}

// Assignment history
async function loadAssignmentHistory() {
  const tbody = document.querySelector('#assignment-history-table tbody');
  if (!tbody) return;
  tbody.innerHTML = 'Loading...';
  const { data: history, error } = await supabase.from('lead_assignments')
    .select(`lead_id, assigned_at, assigned_to_agent:assigned_to(full_name), assigned_by_agent:assigned_by(full_name)`)
    .order('assigned_at', { ascending: false });
  if (error) {
    console.error('Error loading history:', error);
    tbody.innerHTML = '<tr><td colspan="4">Error loading history.</td></tr>';
    return;
  }
  if (!history?.length) {
    tbody.innerHTML = '<tr><td colspan="4">No assignment history yet.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  history.forEach(entry => {
    const tr = document.createElement('tr');
    const assignedToName = entry.assigned_to_agent?.full_name || entry.assigned_to;
    const assignedByName = entry.assigned_by_agent?.full_name || entry.assigned_by;
    tr.innerHTML = `
      <td>${entry.assigned_at ? new Date(entry.assigned_at).toLocaleString() : ''}</td>
      <td>${entry.lead_id}</td>
      <td>${assignedToName}</td>
      <td>${assignedByName}</td>
    `;
    tbody.appendChild(tr);
  });
}

let chartWeekly, chartProducts, chartAssignments;
async function loadAgentStats() {
  const isAll = document.getElementById('stat-all-time')?.checked === true;
  const agentId = document.getElementById('stat-agent')?.value || '';
  chartWeekly?.destroy(); chartProducts?.destroy(); chartAssignments?.destroy();
  let start = null, end = null;
  if (!isAll) {
    const dates = statPicker?.selectedDates || [];
    if (dates.length === 2) [start, end] = dates;
    else {
      end = new Date();
      start = new Date(end.getTime() - 30 * 864e5);
    }
  }
  const startISO = start ? start.toISOString() : null;
  const endISO = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).toISOString() : null;

  let q = supabase.from('leads').select('*', { count: 'exact' });
  if (!isAll && startISO && endISO) q = q.gte('created_at', startISO).lte('created_at', endISO);
  if (agentId) q = q.eq('assigned_to', agentId);
  const { data: leads, error } = await q;
  if (error) { console.error('Stats load error:', error); return; }

  const kNew = leads.length;
  const assignedInWindow = leads.filter(l => {
    if (!l.assigned_at) return false;
    if (isAll) return true;
    const t = new Date(l.assigned_at).getTime();
    return t >= start.getTime() && t <= new Date(endISO).getTime();
  });
  const kAssigned = assignedInWindow.length;
  const ages = leads.map(l => Number(l.age)).filter(n => Number.isFinite(n) && n > 0);
  const avgAge = ages.length ? (ages.reduce((a,b)=>a+b,0)/ages.length) : NaN;
  const distinctAgents = new Set(assignedInWindow.map(l => l.assigned_to).filter(Boolean));
  const kAgents = distinctAgents.size;

  document.getElementById('kpi-new').textContent = String(kNew);
  document.getElementById('kpi-assigned').textContent = String(kAssigned);
  document.getElementById('kpi-avg-age').textContent = Number.isFinite(avgAge) ? (Math.round(avgAge * 10) / 10) : '—';
  document.getElementById('kpi-agents').textContent = String(kAgents);

  const baseDen = leads.length;
  const contacted = leads.filter(isContacted).length;
  const quoted    = leads.filter(isQuoted).length;
  const closed    = leads.filter(isClosed).length;
  const contactRate = safeDiv(contacted, baseDen);
  const quoteRate   = safeDiv(quoted, baseDen);
  const closeRate   = safeDiv(closed, baseDen);

  const now = Date.now();
  const persistCandidates = leads.filter(l => {
    if (!isClosed(l)) return false;
    const ia = issuedAt(l); if (!ia) return false;
    if (!isAll && !inRange(ia, start, new Date(endISO))) return false;
    return (now - +ia) >= PERSISTENCY_DAYS * DAY_MS;
  });
  const persistent = persistCandidates.filter(l => {
    const ia = issuedAt(l);
    const canc = l.cancelled_at ? new Date(l.cancelled_at) : null;
    return !canc || (+canc > (+ia + PERSISTENCY_DAYS * DAY_MS));
  });
  const persistency = safeDiv(persistent.length, persistCandidates.length);

  document.getElementById('kpi-contact').textContent     = fmtPct(contactRate);
  document.getElementById('kpi-quote').textContent       = fmtPct(quoteRate);
  document.getElementById('kpi-close').textContent       = fmtPct(closeRate);
  document.getElementById('kpi-persistency').textContent = fmtPct(persistency);

  let timeLabels, timeCounts, chartLineLabel;
  if (isAll) {
    const nowD = new Date();
    const monthStarts = Array.from({ length: 12 }, (_, i) => new Date(nowD.getFullYear(), nowD.getMonth() - (11 - i), 1));
    const monthCounts = new Array(12).fill(0);
    for (const l of leads) {
      const dt = new Date(l.created_at);
      const base = monthStarts[0];
      const diffMonths = (dt.getFullYear() - base.getFullYear()) * 12 + (dt.getMonth() - base.getMonth());
      if (diffMonths >= 0 && diffMonths < 12) monthCounts[diffMonths]++;
    }
    timeLabels = monthStarts.map(d => `${d.toLocaleString('default', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`);
    timeCounts = monthCounts; chartLineLabel = 'Monthly New Leads';
  } else {
    const totalDays = Math.max(1, Math.round((+new Date(endISO) - +start) / 864e5) + 1);
    const useMonthly = totalDays > 120;
    if (useMonthly) {
      const monthStarts = [];
      const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      const last = new Date(end.getFullYear(), end.getMonth(), 1);
      while (cursor <= last) {
        monthStarts.push(new Date(cursor));
        cursor.setMonth(cursor.getMonth() + 1);
      }
      const monthCounts = new Array(monthStarts.length).fill(0);
      for (const l of leads) {
        const dt = new Date(l.created_at);
        const idx = monthStarts.findIndex(m => dt.getFullYear() === m.getFullYear() && dt.getMonth() === m.getMonth());
        if (idx !== -1) monthCounts[idx]++;
      }
      timeLabels = monthStarts.map(d => `${d.toLocaleString('default', { month: 'short' })} ${String(d.getFullYear()).slice(-2)}`);
      timeCounts = monthCounts; chartLineLabel = 'Monthly New Leads';
    } else {
      const weekMs = 7 * 864e5;
      const bucketCount = Math.min(24, Math.max(1, Math.ceil(totalDays / 7)));
      const bucketStarts = Array.from({ length: bucketCount }, (_, i) => new Date(start.getTime() + i * weekMs));
      const weeklyCounts = new Array(bucketCount).fill(0);
      for (const l of leads) {
        const t = new Date(l.created_at).getTime();
        const idx = Math.floor((t - start.getTime()) / weekMs);
        if (idx >= 0 && idx < bucketCount) weeklyCounts[idx]++;
      }
      timeLabels = bucketStarts.map(d => `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`);
      timeCounts = weeklyCounts; chartLineLabel = 'Weekly New Leads';
    }
  }
  const weeklyTitleEl = document.querySelector('#chart-weekly')?.previousElementSibling;
  if (weeklyTitleEl) weeklyTitleEl.textContent = chartLineLabel;

  const productCounts = {};
  for (const l of leads) {
    const key = (l.product_type || 'Unknown').trim() || 'Unknown';
    productCounts[key] = (productCounts[key] || 0) + 1;
  }
  const productLabels = Object.keys(productCounts);
  const productValues = productLabels.map(k => productCounts[k]);

  const nameById = new Map(allAgents.map(a => [a.id, a.full_name]));
  const assigns = {};
  for (const l of assignedInWindow) {
    const id = l.assigned_to || 'Unknown';
    assigns[id] = (assigns[id] || 0) + 1;
  }
  const assignLabels = Object.keys(assigns).map(id => nameById.get(id) || 'Unassigned/Unknown');
  const assignValues = Object.keys(assigns).map(id => assigns[id]);

  const weeklyCtx = document.getElementById('chart-weekly').getContext('2d');
  chartWeekly = new Chart(weeklyCtx, {
    type:'line',
    data:{ labels: timeLabels, datasets:[{ label: chartLineLabel, data: timeCounts, tension:0.3 }] },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }
    }
  });

  const productsCtx = document.getElementById('chart-products').getContext('2d');
  chartProducts = new Chart(productsCtx, {
    type:'doughnut',
    data:{ labels: productLabels, datasets:[{ data: productValues }] },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom' } }
    }
  });

  const assignsCtx = document.getElementById('chart-assignments').getContext('2d');
  chartAssignments = new Chart(assignsCtx, {
    type:'bar',
    data:{ labels: assignLabels, datasets:[{ label:'Assignments', data: assignValues }] },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{ legend:{ display:false } },
      scales:{ y:{ beginAtZero:true, ticks:{ precision:0 } } }
    }
  });
}

// Toggle export UI
function toggleExportVisibility() {
  const anyChecked = document.querySelectorAll('input.lead-checkbox:checked').length > 0;
  document.getElementById('export-controls').style.display = anyChecked ? 'block' : 'none';
}
function getSelectedLeadsData() {
  return Array.from(document.querySelectorAll('input.lead-checkbox:checked')).map(cb => {
    const row = cb.closest('tr');
    return {
      first_name: row.querySelector('.lead-name')?.textContent.trim() || '',
      last_name: row.querySelector('.lead-last')?.textContent.trim() || '',
      age: row.querySelector('.lead-age')?.textContent.trim() || '',
      phone: row.querySelector('.lead-phone')?.textContent.trim() || '',
      leadType: row.querySelector('.lead-type')?.textContent.trim() || '',
      city: row.querySelector('.lead-city')?.textContent.trim() || '',
      state: row.querySelector('.lead-state')?.textContent.trim() || '',
      zip: row.querySelector('.lead-zip')?.textContent.trim() || '',
      address: row.querySelector('.lead-address')?.textContent.trim() || '',
      agent: row.querySelector('.lead-agent')?.textContent.trim() || '',
      submittedAt: row.querySelector('.lead-date')?.textContent.trim() || ''
    };
  });
}
async function assignLeads(agentId) {
  if (!agentId || selectedLeads.size === 0) {
    alert('Please select leads and an agent.');
    return;
  }
  const leadIds = Array.from(selectedLeads);
  const now = new Date().toISOString();
  const { error: updateError } = await supabase.from('leads').update({
    assigned_to: agentId,
    assigned_at: now
  }).in('id', leadIds);
  if (updateError) {
    alert('❌ Failed to assign leads: ' + updateError.message);
    return;
  }
  const { data: sessionData } = await supabase.auth.getSession();
  const currentUserId = sessionData?.session?.user?.id || userId;
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
  document.getElementById('selected-count').textContent = '0';
  await loadLeadsWithFilters();
  await loadAssignmentHistory();
}

/* =========================
   Announcements: List/Delete
   ========================= */
async function loadAnnouncements() {
  const list = document.getElementById('annc-list');
  if (!list) return;

  list.innerHTML = 'Loading…';

  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    list.innerHTML = '<p>Error loading announcements.</p>';
    return;
  }

  if (!data?.length) {
    list.innerHTML = '<p>No announcements yet.</p>';
    return;
  }

  list.innerHTML = data.map(a => {
    const aud = a.audience || {};
    const repeat = aud.repeat || null;

    let repeatText = '';
    if (repeat && repeat.frequency && repeat.frequency !== 'none') {
      const labels = {
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly',
        yearly: 'Yearly'
      };
      const freqLabel = labels[repeat.frequency] || repeat.frequency;
      repeatText = ` · Repeats: ${freqLabel}`;
      if (repeat.until) {
        repeatText += ` until ${new Date(repeat.until).toLocaleDateString()}`;
      }
    }

    return `
      <div class="annc-row" data-id="${a.id}" style="display:grid; grid-template-columns: 64px 1fr auto; gap:12px; align-items:center; padding:10px; border:1px solid #eee; border-radius:8px; margin-bottom:10px;">
        <div class="thumb" style="width:64px; height:64px; background:#f7f7f7; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:6px;">
          ${a.image_url ? `<img src="${a.image_url}" alt="" style="max-width:100%; max-height:100%;">` : `<i class="fa-regular fa-image"></i>`}
        </div>
        <div class="meta" style="min-width:0;">
          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <strong>${a.title || '(no title)'}</strong>
            ${a.link_url ? `<a href="${a.link_url}" target="_blank" rel="noopener" style="font-size:12px;"><i class="fa-solid fa-link"></i> Open link</a>` : ''}
          </div>
          <div style="font-size:12px; color:#666; margin-top:2px;">
            Audience: ${summarizeAudience(a.audience)}
            · Published: ${a.publish_at ? new Date(a.publish_at).toLocaleString() : 'Now'}
            ${a.expires_at ? ` · Expires: ${new Date(a.expires_at).toLocaleString()}` : ''}
            ${repeatText}
          </div>
          <div style="font-size:13px; margin-top:6px; color:#333; white-space:pre-wrap;">
            ${(a.body || '').slice(0, 240)}${a.body && a.body.length > 240 ? '…' : ''}
          </div>
        </div>
        <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
          <button class="annc-copy" title="Copy link JSON" style="padding:6px 10px;">Copy JSON</button>
          <button class="annc-delete" style="padding:6px 10px; background:#ffe6e6; border:1px solid #ffb3b3;">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Copy JSON
  list.querySelectorAll('.annc-copy').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const row = e.target.closest('.annc-row');
      const id = row?.getAttribute('data-id');
      const a = data.find(x => String(x.id) === String(id));
      if (!a) return;
      navigator.clipboard?.writeText(JSON.stringify(a, null, 2));
      btn.textContent = 'Copied!';
      setTimeout(() => btn.textContent = 'Copy JSON', 1200);
    });
  });

  // Delete
  list.querySelectorAll('.annc-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.annc-row');
      const id = row?.getAttribute('data-id');
      if (!id) return;
      if (!confirm('Delete this announcement?')) return;
      const { error: delErr } = await supabase.from('announcements').delete().eq('id', id);
      if (delErr) {
        alert('❌ Failed to delete.');
        console.error(delErr);
        return;
      }
      row.remove();
      if (!document.querySelector('#annc-list .annc-row')) {
        document.getElementById('annc-list').innerHTML = '<p>No announcements yet.</p>';
      }
    });
  });
}
  // === Training list collapse ===
  const trainingPanelEl = document.getElementById('training-manage-panel');
  const trainingToggleEl = document.getElementById('toggle-training-list');
  const trainingSearchEl = document.getElementById('training-search');

  if (trainingPanelEl && trainingToggleEl) {
    trainingToggleEl.addEventListener('click', () => {
      const isHidden = trainingPanelEl.hasAttribute('hidden');
      if (isHidden) {
        trainingPanelEl.removeAttribute('hidden');
        trainingToggleEl.setAttribute('aria-expanded', 'true');
        trainingToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-down', 'fa-chevron-up');
        // When first opened, ensure list is loaded
        loadTrainingMaterials();
      } else {
        trainingPanelEl.setAttribute('hidden', '');
        trainingToggleEl.setAttribute('aria-expanded', 'false');
        trainingToggleEl
          .querySelector('i')
          ?.classList.replace('fa-chevron-up', 'fa-chevron-down');
      }
    });
  }

  // Search within training list
  window._trainingSearchTerm = '';
  if (trainingSearchEl) {
    trainingSearchEl.addEventListener('input', () => {
      window._trainingSearchTerm = trainingSearchEl.value.toLowerCase();
      loadTrainingMaterials();
    });
  }
/* =========================
   Training Materials: List/Delete
   ========================= */
async function loadTrainingMaterials() {
  const listEl = document.getElementById('training-list');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  const { data, error } = await supabase
    .from('training_materials')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading training materials:', error);
    listEl.innerHTML = '<p>Error loading training materials.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No training items yet.</p>';
    return;
  }

  // Apply search filter (title, description, tags)
  const term = (window._trainingSearchTerm || '').trim().toLowerCase();
  const filtered = term
    ? data.filter(item => {
        const tagsText = Array.isArray(item.tags) ? item.tags.join(' ') : '';
        const haystack = [
          item.title || '',
          item.description || '',
          tagsText
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
    : data;

  if (!filtered.length) {
    listEl.innerHTML = '<p>No training items match your search.</p>';
    return;
  }

  listEl.innerHTML = filtered
    .map(item => {
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : '';
      const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';

      return `
        <div class="training-row" data-id="${item.id}"
             style="display:grid; grid-template-columns: 1fr auto; gap:8px; padding:8px 10px; border:1px solid #eee; border-radius:6px; margin-bottom:8px;">
          <div class="meta" style="min-width:0;">
            <strong>${item.title || '(no title)'}</strong>
            <div style="font-size:12px; color:#666; margin-top:2px;">
              ${created ? `Created: ${created}` : ''}
              ${tags ? ` · Tags: ${tags}` : ''}
            </div>
            <div style="font-size:13px; margin-top:4px; color:#333; white-space:pre-wrap;">
              ${(item.description || '').slice(0, 240)}${item.description && item.description.length > 240 ? '…' : ''}
            </div>
            ${
              item.url
                ? `
              <div style="margin-top:4px; font-size:13px;">
                <a href="${item.url}" target="_blank" rel="noopener">
                  <i class="fa-solid fa-link"></i> Open link
                </a>
              </div>`
                : ''
            }
          </div>
          <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
            <button class="train-delete" style="padding:6px 10px; background:#ffe6e6; border:1px solid #ffb3b3;">
              Delete
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire delete buttons
  listEl.querySelectorAll('.train-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.training-row');
      const id = row?.getAttribute('data-id');
      if (!id) return;

      if (!confirm('Delete this training item?')) return;

      const { error: delErr } = await supabase
        .from('training_materials')
        .delete()
        .eq('id', id);

      if (delErr) {
        alert('❌ Failed to delete training item.');
        console.error(delErr);
        return;
      }

      row.remove();
      if (!document.querySelector('#training-list .training-row')) {
        listEl.innerHTML = '<p>No training items yet.</p>';
      }
    });
  });
}
