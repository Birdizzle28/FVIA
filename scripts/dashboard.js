// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// scripts/dashboard.js
document.addEventListener('DOMContentLoaded', () => {
  /* ---------- FOLDER TABS (kept simple) ---------- */
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

  /* ---------- CAROUSEL CORE (max 5, wrap, autoplay 5s) ---------- */
  class Carousel {
    constructor(root) {
      this.root       = root;
      this.track      = root.querySelector('.carousel-track');
      this.prev       = root.querySelector('.car-btn.prev');
      this.next       = root.querySelector('.car-btn.next');
      this.dots       = root.querySelector('.car-dots');
  
      // config
      this.key        = root.dataset.key || 'carousel';
      this.maxVisible = parseInt(root.dataset.max || '5', 10);  // default max=5
      this.remember   = root.dataset.remember !== 'false';
      this.autoplayMs = parseInt(root.dataset.autoplay || '5000', 10); // default 5s
  
      // full set of items from markup
      this.allSlides  = Array.from(root.querySelectorAll('.slide'));
  
      // visible subset (first N)
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
      // wipe current children, re-append only visible slides
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
      this.prev.addEventListener('click', () => { this.go(this.i - 1); this.restartAuto(); });
      this.next.addEventListener('click', () => { this.go(this.i + 1); this.restartAuto(); });
  
      // keyboard (when focused anywhere in carousel root)
      this.root.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); this.go(this.i - 1); this.restartAuto(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.go(this.i + 1); this.restartAuto(); }
      });
  
      // simple drag / swipe
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
  
      // pause on hover/focus, resume on leave/blur
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
      // wrap-around index
      this.i = ((idx % len) + len) % len;
  
      const w = this.root.clientWidth;
      this.track.style.transform = `translateX(${-this.i * w}px)`;
  
      // dots
      Array.from(this.dots.children).forEach((d, j) => {
        d.setAttribute('aria-current', j === this.i ? 'true' : 'false');
      });
  
      if (save && this.remember) {
        localStorage.setItem(`carousel:${this.key}`, String(this.i));
      }
    }
  
    restoreIndex() {
      const v = localStorage.getItem(`carousel:${this.key}`);
      const n = v ? parseInt(v, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    }
  
    // autoplay helpers
    startAuto() {
      if (this.autoplayMs > 0 && this.slides.length > 1) {
        this.stopAuto();
        this._timer = setInterval(() => this.go(this.i + 1), this.autoplayMs);
      }
    }
    stopAuto() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
    pause()    { this.stopAuto(); }
    resume()   { this.startAuto(); }
    restartAuto(){ this.stopAuto(); this.startAuto(); }
  
    // expose full list for overlay
    getAllSlides(){ return this.allSlides; }
  }
  
  const carousels = Array.from(document.querySelectorAll('.carousel'))
    .map(c => new Carousel(c));
  
  /* ---------- SEE ALL OVERLAY ---------- */
  const overlay = document.getElementById('dash-overlay');
  const overlayGrid = document.getElementById('overlay-grid');
  const overlayTitle = document.getElementById('overlay-title');
  let activeCarousel = null;
  
  const openOverlay = (title, items, carouselInst) => {
    activeCarousel = carouselInst || null;
    // pause autoplay while overlay is up
    activeCarousel?.pause();
  
    overlayTitle.textContent = title;
    overlayGrid.innerHTML = '';
  
    items.forEach((el, idx) => {
      const card = document.createElement('div');
      card.className = 'overlay-item';
      card.innerHTML = `<h3>${el.querySelector('h3')?.textContent || 'Item'}</h3>
                        <p>${el.querySelector('p')?.textContent || ''}</p>`;
      card.addEventListener('click', () => {
        // Only jump if the index exists in the visible 0..maxVisible-1 set
        // (By design we only show up to 5 items in the carousel itself.)
        if (activeCarousel && idx < activeCarousel.slides.length) {
          activeCarousel.go(idx);
        }
        closeOverlay();
      });
      overlayGrid.appendChild(card);
    });
  
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.querySelector('.overlay-close').focus();
    document.body.style.overflow = 'hidden';
  };
  
  const closeOverlay = () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // resume autoplay after closing
    activeCarousel?.resume();
    activeCarousel = null;
  };
  
  overlay.addEventListener('click', (e) => {
    if (e.target.matches('[data-close], .overlay-backdrop')) closeOverlay();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) closeOverlay();
  });
  
  // hook up all "See all" buttons
  document.querySelectorAll('.see-all').forEach(btn => {
    btn.addEventListener('click', () => {
      const key  = btn.dataset.overlay;               // announcements | sales | reminders
      const host = btn.closest('.carousel');
      const inst = carousels.find(c => c.root === host);
  
      const titleMap = {
        announcements: 'All Announcements',
        sales: 'All Sales Entries',
        reminders: 'All Tasks & Reminders'
      };
      // use full set from the instance so overlay shows EVERYTHING
      openOverlay(titleMap[key] || 'All Items', inst ? inst.getAllSlides() : Array.from(host.querySelectorAll('.slide')), inst);
    });
  });
});
