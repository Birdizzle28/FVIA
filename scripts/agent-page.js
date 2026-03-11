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

  function withDefault(value, fallback) {
    if (!value) return fallback;
    if (value.trim() === "") return fallback;
    return value;
  }
  
  function formatPhoneUS(s) {
    const d = String(s || "").replace(/\D/g, "");
    const ten = d.length >= 10 ? d.slice(-10) : "";
    if (!ten) return String(s || "").trim();
    return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  }

  function getUrlParts() {
    return window.location.pathname.split("/").filter(Boolean);
  }

  function getQuery() {
    return new URLSearchParams(window.location.search);
  }

  function isBuilderPreview() {
    return getQuery().get("preview") === "draft";
  }

  function getPreviewAgentId() {
    return getQuery().get("agent_id");
  }

  function getCurrentPageKey() {
    const parts = getUrlParts();

    if (parts[0] !== "a") return "home";
    if (!parts[1]) return "home";

    if (parts[1] === "about") return "about";
    if (parts[1] === "careers") return "careers";
    if (parts[1] === "faqs") return "faqs";

    return "home";
  }

  function getSlug() {
    const parts = getUrlParts();
    const query = getQuery();

    if (parts[0] === "a" && parts[1] && !["about", "careers", "faqs"].includes(parts[1])) {
      return parts[1];
    }

    return query.get("slug");
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

  function setActiveNav(pageKey) {
    const navIds = {
      home: ["nav-home", "m-nav-home"],
      about: ["nav-about", "m-nav-about"],
      careers: ["nav-careers", "m-nav-careers"],
      faqs: ["nav-faqs", "m-nav-faqs"]
    };

    document.querySelectorAll("#active-nav").forEach(el => el.removeAttribute("id"));

    (navIds[pageKey] || []).forEach(id => {
      const el = document.getElementById(id);
      if (el) el.id = "active-nav";
    });
  }

  function applySectionImage(pageKey, sectionKey, content = {}) {
    const imageUrl = String(content.image_url || "").trim();
    if (!imageUrl) return;

    if (pageKey === "home" && sectionKey === "hero") {
      const photoEl = document.getElementById("agent-photo");
      if (photoEl) photoEl.src = imageUrl;
    }

    if (pageKey === "about" && sectionKey === "hero") {
      const photoEl = document.getElementById("agent-photo");
      if (photoEl) photoEl.src = imageUrl;
    }
  }
  
  function applyTheme(settings) {
    const body = document.getElementById("indexbody");
    const header = document.querySelector(".index-grid-header");
    const footer = document.querySelector(".index-grid-footer");
    const headerLogo = document.getElementById("headerlogo");
    const footerLogo = document.getElementById("footerlogo");

    if (!body || !header || !footer) return;

    const theme = settings?.theme_mode || "dark";

    if (theme === "light") {
      body.style.background = "white";
      body.style.backgroundImage = "none";
      header.style.backgroundColor = "#ed9ea5";
      footer.style.backgroundColor = "#ed9ea5";
      if (headerLogo) headerLogo.src = "/Pics/img17.png";
      if (footerLogo) footerLogo.src = "/Pics/img17.png";
    } else {
      body.style.backgroundImage = "radial-gradient(#ed9ea5, #7fabbf)";
      body.style.backgroundColor = "";
      header.style.backgroundColor = "#545454";
      footer.style.backgroundColor = "#545454";
      if (headerLogo) headerLogo.src = "/Pics/img6.png";
      if (footerLogo) footerLogo.src = "/Pics/img6.png";
    }
  }

  function applyPhotoShape(settings) {
    const photoEl = document.getElementById("agent-photo");
    if (!photoEl) return;
  
    photoEl.classList.remove("photo-circle", "photo-square", "photo-diamond");
  
    photoEl.style.borderRadius = "";
    photoEl.style.transform = "";
    photoEl.style.clipPath = "";
  
    const shape = settings?.photo_shape || "circle";
  
    if (shape === "square") {
      photoEl.classList.add("photo-square");
      photoEl.style.borderRadius = "0";
    } else if (shape === "diamond") {
      photoEl.classList.add("photo-diamond");
      photoEl.style.borderRadius = "0";
      photoEl.style.clipPath = "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)";
    } else {
      photoEl.classList.add("photo-circle");
      photoEl.style.borderRadius = "50%";
    }
  }

  function applyFontPreset(settings) {
    const main = document.querySelector("main");
    if (!main) return;
    if (settings?.font_preset) {
      main.style.fontFamily = `"${settings.font_preset}", sans-serif`;
    }
  }

  function applyButtonPreset(settings) {
    const preset = settings?.button_style_preset || "soft-dark";

    const buttonIds = [
      "agent-call",
      "agent-text",
      "agent-email",
      "agent-vcard",
      "agent-call-cta",
      "agent-text-cta",
      "agent-email-cta",
      "careers-contact-email",
      "faq-contact-link"
    ];

    const classMap = {
      "soft-dark": "btn-soft-dark",
      "soft-light": "btn-soft-light",
      "pill-dark": "btn-pill-dark",
      "pill-light": "btn-pill-light",
      "outline-dark": "btn-outline-dark",
      "outline-light": "btn-outline-light"
    };

    buttonIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;

      el.classList.add("fvg-btn");
      Object.values(classMap).forEach(cls => el.classList.remove(cls));
      el.classList.add(classMap[preset] || "btn-soft-dark");
    });
  }
  
  function hideNavIfDisabled(settings) {
    const navMap = [
      ["home_enabled", "nav-home", "m-nav-home"],
      ["about_enabled", "nav-about", "m-nav-about"],
      ["careers_enabled", "nav-careers", "m-nav-careers"],
      ["faqs_enabled", "nav-faqs", "m-nav-faqs"]
    ];

    navMap.forEach(([settingKey, desktopId, mobileId]) => {
      const enabled = !!settings?.[settingKey];
      const desktopEl = document.getElementById(desktopId);
      const mobileEl = document.getElementById(mobileId);

      if (desktopEl) desktopEl.style.display = enabled ? "" : "none";
      if (mobileEl) mobileEl.style.display = enabled ? "" : "none";
    });
  }
  
  function sectionKeyToElementIds(pageKey, sectionKey) {
    const map = {
      home: {
        hero: ["agent-hero"],
        contact: ["agent-contact"],
        licenses: ["agent-details", "agent-licenses"],
        quote: ["agent-quote", "quote-container"]
      },
      about: {
        hero: ["agent-hero"],
        summary: ["agent-about-summary-section", "agent-about-summary"],
        story: ["agent-story-section", "agent-story"],
        approach: ["agent-approach-section", "agent-approach"],
        who_i_help: ["agent-who-i-help-section", "agent-who-i-help"],
        licenses: ["agent-details", "agent-licenses"],
        cta: ["agent-about-cta", "agent-about-cta-text"]
      },
      careers: {
        intro: ["agent-careers-title", "agent-careers-intro", "agent-careers-region"],
        notice: ["agent-hiring-status", "agent-hiring-message"],
        roles: [
          "agent-role-title",
          "agent-role-location",
          "agent-role-type",
          "agent-role-description",
          "setter-role-title",
          "setter-role-location",
          "setter-role-type",
          "setter-role-description"
        ],
        cta: ["careers-contact-title", "careers-contact-description", "careers-contact-email"],
        faq: ["faq-heading", "faq-list"]
      },
      faqs: {
        intro: ["agent-faq-title", "agent-faq-intro"],
        list: ["faq-list"],
        cta: ["faq-contact-title", "faq-contact-text", "faq-contact-link"]
      }
    };

    return map?.[pageKey]?.[sectionKey] || [];
  }

  function setSectionVisibility(pageKey, sectionKey, isEnabled) {
    const ids = sectionKeyToElementIds(pageKey, sectionKey);
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = isEnabled ? "" : "none";
    });
  }

  function setTextIfExists(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value || "";
  }

  function setHtmlIfExists(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = value || "";
  }

  function setHrefIfExists(id, href, textValue = null) {
    const el = document.getElementById(id);
    if (!el) return;
    if (href) el.href = href;
    if (textValue !== null) el.textContent = textValue;
  }

  function fillSectionContent(pageKey, sectionKey, content = {}) {
    if (pageKey === "home") {
      if (sectionKey === "hero") {
        setTextIfExists("agent-name", content.heading || `${window.FVG_AGENT_PAGE_AGENT?.first_name || ""} ${window.FVG_AGENT_PAGE_AGENT?.last_name || ""}`.trim());
        setTextIfExists("agent-name-inline", content.heading || `${window.FVG_AGENT_PAGE_AGENT?.first_name || ""} ${window.FVG_AGENT_PAGE_AGENT?.last_name || ""}`.trim());
        setTextIfExists("agent-hero-subheading", content.subheading || "");
        setHtmlIfExists("agent-bio", content.body || "");
      }
    }
    if (pageKey === "about") {
      if (sectionKey === "summary") {
        setHtmlIfExists("agent-about-summary", content.body || "");
      }
      if (sectionKey === "story") {
        setHtmlIfExists("agent-story", content.body || "");
      }
      if (sectionKey === "approach") {
        setHtmlIfExists("agent-approach", content.body || "");
      }
      if (sectionKey === "who_i_help") {
        setHtmlIfExists("agent-who-i-help", content.body || "");
      }
      if (sectionKey === "cta") {
        setHtmlIfExists("agent-about-cta-text", content.body || "");
        setHrefIfExists("agent-call-cta", document.getElementById("agent-call")?.href || "");
        setHrefIfExists("agent-text-cta", document.getElementById("agent-text")?.href || "");
        setHrefIfExists("agent-email-cta", document.getElementById("agent-email")?.href || "");
      }
    }

    if (pageKey === "careers") {
      if (sectionKey === "intro") {
        setHtmlIfExists("agent-careers-title", content.heading || "");
        setTextIfExists("agent-careers-intro", content.body || "");
        setTextIfExists("agent-careers-region", content.subheading || "");
      }

      if (sectionKey === "notice") {
        setTextIfExists("agent-hiring-status", content.heading || "");
        setHtmlIfExists("agent-hiring-message", content.body || "");
      }

      if (sectionKey === "roles") {
        setTextIfExists("agent-role-title", content.agent_role_title || "");
        setTextIfExists("agent-role-location", content.agent_role_location || "");
        setTextIfExists("agent-role-type", content.agent_role_type || "");
        setHtmlIfExists("agent-role-description", content.agent_role_description || "");

        setTextIfExists("setter-role-title", content.setter_role_title || "");
        setTextIfExists("setter-role-location", content.setter_role_location || "");
        setTextIfExists("setter-role-type", content.setter_role_type || "");
        setHtmlIfExists("setter-role-description", content.setter_role_description || "");
      }

      if (sectionKey === "cta") {
        setTextIfExists("careers-contact-title", content.heading || "");
        setHtmlIfExists("careers-contact-description", content.body || "");
        setHrefIfExists("careers-contact-email", content.button_link || "", content.button_text || "");
      }
    }

    if (pageKey === "faqs") {
      if (sectionKey === "intro") {
        setTextIfExists("agent-faq-title", content.heading || "");
        setHtmlIfExists("agent-faq-intro", content.body || "");
      }

      if (sectionKey === "cta") {
        setTextIfExists("faq-contact-title", content.heading || "");
        setHtmlIfExists("faq-contact-text", content.body || "");
        setHrefIfExists("faq-contact-link", content.button_link || "", content.button_text || "");
      }
    }
  }

  function applySectionStyle(pageKey, sectionKey, style = {}) {
    const ids = sectionKeyToElementIds(pageKey, sectionKey);
  
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
  
      if (style.text_align) {
        el.style.textAlign = style.text_align;
      }
  
      if (style.color_preset === "pink") {
        el.style.color = "#ed9ea5";
      } else if (style.color_preset === "blue") {
        el.style.color = "#7fabbf";
      } else if (style.color_preset === "dark") {
        el.style.color = "#272727";
      } else if (style.color_preset === "light") {
        el.style.color = "#ffffff";
      } else {
        el.style.color = "";
      }
    });
  
    if (pageKey === "home" && sectionKey === "hero") {
      const headingEl = document.getElementById("agent-name");
      const inlineHeadingEl = document.getElementById("agent-name-inline");
      const subheadingEl = document.getElementById("agent-hero-subheading");
      const bodyEl = document.getElementById("agent-bio");
    
      const headingSize = style.heading_size || "md";
    
      const sizeMap = {
        sm: "clamp(1.6rem, 3vw, 2.2rem)",
        md: "clamp(2rem, 4vw, 3rem)",
        lg: "clamp(2.4rem, 5vw, 3.8rem)"
      };
    
      const chosenSize = sizeMap[headingSize] || sizeMap.md;
    
      let chosenColor = "";
      if (style.color_preset === "pink") chosenColor = "#ed9ea5";
      else if (style.color_preset === "blue") chosenColor = "#7fabbf";
      else if (style.color_preset === "dark") chosenColor = "#272727";
      else if (style.color_preset === "light") chosenColor = "#ffffff";
    
      if (headingEl) {
        headingEl.style.fontSize = chosenSize;
        headingEl.style.color = chosenColor || "";
      }
    
      if (inlineHeadingEl) {
        inlineHeadingEl.style.fontSize = chosenSize;
        inlineHeadingEl.style.color = chosenColor || "";
      }
    
      if (subheadingEl) {
        subheadingEl.style.textAlign = style.text_align || "";
        subheadingEl.style.color = chosenColor || "";
      }
    
      if (bodyEl) {
        bodyEl.style.textAlign = style.text_align || "";
        bodyEl.style.color = chosenColor || "";
      }
    }
  }

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
      const phoneFormatted = formatPhoneUS(phoneRaw);

      if (email && mailLink && mailText) {
        mailLink.href = `mailto:${email}`;
        mailText.textContent = email;
      }

      if (phoneRaw && phoneLink && phoneText) {
        phoneLink.href = `tel:${phoneRaw}`;
        phoneText.textContent = phoneFormatted;
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

  function renderFaqList(faqRows) {
    const faqList = document.getElementById("faq-list");
    if (!faqList) return;

    faqList.innerHTML = "";

    const enabledFaqs = (faqRows || [])
      .filter(f => f.is_enabled)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    if (!enabledFaqs.length) {
      faqList.innerHTML = "<p>No FAQs available.</p>";
      return;
    }

    enabledFaqs.forEach(faq => {
      const q = faq.render_question || "";
      const a = faq.render_answer || "";

      const details = document.createElement("details");
      details.className = "faq-item";
      details.innerHTML = `
        <summary>${escapeHtml(q)}</summary>
        <div class="faq-answer">${a || ""}</div>
      `;
      faqList.appendChild(details);
    });
  }

  function renderSocialLinks(socialRows, fallbackLinks = []) {
    const container = document.getElementById("footersocial");
    if (!container) return;

    container.innerHTML = "";

    const enabled = (socialRows || [])
      .filter(x => x.is_enabled && x.render_url)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    const rowsToUse = enabled.length ? enabled : fallbackLinks;

    rowsToUse.forEach(link => {
      const a = document.createElement("a");
      a.href = link.render_url || link.href || "#";
      a.target = "_blank";
      a.rel = "noopener noreferrer";

      const platform = (link.platform || "").toLowerCase();
      const iconMap = {
        facebook: "fab fa-facebook-f",
        instagram: "fab fa-instagram",
        linkedin: "fab fa-linkedin-in",
        youtube: "fab fa-youtube",
        tiktok: "fab fa-tiktok",
        x: "fab fa-x-twitter",
        threads: "fab fa-threads",
        reddit: "fab fa-reddit-alien",
        pinterest: "fab fa-pinterest-p",
        snapchat: "fab fa-snapchat-ghost",
        whatsapp: "fab fa-whatsapp",
        telegram: "fab fa-telegram-plane",
        messenger: "fab fa-facebook-messenger",
        website: "fa fa-globe",
        google: "fab fa-google",
        yelp: "fab fa-yelp",
        linktree: "fa fa-link",
        email: "fa fa-envelope",
        phone: "fa fa-phone",
        calendly: "fa fa-calendar"
      };
      
      const colorMap = {
        facebook: "social-color-facebook",
        instagram: "social-color-instagram",
        linkedin: "social-color-linkedin",
        youtube: "social-color-youtube",
        tiktok: "social-color-tiktok",
        x: "social-color-x",
        threads: "social-color-threads",
        reddit: "social-color-reddit",
        pinterest: "social-color-pinterest",
        snapchat: "social-color-snapchat",
        whatsapp: "social-color-whatsapp",
        telegram: "social-color-telegram",
        messenger: "social-color-messenger",
        website: "social-color-website",
        google: "social-color-google",
        yelp: "social-color-yelp",
        linktree: "social-color-linktree",
        email: "social-color-email",
        phone: "social-color-phone",
        calendly: "social-color-calendly"
      };

      const iconClass = iconMap[platform] || "fa fa-link";
      const colorClass = colorMap[platform] || "social-color-default";
      
      a.className = `${iconClass} ${colorClass}`;
      container.appendChild(a);
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  const slug = getSlug();
  const pageKey = getCurrentPageKey();
  const previewMode = isBuilderPreview();
  const previewAgentId = getPreviewAgentId();

  if (!slug) {
    console.error("Missing slug in URL");
    return;
  }

  wireAgentNav(slug);
  setActiveNav(pageKey);

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
    source: previewMode ? "agent_page_preview" : "agent_page"
  };

  const settingsAgentId = previewMode && previewAgentId ? previewAgentId : agent.id;

  const { data: settings, error: settingsErr } = await supabase
    .from("agent_page_settings")
    .select("*")
    .eq("agent_id", settingsAgentId)
    .single();

  if (settingsErr) {
    console.error("[agent-page] settings load failed:", settingsErr);
  }

  const { data: sectionRows, error: sectionErr } = await supabase
    .from("agent_page_sections")
    .select("*")
    .eq("agent_id", settingsAgentId)
    .eq("page_key", pageKey)
    .order("sort_order", { ascending: true });

  if (sectionErr) {
    console.error("[agent-page] sections load failed:", sectionErr);
  }

  const faqPageKey = pageKey === "careers" ? "careers" : pageKey === "faqs" ? "faqs" : null;
  let faqRows = [];
  if (faqPageKey) {
    const { data: faqData, error: faqErr } = await supabase
      .from("agent_page_faqs")
      .select("*")
      .eq("agent_id", settingsAgentId)
      .eq("page_key", faqPageKey)
      .order("sort_order", { ascending: true });

    if (faqErr) {
      console.error("[agent-page] faq load failed:", faqErr);
    } else {
      faqRows = faqData || [];
    }
  }

  const { data: socialRows, error: socialErr } = await supabase
    .from("agent_social_links")
    .select("*")
    .eq("agent_id", settingsAgentId)
    .order("sort_order", { ascending: true });

  if (socialErr) {
    console.error("[agent-page] social load failed:", socialErr);
  }

  const fallbackSocials = [
    { platform: "facebook", render_url: "https://www.facebook.com/familyvaluesgroup" },
    { platform: "linkedin", render_url: "https://www.linkedin.com/in/demisi-johnson-026227391?utm_source=share&utm_campaign=share_via&utm_content=profile&utm_medium=ios_app" },
    { platform: "youtube", render_url: "https://youtube.com/@familyvaluesgroup?si=mauqWp5nxyczgCJd" },
    { platform: "google", render_url: "https://g.page/r/CXUiEg9T9xHSEAE/review" }
  ];

  const pageEnabledField = pageKey === "home"
    ? "home_enabled"
    : pageKey === "about"
      ? "about_enabled"
      : pageKey === "careers"
        ? "careers_enabled"
        : "faqs_enabled";

  if (settings && settings[pageEnabledField] === false) {
    document.body.innerHTML = `
      <h2 style="text-align:center;margin-top:120px;">
        This page is not available.
      </h2>
    `;
    return;
  }

  hideNavIfDisabled(settings || {});
  
  document.body.classList.remove("agent-theme-dark", "agent-theme-light");
  document.body.classList.add(
    (settings?.theme_mode === "light") ? "agent-theme-light" : "agent-theme-dark"
  );
  
  applyTheme(settings || {});
  applyPhotoShape(settings || {});
  applyFontPreset(settings || {});
  applyButtonPreset(settings || {});
  renderSocialLinks(
    (socialRows || []).map(x => ({
      ...x,
      render_url: previewMode ? x.draft_url : x.published_url
    })),
    fallbackSocials
  );

  setFooterToAgentContact(agent.id);

  const nameEl = document.getElementById("agent-name");
  const bioEl = document.getElementById("agent-bio");
  const photoEl = document.getElementById("agent-photo");
  const nameInlineEl = document.getElementById("agent-name-inline");

  if (nameEl) nameEl.textContent = `${agent.first_name} ${agent.last_name}`;
  if (nameInlineEl) nameInlineEl.textContent = `${agent.first_name} ${agent.last_name}`;
  if (bioEl) bioEl.textContent = agent.bio || "";
  if (photoEl && agent.profile_picture_url) {
    photoEl.src = agent.profile_picture_url;
    photoEl.alt = `${agent.first_name} ${agent.last_name}`;
  }

  const callEl = document.getElementById("agent-call");
  const textEl = document.getElementById("agent-text");
  const emailEl = document.getElementById("agent-email");
  const callCtaEl = document.getElementById("agent-call-cta");
  const textCtaEl = document.getElementById("agent-text-cta");
  const emailCtaEl = document.getElementById("agent-email-cta");

  if (agent.phone) {
    if (callEl) callEl.href = `tel:${agent.phone}`;
    if (textEl) textEl.href = `sms:${agent.phone}`;
    if (callCtaEl) callCtaEl.href = `tel:${agent.phone}`;
    if (textCtaEl) textCtaEl.href = `sms:${agent.phone}`;
  }

  if (agent.email) {
    if (emailEl) emailEl.href = `mailto:${agent.email}`;
    if (emailCtaEl) emailCtaEl.href = `mailto:${agent.email}`;
  }

  (sectionRows || []).forEach(section => {
    const content = previewMode ? section.draft_content : section.published_content;
    const style = previewMode ? section.draft_style : section.published_style;

    setSectionVisibility(pageKey, section.section_key, !!section.is_enabled);
    fillSectionContent(pageKey, section.section_key, content || {});
    applySectionStyle(pageKey, section.section_key, style || {});
    applySectionImage(pageKey, section.section_key, content || {});
  });

  if (pageKey === "home" || pageKey === "about") {
    loadAndRenderLicenses(agent.agent_id);
  }

  if (pageKey === "careers" || pageKey === "faqs") {
    const renderableFaqs = (faqRows || []).map(f => ({
      ...f,
      render_question: previewMode ? f.draft_question : f.published_question,
      render_answer: previewMode ? f.draft_answer : f.published_answer
    }));
    renderFaqList(renderableFaqs);
  }

  if (pageKey === "home") {
    const quoteContainer = document.getElementById("quote-container");
    const quoteSection = document.getElementById("agent-quote");
    const quoteSectionRow = (sectionRows || []).find(s => s.section_key === "quote");

    if (quoteSection && quoteSectionRow && !quoteSectionRow.is_enabled) {
      quoteSection.style.display = "none";
    }

    if (quoteContainer && (!quoteSectionRow || quoteSectionRow.is_enabled)) {
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

      await loadScriptOnce("/scripts/agent-quote-override.js");
      await loadScriptOnce("/scripts/freequote.js");
    }
  }
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
    s.onerror = e => reject(e);
    document.body.appendChild(s);
  });
}
