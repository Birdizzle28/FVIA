// Initialize Supabase client (module-friendly via ESM CDN)
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);
window.supabase = supabase;

document.addEventListener('DOMContentLoaded', () => {
  /* ---------- FOLDER TABS ---------- */
    function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>"]/g, (c) => {
      switch (c) {
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        default:  return c;
      }
    });
  }
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
    rebuildTrack() {
      this.track.innerHTML = '';
      this.slides.forEach(sl => this.track.appendChild(sl));
    }
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
      const start = (x) => {
        dragging = true;
        startX = curX = x;
        this.track.style.transition = 'none';
        this.pause();
      };
      const move  = (x) => {
        if (!dragging) return;
        curX = x;
        this._translateBy(curX - startX);
      };
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
    _translateBy(dx) {
      const w = this.root.clientWidth;
      const base = -this.i * w;
      this.track.style.transform = `translateX(${base + dx}px)`;
    }
    go(idx, save = true) {
      const len = Math.max(1, this.slides.length);
      this.i = ((idx % len) + len) % len;
      const w = this.root.clientWidth;
      this.track.style.transform = `translateX(${-this.i * w}px)`;
      Array.from(this.dots.children).forEach((d, j) =>
        d.setAttribute('aria-current', j === this.i ? 'true' : 'false')
      );
      if (save && this.remember) {
        localStorage.setItem(`carousel:${this.key}`, String(this.i));
      }
    }
    restoreIndex() {
      const v = localStorage.getItem(`carousel:${this.key}`);
      const n = v ? parseInt(v, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    }
    startAuto() {
      if (this.autoplayMs > 0 && this.slides.length > 1) {
        this.stopAuto();
        this._timer = setInterval(() => this.go(this.i + 1), this.autoplayMs);
      }
    }
    stopAuto() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }
    pause() {
      this.stopAuto();
    }
    resume() {
      this.startAuto();
    }
    restartAuto() {
      this.stopAuto();
      this.startAuto();
    }
    setSlides(newSlides) {
      this.allSlides = Array.from(newSlides);
      this.slides = this.allSlides.slice(0, this.maxVisible);
      this.rebuildTrack();
      this.setupDots();
      this.go(0, false);
      this.restartAuto();
    }
    getAllSlides() {
      return this.allSlides;
    }
  }

  const carousels = Array.from(document.querySelectorAll('.carousel')).map(
    c => new Carousel(c)
  );

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
      items.forEach((el, idx) => {
        const card = document.createElement('div');
        card.className = 'overlay-item';
        card.innerHTML = `
          <h3>${el.querySelector('h3')?.textContent || 'Item'}</h3>
          <p>${el.querySelector('p')?.textContent || ''}</p>
        `;
        card.addEventListener('click', () => {
          if (activeCarousel && idx < activeCarousel.slides.length) {
            activeCarousel.go(idx);
          }
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

  overlay.addEventListener('click', (e) => {
    if (e.target.matches('[data-close], .overlay-backdrop')) closeOverlay();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      closeOverlay();
    }
  });

  /* ---------- Announcement DETAIL overlay ---------- */
  const detailOverlay = document.getElementById('annc-detail-overlay');
  if (!detailOverlay) return; // or wrap all detail functions in a guard
  
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

  function closeDetail() {
    detailOverlay.classList.remove('open');
    detailOverlay.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
  }

  detailOverlay.addEventListener('click', (e) => {
    if (e.target.matches('[data-close], .overlay-backdrop')) closeDetail();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailOverlay.classList.contains('open')) {
      closeDetail();
    }
  });

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

  // “See all” button handlers (Announcements get a custom renderer)
  document.querySelectorAll('.see-all').forEach(btn => {
    btn.addEventListener('click', () => {
      const key  = btn.dataset.overlay;
      const host = btn.closest('.carousel');
      const inst = host ? carousels.find(c => c.root === host) : null;
      const titleMap = {
        announcements: 'All Announcements',
        sales: 'All Sales Entries',
        reminders: 'All Tasks & Reminders'
      };
      if (key === 'announcements') {
        openAnnouncementsOverlay(inst);
      } else {
        const items = inst ? inst.getAllSlides() : [];
        openOverlay(titleMap[key] || 'All Items', items, inst);
      }
    });
  });

  /* ---------- ANNOUNCEMENTS (live from Supabase) ---------- */
  let _announcements = []; // filtered list for overlays

  async function getMyAgentMini() {
    const { data: { session } } = await supabase.auth.getSession();
    const myId = session?.user?.id || null;
  
    const me = {
      id: myId,
      is_admin: false,
      level: null,
      npn: null,
      licenses: []
    };
  
    if (!myId) return me;
  
    // load base agent info
    const { data: agent } = await supabase
      .from('agents')
      .select('is_admin, level, agent_id')
      .eq('id', myId)
      .single();
  
    if (agent) {
      me.is_admin = !!agent.is_admin;
      me.level    = agent.level || null;
      me.npn      = agent.agent_id || null;
    }
  
    // load NIPR licenses for this agent (by NPN)
    if (me.npn) {
      const { data: licRows } = await supabase
        .from('agent_nipr_licenses')
        .select('state, active, license_class, loa_names, loa_details')
        .eq('agent_id', me.npn);
  
      me.licenses = licRows || [];
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
        <div class="annc-img">
          ${hasImg ? `<img src="${a.image_url}" alt="">` : ''}
        </div>
      </div>
    `;

    const open = (e) => {
      if (e.target.closest('a')) return;
      openDetail(a);
    };
    art.addEventListener('click', open);
    art.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(e);
      }
    });

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
      const aud   = r.audience || { scope: 'all' };
      const scope = aud.scope || 'all';
      const licenses = me.licenses || [];
    
      // Admin-only
      if (scope === 'admins') return me.is_admin;
    
      // Everyone
      if (scope === 'all') return true;
    
      // Helpers that ALWAYS respect active === true
      const hasState = (target) => {
        if (!target) return false;
        const T = String(target).toUpperCase();
        return licenses.some(lic =>
          lic.active === true &&
          String(lic.state || '').toUpperCase() === T
        );
      };
    
      const hasProduct = (prod) => {
        if (!prod) return false;
        const p = String(prod).toLowerCase();
        return licenses.some(lic => {
          if (!lic.active) return false;
          const loas = lic.loa_names || [];
          if (p === 'life')     return loas.includes('Life');
          if (p === 'health')   return loas.includes('Accident & Health') || loas.includes('Health');
          if (p === 'property') return loas.includes('Property');
          if (p === 'casualty') return loas.includes('Casualty');
          return false;
        });
      };
    
      // By state only
      if (scope === 'by_state') {
        const states = aud.states || [];
        if (!states.length) return false;
        return states.some(s => hasState(s));
      }
    
      // By product only
      if (scope === 'by_product') {
        const products = aud.products || [];
        if (!products.length) return false;
        return products.some(p => hasProduct(p));
      }
    
      // By product AND state (THIS WAS BUGGY BEFORE)
      if (scope === 'by_product_state') {
        const states   = (aud.states   || []).map(s => String(s).toUpperCase());
        const products = (aud.products || []).map(p => String(p).toLowerCase());
        if (!states.length || !products.length) return false;
    
        return licenses.some(lic => {
          if (!lic.active) return false;
    
          const licState = String(lic.state || '').toUpperCase();
          if (!states.includes(licState)) return false;
    
          const loas = lic.loa_names || [];
          const productOk = products.some(p => {
            if (p === 'life')     return loas.includes('Life');
            if (p === 'health')   return loas.includes('Accident & Health') || loas.includes('Health');
            if (p === 'property') return loas.includes('Property');
            if (p === 'casualty') return loas.includes('Casualty');
            return false;
          });
    
          return productOk;
        });
      }
    
      // Custom specific agents
      if (scope === 'custom_agents') {
        return me.id && (aud.agent_ids || []).includes(me.id);
      }
    
      // Anything unknown → hide
      return false;
    };

    const list = (rows || []).filter(timeOk).filter(showsForMe);
    _announcements = list;

    const slides = list.length
      ? list.map(makeAnncSlide)
      : [makeAnncSlide({ title: 'No announcements', body: 'Nothing to show yet.' })];

    inst?.setSlides(slides);
  }

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
        const card = document.createElement('div');
        card.className = 'overlay-item image-card';
        card.setAttribute('data-annc-idx', String(idx));
        card.style.backgroundImage = a.image_url ? `url("${a.image_url}")` : 'none';
        card.innerHTML = `
          <div class="card-content">
            <h3>${a.title || 'Untitled'}</h3>
            <p>${(a.body || '').length > 140 ? (a.body.slice(0,140) + '…') : (a.body || '')}</p>
            <div class="mini-actions">
              <button class="icon-btn btn-eye" title="View details" data-idx="${idx}">
                <i class="fa-solid fa-eye"></i> View
              </button>
              ${a.link_url ? `
              <a class="icon-btn btn-linkout" href="${a.link_url}" target="_blank" rel="noopener">
                <i class="fa-solid fa-link"></i> Open link
              </a>` : ''}
            </div>
          </div>
        `;
        overlayGrid.appendChild(card);
      });

      overlayGrid.querySelectorAll('.btn-eye').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = Number(btn.getAttribute('data-idx')||'0');
          const annc = _announcements[idx];
          if (annc) openDetail(annc);
        });
      });

      overlayGrid.querySelectorAll('.overlay-item.image-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.mini-actions')) return;
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

  // initial announcements load + realtime
  loadAnnouncementsCarousel();
  try {
    supabase.channel('announcements-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, loadAnnouncementsCarousel)
      .subscribe();
  } catch (e) {
    console.warn('Realtime not available:', e);
  }

    /* ---------- TASKS / REMINDERS (from public.tasks) ---------- */

  function makeTaskSlide(task) {
    const art = document.createElement('article');
    art.className = 'slide task';
    art.tabIndex = 0;

    const meta = task.metadata || {};

    // pick a notes field if it exists
    const notes =
      meta.notes ||
      meta.note ||
      meta.description ||
      meta.body ||
      meta.details ||
      '';

    // status label
    const statusRaw = (task.status || 'open').toLowerCase();
    let statusLabel = 'Open';
    if (statusRaw === 'completed') statusLabel = 'Completed';
    else if (statusRaw === 'cancelled') statusLabel = 'Cancelled';

    // format dates
    const fmt = (d) => {
      try {
        return d ? new Date(d).toLocaleString() : '';
      } catch {
        return '';
      }
    };

    const bits = [];
    bits.push(`Status: ${statusLabel}`);
    if (task.channel) bits.push(`Channel: ${task.channel}`);
    if (task.scheduled_at) bits.push(`Scheduled: ${fmt(task.scheduled_at)}`);
    if (task.due_at) bits.push(`Due: ${fmt(task.due_at)}`);

    // first line: status / channel / dates
    let bodyHtml = escapeHtml(bits.join(' • '));

    // second line: notes, if any
    if (notes) {
      bodyHtml += '<br><strong>Notes:</strong> ' + escapeHtml(notes);
    }

    const imgUrl =
      task.metadata?.image_url || null;
    
    let imgHtml = '';
    if (imgUrl) {
      imgHtml = `
        <div class="task-img-wrap">
          <img src="${imgUrl}" alt="" style="width:100%; border-radius:8px; margin-top:8px;">
        </div>
      `;
    }
    art.innerHTML = `
      <h3>${escapeHtml(task.title || 'Task')}</h3>
      <p>${bodyHtml}</p>
      ${imgHtml}
    `;
  
    return art;
  }

  async function loadTasksCarousel() {
    const root = document.querySelector('.carousel[data-key="reminders"]');
    if (!root) return;

    const inst = carousels.find((c) => c.root === root);

    // who is logged in?
    let userId = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id || null;
    } catch (err) {
      console.warn('Could not get session for tasks:', err);
    }

    if (!userId) {
      const slide = makeTaskSlide({
        title: 'No tasks available',
        status: 'open',
        channel: null,
        scheduled_at: null,
        due_at: null,
        metadata: { notes: 'Log in to see your assigned tasks.' }
      });
      inst?.setSlides([slide]);
      return;
    }

    // Only tasks for THIS user, and only non-cancelled (you can tighten this to status = open if you want)
    const { data, error } = await supabase
      .from('tasks')
      .select('id, title, scheduled_at, due_at, completed_at, status, channel, metadata, created_at')
      .eq('assigned_to', userId)
      .neq('status', 'cancelled')
      .order('status', { ascending: true })           // open first, then completed
      .order('due_at', { ascending: true, nullsLast: true })
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      console.warn('Tasks load error:', error);
      const slide = makeTaskSlide({
        title: 'Could not load tasks',
        status: 'open',
        metadata: { notes: 'There was an error loading your tasks. Please try again later.' }
      });
      inst?.setSlides([slide]);
      return;
    }

    const rows = data || [];

    if (!rows.length) {
      const slide = makeTaskSlide({
        title: 'No tasks assigned to you',
        status: 'open',
        metadata: { notes: 'You don’t have any tasks yet.' }
      });
      inst?.setSlides([slide]);
      return;
    }

    const slides = rows.map(makeTaskSlide);
    inst?.setSlides(slides);
  }
  /* ---------- LEAD SNAPSHOT ---------- */
  (async function initLeadSnapshot(){
    let userId = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id || null;
    } catch {}

    const rangeSel = document.getElementById('lead-range');
    const scopeRadios = document.querySelectorAll('input[name="lead-scope"]');
    const el = id => document.getElementById(id);
    const setText = (id, v) => {
      const n = el(id);
      if (n) n.textContent = String(v);
    };

    function inferStage(row){
      if (row.closed_at || ['won','lost'].includes((row.closed_status||'').toLowerCase())) return 'closed';
      if (row.quoted_at)     return 'quoted';
      if (row.contacted_at)  return 'contacted';
      return 'new';
    }

    function fmtDate(d){
      try {
        return new Date(d).toLocaleDateString(undefined, { month:'short', day:'numeric' });
      } catch {
        return '';
      }
    }

    async function fetchLeads(days, scope){
      let q = supabase.from('leads')
        .select('id, first_name, last_name, zip, product_type, notes, created_at, assigned_to, submitted_by, quoted_at, contacted_at, closed_at, closed_status')
        .order('created_at', { ascending:false });

      if (scope === 'mine' && userId) {
        q = q.or(`assigned_to.eq.${userId},submitted_by.eq.${userId}`);
      }
      if (days && Number(days) > 0) {
        const since = new Date();
        since.setDate(since.getDate() - Number(days));
        q = q.gte('created_at', since.toISOString());
      }
      const { data, error } = await q.limit(200);
      if (error) {
        console.warn('Lead fetch error:', error);
        return [];
      }
      return data || [];
    }

    function renderCounts(rows){
      const counts = { new:0, contacted:0, quoted:0, closed:0 };
      rows.forEach(r => {
        const k = inferStage(r);
        counts[k] = (counts[k]||0) + 1;
      });
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
      if (newOnes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4">No new leads in this range.</td></tr>`;
        return;
      }
      newOnes.forEach(r => {
        const tr = document.createElement('tr');
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
        tr.innerHTML = `
          <td>${name}</td>
          <td>${r.product_type || '—'}</td>
          <td>${r.zip || '—'}</td>
          <td>${r.created_at ? fmtDate(r.created_at) : '—'}</td>
        `;
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

    /* ---------- AVAILABILITY SWITCH (agents.is_available) ---------- */
    (async () => {
      const switchEl = document.getElementById("availabilitySwitch");
      const statusEl = document.getElementById("availabilityStatus");
      if (!switchEl || !statusEl) return;
  
      let user = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        user = session?.user;
        if (!user) {
          console.warn("No user found — redirecting to login");
          window.location.href = "login.html";
          return;
        }
      } catch (err) {
        console.error("Error fetching session:", err);
        return;
      }
  
      // Read current availability from agents.is_available
      let isAvail = false;
      let hasAgentRow = false;
      try {
        const { data: agentRow, error } = await supabase
          .from("agents")
          .select("is_available")
          .eq("id", user.id)
          .single();
  
        if (error && error.code !== "PGRST116") {
          console.error("Error fetching agent availability:", error);
        }
  
        if (agentRow) {
          hasAgentRow = true;
          isAvail = !!agentRow.is_available;
        }
      } catch (err) {
        console.error("Error loading availability:", err);
      }
  
      // If there's no agents row for this user, disable toggle
      if (!hasAgentRow) {
        switchEl.disabled = true;
        statusEl.textContent = "No agent record";
        statusEl.style.color = "#b00020";
        return;
      }
  
      // Initialize UI
      switchEl.checked = isAvail;
      statusEl.textContent = isAvail ? "I’m Available" : "I’m Offline";
      statusEl.style.color = isAvail ? "#4caf50" : "#999";
  
      // Toggle handler → UPDATE agents.is_available (no upsert)
      switchEl.addEventListener("change", async () => {
        const next = switchEl.checked;
  
        // optimistic UI
        statusEl.textContent = next ? "I’m Available" : "I’m Offline";
        statusEl.style.color = next ? "#4caf50" : "#999";
  
        const { error } = await supabase
          .from("agents")
          .update({ is_available: next })
          .eq("id", user.id);
  
        if (error) {
          console.error("Availability update error:", error);
          alert("Could not update availability: " + (error.message || "Unknown error"));
          // revert on failure
          switchEl.checked = !next;
          statusEl.textContent = switchEl.checked ? "I’m Available" : "I’m Offline";
          statusEl.style.color = switchEl.checked ? "#4caf50" : "#999";
        }
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
        <tr>
          <td>${r.carrier}</td>
          <td>${r.client}</td>
          <td>${r.status||'—'}</td>
          <td>$${Math.round(r.ap).toLocaleString()}</td>
          <td>${r.date}</td>
        </tr>
      `).join('') || `<tr><td colspan="5">No policy data yet.</td></tr>`;
    }
  }

/* ---------- RECRUITING SNAPSHOT (FINAL, USING agents.is_active) ---------- */

function getDownlineAgentIds(rootId, agents) {
  const downline = [];
  const seen = new Set([rootId]);
  const queue = [rootId];

  while (queue.length) {
    const current = queue.shift();
    for (const a of agents) {
      if (a.recruiter_id === current && !seen.has(a.id)) {
        seen.add(a.id);
        downline.push(a.id);
        queue.push(a.id);
      }
    }
  }
  return downline;
}

function prettyStage(stage) {
  if (!stage) return '—';
  const s = String(stage).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function loadRecruitingSnapshot() {
  const $ = (id) => document.getElementById(id);

  // Get logged-in agent's ID
  let userId = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    userId = session?.user?.id || null;
  } catch {}
  if (!userId) return;

  /* 1) LOAD ALL AGENTS (needed for team & recruiter names) */
  const agentsRes = await supabase
    .from('agents')
    .select('id, recruiter_id, full_name, is_active, created_at');

  if (agentsRes.error) {
    console.warn('Agents error:', agentsRes.error);
    return;
  }
  const agents = agentsRes.data || [];

  /* Build complete downline tree */
  const downlineIds = getDownlineAgentIds(userId, agents);

  /* ---------- METRIC 1: TEAM SIZE ---------- */
  const teamSize = downlineIds.length;

  /* ---------- METRIC 2: ACTIVE AGENTS ---------- */
  // agents.is_active determines this
  const activeCount = agents.filter(
    (a) => downlineIds.includes(a.id) && a.is_active === true
  ).length;

  /* ---------- METRIC 3/4/5: RECRUITS ---------- */

  // IDs in recruiting scope (you + downline)
  const recruiterTreeIds = [userId, ...downlineIds];

  const recRes = await supabase
    .from('recruits')
    .select('id, first_name, last_name, stage, recruiter_id, stage_updated_at')
    .in('recruiter_id', recruiterTreeIds)
    .order('stage_updated_at', { ascending: false })
    .limit(200);

  let recruits = [];
  if (!recRes.error && recRes.data) {
    recruits = recRes.data;
  } else {
    recruits = [];
    console.warn('Recruits query error:', recRes.error);
  }

  /* ---------- METRIC 3: PIPELINE ---------- */
  const excludedStages = new Set(['dropped', 'contracting', 'active']);
  const pipelineCount = recruits.filter((r) => {
    const s = (r.stage || '').toLowerCase();
    return !excludedStages.has(s);
  }).length;

  /* ---------- METRIC 4: INTERVIEWS (last 30 days) ---------- */
  const cutoff30 = new Date(Date.now() - 30 * 864e5);
  const interviews30 = recruits.filter((r) => {
    const s = (r.stage || '').toLowerCase();
    if (s !== 'interview') return false;
    if (!r.stage_updated_at) return false;
    return new Date(r.stage_updated_at) >= cutoff30;
  }).length;

  /* ---------- METRIC 5: RECENT RECRUITING ACTIVITY ---------- */
  const tbody = $('rec-recent-activity');
  if (tbody) {
    const idToName = new Map(agents.map((a) => [a.id, a.full_name || '—']));

    const recent = recruits.slice(0, 6);
    if (!recent.length) {
      tbody.innerHTML = `<tr><td colspan="4">No recruiting activity yet.</td></tr>`;
    } else {
      tbody.innerHTML = recent
        .map((r) => {
          const name =
            [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
          const recruiterName = idToName.get(r.recruiter_id) || '—';
          const date = r.stage_updated_at
            ? new Date(r.stage_updated_at).toLocaleDateString()
            : '—';
          return `
            <tr>
              <td>${name}</td>
              <td>${prettyStage(r.stage)}</td>
              <td>${recruiterName}</td>
              <td>${date}</td>
            </tr>
          `;
        })
        .join('');
    }
  }

  /* ---------- WRITE METRIC COUNTS TO UI ---------- */
  if ($('rec-team')) $('rec-team').textContent = String(teamSize);
  if ($('rec-active')) $('rec-active').textContent = String(activeCount);
  if ($('rec-pipeline')) $('rec-pipeline').textContent = String(pipelineCount);
  if ($('rec-interviews')) $('rec-interviews').textContent = String(interviews30);
}

  // kick off snapshots
  loadCommissionSnapshot();
  loadRecruitingSnapshot();
  loadTasksCarousel();

  /* ---------- COMPLIANCE CARD (YOUR RULES IMPLEMENTED EXACTLY) ---------- */
  (async function initComplianceCard() {
    const npnEl      = document.getElementById('npn-value');
    const uplNameEl  = document.getElementById('upline-name');
    const uplPhoneEl = document.getElementById('upline-phone');
    const uplEmailEl = document.getElementById('upline-email');
    const listEl     = document.getElementById('license-list');
  
    if (!npnEl || !listEl) return;
  
    const safe = (el, v) => el.textContent = v ? v : '—';
  
    // 1) WHO IS LOGGED IN?
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;
  
    // 2) GET AGENT ROW BY EMAIL (YOUR schema)
    const { data: me } = await supabase
      .from('agents')
      .select('id, full_name, phone, email, agent_id, recruiter_id')
      .eq('email', user.email)
      .single();
  
    if (!me) {
      safe(npnEl, null);
      listEl.innerHTML = `<p class="muted">No agent entry found for this account.</p>`;
      return;
    }
  
    // -----------------------------
    // 3) NPN = agents.agent_id
    // -----------------------------
    const npn = me.agent_id;
    safe(npnEl, npn);
  
    // -----------------------------
    // 4) UPLINE LOOKUP
    // recruiter_id → agents.id
    // -----------------------------
    if (me.recruiter_id) {
      const { data: upline } = await supabase
        .from('agents')
        .select('full_name, phone, email')
        .eq('id', me.recruiter_id)
        .single();
  
      safe(uplNameEl,  upline?.full_name);
      safe(uplPhoneEl, upline?.phone);
      safe(uplEmailEl, upline?.email);
  
    } else {
      safe(uplNameEl,  'Not assigned');
      safe(uplPhoneEl, null);
      safe(uplEmailEl, null);
    }
  
    // -----------------------------
    // 5) LICENSES
    // agent_nipr_licenses.agent_id == agents.agent_id
    // -----------------------------
    const { data: licenses } = await supabase
      .from('agent_nipr_licenses')
      .select('*')
      .eq('agent_id', npn)
      .order('state');
  
    if (!licenses?.length) {
      listEl.innerHTML = `<p class="muted">No NIPR licenses on file yet for this agent.</p>`;
      return;
    }
  
    // Build license blocks
    listEl.innerHTML = '';
    licenses.forEach(lic => {
      const block = document.createElement('div');
      block.className = 'license-block';
  
      block.innerHTML = `
        <div class="license-header">
          <span class="license-title">${lic.state} — ${lic.license_class || ''}</span>
          <span class="license-status ${lic.active ? 'active' : 'inactive'}">
            ${lic.active ? 'Active' : 'Inactive'}
          </span>
        </div>
  
        <div class="license-meta">
          <span><strong>Number:</strong> ${lic.license_number || '—'}</span>
          <span><strong>Issued:</strong> ${lic.date_issue_orig || '—'}</span>
          <span><strong>Expires:</strong> ${lic.date_expire || '—'}</span>
        </div>
  
        <div class="license-loas">
          ${(lic.loa_names || []).map(l => `<span class="license-chip">${l}</span>`).join('') 
            || '<span class="muted">No LOAs listed</span>'}
        </div>
      `;
  
      listEl.appendChild(block);
    });
  })();

  /* ---------- PERSONAL INFO LOCK (email + Supabase send-email, 15-min TTL) ---------- */
  (async function initPersonalInfoLock() {
    const card      = document.getElementById("pi-lock-card");
    const content   = document.getElementById("pi-content");
    const emailIn   = document.getElementById("pi-email-input");
    const sendBtn   = document.getElementById("pi-email-send");
    const codeRow   = document.getElementById("pi-code-row");
    const codeIn    = document.getElementById("pi-email-code");
    const verifyBtn = document.getElementById("pi-email-verify");
    const statusEl  = document.getElementById("pi-lock-status");

    if (!card || !content) return;

    const TTL_MS = 15 * 60 * 1000; // 15 minutes

    const setStatus = (msg, isError = false) => {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.style.color = isError ? "#b00020" : "#2a8f6d";
    };

    // Get logged-in user
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setStatus("You must be logged in to unlock this section.", true);
      return;
    }

    const userId    = user.id;
    const userEmail = user.email || "";
    const unlockKey = `pi-email-unlocked:${userId}`;

    const unlock = () => {
      // Hide the lock card
      if (card) {
        card.style.display = "none";
      }

      // Try to find a wrapper around the PI section if you have one
      const wrapper =
        document.getElementById("pi-wrapper") ||
        content?.parentElement ||
        null;

      // Remove lock / blur classes from anything in this area
      [wrapper, content].forEach((el) => {
        if (!el) return;
        el.classList.remove("pi-locked", "pi-blur");
        el.style.filter = "none";
        el.style.pointerEvents = "auto";
      });

      // Extra safety: clear on any descendants with pi-locked/pi-blur
      document
        .querySelectorAll("#pi-content .pi-locked, #pi-content .pi-blur")
        .forEach((el) => {
          el.classList.remove("pi-locked", "pi-blur");
          el.style.filter = "none";
          el.style.pointerEvents = "auto";
        });

      // store expiration time (now + 15 min)
      const expiresAt = Date.now() + TTL_MS;
      localStorage.setItem(unlockKey, String(expiresAt));
    };

    // Check if already unlocked in this browser AND not expired
    const stored = localStorage.getItem(unlockKey);
    if (stored) {
      const expiresAt = Number(stored);
      if (Number.isFinite(expiresAt) && Date.now() < expiresAt) {
        // still within 15 minutes → auto-unlock
        unlock();
        return;
      } else {
        // expired or invalid → clear and require re-verification
        localStorage.removeItem(unlockKey);
      }
    }

    // Prefill email with account email (and lock it)
    if (emailIn) {
      emailIn.value = userEmail;
      emailIn.readOnly = false;
    }

    // This holds the *current* code only while the page is open
    let lastCode = null;

    // SEND CODE
    sendBtn?.addEventListener("click", async () => {
      const typed = (emailIn?.value || "").trim();
      
      if (!typed) {
        setStatus("Enter your email address first.", true);
        return;
      }
      
      if (!userEmail) {
        setStatus("No email found for this account.", true);
        return;
      }

      // core requirement: typed must match auth email
      if (typed.toLowerCase() !== userEmail.toLowerCase()) {
        setStatus("That email doesn’t match the one on your account.", true);
        return;
      }

      // Generate 6-digit code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      lastCode = code;
      console.log("PI lock code (for debugging):", code);

      setStatus("Sending code…");

      try {
        const { data, error } = await supabase.functions.invoke("send-email", {
          body: {
            to: userEmail,
            subject: "Your Family Values verification code",
            html: `<p>Your unlock code is <strong>${code}</strong>.</p>`,
          },
        });

        if (error || !data?.ok) {
          console.error("send-email error:", error || data);
          setStatus("Error sending code. Please try again.", true);
          return;
        }

        if (codeRow) codeRow.hidden = false;
        setStatus("Code sent! Check your email.");
      } catch (err) {
        console.error("send-email invoke failed:", err);
        setStatus("Network error while sending code.", true);
      }
    });

    // VERIFY CODE
    verifyBtn?.addEventListener("click", () => {
      const entered = (codeIn?.value || "").trim();

      if (!lastCode) {
        setStatus("You need to send a code first.", true);
        return;
      }
      if (!entered) {
        setStatus("Enter the code from your email.", true);
        return;
      }
      if (entered !== lastCode) {
        setStatus("That code does not match. Try again or send a new one.", true);
        return;
      }

      setStatus("Verified. Unlocking…");
      unlock();
    });
  })();
});
