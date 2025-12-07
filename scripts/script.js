const supabase = window.supabaseClient;
  
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

  document.addEventListener('DOMContentLoaded', async () => {
  if (!supabase) {
    console.error('Supabase client missing on this page');
    return;
  }

  // ----- mobile highlight behavior (keep as-is) -----
  if (window.innerWidth <= 768) {
    const cards = document.querySelectorAll('.mfcont, .mfcont2, .mfcont3, .testcontainer');
    let lastScrollTop = window.scrollY;
    function checkHighlight() {
      const scrollTop = window.scrollY;
      const goingDown = scrollTop > lastScrollTop;
      const screenCenter = window.innerHeight / 2;
      let activeCard = null;
      cards.forEach((card) => {
        const rect = card.getBoundingClientRect();
        const top = rect.top, bottom = rect.bottom;
        if (goingDown) {
          if (top <= screenCenter && bottom >= screenCenter) activeCard = card;
        } else {
          if (bottom >= screenCenter && top <= screenCenter) activeCard = card;
        }
      });
      cards.forEach((c) => c.classList.remove('active'));
      if (activeCard) activeCard.classList.add('active');
      lastScrollTop = scrollTop;
    }
    window.addEventListener('load', () => { if (cards.length > 0) cards[0].classList.add('active'); });
    window.addEventListener('scroll', checkHighlight);
  }

  // ----- IMPORTANT: do NOT render #agent-cards-container here -----
  // The About page now renders the team itself (to avoid flicker/overwrite).
});
