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
    getAllSlides(){ return this.allSlides; }
  }
  const carousels = Array.from(document.querySelectorAll('.carousel')).map(c => new Carousel(c));

  /* ---------- SEE ALL OVERLAY ---------- */
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
        card.innerHTML = `<h3>${el.querySelector('h3')?.textContent || 'Item'}</h3>
                          <p>${el.querySelector('p')?.textContent || ''}</p>`;
        card.addEventListener('click', () => { if (activeCarousel && idx < activeCarousel.slides.length) activeCarousel.go(idx); closeOverlay(); });
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
  document.querySelectorAll('.see-all').forEach(btn => {
    btn.addEventListener('click', () => {
      const key  = btn.dataset.overlay;
      const host = btn.closest('.carousel');
      const inst = host ? carousels.find(c => c.root === host) : null;
      const titleMap = { announcements: 'All Announcements', sales: 'All Sales Entries', reminders: 'All Tasks & Reminders' };
      const items = inst ? inst.getAllSlides() : [];
      openOverlay(titleMap[key] || 'All Items', items, inst);
    });
  });

  /* ---------- LEAD SNAPSHOT ---------- */
  (async function initLeadSnapshot(){
    let userId = null;
    try { const { data: { session} } = await supabase.auth.getSession(); userId = session?.user?.id || null; } catch {}

    const rangeSel = document.getElementById('lead-range');
    const scopeRadios = document.querySelectorAll('input[name="lead-scope"]');
    const el = id => document.getElementById(id);
    const setText = (id, v) => { const n = el(id); if (n) n.textContent = String(v); };

    // infer stage from timestamps/closed_status (leads has no 'stage' col)
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

  /* ---------- COMMISSION SNAPSHOT (matches your schema) ---------- */
  async function loadCommissionSnapshot(){
    let issuedMonth = 0, ytdAP = 0, pending = 0, chargebacksCount = 0;
    let rows = [];
    try{
      const now = new Date();
      const startMonthISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const startYearISO  = new Date(now.getFullYear(), 0, 1).toISOString();

      // Pull issued policies this year (premium_annual!) and join contact for name
      const res = await supabase.from('policies')
        .select('status, carrier_name, premium_annual, issued_at, contact:contacts(first_name,last_name)')
        .not('issued_at','is', null)                 // only issued policies
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

      // Pending = all policies currently in 'pending' (not restricted by issued_at)
      const pend = await supabase.from('policies').select('id', { count:'exact', head:true }).eq('status','pending');
      pending = pend.count || 0;

      // Optional: chargebacks count in last 30d if you later add policy_status_history table
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

  /* ---------- RECRUITING SNAPSHOT (safe, no applicants required) ---------- */
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
