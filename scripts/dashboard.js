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

  /* ---------- CAROUSEL CORE ---------- */
  class Carousel {
    constructor(root) {
      this.root  = root;
      this.track = root.querySelector('.carousel-track');
      this.slides= Array.from(root.querySelectorAll('.slide'));
      this.prev  = root.querySelector('.car-btn.prev');
      this.next  = root.querySelector('.car-btn.next');
      this.dots  = root.querySelector('.car-dots');
      this.key   = root.dataset.key || 'carousel';
      this.i     = this.restoreIndex();

      this.setup();
      this.bind();
      this.go(this.i, false);
    }

    setup() {
      // build dots
      this.dots.innerHTML = '';
      this.slides.forEach((_, idx) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Go to slide ${idx + 1}`);
        b.addEventListener('click', () => this.go(idx));
        this.dots.appendChild(b);
      });

      // hide controls if only 1 slide
      const multi = this.slides.length > 1;
      this.dots.style.display = multi ? 'flex' : 'none';
      this.prev.style.display = multi ? '' : 'none';
      this.next.style.display = multi ? '' : 'none';
    }

    bind() {
      this.prev.addEventListener('click', () => this.go(this.i - 1));
      this.next.addEventListener('click', () => this.go(this.i + 1));

      // keyboard: left/right when a slide is focused
      this.root.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft')  { e.preventDefault(); this.go(this.i - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); this.go(this.i + 1); }
      });

      // touch / mouse swipe
      let startX = 0, curX = 0, dragging = false;
      const start = (x) => { dragging = true; startX = curX = x; this.track.style.transition = 'none'; };
      const move  = (x) => { if (!dragging) return; curX = x; this._translateBy(curX - startX); };
      const end   = () => {
        if (!dragging) return;
        const delta = curX - startX;
        this.track.style.transition = '';
        if (Math.abs(delta) > 50) {
          this.go(this.i + (delta < 0 ? 1 : -1));
        } else {
          this.go(this.i); // snap back
        }
        dragging = false;
      };

      this.track.addEventListener('touchstart', (e) => start(e.touches[0].clientX), {passive:true});
      this.track.addEventListener('touchmove',  (e) => move(e.touches[0].clientX),   {passive:true});
      this.track.addEventListener('touchend',   end);

      this.track.addEventListener('mousedown', (e) => start(e.clientX));
      window.addEventListener('mousemove', (e) => move(e.clientX));
      window.addEventListener('mouseup', end);

      // resize snap
      window.addEventListener('resize', () => this.go(this.i, false));
    }

    _translateBy(dx) {
      const w = this.root.clientWidth;
      const base = -this.i * w;
      this.track.style.transform = `translateX(${base + dx}px)`;
    }

    go(idx, save = true) {
      const max = this.slides.length - 1;
      this.i = Math.max(0, Math.min(max, idx));
      const w = this.root.clientWidth;
      this.track.style.transform = `translateX(${-this.i * w}px)`;

      // dots
      Array.from(this.dots.children).forEach((d, j) => {
        d.setAttribute('aria-current', j === this.i ? 'true' : 'false');
      });

      // persist
      if (save) localStorage.setItem(`carousel:${this.key}`, String(this.i));
    }

    restoreIndex() {
      const v = localStorage.getItem(`carousel:${this.key}`);
      const n = v ? parseInt(v, 10) : 0;
      return isNaN(n) ? 0 : n;
    }
  }

  const carousels = Array.from(document.querySelectorAll('.carousel')).map(c => new Carousel(c));

  /* ---------- SEE ALL OVERLAY ---------- */
  const overlay = document.getElementById('dash-overlay');
  const overlayGrid = document.getElementById('overlay-grid');
  const overlayTitle = document.getElementById('overlay-title');
  let activeCarousel = null;

  const openOverlay = (title, items, carouselInst) => {
    activeCarousel = carouselInst || null;
    overlayTitle.textContent = title;
    overlayGrid.innerHTML = '';

    items.forEach((el, idx) => {
      const card = document.createElement('div');
      card.className = 'overlay-item';
      card.innerHTML = `<h3>${el.querySelector('h3')?.textContent || 'Item'}</h3>
                        <p>${el.querySelector('p')?.textContent || ''}</p>`;
      card.addEventListener('click', () => {
        if (activeCarousel) activeCarousel.go(idx);
        closeOverlay();
      });
      overlayGrid.appendChild(card);
    });

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    // basic focus move
    overlay.querySelector('.overlay-close').focus();
    document.body.style.overflow = 'hidden';
  };

  const closeOverlay = () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
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
      const key = btn.dataset.overlay; // announcements | sales | reminders
      const host = btn.closest('.carousel');
      const slides = Array.from(host.querySelectorAll('.slide'));
      const inst = carousels.find(c => c.root === host);

      const titleMap = {
        announcements: 'All Announcements',
        sales: 'All Sales Entries',
        reminders: 'All Tasks & Reminders'
      };
      openOverlay(titleMap[key] || 'All Items', slides, inst);
    });
  });
});
