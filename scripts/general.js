// scripts/general.js (put this at the very top)
(async () => {
  // Skip if no admin link exists on this page
  if (!document.querySelector('[data-admin-link], .admin-link')) return;

  // Load supabase ESM quickly without waiting for the rest of your app
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.44.4/+esm');

  // Reuse your public URL/key already in freequote.html (same project here)
  const supabase = createClient(
    'https://ddlbgkolnayqrxslzsxn.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
  );

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return; // still hidden

  const { data: profile } = await supabase
    .from('agents')
    .select('is_admin')
    .eq('id', session.user.id)
    .maybeSingle();

  if (profile?.is_admin === true) {
    document.querySelectorAll('[data-admin-link], .admin-link')
      .forEach(el => el.classList.remove('admin-hidden'));
  }
})();

const menuToggle = document.getElementById('menu-toggle');
const mobileMenu = document.getElementById('mobile-menu');

// Open/close the slide-out menu on hamburger click
menuToggle.addEventListener('click', () => {
    // If opening, position the menu right below the header
    if (!mobileMenu.classList.contains('open')) {
        const header = document.querySelector('header.index-grid-header');
        if (header) {
            mobileMenu.style.top = header.offsetHeight + 'px';
        }
    }
    mobileMenu.classList.toggle('open');
});

// Close the menu when clicking anywhere outside of it
document.addEventListener('click', (e) => {
    if (
        mobileMenu.classList.contains('open') &&                 // menu is open
        !mobileMenu.contains(e.target) &&                        // click is not inside menu
        !e.target.closest('#menu-toggle')                        // click is not the toggle button
    ) {
        mobileMenu.classList.remove('open');
    }
});

  if (window.innerWidth <= 768) {
  const header = document.querySelector('.index-grid-header');

  window.addEventListener('scroll', () => {
    const scrolledPast = window.scrollY > 10;
    if (scrolledPast) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  });
}

const chatBubble = document.getElementById("chat-bubble");
const chatWindow = document.getElementById("chat-window");
const chatBody = document.getElementById("chat-body");
const chatInput = document.querySelector("#chat-input input");
const sendBtn = document.getElementById("send-btn");

// Toggle chat window
if (chatBubble && chatWindow) {
  chatWindow.style.display = "none"; // Start hidden
  chatBubble.addEventListener("click", () => {
    chatWindow.style.display = chatWindow.style.display === "none" ? "flex" : "none";
    chatWindow.style.flexDirection = "column";
  });
}

// Function to add chat bubbles
function addMessage(sender, message) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble ${sender}`;
  bubble.innerHTML = sender === "bot" ? `<strong>Kuma:</strong> ${message}` : message;
  chatBody.appendChild(bubble);
  chatBody.scrollTop = chatBody.scrollHeight;
}

// Function to send user message
async function handleSend() {
  const userMessage = chatInput.value.trim();
  if (!userMessage) return;

  addMessage("user", userMessage);
  chatInput.value = "";

  try {
    const response = await fetch("/.netlify/functions/chatgpt", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ prompt: userMessage })
    });

    const data = await response.json();
    const botMessage = data.response || "Sorry, I didn’t understand that.";
    addMessage("bot", botMessage);
  } catch (err) {
    addMessage("bot", "There was an error talking to me 😢");
  }
}

// Enter key
chatInput?.addEventListener("keypress", function (e) {
  if (e.key === "Enter") handleSend();
});
const toggleToolkit = document.getElementById('toolkit-toggle');
  const submenu = document.getElementById('toolkit-submenu');

  if (toggleToolkit && submenu) {
    const openSubmenu = () => {
      submenu.hidden = false;
      submenu.classList.add('open');
      toggleToolkit.setAttribute('aria-expanded', 'true');
    };
    const closeSubmenu = () => {
      submenu.classList.remove('open');
      toggleToolkit.setAttribute('aria-expanded', 'false');
      // hide after animation finishes to keep height animation smooth
      setTimeout(() => { if (!submenu.classList.contains('open')) submenu.hidden = true; }, 260);
    };

    toggleToolkit.addEventListener('click', () => {
      const expanded = toggleToolkit.getAttribute('aria-expanded') === 'true';
      expanded ? closeSubmenu() : openSubmenu();
    });

    // Optional: close submenu when clicking outside the mobile menu
    document.addEventListener('click', (e) => {
      const mobileMenu = document.getElementById('mobile-menu');
      if (!mobileMenu?.contains(e.target)) closeSubmenu();
    });
  }
// Send button click
sendBtn?.addEventListener("click", handleSend);
