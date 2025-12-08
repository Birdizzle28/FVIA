// scripts/training.js
const supabase = window.supabaseClient;

// --------- Local progress store (per-user, localStorage) ----------
const STORAGE_KEY = 'fvg_training_progress';

class TrainingProgress {
  constructor(userId) {
    this.key = `${STORAGE_KEY}:${userId || 'anon'}`;
    this.data = this._load();
  }
  _load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : {};
    } catch (_) {
      return {};
    }
  }
  _save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch (_) {}
  }
  attachTitle(id, title) {
    if (!id) return;
    const prev = this.data[id];
    if (!prev) {
      this.data[id] = {
        type: 'video',
        title: title || null,
        pct: 0,
        completed: false,
        updatedAt: null
      };
      this._save();
      return;
    }
    if (!prev.title && title) {
      prev.title = title;
      this._save();
    }
  }
  setVideoProgress(id, pct) {
    if (!id) return;
    const prev = this.data[id] || {
      type: 'video',
      title: null,
      pct: 0,
      completed: false,
      updatedAt: null
    };
    const nextPct = Math.max(prev.pct || 0, pct || 0);
    const completed = prev.completed || nextPct >= 95;
    this.data[id] = {
      ...prev,
      pct: nextPct,
      completed,
      updatedAt: new Date().toISOString()
    };
    this._save();
  }
  markComplete(id, title) {
    if (!id) return;
    const prev = this.data[id] || {
      type: 'video',
      title: null,
      pct: 0,
      completed: false,
      updatedAt: null
    };
    this.data[id] = {
      ...prev,
      title: title || prev.title,
      pct: 100,
      completed: true,
      updatedAt: new Date().toISOString()
    };
    this._save();
  }
  get(id) {
    return this.data[id] || null;
  }
  getAll() {
    return this.data;
  }
  getCompletedVideos() {
    return Object.entries(this.data)
      .filter(([, v]) => v.type === 'video' && v.completed);
  }
}

// --------- Small helpers ----------
const money = n => (isFinite(n) ? `$${(+n).toFixed(2)}` : '$—');
const fmtDate = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleDateString();
};
const fmtDateTime = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  return d.toLocaleString();
};

// Parse a YouTube ID from a typical URL
function parseYouTubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace('/', '');
    }
    if (u.searchParams.get('v')) {
      return u.searchParams.get('v');
    }
    if (u.pathname.includes('/embed/')) {
      return u.pathname.split('/embed/')[1];
    }
  } catch (_) {
    // not a full URL, maybe already an ID
    if (/^[\w-]{8,}$/.test(url)) return url;
  }
  return null;
}

// --------- Global-ish state for this page ----------
let progressStore;          // TrainingProgress instance
let currentUserId = 'anon';

let materialsById = new Map();
let totalVideos = 0;
let totalSessionsAttended = 0;  // placeholder (can wire to enrollments later)

// sessions paging
let allSessions = [];
let filteredSessions = [];
let sessionsPage = 1;
const SESSIONS_PER_PAGE = 6;

// YouTube player state
let ytPlayer = null;
let currentMaterialId = null;
let currentVideoId = null;
let watchTimer = null;

// --------- Tabs ----------
function initTabs() {
  const tabs = Array.from(document.querySelectorAll('.folder-tabs .tab'));
  const panels = Array.from(document.querySelectorAll('.folder-tabs .panel'));

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabName = btn.dataset.tab;
      tabs.forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      panels.forEach(p => {
        p.classList.toggle('is-active', p.id === `panel-${tabName}`);
      });
    });
  });
}

// --------- Upcoming Sessions (lightweight, safe even if table missing) ----------
async function loadSessionsFromDb() {
  const list = document.getElementById('sessions-list');
  const pagerLabel = document.getElementById('sessions-page');
  const prevBtn = document.getElementById('sessions-prev');
  const nextBtn = document.getElementById('sessions-next');

  if (!list) return;

  list.innerHTML = '<p class="muted">Loading sessions…</p>';
  pagerLabel.textContent = 'Page 1';
  prevBtn.disabled = true;
  nextBtn.disabled = true;

  try {
    // Try to load from a "training_sessions" table if it exists.
    const { data, error } = await supabase
      .from('training_sessions')
      .select('*')
      .order('start_at', { ascending: true });

    if (error) {
      console.warn('training_sessions not ready or error:', error.message);
      list.innerHTML = '<p class="muted">Upcoming sessions will appear here once configured.</p>';
      return;
    }

    allSessions = data || [];
    filteredSessions = allSessions.slice();
    sessionsPage = 1;
    renderSessionsPage();
  } catch (err) {
    console.error('Error loading sessions:', err);
    list.innerHTML = '<p class="muted">Could not load sessions.</p>';
  }
}

function applySessionFilters() {
  const search = (document.getElementById('session-search')?.value || '').trim().toLowerCase();
  const type = document.getElementById('session-type')?.value || '';
  const dateRange = document.getElementById('session-date-range')?.value || '';

  let startDate = null;
  let endDate = null;
  if (dateRange && dateRange.includes(' to ')) {
    const [s, e] = dateRange.split(' to ');
    if (s) startDate = new Date(s + 'T00:00:00');
    if (e) endDate = new Date(e + 'T23:59:59');
  }

  filteredSessions = (allSessions || []).filter(s => {
    const title = (s.title || '').toLowerCase();
    const instr = (s.instructor || s.instructor_name || '').toLowerCase();
    const t = (s.type || '').toLowerCase();

    if (search && !title.includes(search) && !instr.includes(search)) return false;
    if (type && t !== type.toLowerCase()) return false;

    if (startDate || endDate) {
      const startAt = s.start_at || s.starts_at || s.scheduled_for;
      if (!startAt) return false;
      const d = new Date(startAt);
      if (startDate && d < startDate) return false;
      if (endDate && d > endDate) return false;
    }
    return true;
  });

  sessionsPage = 1;
  renderSessionsPage();
}

function renderSessionsPage() {
  const list = document.getElementById('sessions-list');
  const pagerLabel = document.getElementById('sessions-page');
  const prevBtn = document.getElementById('sessions-prev');
  const nextBtn = document.getElementById('sessions-next');

  if (!list) return;

  if (!filteredSessions.length) {
    list.innerHTML = '<p class="muted">No sessions match these filters.</p>';
    pagerLabel.textContent = 'Page 1';
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }

  const totalPages = Math.ceil(filteredSessions.length / SESSIONS_PER_PAGE) || 1;
  if (sessionsPage > totalPages) sessionsPage = totalPages;

  const start = (sessionsPage - 1) * SESSIONS_PER_PAGE;
  const end = start + SESSIONS_PER_PAGE;
  const slice = filteredSessions.slice(start, end);

  list.innerHTML = slice.map(s => {
    const startAt = s.start_at || s.starts_at || s.scheduled_for;
    const endAt = s.end_at || s.ends_at;
    const t = (s.type || '').toLowerCase();
    const typeLabel = t === 'webinar' ? 'Webinar' : t === 'in_person' ? 'In-person' : (s.type || 'Session');

    return `
      <article class="card session-card">
        <h4>${s.title || '(Untitled session)'}</h4>
        <p class="muted">${s.description || ''}</p>
        <div class="session-meta">
          <span><i class="fa-regular fa-clock"></i> ${startAt ? fmtDateTime(startAt) : 'TBA'}</span>
          ${endAt ? `<span>– ${fmtDateTime(endAt)}</span>` : ''}
        </div>
        <div class="session-meta">
          ${s.instructor || s.instructor_name ? `<span><i class="fa-regular fa-user"></i> ${s.instructor || s.instructor_name}</span>` : ''}
          ${s.location ? `<span><i class="fa-solid fa-location-dot"></i> ${s.location}</span>` : ''}
        </div>
        <div class="session-meta">
          <span class="badge">${typeLabel}</span>
          ${s.join_url ? `<a class="btn small" href="${s.join_url}" target="_blank" rel="noopener">Join / Register</a>` : ''}
        </div>
      </article>
    `;
  }).join('');

  pagerLabel.textContent = `Page ${sessionsPage} of ${totalPages}`;
  prevBtn.disabled = sessionsPage <= 1;
  nextBtn.disabled = sessionsPage >= totalPages;
}

// --------- Video Library (training_materials) ----------
async function loadVideoLibrary() {
  const grid = document.getElementById('video-grid');
  if (!grid) return;

  grid.innerHTML = '<p class="muted">Loading training videos…</p>';

  const category = document.getElementById('video-category')?.value || '';
  const search = (document.getElementById('video-search')?.value || '').trim();

  let query = supabase
    .from('training_materials')
    .select('*')
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (category) {
    // tags is text[]; contains() will match rows that include the category
    query = query.contains('tags', [category]);
  }
  if (search) {
    query = query.ilike('title', `%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error loading training_materials:', error);
    grid.innerHTML = '<p class="muted">Error loading library.</p>';
    return;
  }

  if (!data || !data.length) {
    grid.innerHTML = '<p class="muted">No training videos found.</p>';
    totalVideos = 0;
    updateProgressUI();
    return;
  }

  materialsById = new Map();
  totalVideos = data.length;

  const cardsHtml = data.map(m => {
    materialsById.set(m.id, m);
    if (progressStore) progressStore.attachTitle(m.id, m.title);

    const prog = progressStore?.get(m.id);
    const pct = prog?.pct || 0;
    const completed = prog?.completed;

    const pctLabel = completed ? 'Completed' : (pct ? `${Math.round(pct)}% watched` : 'Not started');

    const tags = Array.isArray(m.tags) ? m.tags : [];
    const tagBadges = tags.map(t => `<span class="badge badge-soft">${t}</span>`).join(' ');

    return `
      <article class="card video-card" data-id="${m.id}">
        <h4>${m.title || '(Untitled video)'}</h4>
        <p class="muted">${m.description || ''}</p>
        <div class="video-tags">
          ${tagBadges}
        </div>
        <div class="video-footer">
          <button class="btn small play-btn">
            <i class="fa-solid fa-play"></i> Play
          </button>
          <span class="muted status-label" data-status-for="${m.id}">
            ${pctLabel}
          </span>
        </div>
      </article>
    `;
  }).join('');

  grid.innerHTML = cardsHtml;

  // Wire click handlers
  grid.querySelectorAll('.video-card .play-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      const card = e.target.closest('.video-card');
      const id = card?.dataset.id;
      if (!id) return;
      openVideoOverlay(id);
    });
  });

  updateProgressUI();
}

// --------- YouTube overlay & watch tracking ----------
function ensureYTReady(videoId) {
  if (window.YT && window.YT.Player) {
    createOrLoadPlayer(videoId);
    return;
  }
  let tries = 0;
  const maxTries = 40; // ~10 seconds
  const timer = setInterval(() => {
    if (window.YT && window.YT.Player) {
      clearInterval(timer);
      createOrLoadPlayer(videoId);
    } else if (++tries >= maxTries) {
      clearInterval(timer);
      alert('YouTube player failed to load. Please try again.');
    }
  }, 250);
}

function createOrLoadPlayer(videoId) {
  currentVideoId = videoId;
  if (!ytPlayer) {
    ytPlayer = new YT.Player('yt-player', {
      videoId,
      playerVars: {
        rel: 0,
        modestbranding: 1
      },
      events: {
        onStateChange: onPlayerStateChange
      }
    });
  } else {
    ytPlayer.loadVideoById(videoId);
  }
}

function onPlayerStateChange(event) {
  if (!ytPlayer || !currentMaterialId || !progressStore) return;
  const state = event.data;
  if (state === YT.PlayerState.PLAYING) {
    if (watchTimer) clearInterval(watchTimer);
    watchTimer = setInterval(() => {
      const dur = ytPlayer.getDuration();
      const cur = ytPlayer.getCurrentTime();
      if (!dur || dur <= 0) return;
      const pct = Math.min(100, Math.max(0, (cur / dur) * 100));
      progressStore.setVideoProgress(currentMaterialId, pct);
      updateVideoStatusLabels();
      updateWatchProgressLabel(currentMaterialId);
      updateProgressUI();
    }, 2000);
  } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED) {
    if (watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
    if (state === YT.PlayerState.ENDED) {
      progressStore.markComplete(currentMaterialId, materialsById.get(currentMaterialId)?.title);
      updateVideoStatusLabels();
      updateWatchProgressLabel(currentMaterialId);
      updateProgressUI();
    }
  }
}

function openVideoOverlay(materialId) {
  const overlay = document.getElementById('video-overlay');
  const titleEl = document.getElementById('overlay-video-title');
  const progressLabel = document.getElementById('watch-progress');
  const markBtn = document.getElementById('mark-complete');

  const material = materialsById.get(materialId);
  if (!overlay || !material) return;

  currentMaterialId = materialId;

  const videoId = parseYouTubeId(material.url || material.file_url);
  if (!videoId) {
    alert('This training item does not have a valid video URL yet.');
    return;
  }

  titleEl.textContent = material.title || 'Training Video';
  overlay.classList.add('open');
  overlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  updateWatchProgressLabel(materialId);

  ensureYTReady(videoId);

  // Mark complete button
  if (markBtn) {
    markBtn.onclick = () => {
      progressStore.markComplete(materialId, material.title);
      updateVideoStatusLabels();
      updateWatchProgressLabel(materialId);
      updateProgressUI();
    };
  }

  if (progressLabel) {
    progressLabel.textContent = progressLabel.textContent || 'Progress: 0%';
  }
}

function closeVideoOverlay() {
  const overlay = document.getElementById('video-overlay');
  if (!overlay) return;

  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';

  if (watchTimer) {
    clearInterval(watchTimer);
    watchTimer = null;
  }
  if (ytPlayer && typeof ytPlayer.stopVideo === 'function') {
    ytPlayer.stopVideo();
  }
  currentMaterialId = null;
  currentVideoId = null;
}

function updateWatchProgressLabel(materialId) {
  const lbl = document.getElementById('watch-progress');
  if (!lbl || !progressStore) return;
  const prog = progressStore.get(materialId);
  if (!prog) {
    lbl.textContent = 'Progress: 0%';
    return;
  }
  const pct = Math.round(prog.pct || 0);
  lbl.textContent = `Progress: ${pct}%${prog.completed ? ' (Completed)' : ''}`;
}

function updateVideoStatusLabels() {
  if (!progressStore) return;
  const all = progressStore.getAll();
  Object.entries(all).forEach(([id, v]) => {
    const el = document.querySelector(`[data-status-for="${id}"]`);
    if (!el) return;
    if (v.completed) {
      el.textContent = 'Completed';
    } else if (v.pct) {
      el.textContent = `${Math.round(v.pct)}% watched`;
    } else {
      el.textContent = 'Not started';
    }
  });
}

// --------- My Progress tab ----------
function updateProgressUI() {
  const statVideos = document.getElementById('stat-videos-complete');
  const statSessions = document.getElementById('stat-sessions-attended');
  const statOverall = document.getElementById('stat-overall');
  const tbody = document.querySelector('#progress-table tbody');

  if (!progressStore) return;

  const completedVideos = progressStore.getCompletedVideos();
  const videosDone = completedVideos.length;

  if (statVideos) statVideos.textContent = String(videosDone);
  if (statSessions) statSessions.textContent = String(totalSessionsAttended);

  const totalItems = totalVideos + totalSessionsAttended;
  const doneItems = videosDone + totalSessionsAttended;
  const overallPct = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
  if (statOverall) statOverall.textContent = `${overallPct}%`;

  if (!tbody) return;

  const rowsData = Object.entries(progressStore.getAll())
    .filter(([, v]) => v.type === 'video' && (v.pct > 0 || v.completed))
    .sort(([, a], [, b]) => {
      const ta = a.updatedAt ? +new Date(a.updatedAt) : 0;
      const tb = b.updatedAt ? +new Date(b.updatedAt) : 0;
      return tb - ta;
    });

  if (!rowsData.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="muted">You haven’t completed any items yet. Start with a video from the library.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rowsData.map(([id, v]) => {
    const date = v.updatedAt ? fmtDate(v.updatedAt) : '';
    const status = v.completed ? 'Completed' : `In progress (${Math.round(v.pct || 0)}%)`;
    return `
      <tr>
        <td>${date}</td>
        <td>Video</td>
        <td>${v.title || '(Untitled video)'}</td>
        <td>${status}</td>
      </tr>
    `;
  }).join('');
}

// --------- Wire everything up on DOMContentLoaded ----------
document.addEventListener('DOMContentLoaded', async () => {
  // Get user id for per-user progress
  try {
    const { data } = await supabase.auth.getUser();
    if (data?.user?.id) currentUserId = data.user.id;
  } catch (_) {
    currentUserId = 'anon';
  }
  progressStore = new TrainingProgress(currentUserId);

  // Tabs
  initTabs();

  // Sessions filter widgets
  if (window.flatpickr) {
    flatpickr('#session-date-range', {
      mode: 'range',
      dateFormat: 'Y-m-d'
    });
  }

  document.getElementById('apply-session-filters')?.addEventListener('click', applySessionFilters);
  document.getElementById('reset-session-filters')?.addEventListener('click', () => {
    const rangeInput = document.getElementById('session-date-range');
    const search = document.getElementById('session-search');
    const type = document.getElementById('session-type');
    if (rangeInput) rangeInput.value = '';
    if (search) search.value = '';
    if (type) type.value = '';
    filteredSessions = allSessions.slice();
    sessionsPage = 1;
    renderSessionsPage();
  });

  document.getElementById('sessions-prev')?.addEventListener('click', () => {
    if (sessionsPage > 1) {
      sessionsPage--;
      renderSessionsPage();
    }
  });
  document.getElementById('sessions-next')?.addEventListener('click', () => {
    const totalPages = Math.ceil(filteredSessions.length / SESSIONS_PER_PAGE) || 1;
    if (sessionsPage < totalPages) {
      sessionsPage++;
      renderSessionsPage();
    }
  });

  // Video filter buttons
  document.getElementById('apply-video-filters')?.addEventListener('click', loadVideoLibrary);
  document.getElementById('reset-video-filters')?.addEventListener('click', () => {
    const cat = document.getElementById('video-category');
    const search = document.getElementById('video-search');
    if (cat) cat.value = '';
    if (search) search.value = '';
    loadVideoLibrary();
  });

  // Overlay close (click X, backdrop, or ESC)
  document.querySelectorAll('#video-overlay [data-close], #video-overlay .overlay-backdrop')
    .forEach(el => el.addEventListener('click', closeVideoOverlay));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('video-overlay');
      if (overlay && overlay.classList.contains('open')) closeVideoOverlay();
    }
  });

  // Initial loads
  loadSessionsFromDb();
  await loadVideoLibrary();
  updateVideoStatusLabels();
  updateProgressUI();
});

// Note: You already load the YouTube IFrame API in training.html.
// We don't need to define onYouTubeIframeAPIReady here; we just wait for YT to exist
// and then build the player when a video is opened.
