// /scripts/agent-page.js

document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error("window.supabase missing");
    return;
  }

  // Force header translucency on scroll (works on all sizes)
  (function initHeaderScrollEffect() {
    const header = document.querySelector(".index-grid-header");
    if (!header) return;
  
    const onScroll = () => {
      if (window.scrollY > 10) header.classList.add("scrolled");
      else header.classList.remove("scrolled");
    };
  
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  })();
  
  // /a/<slug> -> parts[0]="a", parts[1]="<slug>"
  const parts = window.location.pathname.split("/").filter(Boolean);
  const slug = (parts[0] === "a" && parts[1]) ? parts[1] : null;
  if (!slug) {
    console.error("Missing slug in URL");
    return;
  }

  const { data: agent, error } = await supabase
    .from("agent_public_profiles")
    .select("*")
    .eq("agent_slug", slug)
    .single();

  if (error || !agent || !agent.agent_page_enabled) {
    document.body.innerHTML = `
      <h2 style="text-align:center;margin-top:120px;">
        This agent page is not active.
      </h2>
    `;
    return;
  }

  window.FVG_AGENT_PAGE_AGENT = agent;

  // ✅ Expose BOTH UUID + NPN for other scripts
  window.AGENT_PAGE = {
    agent_uuid: agent.id,        // UUID
    agent_npn: agent.agent_id,   // NPN text
    agent_slug: agent.agent_slug,
    source: "agent_page"
  };

  async function loadAndRenderLicenses(agentNpn) {
    const wrap = document.getElementById("agent-licenses");
    if (!wrap) return;
  
    wrap.innerHTML = `
      <h3>Active Licenses</h3>
      <div class="license-list loading">Loading licenses…</div>
    `;
  
    try {
      const res = await fetch(`/.netlify/functions/getAgentActiveLicenses?agent_id=${encodeURIComponent(agentNpn)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
  
      const licenses = Array.isArray(json?.licenses) ? json.licenses : [];
      if (!licenses.length) {
        wrap.innerHTML = `
          <h3>Active Licenses</h3>
          <div class="license-empty">No active licenses found.</div>
        `;
        return;
      }
  
      const html = licenses.map((x) => {
        const loas = (x.loas || []).join(", ");
        return `
          <div class="license-pill">
            <div class="license-left">
              <i class="fa-regular fa-map"></i>
              <span class="license-state">${x.state}</span>
            </div>
            <div class="license-loas">${loas || "—"}</div>
          </div>
        `;
      }).join("");
  
      wrap.innerHTML = `
        <h3>Active Licenses</h3>
        <div class="license-list">${html}</div>
      `;
    } catch (e) {
      wrap.innerHTML = `
        <h3>Active Licenses</h3>
        <div class="license-empty">Couldn’t load licenses.</div>
      `;
      console.error("[agent-page] licenses load failed:", e);
    }
  }
  
  // call it
  loadAndRenderLicenses(agent.agent_id);

  // Render hero/contact info
  const nameEl = document.getElementById("agent-name");
  const bioEl = document.getElementById("agent-bio");
  const photoEl = document.getElementById("agent-photo");

  if (nameEl) nameEl.textContent = `${agent.first_name} ${agent.last_name}`;
  if (bioEl) bioEl.textContent = agent.bio || "";
  if (photoEl && agent.profile_picture_url) photoEl.src = agent.profile_picture_url;

  const callEl = document.getElementById("agent-call");
  const textEl = document.getElementById("agent-text");
  const emailEl = document.getElementById("agent-email");

  if (agent.phone) {
    if (callEl) callEl.href = `tel:${agent.phone}`;
    if (textEl) textEl.href = `sms:${agent.phone}`;
  }
  if (agent.email && emailEl) {
    emailEl.href = `mailto:${agent.email}`;
  }

  // Load freequote funnel partial into #quote-container
  const quoteContainer = document.getElementById("quote-container");
  if (quoteContainer) {
    try {
      const res = await fetch("/partials/freequote-funnel.html", { cache: "no-store" });
      if (!res.ok) {
        console.error("Failed to load freequote partial:", res.status);
      } else {
        quoteContainer.innerHTML = await res.text();
      }
    } catch (e) {
      console.error("Error fetching freequote partial:", e);
    }
  }

  // ✅ MUST load override BEFORE freequote
  await loadScriptOnce("/scripts/agent-quote-override.js");
  await loadScriptOnce("/scripts/freequote.js");
});

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src && s.src.includes(src))) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.body.appendChild(s);
  });
}
