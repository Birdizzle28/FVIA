// /scripts/agent-page.js

document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error("window.supabase missing");
    return;
  }

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

  function formatPhoneUS(s) {
    const d = String(s || "").replace(/\D/g, "");
    const ten = d.length >= 10 ? d.slice(-10) : "";
    if (!ten) return String(s || "").trim();
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }

  function wireAgentNav(slug) {
    const homeHref = `/a/${slug}`;
    const aboutHref = `/a/about?slug=${encodeURIComponent(slug)}`;
    const careersHref = `/a/careers?slug=${encodeURIComponent(slug)}`;
    const faqsHref = `/a/faqs?slug=${encodeURIComponent(slug)}`;

    const linkMap = [
      ["nav-home", homeHref],
      ["nav-about", aboutHref],
      ["nav-careers", careersHref],
      ["nav-faqs", faqsHref],
      ["m-nav-home", homeHref],
      ["m-nav-about", aboutHref],
      ["m-nav-careers", careersHref],
      ["m-nav-faqs", faqsHref]
    ];

    linkMap.forEach(([id, href]) => {
      const el = document.getElementById(id);
      if (el) el.href = href;
    });

    const logoLink = document.querySelector(".index-grid-header > a");
    if (logoLink) logoLink.href = homeHref;
  }

  const parts = window.location.pathname.split("/").filter(Boolean);
  const slug =
    (parts[0] === "a" && parts[1] && !["about", "careers", "faqs"].includes(parts[1]))
      ? parts[1]
      : new URLSearchParams(window.location.search).get("slug");

  if (!slug) {
    console.error("Missing slug in URL");
    return;
  }

  wireAgentNav(slug);

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

  window.AGENT_PAGE = {
    agent_uuid: agent.id,
    agent_npn: agent.agent_id,
    agent_slug: agent.agent_slug,
    source: "agent_page"
  };

  async function setFooterToAgentContact(agentUuid) {
    const footer = document.getElementById("footercontact");
    if (!footer) return;

    const mailLink = footer.querySelector('a[href^="mailto:"]');
    const mailText = mailLink?.querySelector(".contactcontcontacts");

    const phoneLink = footer.querySelector('a[href^="tel:"]');
    const phoneText = phoneLink?.querySelector(".contactcontcontacts");

    try {
      const res = await fetch(
        `/.netlify/functions/getAgentFooterContact?agent_uuid=${encodeURIComponent(agentUuid)}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const email = String(json?.email || "").trim();
      const phoneRaw = String(json?.phone || "").trim();
      const phone = formatPhoneUS(phoneRaw);

      if (email && mailLink && mailText) {
        mailLink.href = `mailto:${email}`;
        mailText.textContent = email;
      }

      if (phone && phoneLink && phoneText) {
        phoneLink.href = `tel:${phoneRaw}`;
        phoneText.textContent = phone;
      }
    } catch (e) {
      console.error("[agent-page] footer contact failed:", e);
    }
  }

  async function loadAndRenderLicenses(agentNpn) {
    const wrap = document.getElementById("agent-licenses");
    if (!wrap) return;

    wrap.innerHTML = `
      <h3>Active Licenses</h3>
      <div class="license-list loading">Loading licenses…</div>
    `;

    try {
      const res = await fetch(
        `/.netlify/functions/getAgentActiveLicenses?agent_id=${encodeURIComponent(agentNpn)}`,
        { cache: "no-store" }
      );
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
          <div class="license-row">
            <span class="license-state">${x.state}</span>
            <span class="license-divider">—</span>
            <span class="license-loas">${loas || "—"}</span>
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

  setFooterToAgentContact(agent.id);
  loadAndRenderLicenses(agent.agent_id);

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
