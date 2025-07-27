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

// Chat toggle
const chatBubble = document.getElementById("chat-bubble");
const chatWindow = document.getElementById("chat-window");

if (chatBubble && chatWindow) {
  chatBubble.addEventListener("click", () => {
    chatWindow.style.display = chatWindow.style.display === "none" ? "block" : "none";
  });
}
const chatInput = document.querySelector("#chat-input input");
const chatBody = document.getElementById("chat-body");

// Replace this with your real API key
const OPENAI_API_KEY = "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";

chatInput.addEventListener("keypress", async function (e) {
  if (e.key === "Enter" && chatInput.value.trim() !== "") {
    const userMessage = chatInput.value.trim();

    // Show user message
    chatBody.innerHTML += `<p><strong>You:</strong> ${userMessage}</p>`;
    chatInput.value = "";
    chatBody.scrollTop = chatBody.scrollHeight;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      const data = await response.json();
      const botMessage = data.choices?.[0]?.message?.content || "Sorry, I didn’t understand that.";

      chatBody.innerHTML += `<p><strong>Kuma:</strong> ${botMessage}</p>`;
      chatBody.scrollTop = chatBody.scrollHeight;
    } catch (err) {
      chatBody.innerHTML += `<p><strong>Kuma:</strong> There was an error talking to me 😢</p>`;
    }
  }
});

  document.addEventListener('DOMContentLoaded', async () => {
  alert("✅ SCRIPT IS RUNNING");

  const container = document.getElementById("agent-cards-container");
  if (!container) {
    alert("❌ Container not found!");
    return;
  }

  container.innerHTML = "Loading team...";

  const { data: agents, error } = await supabase
    .from('agents')
    .select('full_name, bio, profile_picture_url')
    .eq('show_on_about', true)
    .eq('is_active', true);

  if (error || !agents) {
    container.innerHTML = "<p>Unable to load team members.</p>";
    console.error("Error loading agents:", error);
    return;
  }

  if (agents.length === 0) {
    container.innerHTML = "<p>No team members to show yet.</p>";
    return;
  }

  container.innerHTML = agents.map(agent => `
    <div class="agent-card">
      <img src="${agent.profile_picture_url}" alt="${agent.full_name}" class="agent-photo" />
      <h3>${agent.full_name}</h3>
      <p>${agent.bio || 'No bio provided.'}</p>
    </div>
  `).join('');
});
