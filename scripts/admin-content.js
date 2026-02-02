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

 function openOverlay(id){
    const el = document.getElementById(id);
    if (!el) return;
  
    // Force it visible even if CSS has display:none
    el.style.display = 'flex';
    el.style.position = 'fixed';
    el.style.inset = '0';
    el.style.zIndex = '999999';
  
    el.classList.add('open');
    el.setAttribute('aria-hidden','false');
  
    // Lock scroll (both html + body for iOS)
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  
  function closeOverlay(el){
    if (!el) return;
  
    el.classList.remove('open');
    el.setAttribute('aria-hidden','true');
  
    // Hide it even if CSS forgets
    el.style.display = 'none';
  
    // Restore scroll
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
  }
  document.querySelectorAll('.overlay [data-close], .overlay .overlay-backdrop').forEach(btn=>{
    btn.addEventListener('click', (e)=> {
      const wrap = e.target.closest('.overlay');
      if (wrap) closeOverlay(wrap);
    });
  });

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

  openAnnc?.addEventListener('click', () => openOverlay('annc-modal'));
  openTrain?.addEventListener('click', () => openOverlay('train-modal'));
  openMkt?.addEventListener('click', () => openOverlay('mkt-modal'));
  openTask?.addEventListener('click', () => openOverlay('task-modal'));
  openAgent?.addEventListener('click', () => openOverlay('agent-modal'));
  openRemove?.addEventListener('click', () => openOverlay('remove-agent-modal'));

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
        link_url,              // ✅ already null-safe
        image_url,
        created_by: me?.id || null,
        audience,
        publish_at,            // ✅ already ISO or null
        expires_at,            // ✅ already ISO or null
        is_active: true
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

  list.innerHTML = 'Loading…';

  const { data, error } = await sb
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
      const { error: delErr } = await sb.from('announcements').delete().eq('id', id);
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
        created_by: me.id,
        is_published: true
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
  const listEl = document.getElementById('training-list');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  const { data, error } = await sb
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

      const { error: delErr } = await sb
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
        description: description || null,
        url: url || null,
        file_url: null,
        tags,
        created_by: me.id,
        is_published: true
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
  const listEl = document.getElementById('mkt-list');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  const { data, error } = await sb
    .from('marketing_assets')
    .select('*')
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading marketing assets:', error);
    listEl.innerHTML = '<p>Error loading marketing assets.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No marketing assets yet.</p>';
    return;
  }

  // Apply search filter (title, description, tags)
  const term = (window._marketingSearchTerm || '').trim().toLowerCase();
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
    listEl.innerHTML = '<p>No marketing assets match your search.</p>';
    return;
  }

  listEl.innerHTML = filtered
    .map(item => {
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : '';
      const tags = Array.isArray(item.tags) ? item.tags.join(', ') : '';
      const linkUrl = item.url || item.file_url || null;

      let linkHtml = '';
      if (linkUrl) {
        linkHtml = `
          <div style="margin-top:4px; font-size:13px;">
            <a href="${linkUrl}" target="_blank" rel="noopener">
              <i class="fa-solid fa-link"></i> Open asset
            </a>
          </div>
        `;
      }

      return `
        <div class="mkt-row" data-id="${item.id}"
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
            ${linkHtml}
          </div>
          <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
            <button class="mkt-delete"
                    style="padding:6px 10px; background:#ffe6e6; border:1px solid #ffb3b3;">
              Delete
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire delete buttons
  listEl.querySelectorAll('.mkt-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.mkt-row');
      const id = row?.getAttribute('data-id');
      if (!id) return;

      if (!confirm('Delete this marketing asset?')) return;

      const { error: delErr } = await sb
        .from('marketing_assets')
        .delete()
        .eq('id', id);

      if (delErr) {
        alert('❌ Failed to delete marketing asset.');
        console.error(delErr);
        return;
      }

      row.remove();
      if (!document.querySelector('#mkt-list .mkt-row')) {
        listEl.innerHTML = '<p>No marketing assets yet.</p>';
      }
    });
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
        status: 'open',
        due_at: dueAt,
        metadata
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
  const listEl = document.getElementById('task-list');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  // Only tasks created from the admin panel by this admin
  const { data, error } = await sb
    .from('tasks')
    .select('*')
    .contains('metadata', {
      created_by: me.id,
      source: 'admin_panel'
    })
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading tasks:', error);
    listEl.innerHTML = '<p>Error loading tasks.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No tasks sent yet.</p>';
    return;
  }

  // Map agent id → name
  const nameById = new Map((allAgents || []).map(a => [a.id, a.full_name]));

  listEl.innerHTML = data
    .map(task => {
      const meta = task.metadata || {};
      const agentName = nameById.get(task.assigned_to) || 'Unknown agent';
      const status = (task.status || 'open').toLowerCase();
      const dueText = task.due_at
        ? new Date(task.due_at).toLocaleString()
        : 'No due date';

      const notes = (meta.notes || '').toString();
      const shortNotes =
        notes.length > 200 ? notes.slice(0, 200) + '…' : notes;

      const linkUrl = meta.link_url || null;

      return `
        <div class="task-row"
             data-id="${task.id}"
             style="display:grid; grid-template-columns: 64px 1fr auto; gap:8px; padding:8px 10px; border:1px solid #eee; border-radius:6px; margin-bottom:8px; font-size:13px;">
      
          <div class="thumb"
               style="width:64px; height:64px; background:#f7f7f7; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:6px;">
            ${
              meta.image_url
                ? `<img src="${meta.image_url}" style="max-width:100%; max-height:100%;">`
                : `<i class="fa-regular fa-image"></i>`
            }
          </div>
      
          <div class="meta" style="min-width:0;">
            <strong>${task.title || '(no title)'}</strong>
            <div style="font-size:12px; color:#666; margin-top:2px;">
              Assigned to: ${agentName}
              · Status: ${status}
              · Due: ${dueText}
            </div>
            ${
              shortNotes
                ? `<div style="font-size:13px; margin-top:4px; white-space:pre-wrap;">${shortNotes}</div>`
                : ''
            }
            ${
              linkUrl
                ? `<div style="margin-top:4px; font-size:13px;">
                     <a href="${linkUrl}" target="_blank"><i class="fa-solid fa-link"></i> Open link</a>
                   </div>`
                : ''
            }
          </div>
      
          <div class="actions" style="display:flex; flex-direction:column; gap:6px;">
            <button class="task-complete" style="padding:4px 8px; font-size:12px;">Mark done</button>
            <button class="task-delete" style="padding:4px 8px; font-size:12px; background:#ffe6e6; border:1px solid #ffb3b3;">Delete</button>
          </div>
      
        </div>
      `;
    })
    .join('');

  // Wire "Mark done"
  listEl.querySelectorAll('.task-complete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.task-row');
      const id  = row?.getAttribute('data-id');
      if (!id) return;

      try {
        const now = new Date().toISOString();
        const { error: updErr } = await supabase
          .from('tasks')
          .update({ status: 'completed', completed_at: now })
          .eq('id', id);

        if (updErr) {
          alert('❌ Failed to mark task done.');
          console.error(updErr);
          return;
        }

        // Reload list
        await loadMyTasks();
      } catch (err) {
        console.error('Error marking task complete:', err);
        alert('❌ Error marking task complete.');
      }
    });
  });

  // Wire "Delete"
  listEl.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const row = e.target.closest('.task-row');
      const id  = row?.getAttribute('data-id');
      if (!id) return;

      if (!confirm('Delete this task?')) return;

      try {
        const { error: delErr } = await supabase
          .from('tasks')
          .delete()
          .eq('id', id);

        if (delErr) {
          alert('❌ Failed to delete task.');
          console.error(delErr);
          return;
        }

        row.remove();
        if (!document.querySelector('#task-list .task-row')) {
          listEl.innerHTML = '<p>No tasks sent yet.</p>';
        }
      } catch (err) {
        console.error('Error deleting task:', err);
        alert('❌ Error deleting task.');
      }
    });
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
  const listEl = document.getElementById('waitlist-container');
  if (!listEl) return;

  listEl.innerHTML = 'Loading…';

  const { data, error } = await sb
    .from('agent_waitlist')
    .select('id, agent_id, first_name, last_name, phone, email, recruiter_id, level, recruit_id, licensing_approved, ica_signed, banking_approved, stripe_account_id, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading agent waitlist:', error);
    listEl.innerHTML = '<p>Error loading waitlist.</p>';
    return;
  }

  if (!data || !data.length) {
    listEl.innerHTML = '<p>No agents in the waitlist yet.</p>';
    return;
  }

  // Map recruiter_id → full_name using allAgents if available
  const recruiterNameById = new Map(
    (allAgents || []).map(a => [a.id, a.full_name])
  );

  listEl.innerHTML = data
    .map(item => {
      const recruiterName =
        recruiterNameById.get(item.recruiter_id) || 'Unknown recruiter';
      const created = item.created_at
        ? new Date(item.created_at).toLocaleString()
        : '';

      const licChecked  = item.licensing_approved ? 'checked' : '';
      const icaChecked  = item.ica_signed ? 'checked' : '';
      const bankChecked = item.banking_approved ? 'checked' : '';

      return `
        <div class="wait-row"
             data-id="${item.id}"
             data-agent-id="${item.agent_id || ''}"
             data-first-name="${item.first_name || ''}"
             data-last-name="${item.last_name || ''}"
             data-email="${item.email || ''}"
             data-phone="${item.phone || ''}"
             data-recruiter-id="${item.recruiter_id || ''}"
             data-level="${item.level || ''}"
             data-recruit-id="${item.recruit_id || ''}"
             data-stripe-account-id="${item.stripe_account_id || ''}"
             style="border:1px solid #eee; border-radius:6px; padding:10px 12px; margin-bottom:10px; font-size:13px;">
          <div style="display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap;">
            <div>
              <div><strong>${item.first_name || ''} ${item.last_name || ''}</strong> (${item.agent_id || 'No NPN'})</div>
              <div>Email: ${item.email || '—'}</div>
              <div>Phone: ${item.phone || '—'}</div>
              <div>Recruiter: ${recruiterName}</div>
              <div>Level: ${item.level || '—'}</div>
              <div style="color:#666; font-size:12px;">Added: ${created}</div>
            </div>
            <div style="min-width:220px;">
              <div style="font-weight:600; margin-bottom:4px;">Checklist</div>
              <label style="display:block; margin-bottom:2px;">
                <input type="checkbox" class="wait-lic" ${licChecked}>
                Licensing approved
              </label>
              <label style="display:block; margin-bottom:2px;">
                <input type="checkbox" class="wait-ica" ${icaChecked}>
                ICA signed
              </label>
              <label style="display:block; margin-bottom:2px;">
                <input type="checkbox" class="wait-bank" ${bankChecked}>
                Banking / Stripe ok
              </label>
              <button type="button"
                      class="wait-approve-btn"
                      style="margin-top:6px; padding:4px 8px; font-size:12px;">
                Approve & Add to Approved Agents
              </button>
              <button type="button"
                      class="wait-delete-btn"
                      style="margin-top:4px; padding:4px 8px; font-size:12px; background:#ffe6e6; border:1px solid #ffb3b3;">
                Delete from Waitlist
              </button>
              <div class="wait-msg" style="font-size:12px; margin-top:4px; color:#555;"></div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  // Wire up Approve buttons
  listEl.querySelectorAll('.wait-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.wait-row');
      if (row) approveWaitlistEntry(row);
    });
  });

  // Wire up Delete buttons
  listEl.querySelectorAll('.wait-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row   = btn.closest('.wait-row');
      const rowId = row?.getAttribute('data-id');
      if (!rowId) return;

      if (!confirm('Remove this person from the waitlist? This will NOT change approved_agents.')) {
        return;
      }

      const { error: delErr } = await sb
        .from('agent_waitlist')
        .delete()
        .eq('id', rowId);

      if (delErr) {
        alert('❌ Failed to delete from waitlist.');
        console.error(delErr);
        return;
      }

      // Remove row from DOM
      row.remove();

      // If no rows left, show empty message
      if (!document.querySelector('#waitlist-container .wait-row')) {
        listEl.innerHTML = '<p>No agents in the waitlist yet.</p>';
      }
    });
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

function summarizeAudience(audience) {
  if (!audience || !audience.scope) return 'All agents';

  switch (audience.scope) {
    case 'all':
      return 'All agents';

    case 'by_level':
      return `Levels: ${(audience.levels || []).join(', ') || '—'}`;

    case 'by_product':
      return `Products: ${(audience.products || []).join(', ') || '—'}`;

    case 'by_state':
      return `States: ${(audience.states || []).join(', ') || '—'}`;

    case 'by_product_state':
      return `Products: ${(audience.products || []).join(', ')} · States: ${(audience.states || []).join(', ')}`;

    case 'custom_agents':
      return `Specific agents (${(audience.agent_ids || []).length})`;

    default:
      return 'Custom audience';
  }
}
