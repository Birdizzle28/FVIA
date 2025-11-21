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
   (audience-aware + publish_at null-safe)
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

  // Get user/session
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session) return;

  const userId = sessionData.session.user.id;

  // --- Load agent + licenses (for audience filtering) ---
  let me = {
    id: userId,
    is_admin: false,
    npn: null,
    licenses: [] // { state, active, loa_names[] }
  };

  try {
    const { data: agentRow } = await supabase
      .from("agents")
      .select("id, is_admin, agent_id")
      .eq("id", userId)
      .maybeSingle();

    if (agentRow) {
      me.is_admin = !!agentRow.is_admin;
      me.npn = agentRow.agent_id || null;
    }

    if (me.npn) {
      const { data: licRows } = await supabase
        .from("agent_nipr_licenses")
        .select("state, active, loa_names")
        .eq("agent_id", me.npn);

      me.licenses = Array.isArray(licRows) ? licRows : [];
    }
  } catch (err) {
    console.warn("Notif: error loading agent/licenses:", err);
  }

  // --- Audience matcher (same rules as announcements carousel) ---
  function licenseMatchesProducts(lic, products) {
    if (!products || !products.length) return false;
    const loas = lic.loa_names || [];
    const wants = products.map((p) => String(p || "").toLowerCase());

    return wants.some((p) => {
      if (p === "life") return loas.includes("Life");
      if (p === "health")
        return loas.includes("Accident & Health") || loas.includes("Health");
      if (p === "property") return loas.includes("Property");
      if (p === "casualty") return loas.includes("Casualty");
      return false;
    });
  }

  function announcementShowsForMe(row) {
    const aud = row.audience || { scope: "all" };
    const scope = aud.scope || "all";

    if (scope === "all") return true;
    if (scope === "admins") return me.is_admin === true;

    if (scope === "custom_agents") {
      const ids = aud.agent_ids || [];
      return me.id && ids.includes(me.id);
    }

    if (scope === "by_state") {
      const states = (aud.states || []).map((s) =>
        String(s || "").toUpperCase()
      );
      if (!states.length) return false;
      return me.licenses.some(
        (lic) =>
          lic.active === true &&
          states.includes(String(lic.state || "").toUpperCase())
      );
    }

    if (scope === "by_product") {
      const prods = aud.products || [];
      if (!prods.length) return false;
      return me.licenses.some(
        (lic) => lic.active === true && licenseMatchesProducts(lic, prods)
      );
    }

    if (scope === "by_product_state") {
      const prods = aud.products || [];
      const states = (aud.states || []).map((s) =>
        String(s || "").toUpperCase()
      );
      if (!prods.length || !states.length) return false;

      // must match BOTH on the SAME active license
      return me.licenses.some((lic) => {
        if (!lic.active) return false;
        const st = String(lic.state || "").toUpperCase();
        if (!states.includes(st)) return false;
        return licenseMatchesProducts(lic, prods);
      });
    }

    // ignore by_level etc. for now → can extend later if needed
    return false;
  }

  // === READ STATE (per user, per item) ===
  const readKey = `fvia_notif_read_${userId}`;

  function getReadSet() {
    try {
      const raw = localStorage.getItem(readKey);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr);
    } catch {
      return new Set();
    }
  }

  function saveReadSet(set) {
    try {
      localStorage.setItem(readKey, JSON.stringify([...set]));
    } catch {
      // ignore
    }
  }

  const readSet = getReadSet();

  const notifKey = (item) => `${item.type}:${item.id}`;

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

  // --- PREVIEW MODAL ---
  const preview = document.createElement("div");
  preview.id = "fvia-notif-preview";
  preview.style.cssText = `
    position:fixed;
    inset:0;
    background:rgba(0,0,0,0.4);
    display:none;
    align-items:center;
    justify-content:center;
    z-index:10000;
  `;
  preview.innerHTML = `
    <div style="
      background:white;
      width:min(480px, 92vw);
      max-height:80vh;
      overflow:auto;
      border-radius:10px;
      box-shadow:0 10px 30px rgba(0,0,0,0.25);
      padding:16px 18px 18px;
      position:relative;
      font-size:14px;
    ">
      <button id="notif-preview-close" style="
        position:absolute;
        top:8px; right:10px;
        border:0; background:none;
        font-size:22px; cursor:pointer;
      ">&times;</button>
      <div id="notif-preview-meta" style="font-size:12px; color:#777; margin-bottom:6px;"></div>
      <h3 id="notif-preview-title" style="margin:0 0 8px; color:#353468;"></h3>
      <div id="notif-preview-body" style="white-space:pre-wrap; color:#333;"></div>
    </div>
  `;
  document.body.appendChild(preview);

  const previewMeta = preview.querySelector("#notif-preview-meta");
  const previewTitle = preview.querySelector("#notif-preview-title");
  const previewBody = preview.querySelector("#notif-preview-body");
  const previewClose = preview.querySelector("#notif-preview-close");

  function openPreview(item) {
    previewMeta.textContent = `${
      item.type === "task" ? "Task" : "Announcement"
    } · ${item.ts.toLocaleString()}`;
    previewTitle.textContent = item.title || "(No title)";
    let bodyText = item.body || "";
    if (item.type === "task" && item.due) {
      bodyText =
        `Due: ${item.due.toLocaleString()}` +
        (bodyText ? `\n\n${bodyText}` : "");
    }
    previewBody.textContent = bodyText;
    preview.style.display = "flex";
    panel.style.display = "none";
  }

  function closePreview() {
    preview.style.display = "none";
  }

  previewClose.addEventListener("click", closePreview);
  preview.addEventListener("click", (e) => {
    if (e.target === preview) closePreview();
  });

  let currentItems = [];

  // --- Fetch notifications (audience-aware + null-safe publish_at) ---
  async function loadNotifications() {
    const now = new Date();

    const [annc, tasks] = await Promise.all([
      supabase
        .from("announcements")
        .select("id,title,body,created_at,publish_at,expires_at,audience,is_active")
        .eq("is_active", true)
        .order("publish_at", { ascending: false })
        .order("created_at", { ascending: false }),

      supabase
        .from("tasks")
        .select("id,title,status,created_at,due_at")
        .eq("assigned_to", userId)
        .order("created_at", { ascending: false }),
    ]);

    const merged = [];

    // Announcements: time window + audience filter
    (annc.data || [])
      .filter((a) => {
        const pub = a.publish_at ? new Date(a.publish_at) : null;
        const exp = a.expires_at ? new Date(a.expires_at) : null;
        const pubOk = !pub || pub <= now;       // null = "now"
        const expOk = !exp || exp > now;        // expires_at in future or null
        if (!pubOk || !expOk) return false;
        return announcementShowsForMe(a);
      })
      .forEach((a) => {
        const ts = new Date(a.publish_at || a.created_at);
        merged.push({
          type: "announcement",
          id: a.id,
          title: a.title,
          body: a.body,
          ts,
        });
      });

    // Tasks
    (tasks.data || []).forEach((t) => {
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
    currentItems = merged;

    let anyUnread = false;

    if (!merged.length) {
      notifList.innerHTML =
        '<div style="padding:10px 12px; font-size:.85rem; color:#666;">No notifications yet.</div>';
      badge.style.display = "none";
      return;
    }

    notifList.innerHTML = merged
      .map((item, index) => {
        const key = notifKey(item);
        const unread = !readSet.has(key);
        if (unread) anyUnread = true;

        return `
        <div class="fvia-notif-item"
             data-index="${index}"
             style="
          padding:10px 12px;
          border-bottom:1px solid #f2f2f2;
          background:${unread ? "#f7f4ff" : "white"};
          position:relative;
          cursor:pointer;
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
            ${item.title || "(No title)"}
          </div>
          <div style="font-size:.8rem;color:#444;margin-top:4px;">
            ${(item.body || "").slice(0, 120)}${
              item.body && item.body.length > 120 ? "…" : ""
            }
          </div>
        </div>`;
      })
      .join("");

    notifList.querySelectorAll(".fvia-notif-item").forEach((row) => {
      row.addEventListener("click", () => {
        const idx = Number(row.getAttribute("data-index") || "0");
        const item = currentItems[idx];
        if (!item) return;

        const key = notifKey(item);
        if (!readSet.has(key)) {
          readSet.add(key);
          saveReadSet(readSet);
        }

        row.style.background = "white";
        const dot = row.querySelector("div[style*='border-radius:50%']");
        if (dot) dot.remove();

        const stillUnread = currentItems.some(
          (it) => !readSet.has(notifKey(it))
        );
        badge.style.display = stillUnread ? "block" : "none";

        openPreview(item);
      });
    });

    badge.style.display = anyUnread ? "block" : "none";
  }

  // --- Toggle panel ---
  bell.onclick = (e) => {
    e.preventDefault();
    panel.style.display =
      panel.style.display === "none" ? "block" : "none";
    if (panel.style.display === "block") {
      loadNotifications();
    }
  };

  // --- Mark all read ---
  markBtn.onclick = () => {
    currentItems.forEach((item) => {
      readSet.add(notifKey(item));
    });
    saveReadSet(readSet);
    loadNotifications();
    badge.style.display = "none";
  };

  // --- Click outside closes panel (but not preview) ---
  document.addEventListener("click", (e) => {
    if (
      panel.style.display === "block" &&
      !panel.contains(e.target) &&
      !bell.contains(e.target)
    ) {
      panel.style.display = "none";
    }
  });

  // --- Background check so bell shows unread dot on page load ---
  loadNotifications();
})();
