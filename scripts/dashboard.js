// Initialize Supabase client (module-friendly via ESM CDN)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);
window.supabase = supabase;

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- FOLDER TABS ---------- */
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

  /* ---------- CAROUSEL CORE ---------- */
  class Carousel {
    constructor(root) {
      this.root       = root;
      this.track      = root.querySelector('.carousel-track');
      this.prev       = root.querySelector('.car-btn.prev');
      this.next       = root.querySelector('.car-btn.next');
      this.dots       = root.querySelector('.car-dots');
      this.key        = root.dataset.key || 'carousel';
      this.maxVisible = parseInt(root.dataset.max || '5', 10);
      this.remember   = root.dataset.remember !== 'false';
      this.autoplayMs = parseInt(root.dataset.autoplay || '5000', 10);
      this.allSlides  = Array.from(root.querySelectorAll('.slide'));
      this.slides     = this.allSlides.slice(0, this.maxVisible);
      this.rebuildTrack();
      this.i = this.restoreIndex();
      if (this.i < 0 || this.i >= this.slides.length) this.i = 0;
      this.setupDots();
      this.bind();
      this.go(this.i, false);
      this.startAuto();
    }
    rebuildTrack() { this.track.innerHTML = ''; this.slides.forEach(sl => this.track.appendChild(sl)); }
    setupDots() {
      this.dots.innerHTML = '';
      this.slides.forEach((_, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Go to slide ${idx + 1}`);
        b.addEventListener('click', () => { this.go(idx); this.restartAuto(); });
        this.dots.appendChild(b);
      });
      const multi = this.slides.length > 1;
      this.dots.style.display = multi ? 'flex' : 'none';
      this.prev.style.display = multi ? '' : 'none';
      this.next.style.display = multi ? '' : 'none';
    }
    bind() {
      this.prev?.addEventListener('click', () => { this.go(this.i - 1); this.restartAuto(); });
      this.next?.addEventListener('click', () => { this.go(this.i + 1); this.restartAuto(); });
      this.root.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); this.go(this.i - 1); this.restartAuto(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.go(this.i + 1); this.restartAuto(); }
      });
      // drag / swipe
      let startX = 0, curX = 0, dragging = false;
      const start = (x) => { dragging = true; startX = curX = x; this.track.style.transition = 'none'; this.pause(); };
      const move  = (x) => { if (!dragging) return; curX = x; this._translateBy(curX - startX); };
      const end   = () => {
        if (!dragging) return;
        const delta = curX - startX;
        this.track.style.transition = '';
        if (Math.abs(delta) > 50) this.go(this.i + (delta < 0 ? 1 : -1));
        else this.go(this.i);
        dragging = false;
        this.resume();
      };
      this.track.addEventListener('touchstart', (e) => start(e.touches[0].clientX), {passive:true});
      this.track.addEventListener('touchmove',  (e) => move(e.touches[0].clientX),   {passive:true});
      this.track.addEventListener('touchend',   end);
      this.track.addEventListener('mousedown', (e) => start(e.clientX));
      window.addEventListener('mousemove', (e) => move(e.clientX));
      window.addEventListener('mouseup', end);
      this.root.addEventListener('pointerenter', () => this.pause());
      this.root.addEventListener('pointerleave', () => this.resume());
      this.root.addEventListener('focusin',      () => this.pause());
      this.root.addEventListener('focusout',     () => this.resume());
      window.addEventListener('resize', () => this.go(this.i, false));
    }
    _translateBy(dx) { const w = this.root.clientWidth; const base = -this.i * w; this.track.style.transform = `translateX(${base + dx}px)`; }
    go(idx, save = true) {
      const len = Math.max(1, this.slides.length);
      this.i = ((idx % len) + len) % len;
      const w = this.root.clientWidth;
      this.track.style.transform = `translateX(${-this.i * w}px)`;
      Array.from(this.dots.children).forEach((d, j) => d.setAttribute('aria-current', j === this.i ? 'true' : 'false'));
      if (save && this.remember) localStorage.setItem(`carousel:${this.key}`, String(this.i));
    }
    restoreIndex() { const v = localStorage.getItem(`carousel:${this.key}`); const n = v ? parseInt(v, 10) : 0; return Number.isFinite(n) ? n : 0; }
    startAuto() { if (this.autoplayMs > 0 && this.slides.length > 1) { this.stopAuto(); this._timer = setInterval(() => this.go(this.i + 1), this.autoplayMs); } }
    stopAuto() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
    pause()    { this.stopAuto(); }
    resume()   { this.startAuto(); }
    restartAuto(){ this.stopAuto(); this.startAuto(); }
    setSlides(newSlides) {
      this.allSlides = Array.from(newSlides);
      this.slides = this.allSlides.slice(0, this.maxVisible);
      this.rebuildTrack();
      this.setupDots();
      this.go(0, false);
      this.restartAuto();
    }
    getAllSlides(){ return this.allSlides; }
  }
  const carousels = Array.from(document.querySelectorAll('.carousel')).map(c => new Carousel(c));

  /* ---------- SEE ALL OVERLAY (generic) ---------- */
  const overlay = document.getElementById('dash-overlay');
  const overlayGrid = document.getElementById('overlay-grid');
  const overlayTitle = document.getElementById('overlay-title');
  let activeCarousel = null;

  const openOverlay = (title, items = [], carouselInst = null) => {
    activeCarousel = carouselInst || null;
    activeCarousel?.pause();
    overlayTitle.textContent = title;
    overlayGrid.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'overlay-item';
      empty.innerHTML = `<p>No items to show yet.</p>`;
      overlayGrid.appendChild(empty);
    } else {
      // Default generic cards (used for sales/reminders). Announcements use a custom renderer below.
      items.forEach((el, idx) => {
        const card = document.createElement('div');
        card.className = 'overlay-item';
        card.innerHTML = `<h3>${el.querySelector('h3')?.textContent || 'Item'}</h3>
                          <p>${el.querySelector('p')?.textContent || ''}</p>`;
        card.addEventListener('click', () => {
          if (activeCarousel && idx < activeCarousel.slides.length) activeCarousel.go(idx);
          closeOverlay();
        });
        overlayGrid.appendChild(card);
      });
    }
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.querySelector('.overlay-close')?.focus();
    document.body.style.overflow = 'hidden';
  };
  const closeOverlay = () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    activeCarousel?.resume();
    activeCarousel = null;
  };
  overlay.addEventListener('click', (e) => { if (e.target.matches('[data-close], .overlay-backdrop')) closeOverlay(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeOverlay(); });

  /* ---------- Announcement DETAIL overlay ---------- */
  const detailOverlay = document.getElementById('annc-detail-overlay');
  const detailBody = detailOverlay.querySelector('.annc-detail-body');
  const detailTitle = detailOverlay.querySelector('#annc-detail-title');
  function openDetail(annc) {
    detailTitle.textContent = annc.title || 'Announcement';
    detailBody.innerHTML = `
      <div class="hero" style="background-image:url('${(annc.image_url || '').replace(/'/g,"\\'")}');"></div>
      <div class="meta">
        <h3>${annc.title || 'Untitled'}</h3>
        <p>${(annc.body || '').replace(/\n/g,'<br>')}</p>
        <div class="row"><strong>Visible:</strong> ${formatRange(annc.publish_at, annc.expires_at)}</div>
        ${audienceLine(annc)}
        <div class="cta">
          ${annc.link_url ? `<a href="${annc.link_url}" target="_blank" rel="noopener"><i class="fa-solid fa-link"></i> Open link</a>` : ''}
        </div>
      </div>
    `;
    detailOverlay.classList.add('open');
    detailOverlay.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
  }
  function closeDetail(){
    detailOverlay.classList.remove('open');
    detailOverlay.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }
  detailOverlay.addEventListener('click', (e) => { if (e.target.matches('[data-close], .overlay-backdrop')) closeDetail(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && detailOverlay.classList.contains('open')) closeDetail(); });

  function formatRange(pub, exp){
    const f = (d)=> d ? new Date(d).toLocaleString() : 'Now';
    const left = pub ? f(pub) : 'Now';
    const right = exp ? f(exp) : 'No expiry';
    return `${left} → ${right}`;
  }
  function audienceLine(a){
    const aud = a.audience || { scope: 'all' };
    const label = (() => {
      switch (aud.scope) {
        case 'all': return 'Everyone';
        case 'admins': return 'Admins only';
        case 'by_state': return `States: ${(aud.states||[]).join(', ')}`;
        case 'by_product': return `Products: ${(aud.products||[]).join(', ')}`;
        case 'custom_agents': return `Selected agents (${(aud.agent_ids||[]).length})`;
        default: return '—';
      }
    })();
    return `<div class="row"><strong>Audience:</strong> ${label}</div>`;
  }

  // “See all” button handlers (we’ll override Announcements to render image-backed cards)
  document.querySelectorAll('.see-all').forEach(btn => {
    btn.addEventListener('click', () => {
      const key  = btn.dataset.overlay;
      const host = btn.closest('.carousel');
      const inst = host ? carousels.find(c => c.root === host) : null;
      const titleMap = { announcements: 'All Announcements', sales: 'All Sales Entries', reminders: 'All Tasks & Reminders' };
      if (key === 'announcements') {
        // Custom renderer using announcement rows (with images and buttons)
        openAnnouncementsOverlay(inst);
      } else {
        const items = inst ? inst.getAllSlides() : [];
        openOverlay(titleMap[key] || 'All Items', items, inst);
      }
    });
  });

  /* ---------- ANNOUNCEMENTS (live from Supabase) ---------- */
  let _announcements = []; // keep the filtered set for overlay rendering

  async function getMyAgentMini() {
    const { data: { session } } = await supabase.auth.getSession();
    const myId = session?.user?.id || null;
    let me = { id: myId, is_admin: false, state: null, product_types: [] };
    if (!myId) return me;

    const { data: agent } = await supabase
      .from('agents')
      .select('is_admin, state, product_types')
      .eq('id', myId)
      .single();

    if (agent) {
      me.is_admin = !!agent.is_admin;
      me.state = agent.state || null;
      me.product_types = Array.isArray(agent.product_types)
        ? agent.product_types
        : (typeof agent.product_types === 'string'
            ? agent.product_types.split(',').map(s=>s.trim()).filter(Boolean)
            : []);
    }
    return me;
  }

  function makeAnncSlide(a) {
    const art = document.createElement('article');
    art.className = 'slide annc';
    art.tabIndex = 0;
    const hasImg = !!a.image_url;
    art.innerHTML = `
      <div class="annc-inner">
        <div class="annc-text">
          <h3>${a.title || 'Untitled'}</h3>
          <p>${(a.body || '').replace(/\n/g,'<br>')}</p>
        </div>
        <div class="annc-img">${hasImg ? `<img src="${a.image_url}" alt="">` : ''}</div>
      </div>
    `;
    return art;
  }

  async function loadAnnouncementsCarousel() {
    const root = document.querySelector('.carousel[data-key="announcements"]');
    if (!root) return;
    const inst = carousels.find(c => c.root === root);

    const me = await getMyAgentMini();

    const { data: rows, error } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('publish_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Announcements load error:', error);
      const empty = [makeAnncSlide({ title: 'No announcements', body: 'Nothing to show yet.' })];
      _announcements = [];
      return inst?.setSlides(empty);
    }

    const now = new Date();
    const timeOk = (r) => {
      const pub = r.publish_at ? new Date(r.publish_at) : null;
      const exp = r.expires_at ? new Date(r.expires_at) : null;
      if (pub && pub > now) return false;
      if (exp && exp <= now) return false;
      return true;
    };
    const showsForMe = (r) => {
      const aud = r.audience || { scope: 'all' };
      switch (aud.scope) {
        case 'all': return true;
        case 'admins': return me.is_admin;
        case 'by_state': return me.state && (aud.states || []).includes(me.state);
        case 'by_product': {
          const want = new Set(aud.products || []);
          return (me.product_types || []).some(p => want.has(p));
        }
        case 'custom_agents': return me.id && (aud.agent_ids || []).includes(me.id);
        default: return false;
      }
    };

    const list = (rows || []).filter(timeOk).filter(showsForMe);
    _announcements = list; // save for overlay

    const slides = list.length
      ? list.map(makeAnncSlide)
      : [makeAnncSlide({ title: 'No announcements', body: 'Nothing to show yet.' })];

    inst?.setSlides(slides);
  }

  // Custom "See all" overlay for Announcements
  function openAnnouncementsOverlay(inst){
    const title = 'All Announcements';
    activeCarousel = inst || null;
    activeCarousel?.pause();
    overlayTitle.textContent = title;
    overlayGrid.innerHTML = '';

    if (!_announcements.length) {
      const empty = document.createElement('div');
      empty.className = 'overlay-item';
      empty.innerHTML = `<p>No items to show yet.</p>`;
      overlayGrid.appendChild(empty);
    } else {
      _announcements.forEach((a, idx) => {
        const bg = a.image_url ? ` style="background-image:url('${a.image_url.replace(/'/g,"\\'")}')"` : '';
        const card = document.createElement('div');
        card.className = `overlay-item image-card`;
        card.setAttribute('data-annc-idx', String(idx));
        card.innerHTML = `
          <div class="card-bg"${bg}></div>
          <div class="card-content">
            <h3>${a.title || 'Untitled'}</h3>
            <p>${(a.body || '').length > 140 ? (a.body.slice(0,140) + '…') : (a.body || '')}</p>
            <div class="mini-actions">
              <button class="icon-btn btn-eye" title="View details" data-idx="${idx}">
                <i class="fa-solid fa-eye"></i> View
              </button>
              ${a.link_url ? `<a class="icon-btn btn-linkout" href="${a.link_url}" target="_blank" rel="noopener">
                <i class="fa-solid fa-link"></i> Open link
              </a>` : ''}
            </div>
          </div>
        `;
        // Make the background image apply on the card itself:
        card.style.backgroundImage = a.image_url ? `url("${a.image_url}")` : 'none';
        overlayGrid.appendChild(card);
      });

      // Eye button → open detail overlay
      overlayGrid.querySelectorAll('.btn-eye').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(btn.getAttribute('data-idx')||'0');
          const annc = _announcements[idx];
          if (annc) openDetail(annc);
        });
      });

      // Clicking the card (not the buttons) jumps carousel to that slide + closes overlay
      overlayGrid.querySelectorAll('.overlay-item.image-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.mini-actions')) return; // ignore clicks on buttons
          const idx = Number(card.getAttribute('data-annc-idx')||'0');
          if (activeCarousel) activeCarousel.go(idx);
          closeOverlay();
        });
      });
    }

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.querySelector('.overlay-close')?.focus();
    document.body.style.overflow = 'hidden';
  }

  // initial load + realtime
  loadAnnouncementsCarousel();
  try {
    supabase.channel('announcements-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, loadAnnouncementsCarousel)
      .subscribe();
  } catch (e) {
    console.warn('Realtime not available:', e);
  }

  /* ---------- LEAD SNAPSHOT ---------- */
  (async function initLeadSnapshot(){
    let userId = null;
    try { const { data: { session} } = await supabase.auth.getSession(); userId = session?.user?.id || null; } catch {}

    const rangeSel = document.getElementById('lead-range');
    const scopeRadios = document.querySelectorAll('input[name="lead-scope"]');
    const el = id => document.getElementById(id);
    const setText = (id, v) => { const n = el(id); if (n) n.textContent = String(v); };

    function inferStage(row){
      if (row.closed_at || ['won','lost'].includes((row.closed_status||'').toLowerCase())) return 'closed';
      if (row.quoted_at)     return 'quoted';
      if (row.contacted_at)  return 'contacted';
      return 'new';
    }
    function fmtDate(d){ try { return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric' }); } catch { return ''; } }

    async function fetchLeads(days, scope){
      let q = supabase.from('leads')
        .select('id, first_name, last_name, zip, product_type, notes, created_at, assigned_to, submitted_by, quoted_at, contacted_at, closed_at, closed_status')
        .order('created_at', { ascending:false });

      if (scope === 'mine' && userId) q = q.or(`assigned_to.eq.${userId},submitted_by.eq.${userId}`);
      if (days && Number(days) > 0) { const since = new Date(); since.setDate(since.getDate() - Number(days)); q = q.gte('created_at', since.toISOString()); }
      const { data, error } = await q.limit(200);
      if (error) { console.warn('Lead fetch error:', error); return []; }
      return data || [];
    }

    function renderCounts(rows){
      const counts = { new:0, contacted:0, quoted:0, closed:0 };
      rows.forEach(r => { const k = inferStage(r); counts[k] = (counts[k]||0) + 1; });
      setText('stat-new', counts.new);
      setText('stat-contacted', counts.contacted);
      setText('stat-quoted', counts.quoted);
      setText('stat-closed', counts.closed);
    }
    function renderMiniNew(rows){
      const tbody = document.getElementById('mini-new-leads');
      if (!tbody) return;
      tbody.innerHTML = '';
      const newOnes = rows.filter(r => inferStage(r) === 'new').slice(0,5);
      if (newOnes.length === 0) { tbody.innerHTML = `<tr><td colspan="4">No new leads in this range.</td></tr>`; return; }
      newOnes.forEach(r => {
        const tr = document.createElement('tr');
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
        tr.innerHTML = `<td>${name}</td><td>${r.product_type || '—'}</td><td>${r.zip || '—'}</td><td>${r.created_at ? fmtDate(r.created_at) : '—'}</td>`;
        tbody.appendChild(tr);
      });
    }

    async function refresh(){
      const days  = document.getElementById('lead-range')?.value || '30';
      const scope = [...scopeRadios].find(r => r.checked)?.value || 'mine';
      const rows  = await fetchLeads(days, scope);
      renderCounts(rows);
      renderMiniNew(rows);
    }

    rangeSel?.addEventListener('change', refresh);
    scopeRadios.forEach(r => r.addEventListener('change', refresh));
    await refresh();
  })();

  /* ---------- AVAILABILITY SWITCH ---------- */
  (async () => {
    const switchEl = document.getElementById("availabilitySwitch");
    const statusEl = document.getElementById("availabilityStatus");
    if (!switchEl || !statusEl) return;

    let user = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      user = session?.user;
      if (!user) { console.warn("No user found — redirecting to login"); window.location.href = "login.html"; return; }
    } catch (err) { console.error("Error fetching session:", err); return; }

    const { data, error } = await supabase.from("agent_availability").select("available").eq("agent_id", user.id).single();
    if (error && error.code !== "PGRST116") console.error("Error fetching availability:", error);

    if (data) {
      switchEl.checked = !!data.available;
      statusEl.textContent = data.available ? "I’m Available" : "I’m Offline";
      statusEl.style.color = data.available ? "#4caf50" : "#999";
    } else {
      switchEl.checked = false;
      statusEl.textContent = "I’m Offline";
      statusEl.style.color = "#999";
    }

    switchEl.addEventListener("change", async () => {
      const isAvailable = switchEl.checked;
      statusEl.textContent = isAvailable ? "I’m Available" : "I’m Offline";
      statusEl.style.color = isAvailable ? "#4caf50" : "#999";
      const { error } = await supabase.from("agent_availability").upsert(
        { agent_id: user.id, available: isAvailable, last_changed_at: new Date().toISOString() },
        { onConflict: "agent_id" }
      );
      if (error) { alert("Could not update availability: " + error.message); switchEl.checked = !isAvailable; }
    });
  })();

  /* ---------- COMMISSION SNAPSHOT ---------- */
  async function loadCommissionSnapshot(){
    let issuedMonth = 0, ytdAP = 0, pending = 0, chargebacksCount = 0;
    let rows = [];
    try{
      const now = new Date();
      const startMonthISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startYearISO  = new Date(now.getFullYear(), 0, 1).toISOString();

      const res = await supabase.from('policies')
        .select('status, carrier_name, premium_annual, issued_at, contact:contacts(first_name,last_name)')
        .not('issued_at','is', null)
        .gte('issued_at', startYearISO)
        .order('issued_at', { ascending:false })
        .limit(200);

      if (!res.error && res.data) {
        const data = res.data;
        ytdAP = data.reduce((s,r)=> s + (Number(r.premium_annual)||0), 0);
        issuedMonth = data
          .filter(r => r.issued_at && new Date(r.issued_at) >= new Date(startMonthISO))
          .reduce((s,r)=> s + (Number(r.premium_annual)||0), 0);

        rows = data.slice(0,6).map(r=>({
          carrier: r.carrier_name || '—',
          client: `${r.contact?.first_name || ''} ${r.contact?.last_name || ''}`.trim() || '—',
          status: (r.status || '').replace('_',' '),
          ap: Number(r.premium_annual)||0,
          date: r.issued_at ? new Date(r.issued_at).toLocaleDateString() : '—'
        }));
      } else if (res.error) {
        console.warn('Policies query failed:', res.error);
      }

      const pend = await supabase.from('policies').select('id', { count:'exact', head:true }).eq('status','pending');
      pending = pend.count || 0;

      try {
        const cbQ = await supabase.from('policy_status_history')
          .select('event_type', { count:'exact', head:true })
          .gte('event_at', new Date(Date.now() - 30*864e5).toISOString())
          .eq('event_type','chargeback');
        chargebacksCount = cbQ.count || 0;
      } catch {}
    }catch(err){
      console.warn('Commission snapshot error:', err);
    }

    const $ = (id)=>document.getElementById(id);
    $('comm-issued-month') && ($('comm-issued-month').textContent = `$${Math.round(issuedMonth).toLocaleString()}`);
    $('comm-ytd-ap')      && ($('comm-ytd-ap').textContent      = `$${Math.round(ytdAP).toLocaleString()}`);
    $('comm-pending')     && ($('comm-pending').textContent     = String(pending));
    $('comm-chargebacks') && ($('comm-chargebacks').textContent = `${chargebacksCount} events`);

    const tbody = document.getElementById('comm-recent-policies');
    if (tbody) {
      tbody.innerHTML = rows.map(r=>`
        <tr><td>${r.carrier}</td><td>${r.client}</td><td>${r.status||'—'}</td><td>$${Math.round(r.ap).toLocaleString()}</td><td>${r.date}</td></tr>
      `).join('') || `<tr><td colspan="5">No policy data yet.</td></tr>`;
    }
  }

  /* ---------- RECRUITING SNAPSHOT ---------- */
  async function loadRecruitingSnapshot(){
    let team=0, active=0; let activity=[];
    try{
      const agQ = await supabase.from('agents').select('id,is_active,full_name,created_at').order('created_at', {ascending:false}).limit(50);
      if(!agQ.error && agQ.data){
        team   = agQ.data.length;
        active = agQ.data.filter(a=>a.is_active).length;
        activity = agQ.data.slice(0,6).map(a=>({
          name:a.full_name||'—',
          stage:a.is_active?'Active':'Onboarding',
          owner:'—',
          date:new Date(a.created_at).toLocaleDateString()
        }));
      }
    }catch(err){
      console.warn('Recruiting snapshot error:', err);
    }

    const $ = (id)=>document.getElementById(id);
    $('rec-team')       && ($('rec-team').textContent       = String(team));
    $('rec-active')     && ($('rec-active').textContent     = String(active));
    $('rec-pipeline')   && ($('rec-pipeline').textContent   = String(0));
    $('rec-interviews') && ($('rec-interviews').textContent = String(0));

    const tbody = document.getElementById('rec-recent-activity');
    if (tbody) {
      tbody.innerHTML = activity.map(r=>`
        <tr><td>${r.name}</td><td>${r.stage}</td><td>${r.owner}</td><td>${r.date}</td></tr>
      `).join('') || `<tr><td colspan="4">No recruiting activity yet.</td></tr>`;
    }
  }

  // kick off snapshots
  loadCommissionSnapshot();
  loadRecruitingSnapshot();
});
