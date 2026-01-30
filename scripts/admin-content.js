// scripts/admin-content.js
// Content tab extracted into its own page script
// IMPORTANT: use `sb` (window.supabaseClient) instead of `supabase`

let sb = null;
let me = null;
let accessToken = null;

let allAgents = []; // cached list for dropdowns
let anncAgentsChoices = null;
let anncLevelsChoices = null;
let anncProductsChoices = null;
let anncStatesChoices = null;

document.addEventListener('DOMContentLoaded', async () => {
  sb = window.supabaseClient;
  if (!sb) {
    console.warn('Supabase client missing (window.supabaseClient).');
    return;
  }

  // Gate + show page only if admin
  const ok = await gateAdmin();
  if (!ok) return;

  // Basic UI toggles (safe even if general.js also handles it)
  wireMobileMenu();

  // Overlays (data-close)
  wireOverlayClose();

  // Init date pickers (if flatpickr loaded)
  initPickers();

  // Load agents + hydrate dropdowns
  await loadAgentsForAdminLite();
  populateRecruiterSelect();
  populateTaskAgentSelect();
  hydrateAnnouncementAudienceSelects();

  // Wire Content section actions
  wireContentButtons();

  // Initial data (light)
  // (Lists only load when "Manage ..." is expanded)
  await loadWaitlist();

  // Make sure content section is visible on this page
  // (If your admin-content.html already only shows content, this does nothing harmful.)
  showOnlyContentSection();
});

/* =========================
   Admin Gate
========================= */
async function gateAdmin() {
  try {
    const { data: { session } = {} } = await sb.auth.getSession();
    if (!session) {
      location.replace('login.html');
      return false;
    }

    me = session.user;
    accessToken = session.access_token;

    const { data: profile, error } = await sb
      .from('agents')
      .select('is_admin, is_active')
      .eq('id', me.id)
      .maybeSingle();

    if (error) {
      console.error('Admin gate profile error:', error);
      location.replace('dashboard.html');
      return false;
    }

    if (profile?.is_admin === true && profile?.is_active !== false) {
      document.documentElement.style.visibility = 'visible';
      return true;
    }

    location.replace('dashboard.html');
    return false;
  } catch (e) {
    console.error('Admin gate crash:', e);
    location.replace('dashboard.html');
    return false;
  }
}

/* =========================
   UI helpers
========================= */
function wireMobileMenu() {
  const menuToggle = document.getElementById('menu-toggle');
  const mobileMenu = document.getElementById('mobile-menu');

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('open');
      // fallback if your CSS uses display
      if (!mobileMenu.classList.contains('open')) mobileMenu.style.display = '';
      else mobileMenu.style.display = 'block';
    });
  }

  const toolkitToggle = document.getElementById('toolkit-toggle');
  const toolkitSub = document.getElementById('toolkit-submenu');
  if (toolkitToggle && toolkitSub) {
    toolkitToggle.addEventListener('click', () => {
      const expanded = toolkitToggle.getAttribute('aria-expanded') === 'true';
      toolkitToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      toolkitSub.hidden = expanded;
    });
  }
}

function wireOverlayClose() {
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => {
      const overlay = el.closest('.overlay');
      if (overlay) closeOverlay(overlay);
      const modalBackdrop = el.closest('.modal-backdrop');
      if (modalBackdrop) modalBackdrop.style.display = 'none';
    });
  });

  // ESC closes any open overlay
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.overlay[aria-hidden="false"]').forEach(o => closeOverlay(o));
  });
}

function openOverlay(overlayEl) {
  if (!overlayEl) return;
  overlayEl.setAttribute('aria-hidden', 'false');
}

function closeOverlay(overlayEl) {
  if (!overlayEl) return;
  overlayEl.setAttribute('aria-hidden', 'true');
}

function initPickers() {
  if (typeof flatpickr !== 'function') return;

  const publishEl = document.getElementById('annc-publish');
  const expiresEl = document.getElementById('annc-expires');
  const repeatEndEl = document.getElementById('annc-repeat-end');
  const taskDueEl = document.getElementById('task-due');

  const opts = { enableTime: true, dateFormat: 'Y-m-d H:i', time_24hr: false };

  if (publishEl) flatpickr(publishEl, opts);
  if (expiresEl) flatpickr(expiresEl, opts);
  if (repeatEndEl) flatpickr(repeatEndEl, opts);
  if (taskDueEl) flatpickr(taskDueEl, opts);
}

function showOnlyContentSection() {
  const content = document.getElementById('admin-content-section');
  if (content) content.style.display = '';

  // If this page still includes other admin sections (copied markup),
  // we hide them here for safety.
  [
    'admin-all-section',
    'admin-requests-section',
    'admin-history-section',
    'admin-stats-section',
    'admin-commissions-section'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
}

/* =========================
   Agents (for dropdowns)
========================= */
async function loadAgentsForAdminLite() {
  let data = null;

  const { data: dataPrimary, error } = await sb
    .from('agents')
    .select('id, full_name, first_name, last_name, level, product_types, is_admin, is_active')
    .eq('is_active', true)
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Error loading agents (primary):', error);
    const { data: dataFallback, error: err2 } = await sb
      .from('agents')
      .select('id, full_name')
      .eq('is_active', true);

    if (err2) {
      console.error('Error loading agents (fallback):', err2);
      allAgents = [];
      return;
    }
    data = dataFallback;
  } else {
    data = dataPrimary;
  }

  allAgents = (data || []).map(a => {
    const full = a.full_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.id;
    let product_types = a.product_types;

    if (product_types) {
      if (Array.isArray(product_types)) {
        // ok
      } else if (typeof product_types === 'string') {
        product_types = product_types.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        product_types = null;
      }
    }

    return { ...a, full_name: full, product_types };
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

function populateTaskAgentSelect() {
  const sel = document.getElementById('task-agent');
  if (!sel) return;

  sel.innerHTML = '<option value="">Select agent…</option>';
  (allAgents || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.full_name || a.id;
    sel.appendChild(opt);
  });
}

/* =========================
   Content: buttons + forms
========================= */
function wireContentButtons() {
  // Open modals
  const openAnnc = document.getElementById('open-annc-modal');
  const openTrain = document.getElementById('open-train-modal');
  const openMkt = document.getElementById('open-mkt-modal');
  const openTask = document.getElementById('open-task-modal');
  const openAgent = document.getElementById('open-agent-modal');
  const openRemove = document.getElementById('open-remove-agent-modal');

  openAnnc?.addEventListener('click', () => openOverlay(document.getElementById('annc-modal')));
  openTrain?.addEventListener('click', () => openOverlay(document.getElementById('train-modal')));
  openMkt?.addEventListener('click', () => openOverlay(document.getElementById('mkt-modal')));
  openTask?.addEventListener('click', () => openOverlay(document.getElementById('task-modal')));
  openAgent?.addEventListener('click', () => openOverlay(document.getElementById('agent-modal')));
  openRemove?.addEventListener('click', () => openOverlay(document.getElementById('remove-agent-modal')));

  // Expand manage lists
  wireExpandableList({
    toggleId: 'toggle-annc-list',
    panelId: 'annc-list',
    onOpen: loadAnnouncements
  });

  wireExpandableList({
    toggleId: 'toggle-training-list',
    panelId: 'training-manage-panel',
    onOpen: loadTrainingMaterials
  });

  wireExpandableList({
    toggleId: 'toggle-mkt-list',
    panelId: 'mkt-manage-panel',
    onOpen: loadMarketingAssets
  });

  wireExpandableList({
    toggleId: 'toggle-task-list',
    panelId: 'task-list-panel',
    onOpen: loadMyTasks
  });

  // Search boxes (filter UI only; still loads from DB each time for now)
  const trainingSearch = document.getElementById('training-search');
  trainingSearch?.addEventListener('input', () => loadTrainingMaterials());

  const mktSearch = document.getElementById('mkt-search');
  mktSearch?.addEventListener('input', () => loadMarketingAssets());

  // Announcement audience dynamic fields
  const anncScope = document.getElementById('annc-scope');
  anncScope?.addEventListener('change', updateAnnouncementScopeUI);

  // Forms
  wireAnnouncementForm();
  wireTrainingForm();
  wireMarketingForm();
  wireTaskForm();
  wireAgentForm();
  wireRemoveAgentFlow();
}

function wireExpandableList({ toggleId, panelId, onOpen }) {
  const toggle = document.getElementById(toggleId);
  const panel = document.getElementById(panelId);
  if (!toggle || !panel) return;

  toggle.addEventListener('click', async () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');

    // Support both [hidden] and style-based panels
    if ('hidden' in panel) panel.hidden = expanded;
    panel.style.display = expanded ? 'none' : '';

    if (!expanded && typeof onOpen === 'function') {
      await onOpen();
    }
  });

  // Initialize closed state
  if ('hidden' in panel) panel.hidden = true;
  panel.style.display = 'none';
}

/* =========================
   Announcements
========================= */
function hydrateAnnouncementAudienceSelects() {
  // Build multi-select options from cached agents
  const levelsSel = document.getElementById('annc-levels');
  const productsSel = document.getElementById('annc-products');
  const agentsSel = document.getElementById('annc-agent-ids');

  if (levelsSel) {
    levelsSel.innerHTML = '';
    ['agent', 'mit', 'manager', 'mga', 'area_manager'].forEach(l => {
      const o = document.createElement('option');
      o.value = l;
      o.textContent = l;
      levelsSel.appendChild(o);
    });
  }

  if (productsSel) {
    productsSel.innerHTML = '';
    ['Life', 'Health', 'P&C', 'Legal', 'Realty'].forEach(p => {
      const o = document.createElement('option');
      o.value = p;
      o.textContent = p;
      productsSel.appendChild(o);
    });
  }

  if (agentsSel) {
    agentsSel.innerHTML = '';
    (allAgents || []).forEach(a => {
      const o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.full_name || a.id;
      agentsSel.appendChild(o);
    });
  }

  // Choices.js on multiselects
  if (window.Choices) {
    try {
      if (levelsSel) anncLevelsChoices = new Choices(levelsSel, { removeItemButton: true, shouldSort: false });
      if (productsSel) anncProductsChoices = new Choices(productsSel, { removeItemButton: true, shouldSort: false });
      if (agentsSel) anncAgentsChoices = new Choices(agentsSel, { removeItemButton: true, shouldSort: false, searchEnabled: true });
      const statesSel = document.getElementById('annc-states');
      if (statesSel) anncStatesChoices = new Choices(statesSel, { removeItemButton: true, shouldSort: false, searchEnabled: true });
    } catch (e) {
      console.warn('Choices init failed:', e);
    }
  }

  updateAnnouncementScopeUI(); // set correct visibility
}

function updateAnnouncementScopeUI() {
  const scope = document.getElementById('annc-scope')?.value || 'all';
  const show = (id, on) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = on ? '' : 'none';
  };

  show('annc-levels-wrap', scope === 'by_level');
  show('annc-products-wrap', scope === 'by_product' || scope === 'by_product_state');
  show('annc-states-wrap', scope === 'by_state' || scope === 'by_product_state');
  show('annc-agents-wrap', scope === 'custom_agents');
}

function wireAnnouncementForm() {
  const form = document.getElementById('annc-form');
  const msg = document.getElementById('annc-msg');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = 'Saving...';

    try {
      const title = document.getElementById('annc-title')?.value.trim();
      const body = document.getElementById('annc-body')?.value.trim();
      const link_url = document.getElementById('annc-link')?.value.trim() || null;

      const scope = document.getElementById('annc-scope')?.value || 'all';
      const publish_at = parseMaybeDate(document.getElementById('annc-publish')?.value);
      const expires_at = parseMaybeDate(document.getElementById('annc-expires')?.value);
      const repeat = document.getElementById('annc-repeat')?.value || 'none';
      const repeat_until = parseMaybeDate(document.getElementById('annc-repeat-end')?.value);

      // audience payload
      const audience = { scope };

      if (scope === 'by_level') {
        audience.levels = getMultiSelectValues('annc-levels');
      } else if (scope === 'by_product') {
        audience.products = getMultiSelectValues('annc-products');
      } else if (scope === 'by_state') {
        audience.states = getMultiSelectValues('annc-states');
      } else if (scope === 'by_product_state') {
        audience.products = getMultiSelectValues('annc-products');
        audience.states = getMultiSelectValues('annc-states');
      } else if (scope === 'custom_agents') {
        audience.agent_ids = getMultiSelectValues('annc-agent-ids');
      }

      // optional image upload
      const fileInput = document.getElementById('annc-image');
      let image_url = null;
      if (fileInput?.files?.[0]) {
        image_url = await uploadToStorage({
          bucket: 'announcements',
          file: fileInput.files[0],
          prefix: 'annc',
        });
      }

      const payload = {
        title,
        body,
        link_url,
        image_url,
        audience,
        publish_at,
        expires_at,
        repeat,
        repeat_until,
        created_by: me.id
      };

      const { error } = await sb.from('announcements').insert(payload);
      if (error) throw error;

      form.reset();
      // reset choices selections
      try {
        anncLevelsChoices?.removeActiveItems();
        anncProductsChoices?.removeActiveItems();
        anncStatesChoices?.removeActiveItems();
        anncAgentsChoices?.removeActiveItems();
      } catch {}

      if (msg) msg.textContent = 'Saved ✅';
      closeOverlay(document.getElementById('annc-modal'));

      // refresh list if open
      const list = document.getElementById('annc-list');
      const toggle = document.getElementById('toggle-annc-list');
      if (list && toggle?.getAttribute('aria-expanded') === 'true') {
        await loadAnnouncements();
      }
    } catch (err) {
      console.error('Announcement save error:', err);
      if (msg) msg.textContent = `Error: ${err?.message || 'Failed to save'}`;
    }
  });
}

async function loadAnnouncements() {
  const list = document.getElementById('annc-list');
  if (!list) return;

  list.innerHTML = '<p style="font-size:13px; color:#666;">Loading…</p>';

  const { data, error } = await sb
    .from('announcements')
    .select('id, title, body, link_url, image_url, publish_at, expires_at, repeat, repeat_until, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('loadAnnouncements error:', error);
    list.innerHTML = '<p style="font-size:13px; color:#c00;">Error loading announcements.</p>';
    return;
  }

  if (!data?.length) {
    list.innerHTML = '<p style="font-size:13px; color:#666;">No announcements yet.</p>';
    return;
  }

  list.innerHTML = '';
  data.forEach(a => {
    const row = document.createElement('div');
    row.style.border = '1px solid #eee';
    row.style.borderRadius = '10px';
    row.style.padding = '10px';
    row.style.marginBottom = '8px';

    const when = a.publish_at ? `Publishes: ${formatDate(a.publish_at)}` : 'Publishes: now';
    const exp = a.expires_at ? ` • Expires: ${formatDate(a.expires_at)}` : '';
    const rep = a.repeat && a.repeat !== 'none' ? ` • Repeats: ${a.repeat}` : '';

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <strong style="font-size:14px;">${escapeHtml(a.title || '(untitled)')}</strong>
        <button data-del="${a.id}" type="button" style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:4px 8px; cursor:pointer;">
          Delete
        </button>
      </div>
      <div style="font-size:12px; color:#666; margin-top:4px;">${when}${exp}${rep}</div>
      <div style="font-size:13px; margin-top:6px; white-space:pre-wrap;">${escapeHtml(a.body || '')}</div>
      ${
        a.link_url
          ? `<div style="margin-top:6px; font-size:12px;"><a href="${escapeAttr(a.link_url)}" target="_blank" rel="noopener">Open link</a></div>`
          : ''
      }
      ${
        a.image_url
          ? `<div style="margin-top:8px;"><img src="${escapeAttr(a.image_url)}" alt="Announcement image" style="max-width:100%; border-radius:10px;"></div>`
          : ''
      }
    `;

    row.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Delete this announcement?')) return;
      const { error: delErr } = await sb.from('announcements').delete().eq('id', a.id);
      if (delErr) {
        alert('Failed to delete.');
        console.error(delErr);
        return;
      }
      await loadAnnouncements();
    });

    list.appendChild(row);
  });
}

/* =========================
   Training
========================= */
function wireTrainingForm() {
  const form = document.getElementById('train-form');
  const msg = document.getElementById('train-msg');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = 'Publishing...';

    try {
      const title = document.getElementById('train-title')?.value.trim();
      const description = document.getElementById('train-desc')?.value.trim() || null;
      const url = document.getElementById('train-url')?.value.trim() || null;
      const tags = parseTags(document.getElementById('train-tags')?.value);

      const payload = {
        title,
        description,
        url,
        tags,
        created_by: me.id
      };

      const { error } = await sb.from('training_library').insert(payload);
      if (error) throw error;

      form.reset();
      if (msg) msg.textContent = 'Published ✅';
      closeOverlay(document.getElementById('train-modal'));

      const toggle = document.getElementById('toggle-training-list');
      if (toggle?.getAttribute('aria-expanded') === 'true') {
        await loadTrainingMaterials();
      }
    } catch (err) {
      console.error('Training publish error:', err);
      if (msg) msg.textContent = `Error: ${err?.message || 'Failed to publish'}`;
    }
  });
}

async function loadTrainingMaterials() {
  const list = document.getElementById('training-list');
  if (!list) return;

  const q = (document.getElementById('training-search')?.value || '').trim().toLowerCase();
  list.innerHTML = '<p style="font-size:13px; color:#666;">Loading…</p>';

  const { data, error } = await sb
    .from('training_library')
    .select('id, title, description, url, tags, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('loadTrainingMaterials error:', error);
    list.innerHTML = '<p style="font-size:13px; color:#c00;">Error loading training.</p>';
    return;
  }

  let rows = data || [];
  if (q) {
    rows = rows.filter(r => {
      const t = (r.title || '').toLowerCase();
      const d = (r.description || '').toLowerCase();
      const tags = (Array.isArray(r.tags) ? r.tags.join(',') : (r.tags || '')).toLowerCase();
      return t.includes(q) || d.includes(q) || tags.includes(q);
    });
  }

  if (!rows.length) {
    list.innerHTML = '<p style="font-size:13px; color:#666;">No training items found.</p>';
    return;
  }

  list.innerHTML = '';
  rows.forEach(item => {
    const card = document.createElement('div');
    card.style.border = '1px solid #eee';
    card.style.borderRadius = '10px';
    card.style.padding = '10px';
    card.style.marginBottom = '8px';

    const tags = Array.isArray(item.tags) ? item.tags : parseTags(item.tags);

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <strong style="font-size:14px;">${escapeHtml(item.title || '(untitled)')}</strong>
        <button data-del="${item.id}" type="button" style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:4px 8px; cursor:pointer;">
          Delete
        </button>
      </div>
      ${
        item.description
          ? `<div style="font-size:13px; margin-top:6px; white-space:pre-wrap;">${escapeHtml(item.description)}</div>`
          : ''
      }
      ${
        item.url
          ? `<div style="margin-top:6px; font-size:12px;"><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Open link</a></div>`
          : ''
      }
      ${
        tags?.length
          ? `<div style="margin-top:6px; font-size:12px; color:#666;">Tags: ${escapeHtml(tags.join(', '))}</div>`
          : ''
      }
    `;

    card.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Delete this training item?')) return;
      const { error: delErr } = await sb.from('training_library').delete().eq('id', item.id);
      if (delErr) {
        alert('Failed to delete.');
        console.error(delErr);
        return;
      }
      await loadTrainingMaterials();
    });

    list.appendChild(card);
  });
}

/* =========================
   Marketing
========================= */
function wireMarketingForm() {
  const form = document.getElementById('mkt-form');
  const msg = document.getElementById('mkt-msg');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = 'Publishing...';

    try {
      const title = document.getElementById('mkt-title')?.value.trim();
      const description = document.getElementById('mkt-desc')?.value.trim() || null;
      const url = document.getElementById('mkt-url')?.value.trim() || null;
      const tags = parseTags(document.getElementById('mkt-tags')?.value);

      const payload = {
        title,
        description,
        url,
        tags,
        created_by: me.id
      };

      const { error } = await sb.from('marketing_library').insert(payload);
      if (error) throw error;

      form.reset();
      if (msg) msg.textContent = 'Published ✅';
      closeOverlay(document.getElementById('mkt-modal'));

      const toggle = document.getElementById('toggle-mkt-list');
      if (toggle?.getAttribute('aria-expanded') === 'true') {
        await loadMarketingAssets();
      }
    } catch (err) {
      console.error('Marketing publish error:', err);
      if (msg) msg.textContent = `Error: ${err?.message || 'Failed to publish'}`;
    }
  });
}

async function loadMarketingAssets() {
  const list = document.getElementById('mkt-list');
  if (!list) return;

  const q = (document.getElementById('mkt-search')?.value || '').trim().toLowerCase();
  list.innerHTML = '<p style="font-size:13px; color:#666;">Loading…</p>';

  const { data, error } = await sb
    .from('marketing_library')
    .select('id, title, description, url, tags, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('loadMarketingAssets error:', error);
    list.innerHTML = '<p style="font-size:13px; color:#c00;">Error loading marketing assets.</p>';
    return;
  }

  let rows = data || [];
  if (q) {
    rows = rows.filter(r => {
      const t = (r.title || '').toLowerCase();
      const d = (r.description || '').toLowerCase();
      const tags = (Array.isArray(r.tags) ? r.tags.join(',') : (r.tags || '')).toLowerCase();
      return t.includes(q) || d.includes(q) || tags.includes(q);
    });
  }

  if (!rows.length) {
    list.innerHTML = '<p style="font-size:13px; color:#666;">No marketing assets found.</p>';
    return;
  }

  list.innerHTML = '';
  rows.forEach(item => {
    const card = document.createElement('div');
    card.style.border = '1px solid #eee';
    card.style.borderRadius = '10px';
    card.style.padding = '10px';
    card.style.marginBottom = '8px';

    const tags = Array.isArray(item.tags) ? item.tags : parseTags(item.tags);

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <strong style="font-size:14px;">${escapeHtml(item.title || '(untitled)')}</strong>
        <button data-del="${item.id}" type="button" style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:4px 8px; cursor:pointer;">
          Delete
        </button>
      </div>
      ${
        item.description
          ? `<div style="font-size:13px; margin-top:6px; white-space:pre-wrap;">${escapeHtml(item.description)}</div>`
          : ''
      }
      ${
        item.url
          ? `<div style="margin-top:6px; font-size:12px;"><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Open link</a></div>`
          : ''
      }
      ${
        tags?.length
          ? `<div style="margin-top:6px; font-size:12px; color:#666;">Tags: ${escapeHtml(tags.join(', '))}</div>`
          : ''
      }
    `;

    card.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Delete this marketing asset?')) return;
      const { error: delErr } = await sb.from('marketing_library').delete().eq('id', item.id);
      if (delErr) {
        alert('Failed to delete.');
        console.error(delErr);
        return;
      }
      await loadMarketingAssets();
    });

    list.appendChild(card);
  });
}

/* =========================
   Tasks
========================= */
function wireTaskForm() {
  const form = document.getElementById('admin-task-form');
  const msg = document.getElementById('task-msg');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = 'Saving...';

    try {
      const assigned_to = document.getElementById('task-agent')?.value;
      const title = document.getElementById('task-title')?.value.trim();
      const body = document.getElementById('task-body')?.value.trim() || null;
      const link_url = document.getElementById('task-link')?.value.trim() || null;
      const due_at = parseMaybeDate(document.getElementById('task-due')?.value);

      if (!assigned_to) throw new Error('Select an agent.');
      if (!title) throw new Error('Task title is required.');

      let image_url = null;
      const fileInput = document.getElementById('task-image');
      if (fileInput?.files?.[0]) {
        image_url = await uploadToStorage({
          bucket: 'tasks',
          file: fileInput.files[0],
          prefix: 'task',
        });
      }

      const payload = {
        assigned_to,
        title,
        body,
        link_url,
        image_url,
        due_at,
        created_by: me.id,
        status: 'open'
      };

      const { error } = await sb.from('tasks').insert(payload);
      if (error) throw error;

      form.reset();
      if (msg) msg.textContent = 'Saved ✅';
      closeOverlay(document.getElementById('task-modal'));

      const toggle = document.getElementById('toggle-task-list');
      if (toggle?.getAttribute('aria-expanded') === 'true') {
        await loadMyTasks();
      }
    } catch (err) {
      console.error('Task save error:', err);
      if (msg) msg.textContent = `Error: ${err?.message || 'Failed to save'}`;
    }
  });
}

async function loadMyTasks() {
  const list = document.getElementById('task-list');
  if (!list) return;

  list.innerHTML = '<p style="font-size:13px; color:#666;">Loading…</p>';

  const { data, error } = await sb
    .from('tasks')
    .select('id, title, body, link_url, image_url, due_at, status, assigned_to, created_at')
    .eq('created_by', me.id)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('loadMyTasks error:', error);
    list.innerHTML = '<p style="font-size:13px; color:#c00;">Error loading tasks.</p>';
    return;
  }

  if (!data?.length) {
    list.innerHTML = '<p style="font-size:13px; color:#666;">No tasks sent yet.</p>';
    return;
  }

  list.innerHTML = '';
  data.forEach(t => {
    const agentName = allAgents.find(a => a.id === t.assigned_to)?.full_name || t.assigned_to;

    const card = document.createElement('div');
    card.style.border = '1px solid #eee';
    card.style.borderRadius = '10px';
    card.style.padding = '10px';
    card.style.marginBottom = '8px';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <strong style="font-size:14px;">${escapeHtml(t.title || '(untitled)')}</strong>
        <button data-del="${t.id}" type="button" style="background:#fff; border:1px solid #ddd; border-radius:8px; padding:4px 8px; cursor:pointer;">
          Delete
        </button>
      </div>
      <div style="font-size:12px; color:#666; margin-top:4px;">
        To: ${escapeHtml(agentName)} • ${t.due_at ? `Due: ${formatDate(t.due_at)}` : 'No due date'} • Status: ${escapeHtml(t.status || 'open')}
      </div>
      ${
        t.body
          ? `<div style="font-size:13px; margin-top:6px; white-space:pre-wrap;">${escapeHtml(t.body)}</div>`
          : ''
      }
      ${
        t.link_url
          ? `<div style="margin-top:6px; font-size:12px;"><a href="${escapeAttr(t.link_url)}" target="_blank" rel="noopener">Open link</a></div>`
          : ''
      }
      ${
        t.image_url
          ? `<div style="margin-top:8px;"><img src="${escapeAttr(t.image_url)}" alt="Task image" style="max-width:100%; border-radius:10px;"></div>`
          : ''
      }
    `;

    card.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Delete this task?')) return;
      const { error: delErr } = await sb.from('tasks').delete().eq('id', t.id);
      if (delErr) {
        alert('Failed to delete.');
        console.error(delErr);
        return;
      }
      await loadMyTasks();
    });

    list.appendChild(card);
  });
}

/* =========================
   Pre-approve agent + Waitlist
========================= */
function wireAgentForm() {
  const form = document.getElementById('agent-form');
  const msg = document.getElementById('agent-msg');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (msg) msg.textContent = 'Pre-approving...';

    try {
      const agentId = (document.getElementById('agent-id')?.value || '').trim();
      const first = (document.getElementById('agent-first-name')?.value || '').trim();
      const last = (document.getElementById('agent-last-name')?.value || '').trim();
      const phone = (document.getElementById('agent-phone')?.value || '').trim();
      const email = (document.getElementById('agent-email')?.value || '').trim();
      const recruiterId = document.getElementById('agent-recruiter')?.value || '';
      const level = document.getElementById('agent-level')?.value || '';

      if (!agentId || !first || !last || !phone || !email || !recruiterId || !level) {
        throw new Error('Please complete all fields.');
      }

      // This matches the flow you already use: create onboarding record (recruits)
      const { error } = await sb.from('recruits').insert({
        npn: agentId,
        first_name: first,
        last_name: last,
        phone,
        email,
        recruiter_id: recruiterId,
        level,
        stage: 'waiting_review',
        created_by: me.id
      });

      if (error) throw error;

      form.reset();
      if (msg) msg.textContent = 'Added to waitlist ✅';

      closeOverlay(document.getElementById('agent-modal'));
      await loadWaitlist();
    } catch (err) {
      console.error('Pre-approve error:', err);
      if (msg) msg.textContent = `Error: ${err?.message || 'Failed'}`;
    }
  });
}

async function loadWaitlist() {
  const container = document.getElementById('waitlist-container');
  if (!container) return;

  container.innerHTML = '<p style="font-size:13px; color:#666;">Loading…</p>';

  const { data, error } = await sb
    .from('recruits')
    .select('id, npn, first_name, last_name, email, phone, recruiter_id, level, stage, created_at')
    .eq('stage', 'waiting_review')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('loadWaitlist error:', error);
    container.innerHTML = '<p style="font-size:13px; color:#c00;">Error loading waitlist.</p>';
    return;
  }

  if (!data?.length) {
    container.innerHTML = '<p style="font-size:13px; color:#666;">No one is waiting for review.</p>';
    return;
  }

  container.innerHTML = '';
  data.forEach(r => {
    const recruiterName = allAgents.find(a => a.id === r.recruiter_id)?.full_name || r.recruiter_id;

    const row = document.createElement('div');
    row.style.border = '1px solid #eee';
    row.style.borderRadius = '10px';
    row.style.padding = '10px';
    row.style.marginBottom = '8px';

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:10px;">
        <strong style="font-size:14px;">${escapeHtml((r.first_name || '') + ' ' + (r.last_name || ''))}</strong>
        <span style="font-size:12px; color:#666;">${escapeHtml(r.level || '')}</span>
      </div>
      <div style="font-size:12px; color:#666; margin-top:4px;">
        NPN: ${escapeHtml(r.npn || '')} • Recruiter: ${escapeHtml(recruiterName || '')}
      </div>
      <div style="font-size:12px; margin-top:6px;">
        <div>Email: ${escapeHtml(r.email || '')}</div>
        <div>Phone: ${escapeHtml(r.phone || '')}</div>
      </div>
    `;

    container.appendChild(row);
  });
}

/* =========================
   Remove agent flow
========================= */
function wireRemoveAgentFlow() {
  const searchBtn = document.getElementById('remove-agent-search-btn');
  const searchInput = document.getElementById('remove-agent-search');
  const results = document.getElementById('remove-agent-results');
  const msg = document.getElementById('remove-agent-msg');

  if (!searchBtn || !searchInput || !results) return;

  searchBtn.addEventListener('click', async () => {
    const term = (searchInput.value || '').trim().toLowerCase();
    results.innerHTML = '';
    if (msg) msg.textContent = '';

    if (!term) {
      if (msg) msg.textContent = 'Enter an NPN or a name.';
      return;
    }

    // Search active agents
    const { data, error } = await sb
      .from('agents')
      .select('id, full_name, first_name, last_name, npn')
      .or(`npn.ilike.%${term}%,full_name.ilike.%${term}%,first_name.ilike.%${term}%,last_name.ilike.%${term}%`)
      .limit(25);

    if (error) {
      console.error('Remove agent search error:', error);
      if (msg) msg.textContent = 'Search failed.';
      return;
    }

    if (!data?.length) {
      if (msg) msg.textContent = 'No matches found.';
      return;
    }

    data.forEach(a => {
      const row = document.createElement('div');
      row.style.border = '1px solid #eee';
      row.style.borderRadius = '10px';
      row.style.padding = '10px';
      row.style.marginBottom = '8px';

      const name = a.full_name || `${a.first_name || ''} ${a.last_name || ''}`.trim() || a.id;

      row.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px; align-items:center;">
          <div>
            <div style="font-weight:700;">${escapeHtml(name)}</div>
            <div style="font-size:12px; color:#666;">NPN: ${escapeHtml(a.npn || '(none)')}</div>
          </div>
          <button type="button" data-remove="${a.id}" style="background:#fff; border:1px solid #c00; color:#c00; border-radius:8px; padding:6px 10px; cursor:pointer;">
            Remove
          </button>
        </div>
      `;

      row.querySelector('[data-remove]')?.addEventListener('click', async () => {
        const ok = confirm(
          'This will permanently remove the agent (including auth account and records). Continue?'
        );
        if (!ok) return;

        try {
          if (msg) msg.textContent = 'Removing...';

          const resp = await fetch('/.netlify/functions/removeAgent', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken || ''}`
            },
            body: JSON.stringify({ agent_id: a.id })
          });

          const json = await resp.json().catch(() => ({}));
          if (!resp.ok) {
            throw new Error(json?.error || 'Remove failed');
          }

          if (msg) msg.textContent = 'Removed ✅';
          // Refresh search results
          searchBtn.click();
        } catch (err) {
          console.error('Remove agent error:', err);
          if (msg) msg.textContent = `Error: ${err?.message || 'Remove failed'}`;
        }
      });

      results.appendChild(row);
    });
  });
}

/* =========================
   Storage helper
========================= */
async function uploadToStorage({ bucket, file, prefix }) {
  if (!file) return null;
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'png';
  const path = `${prefix}/${me.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;

  const { error: upErr } = await sb.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: false
  });
  if (upErr) throw upErr;

  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

/* =========================
   Tiny utils
========================= */
function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return String(raw)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseMaybeDate(str) {
  const v = (str || '').trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return String(iso || '');
  }
}

function getMultiSelectValues(id) {
  const el = document.getElementById(id);
  if (!el) return [];
  return Array.from(el.selectedOptions || []).map(o => o.value).filter(Boolean);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#096;');
}
