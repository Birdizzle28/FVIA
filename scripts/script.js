import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);
  
window.addEventListener("load", () => {
  const slides = document.querySelector(".carousel");
  const thumbWrapper = document.querySelector(".thumbnail-wrapper");
  const container = document.querySelector(".carousel-container");

  if (!slides || !thumbWrapper || !container || !slides.children.length) {
    console.warn("Carousel elements are missing or empty.");
    return;
  }

  const count = slides.children.length;
  let idx = 0;
  let pos = 0;
  let width = slides.firstElementChild.offsetWidth;
  let timer;
  const pause = 5000;

  // Build thumbnails
  for (let i = 0; i < count; i++) {
    const thumb = document.createElement("img");
    thumb.src = slides.children[i].src;
    thumb.className = "thumbnail" + (i === 0 ? " active-thumb" : "");
    thumb.dataset.i = i;
    thumb.addEventListener("click", () => {
      jumpTo(i);
      resetTimer();
    });
    thumbWrapper.appendChild(thumb);
  }

  const updateThumbs = () => {
    document.querySelectorAll(".thumbnail").forEach((t, i) => {
      t.classList.toggle("active-thumb", i === idx);
    });
  };

  const slideNext = () => {
    pos += width;
    slides.style.left = `-${pos}px`;
    slides.style.transition = "left 0.5s";
    idx = (idx + 1) % count;

    setTimeout(() => {
      slides.appendChild(slides.firstElementChild);
      slides.style.transition = "none";
      pos -= width;
      slides.style.left = `-${pos}px`;
      updateThumbs();
    }, 500);
  };

  const slidePrev = () => {
    slides.style.transition = "none";
    slides.insertBefore(slides.lastElementChild, slides.firstElementChild);
    pos += width;
    slides.style.left = `-${pos}px`;
    idx = (idx - 1 + count) % count;

    setTimeout(() => {
      slides.style.transition = "left 0.5s";
      pos -= width;
      slides.style.left = `-${pos}px`;
      updateThumbs();
    }, 20);
  };

  const jumpTo = (target) => {
    if (target === idx) return;
    const diff = (target - idx + count) % count;
    for (let i = 0; i < diff; i++) {
      slides.appendChild(slides.firstElementChild);
    }
    slides.style.transition = "none";
    pos = 0;
    slides.style.left = "0px";
    idx = target;
    updateThumbs();
  };

  const startTimer = () => (timer = setInterval(slideNext, pause));
  const stopTimer = () => clearInterval(timer);
  const resetTimer = () => {
    stopTimer();
    startTimer();
  };

  // Add arrows
  ["left", "right"].forEach((dir) => {
    const btn = document.createElement("button");
    btn.className = `arrow ${dir}`;
    btn.innerHTML = dir === "left" ? "&#9664;" : "&#9654;";
    btn.addEventListener("click", () => {
      dir === "left" ? slidePrev() : slideNext();
      resetTimer();
    });
    container.appendChild(btn);
  });

  // Pause on hover
  container.addEventListener("mouseenter", stopTimer);
  container.addEventListener("mouseleave", startTimer);

  // Swipe support
  let startX = 0;
  container.addEventListener("touchstart", (e) => (startX = e.touches[0].clientX));
  container.addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 50) {
      dx > 0 ? slidePrev() : slideNext();
      resetTimer();
    }
  });

  // Init
  slides.style.left = "0px";
  startTimer();

  // Resize handling
  window.addEventListener("resize", () => {
    width = slides.firstElementChild.offsetWidth;
  });
});

  <script type="module">
  (async () => {
    // --- Supabase bootstrap (reuses window.supabase if already present) ---
    const URL  = window.FVG_SUPABASE_URL  || "https://ddlbgkolnayqrxslzsxn.supabase.co";
    const KEY  = window.FVG_SUPABASE_ANON || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho";
    let supabase = window.supabase;
    if (!supabase && URL && KEY) {
      const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.44.4/+esm");
      supabase = createClient(URL, KEY, { auth: { persistSession: false }});
      window.supabase = supabase;
    }

    const mount = document.getElementById("agent-cards-container");
    if (!mount) return;
    mount.innerHTML = "Loading team…";

    try {
      const { data: agents, error } = await supabase
        .from("agents")
        .select("full_name, bio, profile_picture_url")
        .eq("show_on_about", true)
        .eq("is_active", true)
        .order("full_name", { ascending: true })
        .limit(24);

      if (error) throw error;
      if (!agents || agents.length === 0) {
        mount.innerHTML = "<p>No team members to show yet.</p>";
        return;
      }

      // --- Build slider shell ---
      mount.innerHTML = `
        <section class="agent-slider" aria-roledescription="carousel" aria-label="Team carousel">
          <button class="agent-arrow prev" aria-label="Previous">&#10094;</button>
          <div class="agent-viewport">
            <div class="agent-track" role="list"></div>
          </div>
          <button class="agent-arrow next" aria-label="Next">&#10095;</button>
          <div class="agent-thumbs" role="tablist" aria-label="Team thumbnails"></div>
        </section>
      `;

      const track  = mount.querySelector(".agent-track");
      const thumbs = mount.querySelector(".agent-thumbs");

      // Slides + thumbs
      agents.forEach((a, i) => {
        const img = a.profile_picture_url || "Pics/placeholder-user.png";
        const name = a.full_name || "Team member";
        const bio  = a.bio || "No bio provided.";

        const slide = document.createElement("article");
        slide.className = "agent-slide";
        slide.setAttribute("role", "group");
        slide.setAttribute("aria-roledescription", "slide");
        slide.setAttribute("aria-label", `${i + 1} of ${agents.length}`);
        slide.innerHTML = `
          <img class="agent-photo" src="${img}" alt="${name}">
          <div class="agent-copy">
            <h3>${name}</h3>
            <p class="agent-bio">${bio}</p>
          </div>
        `;
        track.appendChild(slide);

        const th = document.createElement("button");
        th.className = "agent-thumb";
        th.setAttribute("role", "tab");
        th.setAttribute("aria-label", `Go to ${name}`);
        th.innerHTML = `<img src="${img}" alt="">`;
        th.addEventListener("click", () => go(i));
        thumbs.appendChild(th);
      });

      // --- Slider logic (arrows, drag/swipe, thumbs, resize) ---
      const prev = mount.querySelector(".agent-arrow.prev");
      const next = mount.querySelector(".agent-arrow.next");
      let i = 0, w = 0, dragging = false, startX = 0, curX = 0, raf;

      const slides = Array.from(track.children);
      const thumbBtns = Array.from(thumbs.children);

      function measure(){ w = mount.querySelector(".agent-viewport").clientWidth; }
      function translate(x){ track.style.transform = `translateX(${x}px)`; }

      function go(idx){
        i = ((idx % slides.length) + slides.length) % slides.length;
        translate(-i * w);
        thumbBtns.forEach((b,j)=> b.classList.toggle("is-active", j === i));
      }

      function nextSlide(){ go(i + 1); }
      function prevSlide(){ go(i - 1); }

      prev.addEventListener("click", prevSlide);
      next.addEventListener("click", nextSlide);

      // Drag / swipe
      const vp = mount.querySelector(".agent-viewport");
      function onDown(x){
        dragging = true; startX = curX = x;
        track.style.transition = "none";
        cancelAnimationFrame(raf);
      }
      function onMove(x){
        if (!dragging) return;
        curX = x;
        const delta = curX - startX;
        translate(-i * w + delta);
      }
      function onUp(){
        if (!dragging) return;
        const delta = curX - startX;
        track.style.transition = "";
        if (Math.abs(delta) > w * 0.15) (delta < 0 ? nextSlide() : prevSlide());
        else go(i);
        dragging = false;
      }

      vp.addEventListener("mousedown", e => onDown(e.clientX));
      window.addEventListener("mousemove", e => onMove(e.clientX));
      window.addEventListener("mouseup", onUp);

      vp.addEventListener("touchstart", e => onDown(e.touches[0].clientX), { passive: true });
      vp.addEventListener("touchmove",  e => onMove(e.touches[0].clientX), { passive: true });
      vp.addEventListener("touchend", onUp);

      // Keyboard (when focus is within slider)
      mount.addEventListener("keydown", (e) => {
        if (e.key === "ArrowLeft")  { e.preventDefault(); prevSlide(); }
        if (e.key === "ArrowRight") { e.preventDefault(); nextSlide(); }
      });

      // Init + resize
      measure(); go(0);
      window.addEventListener("resize", () => { measure(); go(i); });
    } catch (e) {
      console.error(e);
      mount.innerHTML = "<p>Unable to load team members.</p>";
    }
  })();
</script>
