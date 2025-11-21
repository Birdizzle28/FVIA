// scripts/general.js

// --- Shared Supabase config (GLOBAL, used by all IIFEs) ---
const SUPABASE_URL = 'https://ddlbgkolnayqrxslzsxn.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho';

// --- Admin-link visibility (only show admin links for admins) ---
(async () => {
  // Skip if no admin link exists on this page
  if (!document.querySelector('[data-admin-link], .admin-link')) return;

  // Load supabase ESM quickly without waiting for the rest of your app
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.44.4/+esm'
  );

  // Create client once, using shared config
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

// ======================
// MENU + HEADER + CHAT
// ======================
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
   (audience-aware + publish_at null-safe, with images & type chips
   and richer Task overlay: status, created, due, notes, link)
   ============================================================ */
(async function initFVNotifications() {
  const bell = document.getElementById("notifications-tab");
  if (!bell) return; // no bell on this page, skip

  // --- Supabase init ONLY for this feature ---
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.44.4/+esm'
  );
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // helper: resolve a tasks image path into a public URL
  function resolveTaskImage(raw) {
    if (!raw) return null;
    const v = String(raw);

    // Already a full URL?
    if (/^https?:\/\//i.test(v)) return v;

    // Strip leading slash
    let path = v.replace(/^\/+/, "");

    // If someone stored "tasks/..." trim the bucket prefix
    if (path.toLowerCase().startsWith("tasks/")) {
      path = path.slice("tasks/".length);
    }

    const { data } = supabase.storage.from("tasks").getPublicUrl(path);
    return data?.publicUrl || null;
  }

  // small helper so we can safely inject notes into innerHTML
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

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

  // --- DETAIL MODAL (styled like dashboard announcement/task detail overlays) ---
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
    <div id="notif-detail-card" style="
      background:white;
      width:min(540px, 94vw);
      max-height:80vh;
      overflow:auto;
      border-radius:10px;
      box-shadow:0 10px 30px rgba(0,0,0,0.25);
      position:relative;
    ">
      <button id="notif-preview-close" style="
        position:absolute;
        top:8px; right:10px;
        border:0; background:none;
        font-size:22px; cursor:pointer;
      ">&times;</button>
      <div id="notif-detail-body"></div>
    </div>
  `;
  document.body.appendChild(preview);

  const previewBody = preview.querySelector("#notif-detail-body");
  const previewClose = preview.querySelector("#notif-preview-close");

  // helpers to match dashboard detail overlay text
  function formatRange(pub, exp) {
    const fmt = (d) => {
      if (!d) return 'Now';
      try {
        return new Date(d).toLocaleString();
      } catch {
        return String(d);
      }
    };
    const left = pub ? fmt(pub) : 'Now';
    const right = exp ? fmt(exp) : 'No expiry';
    return `${left} → ${right}`;
  }

  function audienceLine(aud) {
    const a = aud || { scope: 'all' };
    const scope = a.scope || 'all';
    switch (scope) {
      case 'all': return 'Everyone';
      case 'admins': return 'Admins only';
      case 'by_state':
        return `States: ${(a.states || []).join(', ')}`;
      case 'by_product':
        return `Products: ${(a.products || []).join(', ')}`;
      case 'by_product_state': {
        const states = (a.states || []).join(', ');
        const prods  = (a.products || []).join(', ');
        return `Products: ${prods} in States: ${states}`;
      }
      case 'custom_agents':
        return `Selected agents (${(a.agent_ids || []).length})`;
      default: return '—';
    }
  }

  function openPreview(item) {
    if (!previewBody) return;

    const isTask = item.type === "task";

    // ANNOUNCEMENT DETAIL — clone of dashboard style
    if (!isTask) {
      const heroUrl = item.imageUrl || "";
      const visibleText = formatRange(item.publish_at, item.expires_at);
      const audText = audienceLine(item.audience);

      const safeTitle = escapeHtml(item.title || 'Announcement');
      const safeBody = escapeHtml(item.body || '').replace(/\n/g, '<br>');

      const linkHtml = item.linkUrl
        ? `
        <div class="cta" style="margin-top:10px;">
          <a href="${encodeURI(String(item.linkUrl))}"
             target="_blank"
             rel="noopener noreferrer"
             style="
               display:inline-flex;
               align-items:center;
               gap:6px;
               padding:6px 12px;
               border-radius:999px;
               background:#353468;
               color:white;
               font-size:13px;
               text-decoration:none;
             ">
            <span>Open link</span>
          </a>
        </div>
      `
        : '';

      previewBody.innerHTML = `
        <div style="padding:16px 18px 18px;">
          <div class="hero" style="
            width:100%;
            height:180px;
            border-radius:8px;
            background-size:contain;
            background-position:center;
            background-color:#f3f3fb;
            ${heroUrl ? `background-image:url('${heroUrl.replace(/'/g,"\\'")}');` : ''}
          "></div>
          <div class="meta" style="margin-top:14px; font-size:14px; color:#333;">
            <h3 style="margin:0 0 8px; color:#353468; font-size:18px;">${safeTitle}</h3>
            <p style="margin:0 0 10px; line-height:1.5;">${safeBody}</p>
            <div class="row" style="margin-bottom:4px;font-size:13px;">
              <strong>Visible:</strong> ${escapeHtml(visibleText)}
            </div>
            <div class="row" style="margin-bottom:8px;font-size:13px;">
              <strong>Audience:</strong> ${escapeHtml(audText)}
            </div>
            ${linkHtml}
          </div>
        </div>
      `;
    } else {
      // TASK DETAIL — styled to match announcement overlay
      const heroUrl = item.imageUrl || "";
      const statusRaw = (item.status || 'open').toLowerCase();
      let statusLabel = 'Open';
      if (statusRaw === 'completed') statusLabel = 'Completed';
      else if (statusRaw === 'cancelled') statusLabel = 'Cancelled';

      const createdText = item.ts ? item.ts.toLocaleString() : '—';
      const dueText = item.due ? item.due.toLocaleString() : '—';
      const notes = item.notes || '';

      const safeTitle = escapeHtml(item.title || 'Task');
      const safeNotes = escapeHtml(notes);

      const linkHtml = item.linkUrl
        ? `
        <div class="cta" style="margin-top:10px;">
          <a href="${encodeURI(String(item.linkUrl))}"
             target="_blank"
             rel="noopener noreferrer"
             style="
               display:inline-flex;
               align-items:center;
               gap:6px;
               padding:6px 12px;
               border-radius:999px;
               background:#353468;
               color:white;
               font-size:13px;
               text-decoration:none;
             ">
            <span>Open linked item</span>
          </a>
        </div>
      `
        : '';

      previewBody.innerHTML = `
        <div style="padding:16px 18px 18px;">
          <div class="hero task-hero" style="
            width:100%;
            height:180px;
            border-radius:8px;
            background-size:contain;
            background-position:center;
            background-color:#f3f3fb;
            ${heroUrl ? `background-image:url('${heroUrl.replace(/'/g,"\\'")}');` : ''}
          "></div>
          <div class="meta" style="margin-top:14px; font-size:14px; color:#333;">
            <h3 style="margin:0 0 8px; color:#353468; font-size:18px;">${safeTitle}</h3>
            <div class="row" style="margin-bottom:4px;font-size:13px;">
              <strong>Status:</strong> ${escapeHtml(statusLabel)}
            </div>
            <div class="row" style="margin-bottom:4px;font-size:13px;">
              <strong>Created:</strong> ${escapeHtml(createdText)}
            </div>
            <div class="row" style="margin-bottom:8px;font-size:13px;">
              <strong>Due:</strong> ${escapeHtml(dueText)}
            </div>
            ${safeNotes ? `<p class="task-notes" style="margin-top:4px; font-size:13px; line-height:1.5;"><strong>Notes:</strong> ${safeNotes}</p>` : ''}
            ${linkHtml}
          </div>
        </div>
      `;
    }

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
        .select("id,title,body,created_at,publish_at,expires_at,audience,is_active,image_url,link_url")
        .eq("is_active", true)
        .order("publish_at", { ascending: false })
        .order("created_at", { ascending: false }),

      supabase
        .from("tasks")
        .select("id,title,status,created_at,due_at,metadata")
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
          imageUrl: a.image_url || null,
          publish_at: a.publish_at || null,
          expires_at: a.expires_at || null,
          audience: a.audience || null,
          linkUrl: a.link_url || null
        });
      });

    // Tasks
    (tasks.data || []).forEach((t) => {
      const ts = new Date(t.created_at);

      // parse metadata for notes + image + link
      const meta = (() => {
        const raw = t.metadata;
        if (!raw) return {};
        if (typeof raw === "string") {
          try { return JSON.parse(raw); } catch { return {}; }
        }
        return raw;
      })();

      const notes =
        meta.notes ||
        meta.note ||
        meta.description ||
        meta.body ||
        meta.details ||
        "";

      const linkUrl =
        meta.link_url ||
        meta.link ||
        null;

      const rawImg =
        meta.image_url ||
        meta.imagePath ||
        meta.path ||
        null;

      const imgUrl = resolveTaskImage(rawImg);

      const statusLabel = "Status: " + (t.status || "—");
      const bodyText = notes ? `${statusLabel}\n\n${notes}` : statusLabel;

      merged.push({
        type: "task",
        id: t.id,
        title: t.title,
        // structured fields for overlay
        status: t.status || null,
        ts,
        due: t.due_at ? new Date(t.due_at) : null,
        notes,
        linkUrl,
        // used for the list preview snippet
        body: bodyText,
        imageUrl: imgUrl
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

        const isTask = item.type === "task";

        // small image on the right
        const hasImg = !!item.imageUrl;
        const imgHtml = hasImg
          ? `<div style="flex:0 0 52px; margin-left:8px;">
               <div style="
                 width:52px;height:52px;
                 border-radius:6px;
                 background:#eef1f8;
                 background-image:url('${item.imageUrl}');
                 background-size:cover;
                 background-position:center;
               "></div>
             </div>`
          : "";

        // type chip
        const chipHtml = isTask
          ? `<span style="
                display:inline-block;
                padding:2px 7px;
                border-radius:999px;
                background:#ede9ff;
                color:#353468;
                font-size:10px;
                font-weight:600;
                text-transform:uppercase;
                letter-spacing:0.03em;
              ">Task</span>`
          : `<span style="
                display:inline-block;
                padding:2px 7px;
                border-radius:999px;
                background:#ffe3ea;
                color:#b43a5e;
                font-size:10px;
                font-weight:600;
                text-transform:uppercase;
                letter-spacing:0.03em;
              ">Announcement</span>`;

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
          <div style="display:flex; align-items:flex-start; gap:8px;">
            <div style="flex:1 1 auto; min-width:0;">
              <div style="display:flex; align-items:center; gap:6px; margin-bottom:2px;">
                ${chipHtml}
                <span style="font-size:.75rem; color:#666;">
                  ${item.ts.toLocaleString()}
                </span>
              </div>
              <div style="font-size:.9rem;font-weight:600;color:#353468;margin-top:2px;">
                ${item.title || "(No title)"}
              </div>
              <div style="font-size:.8rem;color:#444;margin-top:4px;">
                ${(item.body || "").slice(0, 120)}${
                  item.body && item.body.length > 120 ? "…" : ""
                }
              </div>
            </div>
            ${imgHtml}
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
