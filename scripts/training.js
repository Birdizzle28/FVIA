// scripts/training.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ====== Supabase init (same project as your other pages) ======
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// ====== Globals ======
let me = null;
let isAdmin = false;

// Sessions paging
let sessPage = 1;
const SESS_PAGE_SIZE = 8;

// Cache for current YT playing
let ytPlayer = null;
let ytVideo = null; // { id, title, youtube_id }

// ====== Utilities ======
function fmtDate(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.toLocaleString();
}
const q = (sel, root = document) => root.querySelector(sel);
const qa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Dropdown menu behavior (Agent Hub) like in other pages
function initHubMenu() {
  const toggle = document.getElementById("agent-hub-toggle");
  const menu = document.getElementById("agent-hub-menu");
  if (!toggle || !menu) return;
  menu.style.display = "none";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = (menu.style.display === "block") ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) menu.style.display = "none";
  });
}

// ====== Auth/session gate ======
async function requireSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  const user = session.user;
  const { data: agent } = await supabase.from('agents').select('*').eq('id', user.id).single();
  if (!agent) {
    alert('Agent profile not found.');
    return null;
  }
  // Hide Admin link if not admin
  if (!agent.is_admin) {
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) adminLink.style.display = 'none';
  }
  me = agent;
  isAdmin = !!agent.is_admin;
  return agent;
}

// ====== Filters/widgets ======
function initFilters() {
  try { new Choices('#session-type', { shouldSort:false, searchEnabled:false }); } catch {}
  try { new Choices('#video-category', { shouldSort:false, searchEnabled:false }); } catch {}
  flatpickr('#session-date-range', { mode:'range', dateFormat:'Y-m-d' });
}

// ====== UPCOMING SESSIONS ======
async function loadSessions(page = 1) {
  const search = q('#session-search').value.trim();
  const tType = q('#session-type').value;
  const dr = q('#session-date-range').value;

  let query = supabase.from('training_sessions')
    .select('*', { count: 'exact' })
    .gte('start_time', new Date().toISOString());

  if (search) {
    // search title OR instructor
    query = query.or(`title.ilike.%${search}%,instructor.ilike.%${search}%`);
  }
  if (tType) query = query.eq('type', tType);
  if (dr && dr.includes(' to ')) {
    const [start, end] = dr.split(/\s*to\s*/);
    query = query.gte('start_time', new Date(start).toISOString())
                 .lte('start_time', new Date(end + 'T23:59:59').toISOString());
  }

  query = query.order('start_time', { ascending:true })
               .range((page-1)*SESS_PAGE_SIZE, page*SESS_PAGE_SIZE - 1);

  const { data, error, count } = await query;
  if (error) { console.error(error); return; }

  renderSessions(data || []);
  // pager
  const totalPages = Math.max(1, Math.ceil((count || 0) / SESS_PAGE_SIZE));
  q('#sessions-page').textContent = `Page ${page} of ${totalPages}`;
  q('#sessions-prev').disabled = page <= 1;
  q('#sessions-next').disabled = page >= totalPages;
}

function renderSessions(list) {
  const host = q('#sessions-list');
  host.innerHTML = '';
  if (!list.length) {
    host.innerHTML = `<div class="session-card"><em>No upcoming sessions match your filters.</em></div>`;
    return;
  }
  list.forEach(s => {
    const capText = (s.capacity && s.registered_count != null)
      ? `${s.registered_count}/${s.capacity} seats`
      : (s.capacity ? `${s.capacity} seats` : '—');

    const card = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
      <h3>${s.title}</h3>
      <div class="session-meta">
        <span class="badge ${s.type}">${s.type === 'in_person' ? 'In-person' : 'Webinar'}</span>
        &nbsp;•&nbsp; ${fmtDate(s.start_time)}
        ${s.location ? ` &nbsp;•&nbsp; ${s.location}` : ''}
      </div>
      <p>${s.description || ''}</p>
      <div class="session-actions">
        <button class="primary" data-enroll="${s.id}">RSVP</button>
        ${s.join_url ? `<a class="ghost" href="${s.join_url}" target="_blank">Join/Details</a>` : ''}
        <span class="muted">${capText}</span>
      </div>
    `;
    host.appendChild(card);
  });

  // wire enroll buttons
  qa('[data-enroll]').forEach(btn => {
    btn.addEventListener('click', () => enrollInSession(btn.getAttribute('data-enroll')));
  });
}

async function enrollInSession(sessionId) {
  if (!me) return;
  // prevent double-enroll
  const { data: existing } = await supabase.from('training_enrollments')
    .select('id').eq('session_id', sessionId).eq('agent_id', me.id).maybeSingle();
  if (existing) { alert('You are already enrolled.'); return; }

  const { error } = await supabase.from('training_enrollments').insert({
    session_id: sessionId,
    agent_id: me.id,
    status: 'registered'
  });
  if (error) { console.error(error); alert('Could not RSVP.'); return; }

  alert('✅ Registered! We’ll see you there.');
  // Optional: increment a cached registered_count via RPC; for now just reload sessions
  loadSessions(sessPage);
}

// ====== VIDEO LIBRARY ======
async function loadVideos() {
  const cat = q('#video-category').value;
  const search = q('#video-search').value.trim();

  let query = supabase.from('training_videos').select('*').order('created_at', { ascending:false });
  if (cat) query = query.eq('category', cat);
  if (search) query = query.ilike('title', `%${search}%`);

  const { data, error } = await query;
  if (error) { console.error(error); return; }
  renderVideos(data || []);
}

function renderVideos(list) {
  const host = q('#video-grid');
  host.innerHTML = '';
  if (!list.length) {
    host.innerHTML = `<div class="video-card"><em>No videos found.</em></div>`;
    return;
  }
  list.forEach(v => {
    const card = document.createElement('div');
    card.className = 'video-card';
    card.innerHTML = `
      <h3>${v.title}</h3>
      <div class="video-meta">
        <span class="badge">${(v.category || '').replaceAll('_',' ') || 'General'}</span>
        ${v.length_min ? ` • ${v.length_min} mins` : ''}
      </div>
      <p>${v.description || ''}</p>
      <div class="video-actions">
        <button class="primary" data-play="${v.id}">Play</button>
        <button class="ghost" data-mark="${v.id}">Mark Complete</button>
      </div>
    `;
    host.appendChild(card);
  });

  qa('[data-play]').forEach(btn => {
    btn.addEventListener('click', () => openVideoOverlay(btn.getAttribute('data-play')));
  });
  qa('[data-mark]').forEach(btn => {
    btn.addEventListener('click', () => markVideoComplete(btn.getAttribute('data-mark')));
  });
}

// Overlay controls + YT integration
window.onYouTubeIframeAPIReady = () => {
  // created on demand in openVideoOverlay
};
async function openVideoOverlay(videoId) {
  // fetch video metadata (need youtube_id)
  const { data: v, error } = await supabase.from('training_videos').select('*').eq('id', videoId).single();
  if (error || !v) { console.error(error); return; }
  ytVideo = v;

  q('#overlay-video-title').textContent = v.title || 'Playing';
  const overlay = q('#video-overlay');
  overlay.classList.add('open'); overlay.setAttribute('aria-hidden','false');

  // Create or load player
  const mount = q('#yt-player');
  mount.innerHTML = ''; // reset
  ytPlayer = new YT.Player('yt-player', {
    videoId: v.youtube_id,
    playerVars: { rel:0, modestbranding:1 },
    events: {
      onStateChange: (e) => {
        // 1 = playing, 2 = paused, 0 = ended
        if (e.data === 0) { // ended
          // auto-mark complete
          markVideoComplete(v.id, true);
        }
      }
    }
  });

  // Mark complete button
  q('#mark-complete').onclick = () => markVideoComplete(v.id);

  // (Light) progress ping every 10s (if playable)
  let ticker = setInterval(async () => {
    if (!ytPlayer || !ytPlayer.getDuration) return;
    try {
      const dur = ytPlayer.getDuration?.() || 0;
      const cur = ytPlayer.getCurrentTime?.() || 0;
      if (dur > 0) q('#watch-progress').textContent = `Progress: ${Math.round((cur/dur)*100)}%`;
      // upsert progress row occasionally
      if (me && v) {
        await supabase.from('training_progress').upsert({
          agent_id: me.id,
          item_type: 'video',
          item_id: v.id,
          percent: Math.min(100, Math.round((cur/dur)*100)) || 0
        }, { onConflict: 'agent_id,item_type,item_id' });
      }
    } catch {}
  }, 10000);

  // Close overlay
  overlay.addEventListener('click', (e) => {
    if (e.target.matches('[data-close], .overlay-backdrop')) {
      clearInterval(ticker);
      try { ytPlayer?.stopVideo?.(); } catch {}
      overlay.classList.remove('open'); overlay.setAttribute('aria-hidden','true');
    }
  }, { once:true });
}

async function markVideoComplete(videoId, quiet=false) {
  if (!me) return;
  const { error } = await supabase.from('training_progress').upsert({
    agent_id: me.id,
    item_type: 'video',
    item_id: videoId,
    completed: true,
    completed_at: new Date().toISOString(),
    percent: 100
  }, { onConflict: 'agent_id,item_type,item_id' });
  if (error) { console.error(error); if(!quiet) alert('Could not mark complete.'); return; }
  if (!quiet) alert('✅ Marked complete.');
  loadMyProgress();
}

// ====== PROGRESS ======
async function loadMyProgress() {
  if (!me) return;
  const { data, error } = await supabase
    .from('training_progress')
    .select('*')
    .eq('agent_id', me.id)
    .order('completed_at', { ascending:false });
  if (error) { console.error(error); return; }

  // Stats
  const videos = (data || []).filter(r => r.item_type === 'video' && r.completed);
  const sessions = (data || []).filter(r => r.item_type === 'session' && r.completed);
  q('#stat-videos-complete').textContent = videos.length;
  q('#stat-sessions-attended').textContent = sessions.length;

  // crude overall: count of completed items / (completed + incomplete uniques)
  // (Optional) For now, just % of completed rows among rows.
  const overallPct = data?.length ? Math.round((data.filter(r=>r.completed).length / data.length)*100) : 0;
  q('#stat-overall').textContent = `${overallPct}%`;

  // Table
  const tbody = q('#progress-table tbody');
  tbody.innerHTML = '';
  for (const row of (data || [])) {
    let title = '';
    if (row.item_type === 'video') {
      const { data: v } = await supabase.from('training_videos').select('title').eq('id', row.item_id).maybeSingle();
      title = v?.title || '(Video)';
    } else {
      const { data: s } = await supabase.from('training_sessions').select('title').eq('id', row.item_id).maybeSingle();
      title = s?.title || '(Session)';
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.completed_at ? new Date(row.completed_at).toLocaleDateString() : '—'}</td>
      <td>${row.item_type}</td>
      <td>${title}</td>
      <td>${row.completed ? 'Completed' : `${row.percent ?? 0}%`}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ====== Event wiring ======
document.addEventListener('DOMContentLoaded', async () => {
  initHubMenu();

  const agent = await requireSession();
  if (!agent) return;

  // Tabs reuse your dashboard tab logic
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.folder-tabs .tab');
    if (!btn) return;
    const tabs   = btn.parentElement.querySelectorAll('.tab');
    const panels = btn.closest('.folder-tabs').querySelectorAll('.panel');
    const id     = btn.dataset.tab;
    tabs.forEach(t => {
      const active = t === btn;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach(p => p.classList.toggle('is-active', p.id === `panel-${id}`));
  });

  initFilters();

  // Sessions
  document.getElementById('apply-session-filters').addEventListener('click', () => { sessPage = 1; loadSessions(sessPage); });
  document.getElementById('reset-session-filters').addEventListener('click', () => {
    q('#session-search').value = ''; q('#session-type').value = '';
    q('#session-date-range').value = '';
    sessPage = 1; loadSessions(sessPage);
  });
  document.getElementById('sessions-prev').addEventListener('click', () => { if (sessPage>1){ sessPage--; loadSessions(sessPage);} });
  document.getElementById('sessions-next').addEventListener('click', () => { sessPage++; loadSessions(sessPage); });

  // Library
  document.getElementById('apply-video-filters').addEventListener('click', () => loadVideos());
  document.getElementById('reset-video-filters').addEventListener('click', () => {
    q('#video-category').value = ''; q('#video-search').value = ''; loadVideos();
  });

  // Initial loads
  await loadSessions(sessPage);
  await loadVideos();
  await loadMyProgress();
});
