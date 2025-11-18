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

/* ============================================================
   NOTIFICATION BELL — ANNOUNCEMENTS + TASKS + UNREAD BADGE
   ============================================================ */
(async function initFVNotifications() {
  const bell = document.getElementById("notifications-tab");
  if (!bell) return; // no bell on this page, skip

  // --- Supabase init ONLY for this feature ---
  const { createClient } = await import(
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.44.4/+esm"
  );

  const supabase = createClient(
    "https://ddlbgkolnayqrxslzsxn.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho"
  );

  // Get user
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) return;

  const userId = sessionData.session.user.id;
  const lsKey = `fvia_last_seen_notifications_${userId}`;

  function getLastSeen() {
    const raw = localStorage.getItem(lsKey);
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(+d) ? null : d;
  }
  function setLastSeen() {
    localStorage.setItem(lsKey, new Date().toISOString());
  }

  // --- Add unread red dot to the bell ---
  const badge = document.createElement("span");
  badge.style.cssText = `
    position:absolute;
    top:-3px; right:-3px;
    width:8px; height:8px;
    border-radius:50%;
    background:#e52929;
    display:none;
  `;
  bell.style.position = "relative";
  bell.appendChild(badge);

  // --- Create dropdown panel ---
  const panel = document.createElement("div");
  panel.id = "fvia-notif-panel";
  panel.style.cssText = `
    position:fixed;
    right:14px;
    top:70px;
    width:340px;
    max-height:70vh;
    overflow-y:auto;
    background:white;
    border:1px solid #ddd;
    border-radius:8px;
    box-shadow:0 8px 25px rgba(0,0,0,0.15);
    display:none;
    z-index:9999;
  `;
  panel.innerHTML = `
    <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between; align-items:center;">
      <strong>Notifications</strong>
      <button id="notif-mark-read" style="border:0; background:none; color:#666; cursor:pointer;font-size:.85rem;">
        Mark all read
      </button>
    </div>
    <div id="fvia-notif-list"></div>
  `;
  document.body.appendChild(panel);

  const notifList = panel.querySelector("#fvia-notif-list");
  const markBtn = panel.querySelector("#notif-mark-read");

  // --- Fetch notifications ---
  async function loadNotifications() {
    const lastSeen = getLastSeen();

    const nowISO = new Date().toISOString();

    const [annc, tasks] = await Promise.all([
      supabase
        .from("announcements")
        .select("id,title,body,created_at,publish_at")
        .eq("is_active", true)
        .lte("publish_at", nowISO)
        .order("publish_at", { ascending: false }),

      supabase
        .from("tasks")
        .select("id,title,status,created_at,due_at")
        .eq("assigned_to", userId)
        .order("created_at", { ascending: false }),
    ]);

    const merged = [];

    (annc.data || []).forEach(a => {
      const ts = new Date(a.publish_at || a.created_at);
      merged.push({
        type: "announcement",
        id: a.id,
        title: a.title,
        body: a.body,
        ts,
      });
    });

    (tasks.data || []).forEach(t => {
      const ts = new Date(t.created_at);
      merged.push({
        type: "task",
        id: t.id,
        title: t.title,
        body: "Status: " + (t.status || "—"),
        due: t.due_at ? new Date(t.due_at) : null,
        ts,
      });
    });

    merged.sort((a, b) => b.ts - a.ts);

    // Detect unread
    let anyUnread = false;

    notifList.innerHTML = merged
      .map(item => {
        const unread =
          !lastSeen || (item.ts && item.ts > lastSeen);

        if (unread) anyUnread = true;

        return `
        <div style="
          padding:10px 12px;
          border-bottom:1px solid #f2f2f2;
          background:${unread ? "#f7f4ff" : "white"};
          position:relative;
        ">
          ${
            unread
              ? `<div style="
                  position:absolute;
                  right:10px; top:12px;
                  width:8px; height:8px;
                  background:#e52929;
                  border-radius:50%;
                "></div>`
              : ""
          }
          <div style="font-size:.75rem;color:#666;">
            ${item.type === "task" ? "Task" : "Announcement"}
            · ${item.ts.toLocaleString()}
          </div>
          <div style="font-size:.9rem;font-weight:600;color:#353468;margin-top:4px;">
            ${item.title}
          </div>
          <div style="font-size:.8rem;color:#444;margin-top:4px;">
            ${(item.body || "").slice(0, 120)}${
              item.body?.length > 120 ? "…" : ""
            }
          </div>
        </div>`;
      })
      .join("");

    badge.style.display = anyUnread ? "block" : "none";
  }

  // --- Toggle panel ---
  bell.onclick = (e) => {
    e.preventDefault();
    panel.style.display =
      panel.style.display === "none" ? "block" : "none";
    if (panel.style.display === "block") {
      loadNotifications();
      setLastSeen(); // mark all read when opened
      badge.style.display = "none";
    }
  };

  // --- Mark all read ---
  markBtn.onclick = () => {
    setLastSeen();
    loadNotifications();
    badge.style.display = "none";
  };

  // --- Click outside closes panel ---
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && !bell.contains(e.target)) {
      panel.style.display = "none";
    }
  });

  // --- Background check so bell shows unread dot immediately ---
  loadNotifications();
})();
