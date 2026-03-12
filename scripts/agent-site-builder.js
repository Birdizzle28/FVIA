// /scripts/agent-site-builder.js

document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error("Supabase missing");
    return;
  }

  const FONT_PRESETS = [
  "Bellota Text",
  "Cinzel",
  "Cormorant Garamond",
  "Cormorant SC",
  "Playfair Display",
  "Abril Fatface",
  "Bebas Neue",
  "Bodoni Moda",
  "DM Serif Display",
  "Prata",
  "Marcellus",
  "Unna",
  "Libre Baskerville",
  "Merriweather",
  "Lora",
  "Josefin Sans",
  "Figtree",
  "Poppins",
  "Montserrat",
  "Raleway",
  "Quicksand",
  "Inter",
  "Manrope",
  "Urbanist",
  "Space Grotesk",
  "Sora",
  "Rubik",
  "Cabin",
  "Oxygen",
  "Nunito"
];

  const SOCIAL_PLATFORMS = [
    "facebook",
    "instagram",
    "linkedin",
    "youtube",
    "tiktok",
    "x",
    "threads",
    "reddit",
    "pinterest",
    "snapchat",
    "whatsapp",
    "telegram",
    "calendly",
    "google",
    "yelp",
    "website",
    "email",
    "phone",
    "messenger",
    "linktree"
  ];

  const pageSelect = document.getElementById("builder-page-select");
  const fontSelect = document.getElementById("builder-font-preset");
  const sectionToggleList = document.getElementById("section-toggle-list");
  const editorFields = document.getElementById("builder-editor-fields");
  const previewFrame = document.getElementById("builder-preview-frame");

  const themeModeEl = document.getElementById("builder-theme-mode");
  const photoShapeEl = document.getElementById("builder-photo-shape");
  const buttonStyleEl = document.getElementById("builder-button-style");

  const toggleHomePage = document.getElementById("toggle-home-page");
  const toggleAboutPage = document.getElementById("toggle-about-page");
  const toggleCareersPage = document.getElementById("toggle-careers-page");
  const toggleFaqsPage = document.getElementById("toggle-faqs-page");

  const saveDraftBtn = document.getElementById("save-draft-btn");
  const submitReviewBtn = document.getElementById("submit-review-btn");
  const previewDraftBtn = document.getElementById("preview-draft-btn");
  const publishNowBtn = document.getElementById("publish-now-btn");
  const rejectDraftBtn = document.getElementById("reject-draft-btn");
  const resetPageBtn = document.getElementById("reset-page-btn");
  const resetSectionBtn = document.getElementById("reset-section-btn");
  const statusText = document.getElementById("builder-status-text");

  const query = new URLSearchParams(window.location.search);
  const targetAgentId = query.get("agent_id");
  const slug = query.get("slug") || "preview-agent";

  const builderLayout = document.querySelector(".builder-layout");
  const leftPane = document.getElementById("builder-left-pane");
  const centerPane = document.getElementById("builder-center-pane");
  const leftToggleBtn = document.getElementById("builder-left-toggle");
  const centerToggleBtn = document.getElementById("builder-center-toggle");
  const HOME_SECTION_RULES = {
    hero: {
      showHeading: true,
      showSubheading: true,
      showBody: true,
      showButtonText: false,
      showButtonLink: false,
      showImageUrl: false,
      showImageUpload: true,
      showHeadingSize: true,
      showColorPreset: true
    },
    contact: {
      showHeading: false,
      showSubheading: false,
      showBody: false,
      showButtonText: false,
      showButtonLink: false,
      showImageUrl: false,
      showImageUpload: false,
      showHeadingSize: false,
      showColorPreset: false
    },
    licenses: {
      showHeading: false,
      showSubheading: false,
      showBody: false,
      showButtonText: false,
      showButtonLink: false,
      showImageUrl: false,
      showImageUpload: false,
      showHeadingSize: false,
      showColorPreset: false
    },
    quote: {
      showHeading: false,
      showSubheading: false,
      showBody: false,
      showButtonText: false,
      showButtonLink: false,
      showImageUrl: false,
      showImageUpload: false,
      showHeadingSize: false,
      showColorPreset: false
    }
  };

  if (!targetAgentId) {
    editorFields.innerHTML = "<p>Missing agent_id in URL.</p>";
    return;
  }
  
  let currentUser = null;
  let currentAgentRow = null;
  let isAdmin = false;

  let settings = null;
  let sections = [];
  let faqs = [];
  let socials = [];

  FONT_PRESETS.forEach(font => {
    const opt = document.createElement("option");
    opt.value = font;
    opt.textContent = font;
    fontSelect.appendChild(opt);
  });

  let savedSelection = null;

  function saveEditorSelection(editor) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
  
    const range = sel.getRangeAt(0);
    if (!editor || !editor.contains(range.commonAncestorContainer)) return;
  
    savedSelection = range.cloneRange();
  }
  
  function restoreEditorSelection(editor) {
    if (!savedSelection || !editor) return;
  
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedSelection);
  }

  async function loadCurrentUserPermissions() {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      alert("You must be logged in.");
      window.location.href = "/login.html";
      return false;
    }

    currentUser = userRes.user;

    const { data: me, error: meErr } = await supabase
      .from("agents")
      .select("id, is_admin, is_active")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (meErr || !me?.id) {
      alert("Your agent account could not be found.");
      return false;
    }

    currentAgentRow = me;
    isAdmin = !!me.is_admin;

    if (!isAdmin && me.id !== targetAgentId) {
      alert("You can only edit your own page.");
      window.location.href = "/dashboard.html";
      return false;
    }

    if (publishNowBtn) publishNowBtn.style.display = isAdmin ? "" : "none";
    if (rejectDraftBtn) rejectDraftBtn.style.display = isAdmin ? "" : "none";
    if (resetPageBtn) resetPageBtn.style.display = isAdmin ? "" : "none";
    if (resetSectionBtn) resetSectionBtn.style.display = isAdmin ? "" : "none";

    return true;
  }

  function getCommandStateSafe(command) {
    try {
      return document.queryCommandState(command);
    } catch {
      return false;
    }
  }
  
  function getCurrentBlockTag(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return "";
  
    let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  
    while (node && node !== editor) {
      const tag = node.tagName?.toUpperCase();
      if (tag === "H2" || tag === "H3" || tag === "P" || tag === "DIV" || tag === "LI") {
        return tag;
      }
      node = node.parentElement;
    }
  
    return "";
  }
  
  function getCurrentTextAlign(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return "";
  
    let node = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  
    while (node && node !== editor) {
      const style = window.getComputedStyle(node);
      if (style.textAlign && style.textAlign !== "start") return style.textAlign;
      node = node.parentElement;
    }
  
    return window.getComputedStyle(editor).textAlign || "";
  }
  
  function updateToolbarStateForEditor(editor) {
    if (!editor) return;
  
    const sectionId = editor.dataset.sectionId;
    const faqId = editor.dataset.faqId;
  
    const scope = faqId
      ? `.faq-rt-btn[data-faq-id="${faqId}"]`
      : `.rt-btn[data-section-id="${sectionId}"]`;
  
    const buttons = editorFields.querySelectorAll(scope);
  
    buttons.forEach(btn => btn.classList.remove("active"));
  
    const boldBtn = [...buttons].find(b => b.dataset.cmd === "bold");
    const italicBtn = [...buttons].find(b => b.dataset.cmd === "italic");
    const underlineBtn = [...buttons].find(b => b.dataset.cmd === "underline");
    const leftBtn = [...buttons].find(b => b.dataset.cmd === "justifyLeft");
    const centerBtn = [...buttons].find(b => b.dataset.cmd === "justifyCenter");
    const rightBtn = [...buttons].find(b => b.dataset.cmd === "justifyRight");
    const h2Btn = [...buttons].find(b => b.dataset.cmd === "formatBlock-h2");
    const h3Btn = [...buttons].find(b => b.dataset.cmd === "formatBlock-h3");
  
    if (boldBtn && getCommandStateSafe("bold")) boldBtn.classList.add("active");
    if (italicBtn && getCommandStateSafe("italic")) italicBtn.classList.add("active");
    if (underlineBtn && getCommandStateSafe("underline")) underlineBtn.classList.add("active");
  
    const tag = getCurrentBlockTag(editor);
    if (h2Btn && tag === "H2") h2Btn.classList.add("active");
    if (h3Btn && tag === "H3") h3Btn.classList.add("active");
  
    const align = getCurrentTextAlign(editor);
    if (leftBtn && align === "left") leftBtn.classList.add("active");
    if (centerBtn && align === "center") centerBtn.classList.add("active");
    if (rightBtn && align === "right") rightBtn.classList.add("active");
  }
  
  function bindToolbarStateTracking() {
    editorFields.querySelectorAll(".rich-editor").forEach(editor => {
      ["keyup", "mouseup", "focus"].forEach(evt => {
        editor.addEventListener(evt, () => updateToolbarStateForEditor(editor));
      });
    });
  }
  
  function hydrateSettingsUI() {
    if (!settings) return;

    themeModeEl.value = settings.theme_mode || "dark";
    photoShapeEl.value = settings.photo_shape || "circle";
    fontSelect.value = settings.font_preset || "Bellota Text";
    buttonStyleEl.value = settings.button_style_preset || "soft-dark";

    toggleHomePage.checked = !!settings.home_enabled;
    toggleAboutPage.checked = !!settings.about_enabled;
    toggleCareersPage.checked = !!settings.careers_enabled;
    toggleFaqsPage.checked = !!settings.faqs_enabled;

    const buttonRadiusEl = document.getElementById("builder-button-radius");
    const buttonBgEl = document.getElementById("builder-button-bg");
    const buttonTextEl = document.getElementById("builder-button-text");
    const buttonBorderColorEl = document.getElementById("builder-button-border-color");
    const buttonBorderWidthEl = document.getElementById("builder-button-border-width");
    const buttonBorderStyleEl = document.getElementById("builder-button-border-style");
    const pageBgModeEl = document.getElementById("builder-page-bg-mode");
    const pageBgCustomEl = document.getElementById("builder-page-bg-custom");

    if (buttonRadiusEl) buttonRadiusEl.value = px(settings.button_radius, 14);
    if (buttonBorderWidthEl) buttonBorderWidthEl.value = px(settings.button_border_width, 1);
    
    const buttonRadiusValueEl = document.getElementById("builder-button-radius-value");
    const buttonBorderWidthValueEl = document.getElementById("builder-button-border-width-value");
    
    if (buttonRadiusValueEl && buttonRadiusEl) {
      buttonRadiusValueEl.textContent = `${buttonRadiusEl.value}px`;
    }
    if (buttonBorderWidthValueEl && buttonBorderWidthEl) {
      buttonBorderWidthValueEl.textContent = `${buttonBorderWidthEl.value}px`;
    }
    
    if (pageBgModeEl) pageBgModeEl.value = settings.page_bg_mode || "default";
    if (pageBgCustomEl) pageBgCustomEl.value = settings.page_bg_custom || "#ffffff";
    
    if (buttonRadiusEl) buttonRadiusEl.value = settings.button_radius || "14px";
    if (buttonBgEl) buttonBgEl.value = settings.button_bg_color || "#545454";
    if (buttonTextEl) buttonTextEl.value = settings.button_text_color || "#ffffff";
    if (buttonBorderColorEl) buttonBorderColorEl.value = settings.button_border_color || "#272727";
    if (buttonBorderWidthEl) buttonBorderWidthEl.value = settings.button_border_width || "1px";
    if (buttonBorderStyleEl) buttonBorderStyleEl.value = settings.button_border_style || "solid";

    setStatusBadge(settings.status || "draft");
    syncPageTogglePills();
  }
  
  async function loadAll() {
    const { data: settingsRow, error: settingsErr } = await supabase
      .from("agent_page_settings")
      .select("*")
      .eq("agent_id", targetAgentId)
      .single();

    if (settingsErr) {
      console.error("[builder] settings load failed", settingsErr);
      return;
    }

    settings = settingsRow;

    const { data: sectionRows, error: sectionErr } = await supabase
      .from("agent_page_sections")
      .select("*")
      .eq("agent_id", targetAgentId)
      .order("page_key", { ascending: true })
      .order("sort_order", { ascending: true });

    if (sectionErr) {
      console.error("[builder] sections load failed", sectionErr);
      return;
    }

    sections = sectionRows || [];

    const { data: faqRows, error: faqErr } = await supabase
      .from("agent_page_faqs")
      .select("*")
      .eq("agent_id", targetAgentId)
      .order("page_key", { ascending: true })
      .order("sort_order", { ascending: true });

    if (faqErr) {
      console.error("[builder] faqs load failed", faqErr);
      return;
    }

    faqs = faqRows || [];

    const { data: socialRows, error: socialErr } = await supabase
      .from("agent_social_links")
      .select("*")
      .eq("agent_id", targetAgentId)
      .order("sort_order", { ascending: true });

    if (socialErr) {
      console.error("[builder] socials load failed", socialErr);
      return;
    }

    socials = socialRows || [];

    hydrateSettingsUI();
    renderPageEditor(pageSelect.value);

    const oldWarning = document.getElementById("builder-review-warning");
    if (oldWarning) oldWarning.remove();

    if (settings?.rejection_notes) {
      const box = document.createElement("div");
      box.id = "builder-review-warning";
      box.className = "review-warning";
      box.innerHTML =
        "<strong>Admin Feedback:</strong><br>" +
        settings.rejection_notes;
      editorFields.prepend(box);
    }

    refreshPreview();
    styleBuilderButtonsPreview();
  }

  const setDefaultBtn = document.getElementById("set-default-btn");
  async function setCurrentPageToDefault() {
    const pageKey = pageSelect.value;
  
    const res = await fetch("/.netlify/functions/resetAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: targetAgentId,
        page_key: pageKey,
        mode: "page"
      })
    });
  
    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[builder] set default failed", json);
      alert(json.error || "Failed to reset page.");
      return;
    }
  
    await loadAll();
    showToast("Page reset to default.", "success");
  }

  if (setDefaultBtn) {
    setDefaultBtn.addEventListener("click", async () => {
      await setCurrentPageToDefault();
    });
  }
  
  async function uploadSectionImage(file, sectionId) {
    if (!file || !sectionId) return null;

    const section = sections.find(s => s.id === sectionId);
    if (!section) return null;

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";
    const fileName = `${targetAgentId}/${section.page_key}/${section.section_key}-${Date.now()}.${safeExt}`;

    const { error: uploadErr } = await supabase.storage
      .from("agent-page-images")
      .upload(fileName, file, {
        upsert: true
      });

    if (uploadErr) {
      console.error("[builder] image upload failed", uploadErr);
      alert("Failed to upload image.");
      return null;
    }

    const { data } = supabase.storage
      .from("agent-page-images")
      .getPublicUrl(fileName);

    return data?.publicUrl || null;
  }

  function px(value, fallback = 0) {
    const n = parseInt(String(value || "").replace("px", ""), 10);
    return Number.isFinite(n) ? n : fallback;
  }
  
  function bindPageBackgroundControls() {
    const modeEl = document.getElementById("builder-page-bg-mode");
    const customWrap = document.getElementById("builder-page-bg-custom-wrap");
  
    if (!modeEl || !customWrap) return;
  
    const sync = () => {
      customWrap.style.display = modeEl.value === "custom" ? "" : "none";
    };
  
    modeEl.addEventListener("change", sync);
    sync();
  }

  function bindPxSliders() {
    const pairs = [
      ["builder-button-radius", "builder-button-radius-value"],
      ["builder-button-border-width", "builder-button-border-width-value"]
    ];
  
    pairs.forEach(([inputId, valueId]) => {
      const input = document.getElementById(inputId);
      const value = document.getElementById(valueId);
      if (!input || !value) return;
  
      const sync = () => {
        value.textContent = `${input.value}px`;
      };
  
      input.addEventListener("input", sync);
      sync();
    });
  }
  
  function bindSectionImageUploads() {
    editorFields.querySelectorAll(".section-image-upload").forEach(input => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        const sectionId = input.dataset.sectionId;
        const row = sections.find(s => s.id === sectionId);
  
        if (!file || !sectionId || !row) return;
  
        if (!file.type.startsWith("image/")) {
          alert("Please upload an image file.");
          return;
        }
  
        if (file.size > 5 * 1024 * 1024) {
          alert("Please keep images under 5MB.");
          return;
        }
  
        const imageUrl = await uploadSectionImage(file, sectionId);
        if (!imageUrl) return;
  
        const urlInput = editorFields.querySelector(
          `[data-field-type="section-content"][data-section-id="${sectionId}"][data-key="image_url"]`
        );
        const preview = editorFields.querySelector(`[data-image-preview="${sectionId}"]`);
  
        if (urlInput) {
          urlInput.value = imageUrl;
        }
  
        if (preview) {
          preview.src = imageUrl;
          preview.classList.remove("hidden");
        }
  
        row.draft_content = {
          ...(row.draft_content || {}),
          image_url: imageUrl
        };
  
        const { error } = await supabase
          .from("agent_page_sections")
          .update({
            draft_content: row.draft_content,
            updated_at: new Date().toISOString()
          })
          .eq("id", sectionId);
  
        if (error) {
          console.error("[builder] image save failed", error);
          showToast("Failed to save image.", "error");
          return;
        }
  
        showToast("Image uploaded.", "success");
        refreshPreview();
      });
    });
  }
  
  function prettyLabel(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, m => m.toUpperCase());
  }

  function syncPageTogglePills() {
    const pairs = [
      ["pill-home-page", toggleHomePage],
      ["pill-about-page", toggleAboutPage],
      ["pill-careers-page", toggleCareersPage],
      ["pill-faqs-page", toggleFaqsPage]
    ];
  
    pairs.forEach(([pillId, checkbox]) => {
      const pill = document.getElementById(pillId);
      if (!pill || !checkbox) return;
  
      pill.classList.remove("active", "inactive");
  
      if (checkbox.checked) {
        pill.classList.add("active");
        pill.innerHTML = `
          <span class="pill-text">${pill.textContent.trim()}</span>
          <span class="pill-badge enabled"><i class="fa-solid fa-check"></i></span>
        `;
      } else {
        pill.classList.add("inactive");
        pill.innerHTML = `
          <span class="pill-text">${pill.textContent.trim()}</span>
          <span class="pill-badge disabled"><i class="fa-solid fa-xmark"></i></span>
        `;
      }
    });
  }

  function bindPageTogglePills() {
    document.querySelectorAll(".builder-pill-toggle[data-target-checkbox]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const targetId = btn.dataset.targetCheckbox;
        const checkbox = document.getElementById(targetId);
        if (!checkbox) return;

        checkbox.checked = !checkbox.checked;
        syncPageTogglePills();
        await saveSettings();
        refreshPreview();
      });
    });
  }

  function renderSectionTogglePills(pageKey) {
    sectionToggleList.innerHTML = "";
  
    const pageSections = getCurrentPageSections(pageKey);
    if (!pageSections.length) {
      sectionToggleList.innerHTML = "<p>No sections found.</p>";
      return;
    }
  
    pageSections.forEach(section => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `builder-pill-toggle ${section.is_enabled ? "active" : "inactive"}`;
  
      btn.innerHTML = `
        <span class="pill-text">${prettyLabel(section.section_key)}</span>
        <span class="pill-badge ${section.is_enabled ? "enabled" : "disabled"}">
          <i class="fa-solid ${section.is_enabled ? "fa-check" : "fa-xmark"}"></i>
        </span>
      `;
  
      btn.addEventListener("click", async () => {
        await saveSectionToggle(section.id, !section.is_enabled);
      });
  
      sectionToggleList.appendChild(btn);
    });
  }

  function toggleCollapsibleCard(card) {
    if (!card) return;
    card.classList.toggle("collapsed");
  }

  function bindLicenseBodyStyleControls() {
    editorFields.querySelectorAll(".license-style-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sectionId = btn.dataset.sectionId;
        const row = sections.find(s => s.id === sectionId);
        if (!row) return;
  
        row.draft_style = row.draft_style || {};
  
        if (btn.classList.contains("license-style-clear-btn")) {
          delete row.draft_style.licenses_body_highlight;
          delete row.draft_style.licenses_body_color;
          delete row.draft_style.licenses_body_font_size;
          delete row.draft_style.licenses_body_font_weight;
          delete row.draft_style.licenses_body_font_style;
          delete row.draft_style.licenses_body_text_decoration;
        } else {
          const key = btn.dataset.styleKey;
          const value = btn.dataset.styleValue;
          const styleKey = `licenses_body_${key}`;
  
          row.draft_style[styleKey] =
            row.draft_style[styleKey] === value ? "" : value;
        }
  
        await supabase
          .from("agent_page_sections")
          .update({
            draft_style: row.draft_style,
            updated_at: new Date().toISOString()
          })
          .eq("id", sectionId);
  
        refreshPreview();
        renderPageEditor(pageSelect.value);
      });
    });
  
    editorFields.querySelectorAll(".license-body-color-picker").forEach(input => {
      input.addEventListener("input", async () => {
        const sectionId = input.dataset.sectionId;
        const row = sections.find(s => s.id === sectionId);
        if (!row) return;
  
        row.draft_style = row.draft_style || {};
        row.draft_style.licenses_body_color = input.value;
  
        await supabase
          .from("agent_page_sections")
          .update({
            draft_style: row.draft_style,
            updated_at: new Date().toISOString()
          })
          .eq("id", sectionId);
  
        refreshPreview();
      });
    });
  
    editorFields.querySelectorAll(".license-body-highlight-picker").forEach(input => {
      input.addEventListener("input", async () => {
        const sectionId = input.dataset.sectionId;
        const row = sections.find(s => s.id === sectionId);
        if (!row) return;
  
        row.draft_style = row.draft_style || {};
        row.draft_style.licenses_body_highlight = input.value;
  
        await supabase
          .from("agent_page_sections")
          .update({
            draft_style: row.draft_style,
            updated_at: new Date().toISOString()
          })
          .eq("id", sectionId);
  
        refreshPreview();
      });
    });
  
    editorFields.querySelectorAll(".license-body-font-size").forEach(input => {
      input.addEventListener("input", async () => {
        const sectionId = input.dataset.sectionId;
        const row = sections.find(s => s.id === sectionId);
        if (!row) return;
  
        const pxValue = parseInt(input.value, 10);
        if (!Number.isFinite(pxValue) || pxValue < 1) return;
  
        row.draft_style = row.draft_style || {};
        row.draft_style.licenses_body_font_size = `${pxValue}px`;
  
        await supabase
          .from("agent_page_sections")
          .update({
            draft_style: row.draft_style,
            updated_at: new Date().toISOString()
          })
          .eq("id", sectionId);
  
        refreshPreview();
      });
    });
  }

  function bindCollapsibleCards() {
    document.querySelectorAll(".editor-subcard, .editor-field-group").forEach(card => {
      const head = card.querySelector(":scope > .builder-collapsible-head");
      if (!head) return;
  
      head.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
  
        const isCollapsed = card.classList.contains("collapsed");
        setCollapsibleState(card, !isCollapsed);
      };
    });
  }
  
  function validateBeforePublish() {
    const errors = [];

    sections.forEach(section => {
      if (!section.is_enabled) return;

      const c = section.draft_content || {};
      const hasAnyContent = Object.values(c).some(v => {
        if (v == null) return false;
        return String(v).trim() !== "";
      });

      if (!hasAnyContent) {
        errors.push(section.section_key);
      }
    });

    if (errors.length) {
      showToast("Some enabled sections are empty.", "error");
      alert(
        "These sections are empty but enabled:\n\n" +
        errors.join("\n") +
        "\n\nDisable them or add content."
      );
      return false;
    }

    return true;
  }
  
  function getSocialIconClass(platform) {
    const p = String(platform || "").toLowerCase();
  
    const map = {
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
      calendly: "fa fa-calendar",
      google: "fab fa-google",
      yelp: "fab fa-yelp",
      website: "fa fa-globe",
      email: "fa fa-envelope",
      phone: "fa fa-phone",
      messenger: "fab fa-facebook-messenger",
      linktree: "fa fa-link"
    };
  
    return map[p] || "fa fa-link";
  }
  
  function getSocialColorClass(platform) {
    const p = String(platform || "").toLowerCase();
  
    const map = {
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
      calendly: "social-color-calendly",
      google: "social-color-google",
      yelp: "social-color-yelp",
      website: "social-color-website",
      email: "social-color-email",
      phone: "social-color-phone",
      messenger: "social-color-messenger",
      linktree: "social-color-linktree"
    };
  
    return map[p] || "social-color-default";
  }
  
  function setStatusBadge(status) {
    if (!statusText) return;

    const normalized = status || "draft";
    statusText.textContent = normalized;

    statusText.classList.remove("status-draft", "status-pending_review", "status-published");
    statusText.classList.add(`status-${normalized}`);
  }
  
  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function applyPaneState() {
    if (!builderLayout || !leftPane || !centerPane) return;

    const leftCollapsed = leftPane.classList.contains("collapsed");
    const centerCollapsed = centerPane.classList.contains("collapsed");

    builderLayout.classList.toggle("left-collapsed", leftCollapsed);
    builderLayout.classList.toggle("center-collapsed", centerCollapsed);
  }

  function bindPaneToggles() {
    if (leftToggleBtn && leftPane) {
      leftToggleBtn.addEventListener("click", () => {
        leftPane.classList.toggle("collapsed");
        applyPaneState();
      });
    }

    if (centerToggleBtn && centerPane) {
      centerToggleBtn.addEventListener("click", () => {
        centerPane.classList.toggle("collapsed");
        applyPaneState();
      });
    }
  }

  function showToast(message, type = "info") {
    const wrap = document.getElementById("builder-toast-wrap");
    if (!wrap) return;

    const toast = document.createElement("div");
    toast.className = `builder-toast ${type}`;
    toast.textContent = message;

    wrap.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 250);
    }, 2200);
  }

  function setSaveStatus(state, text = "") {
    const el = document.getElementById("builder-save-status");
    if (!el) return;

    el.className = `save-status ${state}`;
    el.textContent = text || state;
  }

  function getSectionCompleteness(section) {
    const c = section?.draft_content || {};
    const values = Object.values(c)
      .map(v => String(v || "").trim())
      .filter(Boolean);

    if (values.length === 0) return "empty";
    if (values.length < 2) return "partial";
    return "ready";
  }

  function bindSectionRangeOutputs() {
    editorFields.querySelectorAll('input[type="range"][data-field-type="section-style"]').forEach(input => {
      const output = input.nextElementSibling;
      if (!output || !output.classList.contains("range-output")) return;
  
      const sync = () => {
        output.textContent = `${input.value}px`;
      };
  
      input.addEventListener("input", sync);
      sync();
    });
  }

  function bindSectionCardCollapse() {
    editorFields.querySelectorAll(".builder-section-card").forEach(card => {
      const head = card.querySelector(":scope > .builder-section-head");
      if (!head) return;
  
      head.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
  
        const isCollapsed = card.classList.contains("collapsed");
        setCollapsibleState(card, !isCollapsed);
      };
    });
  }

  function setCollapsibleState(card, collapsed) {
    if (!card) return;
  
    const body = card.querySelector(":scope > .builder-section-body, :scope > .builder-collapsible-body");
    const caret = card.querySelector(":scope > .builder-section-head .builder-section-caret, :scope > .builder-collapsible-head .builder-section-caret");
  
    card.classList.toggle("collapsed", collapsed);
  
    if (body) {
      body.style.display = collapsed ? "none" : "block";
    }
  
    if (caret) {
      caret.style.transform = collapsed ? "rotate(-90deg)" : "rotate(0deg)";
    }
  }
  
  function sanitizeRichHtml(html) {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html || "";
  
    const allowedTags = new Set([
      "B", "STRONG",
      "I", "EM",
      "U",
      "MARK",
      "UL", "OL", "LI",
      "BR",
      "P",
      "DIV",
      "H2",
      "H3",
      "SPAN",
      "FONT"
    ]);
  
    const nodes = wrapper.querySelectorAll("*");
  
    nodes.forEach(node => {
      if (!allowedTags.has(node.tagName)) {
        const parent = node.parentNode;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
        return;
      }
  
      [...node.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const rawValue = String(attr.value || "");
  
        if (name === "style") {
          const safeStyles = [];
  
          const textAlignMatch = rawValue.match(/text-align\s*:\s*(left|center|right)/i);
          if (textAlignMatch) {
            safeStyles.push(`text-align:${textAlignMatch[1].toLowerCase()}`);
          }
  
          const fontWeightMatch = rawValue.match(/font-weight\s*:\s*(bold|700|600|500)/i);
          if (fontWeightMatch) {
            safeStyles.push("font-weight:bold");
          }
  
          const fontStyleMatch = rawValue.match(/font-style\s*:\s*italic/i);
          if (fontStyleMatch) {
            safeStyles.push("font-style:italic");
          }
  
          const underlineMatch = rawValue.match(/text-decoration(?:-line)?\s*:\s*underline/i);
          if (underlineMatch) {
            safeStyles.push("text-decoration:underline");
          }
  
          const bgMatch = rawValue.match(/background(?:-color)?\s*:\s*([^;]+)/i);
          if (bgMatch) {
            safeStyles.push(`background:${bgMatch[1].trim()}`);
          }
          
          const colorMatch = rawValue.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
          if (colorMatch) {
            const colorValue = colorMatch[1].trim().toLowerCase();
            const bgValue = bgMatch ? bgMatch[1].trim().toLowerCase() : "";
          
            const looksWhite =
              colorValue === "#fff" ||
              colorValue === "#ffffff" ||
              colorValue === "white" ||
              colorValue === "rgb(255, 255, 255)" ||
              colorValue === "rgb(255,255,255)";
          
            if (!(bgValue && looksWhite)) {
              safeStyles.push(`color:${colorMatch[1].trim()}`);
            }
          }
            
          const fontSizeMatch = rawValue.match(/font-size\s*:\s*([0-9.]+px)/i);
          if (fontSizeMatch) {
            safeStyles.push(`font-size:${fontSizeMatch[1].trim()}`);
          }
  
          if (safeStyles.length) {
            node.setAttribute("style", safeStyles.join(";"));
          } else {
            node.removeAttribute("style");
          }
  
          return;
        }
  
        if (node.tagName === "FONT" && name === "size") {
          return;
        }
  
        node.removeAttribute(attr.name);
      });
  
      if (node.tagName === "FONT") {
        const size = node.getAttribute("size");
        if (size === "7" && !node.style.fontSize) {
          node.style.fontSize = "16px";
        }
        node.removeAttribute("size");
      }
  
      if (node.tagName === "SPAN") {
        const style = node.getAttribute("style");
        if (!style) {
          const parent = node.parentNode;
          while (node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
        }
      }
    });
  
    return wrapper.innerHTML.trim();
  }
  
  function styleBuilderButtonsPreview() {
    const preset = buttonStyleEl.value || "soft-dark";
    const previewButtons = [
      saveDraftBtn,
      submitReviewBtn,
      previewDraftBtn
    ].filter(Boolean);

    const allPresetClasses = [
      "btn-soft-dark",
      "btn-soft-light",
      "btn-pill-dark",
      "btn-pill-light",
      "btn-outline-dark",
      "btn-outline-light",
      "fvg-btn"
    ];

    previewButtons.forEach(btn => {
      allPresetClasses.forEach(cls => btn.classList.remove(cls));
      btn.classList.add("fvg-btn", `btn-${preset}`);
    });
  }

  function execRichCommand(cmd, targetEl, value = null) {
    if (!targetEl) return;
  
    targetEl.focus();
  
    if (cmd === "highlightColor") {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("hiliteColor", false, value || "#fff3a3");
      document.execCommand("styleWithCSS", false, false);
      return;
    }
  
    document.execCommand("styleWithCSS", false, false);
  
    if (cmd === "formatBlock-h2") {
      document.execCommand("formatBlock", false, "H2");
      return;
    }
  
    if (cmd === "formatBlock-h3") {
      document.execCommand("formatBlock", false, "H3");
      return;
    }
  
    if (cmd === "justifyLeft" || cmd === "justifyCenter" || cmd === "justifyRight") {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand(cmd, false, null);
      document.execCommand("styleWithCSS", false, false);
      return;
    }
  
    if (cmd === "removeFormat") {
      document.execCommand("removeFormat", false, null);
      document.execCommand("unlink", false, null);
    
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        let node = sel.getRangeAt(0).commonAncestorContainer;
        if (node.nodeType !== 1) node = node.parentElement;
    
        while (node && node !== targetEl) {
          if (["H2", "H3"].includes(node.tagName)) {
            document.execCommand("formatBlock", false, "P");
            break;
          }
          node = node.parentElement;
        }
      }
    
      return;
    }

    if (cmd === "foreColor") {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("foreColor", false, value || "#000000");
      document.execCommand("styleWithCSS", false, false);
      return;
    }
    
    if (cmd === "fontSizeCustom") {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
    
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("fontSize", false, "7");
    
      targetEl.querySelectorAll('font[size="7"]').forEach(node => {
        const span = document.createElement("span");
        span.style.fontSize = value || "16px";
        span.innerHTML = node.innerHTML;
        node.replaceWith(span);
      });
    
      return;
    }
    
    document.execCommand(cmd, false, null);
  }

  function bindRichTextToolbar() {
    const allToolbarButtons = editorFields.querySelectorAll(
      ".rt-btn, .faq-rt-btn, .faq-highlight-color-btn"
    );
  
    allToolbarButtons.forEach(btn => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
  
        const sectionId = btn.dataset.sectionId;
        const faqId = btn.dataset.faqId;
        const targetKey = btn.dataset.targetKey || "body";
  
        const editor = faqId
          ? editorFields.querySelector(`.faq-rich-editor[data-faq-id="${faqId}"]`)
          : editorFields.querySelector(`.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`);
  
        if (editor) {
          restoreEditorSelection(editor);
        }
      });
    });
  
    editorFields.querySelectorAll(".rt-btn[data-section-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const sectionId = btn.dataset.sectionId;
        const cmd = btn.dataset.cmd;
        const targetKey = btn.dataset.targetKey || "body";
        const editor = editorFields.querySelector(`.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`);
  
        restoreEditorSelection(editor);
        execRichCommand(cmd, editor);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
      });
    });
  
    editorFields.querySelectorAll(".faq-rt-btn[data-faq-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const faqId = btn.dataset.faqId;
        const cmd = btn.dataset.cmd;
        const editor = editorFields.querySelector(`.faq-rich-editor[data-faq-id="${faqId}"]`);
  
        restoreEditorSelection(editor);
        execRichCommand(cmd, editor);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
      });
    });
  
    editorFields.querySelectorAll(".highlight-color-btn[data-section-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const sectionId = btn.dataset.sectionId;
        const color = btn.dataset.color;
        const targetKey = btn.dataset.targetKey || "body";
        const editor = editorFields.querySelector(`.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`);
  
        restoreEditorSelection(editor);
        execRichCommand("highlightColor", editor, color);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
      });
    });
  
    editorFields.querySelectorAll(".faq-highlight-color-btn[data-faq-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const faqId = btn.dataset.faqId;
        const color = btn.dataset.color;
        const editor = editorFields.querySelector(`.faq-rich-editor[data-faq-id="${faqId}"]`);
  
        restoreEditorSelection(editor);
        execRichCommand("highlightColor", editor, color);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
      });
    });
  }

  function bindCustomHighlightPickers() {
    editorFields.querySelectorAll(".custom-highlight-picker").forEach(input => {
      input.addEventListener("mousedown", (e) => {
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (editor) saveEditorSelection(editor);
        e.stopPropagation();
      });
  
      input.addEventListener("click", (e) => {
        e.stopPropagation();
      });
  
      input.addEventListener("input", async () => {
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (!editor) return;
  
        restoreEditorSelection(editor);
        execRichCommand("highlightColor", editor, input.value);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
  
        await saveSectionDraft(sectionId);
      });
    });
  }
  
  function bindEditorSelectionTracking() {
    editorFields.querySelectorAll(".rich-editor, .faq-rich-editor").forEach(editor => {
      ["keyup", "mouseup", "focus", "input"].forEach(evt => {
        editor.addEventListener(evt, () => {
          saveEditorSelection(editor);
        });
      });
    });
  }

  function bindBackgroundModeToggles() {
    editorFields.querySelectorAll(".background-mode-select").forEach(select => {
      select.addEventListener("change", () => {
        const sectionId = select.dataset.sectionId;
        const presetWrap = editorFields.querySelector(`.background-preset-wrap[data-section-id="${sectionId}"]`);
        const customWrap = editorFields.querySelector(`.background-custom-wrap[data-section-id="${sectionId}"]`);
  
        if (presetWrap) {
          presetWrap.style.display = select.value === "preset" ? "" : "none";
        }
  
        if (customWrap) {
          customWrap.style.display = select.value === "custom" ? "" : "none";
        }
      });
    });
  }

  function bindTextColorPickers() {
    editorFields.querySelectorAll(".text-color-picker").forEach(input => {
      input.addEventListener("mousedown", () => {
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (editor) saveEditorSelection(editor);
      });
  
      input.addEventListener("input", async () => {
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (!editor) return;
  
        restoreEditorSelection(editor);
        execRichCommand("foreColor", editor, input.value);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
  
        const icon = input.parentElement?.querySelector(".toolbar-a-icon");
        if (icon) {
          icon.style.setProperty("--toolbar-color", input.value);
        }
  
        await saveSectionDraft(sectionId);
      });
    });
  }

  function bindToolbarFontSizes() {
    editorFields.querySelectorAll(".toolbar-font-size").forEach(input => {
      input.addEventListener("mousedown", () => {
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (editor) saveEditorSelection(editor);
      });
  
      input.addEventListener("focus", () => {
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (editor) saveEditorSelection(editor);
      });
  
      input.addEventListener("keydown", async (e) => {
        if (e.key !== "Enter") return;
  
        e.preventDefault();
  
        const pxValue = parseInt(input.value, 10);
        if (!Number.isFinite(pxValue) || pxValue < 1) {
          input.value = 16;
          return;
        }
  
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (!editor) return;
  
        restoreEditorSelection(editor);
        execRichCommand("fontSizeCustom", editor, `${pxValue}px`);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
  
        await saveSectionDraft(sectionId);
      });
  
      input.addEventListener("change", async () => {
        const pxValue = parseInt(input.value, 10);
        if (!Number.isFinite(pxValue) || pxValue < 1) {
          input.value = 16;
          return;
        }
  
        const sectionId = input.dataset.sectionId;
        const targetKey = input.dataset.targetKey || "body";
        const editor = editorFields.querySelector(
          `.rich-editor[data-section-id="${sectionId}"][data-key="${targetKey}"]`
        );
  
        if (!editor) return;
  
        restoreEditorSelection(editor);
        execRichCommand("fontSizeCustom", editor, `${pxValue}px`);
        saveEditorSelection(editor);
        updateToolbarStateForEditor(editor);
  
        await saveSectionDraft(sectionId);
      });
    });
  }
  
  function bindDragList(listEl, itemSelector, idAttr, onDropSave) {
    if (!listEl) return;

    let draggedEl = null;

    listEl.querySelectorAll(itemSelector).forEach(item => {
      const handle = item.querySelector(".drag-handle");
      if (!handle) return;

      handle.addEventListener("mousedown", () => {
        item.draggable = true;
      });

      item.addEventListener("dragstart", (e) => {
        draggedEl = item;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });

      item.addEventListener("dragend", async () => {
        item.classList.remove("dragging");
        listEl.querySelectorAll(itemSelector).forEach(el => el.classList.remove("drag-over"));

        if (draggedEl) {
          await onDropSave(
            Array.from(listEl.querySelectorAll(itemSelector)).map((el, index) => ({
              id: el.dataset[idAttr],
              sort_order: index + 1
            }))
          );
        }

        draggedEl = null;
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (!draggedEl || draggedEl === item) return;
        item.classList.add("drag-over");
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("drag-over");
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");

        if (!draggedEl || draggedEl === item) return;

        const items = Array.from(listEl.querySelectorAll(itemSelector));
        const draggedIndex = items.indexOf(draggedEl);
        const targetIndex = items.indexOf(item);

        if (draggedIndex < targetIndex) {
          item.after(draggedEl);
        } else {
          item.before(draggedEl);
        }
      });
    });
  }

  async function saveFaqOrderFromList(orderRows) {
    for (const row of orderRows) {
      const { error } = await supabase
        .from("agent_page_faqs")
        .update({
          sort_order: row.sort_order,
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

      if (error) {
        console.error("[builder] faq drag reorder failed", error);
        showToast("Failed to reorder FAQs.", "error");
        return;
      }
    }

    faqs = faqs.map(faq => {
      const match = orderRows.find(r => r.id === faq.id);
      return match ? { ...faq, sort_order: match.sort_order } : faq;
    }).sort((a, b) => {
      if (a.page_key !== b.page_key) return a.page_key.localeCompare(b.page_key);
      return (a.sort_order || 0) - (b.sort_order || 0);
    });

    showToast("FAQ order updated.", "success");
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function saveSocialOrderFromList(orderRows) {
    for (const row of orderRows) {
      const { error } = await supabase
        .from("agent_social_links")
        .update({
          sort_order: row.sort_order,
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

      if (error) {
        console.error("[builder] social drag reorder failed", error);
        showToast("Failed to reorder socials.", "error");
        return;
      }
    }

    socials = socials.map(social => {
      const match = orderRows.find(r => r.id === social.id);
      return match ? { ...social, sort_order: match.sort_order } : social;
    }).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

    showToast("Social order updated.", "success");
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  function bindRemoveImageButtons() {
    editorFields.querySelectorAll(".remove-image-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sectionId = btn.dataset.sectionId;
        const row = sections.find(s => s.id === sectionId);
        if (!row) return;
  
        const preview = editorFields.querySelector(`[data-image-preview="${sectionId}"]`);
        const urlInput = editorFields.querySelector(
          `[data-field-type="section-content"][data-section-id="${sectionId}"][data-key="image_url"]`
        );
  
        if (urlInput) {
          urlInput.value = "";
        }
  
        if (preview) {
          preview.src = "";
          preview.classList.add("hidden");
        }
  
        row.draft_content = {
          ...(row.draft_content || {}),
          image_url: ""
        };
  
        const { error } = await supabase
          .from("agent_page_sections")
          .update({
            draft_content: row.draft_content,
            updated_at: new Date().toISOString()
          })
          .eq("id", sectionId);
  
        if (error) {
          console.error("[builder] remove image failed", error);
          showToast("Failed to remove image.", "error");
          return;
        }
  
        refreshPreview();
        showToast("Image removed.", "info");
      });
    });
  }
  
  function bindRichPasteHandling() {
    editorFields.querySelectorAll(".rich-editor").forEach(editor => {
      editor.addEventListener("paste", (e) => {
        e.preventDefault();

        const clipboard = e.clipboardData || window.clipboardData;
        const html = clipboard.getData("text/html");
        const text = clipboard.getData("text/plain");

        if (html) {
          const clean = sanitizeRichHtml(html);
          document.execCommand("insertHTML", false, clean);
        } else {
          const safeText = String(text || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll("\n", "<br>");
          document.execCommand("insertHTML", false, safeText);
        }
      });
    });
  }

  function bindRichEditorParagraphHandling() {
    editorFields.querySelectorAll(".rich-editor").forEach(editor => {
      editor.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          const selection = window.getSelection();
          const node = selection?.anchorNode?.parentElement;

          if (node && ["LI", "H2", "H3", "P", "DIV"].includes(node.tagName)) {
            return;
          }

          document.execCommand("formatBlock", false, "p");
        }
      });
    });
  }
  
  function getCurrentPageSections(pageKey) {
    return sections.filter(s => s.page_key === pageKey);
  }

  function getCurrentPageFaqs(pageKey) {
    return faqs.filter(f => f.page_key === pageKey);
  }

  function renderSectionToggles(pageKey) {
    renderSectionTogglePills(pageKey);
  }

  function renderPageEditor(pageKey) {
    renderSectionToggles(pageKey);
    editorFields.innerHTML = "";
  
    const pageSections = getCurrentPageSections(pageKey);
  
    pageSections.forEach(section => {
      const content = section.draft_content || {};
      const style = section.draft_style || {};
      const completeness = getSectionCompleteness(section);
  
      const wrap = document.createElement("div");
      wrap.className = "builder-section-card collapsed";
  
      const homeRules = pageKey === "home"
        ? (HOME_SECTION_RULES[section.section_key] || null)
        : null;
  
      const isLicensesSection = pageKey === "home" && section.section_key === "licenses";
  
      wrap.innerHTML = `
        <button type="button" class="builder-section-head">
          <div class="builder-section-head-left">
            <span class="builder-section-title">${prettyLabel(pageKey)} / ${prettyLabel(section.section_key)}</span>
            <div class="builder-section-meta">
              <span class="section-badge ${completeness}">${completeness}</span>
              <span class="section-toggle-mini">${section.is_enabled ? "Enabled" : "Disabled"}</span>
            </div>
          </div>
          <span class="builder-section-caret">▾</span>
        </button>
  
        <div class="builder-section-body">
          ${
            !homeRules || homeRules.showHeading
              ? `
                <div class="editor-subcard collapsed">
                  <button type="button" class="builder-collapsible-head">
                    <span class="builder-section-title">Heading</span>
                    <span class="builder-section-caret">▾</span>
                  </button>
                  <div class="builder-collapsible-body">
                    <div class="highlight-color-row">
                      <input
                        type="color"
                        class="custom-highlight-picker"
                        data-section-id="${section.id}"
                        data-target-key="heading"
                        value="#fff3a3"
                        title="Custom highlight"
                      />
                    </div>
  
                    <div class="rt-toolbar" data-toolbar-for="${section.id}-heading">
                      <button type="button" class="rt-btn" data-cmd="bold" data-section-id="${section.id}" data-target-key="heading" title="Bold"><i class="fa-solid fa-bold"></i></button>
                      <button type="button" class="rt-btn" data-cmd="italic" data-section-id="${section.id}" data-target-key="heading" title="Italic"><i class="fa-solid fa-italic"></i></button>
                      <button type="button" class="rt-btn" data-cmd="underline" data-section-id="${section.id}" data-target-key="heading" title="Underline"><i class="fa-solid fa-underline"></i></button>
                      <button type="button" class="rt-btn" data-cmd="insertUnorderedList" data-section-id="${section.id}" data-target-key="heading" title="Bullet List"><i class="fa-solid fa-list-ul"></i></button>
                      <button type="button" class="rt-btn" data-cmd="formatBlock-h2" data-section-id="${section.id}" data-target-key="heading" title="Heading 2">H2</button>
                      <button type="button" class="rt-btn" data-cmd="formatBlock-h3" data-section-id="${section.id}" data-target-key="heading" title="Heading 3">H3</button>
                      <button type="button" class="rt-btn" data-cmd="justifyLeft" data-section-id="${section.id}" data-target-key="heading" title="Align Left"><i class="fa-solid fa-align-left"></i></button>
                      <button type="button" class="rt-btn" data-cmd="justifyCenter" data-section-id="${section.id}" data-target-key="heading" title="Align Center"><i class="fa-solid fa-align-center"></i></button>
                      <button type="button" class="rt-btn" data-cmd="justifyRight" data-section-id="${section.id}" data-target-key="heading" title="Align Right"><i class="fa-solid fa-align-right"></i></button>
                      <div class="toolbar-color-wrap">
                        <button type="button" class="rt-color-btn" title="Text Color">
                          <span class="toolbar-a-icon" style="--toolbar-color:${escapeHtml(style.color_custom || "#000000")}">A</span>
                        </button>
                        <input
                          type="color"
                          class="text-color-picker"
                          data-section-id="${section.id}"
                          data-target-key="heading"
                          value="${escapeHtml(style.color_custom || "#000000")}"
                          title="Text Color"
                        />
                      </div>
  
                      <input
                        type="number"
                        class="toolbar-font-size"
                        data-section-id="${section.id}"
                        data-target-key="heading"
                        min="8"
                        max="300"
                        step="1"
                        value="16"
                        title="Text Size"
                      />
                      <button type="button" class="rt-btn" data-cmd="removeFormat" data-section-id="${section.id}" data-target-key="heading" title="Clear Formatting"><i class="fa-solid fa-eraser"></i></button>
                    </div>
  
                    <div
                      class="rich-editor"
                      contenteditable="true"
                      data-field-type="section-content-html"
                      data-section-id="${section.id}"
                      data-key="heading"
                    >${content.heading || ""}</div>
                  </div>
                </div>
              `
              : ""
          }
  
          ${
            !homeRules || homeRules.showSubheading
              ? `
                <div class="editor-subcard collapsed">
                  <button type="button" class="builder-collapsible-head">
                    <span class="builder-section-title">Subheading</span>
                    <span class="builder-section-caret">▾</span>
                  </button>
                  <div class="builder-collapsible-body">
                    <div class="highlight-color-row">
                      <input
                        type="color"
                        class="custom-highlight-picker"
                        data-section-id="${section.id}"
                        data-target-key="subheading"
                        value="#fff3a3"
                        title="Custom highlight"
                      />
                    </div>
  
                    <div class="rt-toolbar" data-toolbar-for="${section.id}-subheading">
                      <button type="button" class="rt-btn" data-cmd="bold" data-section-id="${section.id}" data-target-key="subheading" title="Bold"><i class="fa-solid fa-bold"></i></button>
                      <button type="button" class="rt-btn" data-cmd="italic" data-section-id="${section.id}" data-target-key="subheading" title="Italic"><i class="fa-solid fa-italic"></i></button>
                      <button type="button" class="rt-btn" data-cmd="underline" data-section-id="${section.id}" data-target-key="subheading" title="Underline"><i class="fa-solid fa-underline"></i></button>
                      <button type="button" class="rt-btn" data-cmd="insertUnorderedList" data-section-id="${section.id}" data-target-key="subheading" title="Bullet List"><i class="fa-solid fa-list-ul"></i></button>
                      <button type="button" class="rt-btn" data-cmd="formatBlock-h2" data-section-id="${section.id}" data-target-key="subheading" title="Heading 2">H2</button>
                      <button type="button" class="rt-btn" data-cmd="formatBlock-h3" data-section-id="${section.id}" data-target-key="subheading" title="Heading 3">H3</button>
                      <button type="button" class="rt-btn" data-cmd="justifyLeft" data-section-id="${section.id}" data-target-key="subheading" title="Align Left"><i class="fa-solid fa-align-left"></i></button>
                      <button type="button" class="rt-btn" data-cmd="justifyCenter" data-section-id="${section.id}" data-target-key="subheading" title="Align Center"><i class="fa-solid fa-align-center"></i></button>
                      <button type="button" class="rt-btn" data-cmd="justifyRight" data-section-id="${section.id}" data-target-key="subheading" title="Align Right"><i class="fa-solid fa-align-right"></i></button>
                      <div class="toolbar-color-wrap">
                        <button type="button" class="rt-color-btn" title="Text Color">
                          <span class="toolbar-a-icon" style="--toolbar-color:${escapeHtml(style.color_custom || "#000000")}">A</span>
                        </button>
                        <input
                          type="color"
                          class="text-color-picker"
                          data-section-id="${section.id}"
                          data-target-key="subheading"
                          value="${escapeHtml(style.color_custom || "#000000")}"
                          title="Text Color"
                        />
                      </div>
  
                      <input
                        type="number"
                        class="toolbar-font-size"
                        data-section-id="${section.id}"
                        data-target-key="subheading"
                        min="8"
                        max="300"
                        step="1"
                        value="16"
                        title="Text Size"
                      />
                      <button type="button" class="rt-btn" data-cmd="removeFormat" data-section-id="${section.id}" data-target-key="subheading" title="Clear Formatting"><i class="fa-solid fa-eraser"></i></button>
                    </div>
  
                    <div
                      class="rich-editor"
                      contenteditable="true"
                      data-field-type="section-content-html"
                      data-section-id="${section.id}"
                      data-key="subheading"
                    >${content.subheading || ""}</div>
                  </div>
                </div>
              `
              : ""
          }
  
          ${
            !homeRules || homeRules.showBody
              ? (
                  isLicensesSection
                    ? `
                      <div class="editor-subcard collapsed">
                        <button type="button" class="builder-collapsible-head">
                          <span class="builder-section-title">Body</span>
                          <span class="builder-section-caret">▾</span>
                        </button>
                        <div class="builder-collapsible-body">
                          <p class="builder-note">
                            These controls style the generated license rows only. They do not edit the actual license text.
                          </p>
  
                          <div class="rt-toolbar license-style-toolbar" data-toolbar-for="${section.id}-licenses-body">
                            <input
                              type="color"
                              class="license-body-highlight-picker"
                              data-section-id="${section.id}"
                              value="${escapeHtml(style.licenses_body_highlight || "#fff3a3")}"
                              title="Highlight Color"
                            />
  
                            <button
                              type="button"
                              class="license-style-btn"
                              data-section-id="${section.id}"
                              data-style-key="font_weight"
                              data-style-value="bold"
                              title="Bold"
                            >
                              <i class="fa-solid fa-bold"></i>
                            </button>
  
                            <button
                              type="button"
                              class="license-style-btn"
                              data-section-id="${section.id}"
                              data-style-key="font_style"
                              data-style-value="italic"
                              title="Italic"
                            >
                              <i class="fa-solid fa-italic"></i>
                            </button>
  
                            <button
                              type="button"
                              class="license-style-btn"
                              data-section-id="${section.id}"
                              data-style-key="text_decoration"
                              data-style-value="underline"
                              title="Underline"
                            >
                              <i class="fa-solid fa-underline"></i>
                            </button>
  
                            <div class="toolbar-color-wrap">
                              <button type="button" class="rt-color-btn" title="Text Color">
                                <span class="toolbar-a-icon" style="--toolbar-color:${escapeHtml(style.licenses_body_color || "#000000")}">A</span>
                              </button>
                              <input
                                type="color"
                                class="license-body-color-picker"
                                data-section-id="${section.id}"
                                value="${escapeHtml(style.licenses_body_color || "#000000")}"
                                title="Text Color"
                              />
                            </div>
  
                            <input
                              type="number"
                              class="license-body-font-size"
                              data-section-id="${section.id}"
                              min="8"
                              max="300"
                              step="1"
                              value="${parseInt(style.licenses_body_font_size || "16px", 10) || 16}"
                              title="Text Size"
                            />
  
                            <button
                              type="button"
                              class="license-style-btn license-style-clear-btn"
                              data-section-id="${section.id}"
                              title="Clear Formatting"
                            >
                              <i class="fa-solid fa-eraser"></i>
                            </button>
                          </div>
                        </div>
                      </div>
                    `
                    : `
                      <div class="editor-subcard collapsed">
                        <button type="button" class="builder-collapsible-head">
                          <span class="builder-section-title">Body</span>
                          <span class="builder-section-caret">▾</span>
                        </button>
                        <div class="builder-collapsible-body">
                          <div class="highlight-color-row">
                            <input
                              type="color"
                              class="custom-highlight-picker"
                              data-section-id="${section.id}"
                              data-target-key="body"
                              value="#fff3a3"
                              title="Custom highlight"
                            />
                          </div>
  
                          <div class="rt-toolbar" data-toolbar-for="${section.id}-body">
                            <button type="button" class="rt-btn" data-cmd="bold" data-section-id="${section.id}" data-target-key="body" title="Bold"><i class="fa-solid fa-bold"></i></button>
                            <button type="button" class="rt-btn" data-cmd="italic" data-section-id="${section.id}" data-target-key="body" title="Italic"><i class="fa-solid fa-italic"></i></button>
                            <button type="button" class="rt-btn" data-cmd="underline" data-section-id="${section.id}" data-target-key="body" title="Underline"><i class="fa-solid fa-underline"></i></button>
                            <button type="button" class="rt-btn" data-cmd="insertUnorderedList" data-section-id="${section.id}" data-target-key="body" title="Bullet List"><i class="fa-solid fa-list-ul"></i></button>
                            <button type="button" class="rt-btn" data-cmd="formatBlock-h2" data-section-id="${section.id}" data-target-key="body" title="Heading 2">H2</button>
                            <button type="button" class="rt-btn" data-cmd="formatBlock-h3" data-section-id="${section.id}" data-target-key="body" title="Heading 3">H3</button>
                            <button type="button" class="rt-btn" data-cmd="justifyLeft" data-section-id="${section.id}" data-target-key="body" title="Align Left"><i class="fa-solid fa-align-left"></i></button>
                            <button type="button" class="rt-btn" data-cmd="justifyCenter" data-section-id="${section.id}" data-target-key="body" title="Align Center"><i class="fa-solid fa-align-center"></i></button>
                            <button type="button" class="rt-btn" data-cmd="justifyRight" data-section-id="${section.id}" data-target-key="body" title="Align Right"><i class="fa-solid fa-align-right"></i></button>
                            <div class="toolbar-color-wrap">
                              <button type="button" class="rt-color-btn" title="Text Color">
                                <span class="toolbar-a-icon" style="--toolbar-color:${escapeHtml(style.color_custom || "#000000")}">A</span>
                              </button>
                              <input
                                type="color"
                                class="text-color-picker"
                                data-section-id="${section.id}"
                                data-target-key="body"
                                value="${escapeHtml(style.color_custom || "#000000")}"
                                title="Text Color"
                              />
                            </div>
  
                            <input
                              type="number"
                              class="toolbar-font-size"
                              data-section-id="${section.id}"
                              data-target-key="body"
                              min="8"
                              max="300"
                              step="1"
                              value="16"
                              title="Text Size"
                            />
                            <button type="button" class="rt-btn" data-cmd="removeFormat" data-section-id="${section.id}" data-target-key="body" title="Clear Formatting"><i class="fa-solid fa-eraser"></i></button>
                          </div>
  
                          <div
                            class="rich-editor"
                            contenteditable="true"
                            data-field-type="section-content-html"
                            data-section-id="${section.id}"
                            data-key="body"
                          >${content.body || ""}</div>
                        </div>
                      </div>
                    `
                )
              : ""
          }
  
          ${
            (!homeRules || homeRules.showImageUpload || homeRules.showImageUrl)
              ? `
                <div class="editor-subcard collapsed">
                  <button type="button" class="builder-collapsible-head">
                    <span class="builder-section-title">Image</span>
                    <span class="builder-section-caret">▾</span>
                  </button>
                  <div class="builder-collapsible-body">
                    ${
                      !homeRules || homeRules.showImageUrl
                        ? `
                          <label>Image URL</label>
                          <input
                            type="text"
                            data-field-type="section-content"
                            data-section-id="${section.id}"
                            data-key="image_url"
                            value="${escapeHtml(content.image_url || "")}"
                          />
                        `
                        : ""
                    }
  
                    ${
                      !homeRules || homeRules.showImageUpload
                        ? `
                          <label>Upload Image</label>
                          <input
                            type="file"
                            accept="image/*"
                            class="section-image-upload"
                            data-section-id="${section.id}"
                          />
  
                          <img
                            class="image-preview ${(content.image_url || "").trim() ? "" : "hidden"}"
                            data-image-preview="${section.id}"
                            src="${escapeHtml(content.image_url || "")}"
                            alt=""
                          />
  
                          <button
                            type="button"
                            class="remove-image-btn"
                            data-section-id="${section.id}"
                          >
                            Remove Image
                          </button>
  
                          <label>Image Border Color</label>
                          <input
                            type="color"
                            data-field-type="section-style"
                            data-section-id="${section.id}"
                            data-key="image_border_color"
                            value="${escapeHtml(style.image_border_color || "#272727")}"
                          />
  
                          <label>Image Border Style</label>
                          <select data-field-type="section-style" data-section-id="${section.id}" data-key="image_border_style">
                            <option value="" ${!style.image_border_style ? "selected" : ""}>None</option>
                            <option value="solid" ${style.image_border_style === "solid" ? "selected" : ""}>Solid</option>
                            <option value="dashed" ${style.image_border_style === "dashed" ? "selected" : ""}>Dashed</option>
                            <option value="dotted" ${style.image_border_style === "dotted" ? "selected" : ""}>Dotted</option>
                            <option value="double" ${style.image_border_style === "double" ? "selected" : ""}>Double</option>
                          </select>
  
                          <label>Image Border Width</label>
                          <input
                            type="range"
                            min="0"
                            max="20"
                            step="1"
                            data-field-type="section-style"
                            data-section-id="${section.id}"
                            data-key="image_border_width"
                            value="${px(style.image_border_width, 0)}"
                          />
                          <span class="range-output">${px(style.image_border_width, 0)}px</span>
  
                          <label>Image Border Radius</label>
                          <input
                            type="range"
                            min="0"
                            max="20"
                            step="1"
                            data-field-type="section-style"
                            data-section-id="${section.id}"
                            data-key="image_border_radius"
                            value="${px(style.image_border_radius, 0)}"
                          />
                          <span class="range-output">${px(style.image_border_radius, 0)}px</span>
                        `
                        : ""
                    }
                  </div>
                </div>
              `
              : ""
          }
  
          <div class="editor-subcard collapsed">
            <button type="button" class="builder-collapsible-head">
              <span class="builder-section-title">Section Controls</span>
              <span class="builder-section-caret">▾</span>
            </button>
            <div class="builder-collapsible-body">
              ${
                !homeRules || homeRules.showHeadingSize
                  ? `
                    <label>Heading Size</label>
                    <select data-field-type="section-style" data-section-id="${section.id}" data-key="heading_size">
                      <option value="sm" ${style.heading_size === "sm" ? "selected" : ""}>Small</option>
                      <option value="md" ${!style.heading_size || style.heading_size === "md" ? "selected" : ""}>Medium</option>
                      <option value="lg" ${style.heading_size === "lg" ? "selected" : ""}>Large</option>
                    </select>
                  `
                  : ""
              }
  
              <label>Section Background</label>
              <select
                class="background-mode-select"
                data-section-id="${section.id}"
                data-field-type="section-style"
                data-key="background_color_mode"
              >
                <option value="" ${!style.background_color_mode ? "selected" : ""}>None</option>
                <option value="preset" ${style.background_color_mode === "preset" ? "selected" : ""}>Preset</option>
                <option value="custom" ${style.background_color_mode === "custom" ? "selected" : ""}>Custom</option>
              </select>
  
              <div
                class="background-preset-wrap"
                data-section-id="${section.id}"
                style="${style.background_color_mode === "preset" ? "" : "display:none;"}"
              >
                <select data-field-type="section-style" data-section-id="${section.id}" data-key="background_color">
                  <option value="#ffffff" ${style.background_color === "#ffffff" ? "selected" : ""}>White</option>
                  <option value="#ed9ea5" ${style.background_color === "#ed9ea5" ? "selected" : ""}>Pink</option>
                  <option value="#7fabbf" ${style.background_color === "#7fabbf" ? "selected" : ""}>Blue</option>
                  <option value="#545454" ${style.background_color === "#545454" ? "selected" : ""}>Gray</option>
                  <option value="#272727" ${style.background_color === "#272727" ? "selected" : ""}>Dark</option>
                </select>
              </div>
  
              <div
                class="background-custom-wrap"
                data-section-id="${section.id}"
                style="${style.background_color_mode === "custom" ? "" : "display:none;"}"
              >
                <input
                  type="color"
                  data-field-type="section-style"
                  data-section-id="${section.id}"
                  data-key="background_color_custom"
                  value="${escapeHtml(style.background_color_custom || "#ffffff")}"
                />
              </div>
  
              <label>Section Border Color</label>
              <input
                type="color"
                data-field-type="section-style"
                data-section-id="${section.id}"
                data-key="border_color"
                value="${escapeHtml(style.border_color || "#272727")}"
              />
  
              <label>Section Border Style</label>
              <select data-field-type="section-style" data-section-id="${section.id}" data-key="border_style">
                <option value="" ${!style.border_style ? "selected" : ""}>None</option>
                <option value="solid" ${style.border_style === "solid" ? "selected" : ""}>Solid</option>
                <option value="dashed" ${style.border_style === "dashed" ? "selected" : ""}>Dashed</option>
                <option value="dotted" ${style.border_style === "dotted" ? "selected" : ""}>Dotted</option>
                <option value="double" ${style.border_style === "double" ? "selected" : ""}>Double</option>
              </select>
  
              <label>Section Border Width</label>
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                data-field-type="section-style"
                data-section-id="${section.id}"
                data-key="border_width"
                value="${px(style.border_width, 0)}"
              />
              <span class="range-output">${px(style.border_width, 0)}px</span>
  
              <label>Section Border Radius</label>
              <input
                type="range"
                min="0"
                max="20"
                step="1"
                data-field-type="section-style"
                data-section-id="${section.id}"
                data-key="border_radius"
                value="${px(style.border_radius, 0)}"
              />
              <span class="range-output">${px(style.border_radius, 0)}px</span>
  
              <label>Shadow Color</label>
              <input
                type="color"
                data-field-type="section-style"
                data-section-id="${section.id}"
                data-key="shadow_color"
                value="${escapeHtml(style.shadow_color || "#000000")}"
              />
  
              <label>Shadow Blur</label>
              <input
                type="range"
                min="0"
                max="60"
                step="1"
                data-field-type="section-style"
                data-section-id="${section.id}"
                data-key="shadow_blur"
                value="${px(style.shadow_blur, 0)}"
              />
              <span class="range-output">${px(style.shadow_blur, 0)}px</span>
  
              <label>Shadow X Offset</label>
              <input
                type="range"
                min="-40"
                max="40"
                step="1"
                data-field-type="section-style"
                data-section-id="${section.id}"
                data-key="shadow_x"
                value="${px(style.shadow_x, 0)}"
              />
              <span class="range-output">${px(style.shadow_x, 0)}px</span>
  
              <label>Shadow Y Offset</label>
              <input
                type="range"
                min="-40"
                max="40"
                step="1"
                data-field-type="section-style"
                data-section-id="${section.id}"
                data-key="shadow_y"
                value="${px(style.shadow_y, 0)}"
              />
              <span class="range-output">${px(style.shadow_y, 0)}px</span>
            </div>
          </div>
  
          ${
            pageKey === "home" && ["contact", "quote"].includes(section.section_key)
              ? `<p class="builder-note">This section currently uses site defaults. You can toggle it on or off, but it does not have editable content yet.</p>`
              : ""
          }
        </div>
      `;
  
      editorFields.appendChild(wrap);
    });
  
    if (pageKey === "careers" || pageKey === "faqs") {
      renderFaqEditor(pageKey);
    }
  
    renderSocialEditor();
    bindSectionFieldAutosave();
    bindRichTextToolbar();
    bindCustomHighlightPickers();
    bindRichPasteHandling();
    bindRichEditorParagraphHandling();
    bindEditorSelectionTracking();
    bindToolbarStateTracking();
    bindImagePreviewUpdates();
    bindSectionImageUploads();
    bindRemoveImageButtons();
    bindSectionCardCollapse();
    bindCollapsibleCards();
    bindBackgroundModeToggles();
    bindSectionRangeOutputs();
    bindTextColorPickers();
    bindToolbarFontSizes();
    bindLicenseBodyStyleControls();
  
    editorFields.querySelectorAll(".builder-section-card").forEach(card => {
      setCollapsibleState(card, card.classList.contains("collapsed"));
    });
  
    editorFields.querySelectorAll(".editor-subcard, .editor-field-group").forEach(card => {
      if (card.querySelector(":scope > .builder-collapsible-head")) {
        setCollapsibleState(card, card.classList.contains("collapsed"));
      }
    });
  }
  
  function renderFaqEditor(pageKey) {
    const faqWrap = document.createElement("div");
    faqWrap.className = "editor-field-group";    
    faqWrap.innerHTML = `
      <h3>${prettyLabel(pageKey)} FAQs</h3>
      <div id="faq-editor-list" class="drag-list"></div>
      <button type="button" id="add-faq-btn">Add FAQ</button>
    `;

    editorFields.appendChild(faqWrap);

    const faqList = faqWrap.querySelector("#faq-editor-list");
    const pageFaqs = getCurrentPageFaqs(pageKey);

    pageFaqs.forEach(faq => {
      const row = document.createElement("div");
      row.className = "editor-field-group drag-item collapsed";
      row.dataset.faqId = faq.id;
      row.draggable = true;

      row.innerHTML = `
        <button type="button" class="drag-handle" title="Drag to reorder">☰ Drag FAQ</button>

        <label>Question</label>
        <input type="text" data-faq-type="question" data-faq-id="${faq.id}" value="${escapeHtml(faq.draft_question || "")}" />

        <label>Answer</label>
        <div class="highlight-color-row">
          <button type="button" class="highlight-color-btn faq-highlight-color-btn" data-color="#fff3a3" data-faq-id="${faq.id}" style="background:#fff3a3;" title="Yellow"></button>
          <button type="button" class="highlight-color-btn faq-highlight-color-btn" data-color="#ffd6e7" data-faq-id="${faq.id}" style="background:#ffd6e7;" title="Pink"></button>
          <button type="button" class="highlight-color-btn faq-highlight-color-btn" data-color="#d8ecff" data-faq-id="${faq.id}" style="background:#d8ecff;" title="Blue"></button>
          <button type="button" class="highlight-color-btn faq-highlight-color-btn" data-color="#dff5df" data-faq-id="${faq.id}" style="background:#dff5df;" title="Green"></button>
          <button type="button" class="highlight-color-btn faq-highlight-color-btn" data-color="#eadcff" data-faq-id="${faq.id}" style="background:#eadcff;" title="Purple"></button>
        </div>

        <div class="rt-toolbar" data-toolbar-for="faq-${faq.id}">
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="bold" data-faq-id="${faq.id}" title="Bold"><i class="fa-solid fa-bold"></i></button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="italic" data-faq-id="${faq.id}" title="Italic"><i class="fa-solid fa-italic"></i></button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="underline" data-faq-id="${faq.id}" title="Underline"><i class="fa-solid fa-underline"></i></button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="insertUnorderedList" data-faq-id="${faq.id}" title="Bullet List"><i class="fa-solid fa-list-ul"></i></button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="formatBlock-h3" data-faq-id="${faq.id}" title="Heading 3">H3</button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="justifyLeft" data-faq-id="${faq.id}" title="Align Left"><i class="fa-solid fa-align-left"></i></button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="justifyCenter" data-faq-id="${faq.id}" title="Align Center"><i class="fa-solid fa-align-center"></i></button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="justifyRight" data-faq-id="${faq.id}" title="Align Right"><i class="fa-solid fa-align-right"></i></button>
          <button type="button" class="rt-btn faq-rt-btn" data-cmd="removeFormat" data-faq-id="${faq.id}" title="Clear Formatting"><i class="fa-solid fa-eraser"></i></button>
        </div>

        <div
          class="rich-editor faq-rich-editor"
          contenteditable="true"
          data-faq-type="answer-html"
          data-faq-id="${faq.id}"
        >${faq.draft_answer || ""}</div>

        <label>
          <input type="checkbox" class="faq-enabled-toggle" data-faq-id="${faq.id}" ${faq.is_enabled ? "checked" : ""} />
          Enabled
        </label>

        <button type="button" class="delete-faq-btn" data-faq-id="${faq.id}">
          Delete FAQ
        </button>
      `;
      faqList.appendChild(row);
    });

    faqWrap.querySelector("#add-faq-btn").addEventListener("click", async () => {
      await addFaq(pageKey);
    });

    bindFaqFieldAutosave();
    bindFaqDeleteButtons();
    bindRichTextToolbar();
    bindRichPasteHandling();
    bindRichEditorParagraphHandling();
    bindDragList(
      faqList,
      ".drag-item[data-faq-id]",
      "faqId",
      saveFaqOrderFromList
    );
  }

  function renderSocialEditor() {
    let socialWrap = document.getElementById("social-editor-wrap");
    if (socialWrap) socialWrap.remove();

    socialWrap = document.createElement("div");
    socialWrap.className = "editor-field-group collapsed";
    socialWrap.id = "social-editor-wrap";
    socialWrap.innerHTML = `
      <div class="builder-collapsible-head">
        <div class="builder-section-head-left">
          <span class="builder-section-title">Social Links</span>
        </div>
        <span class="builder-section-caret">▾</span>
      </div>
      <div class="builder-collapsible-body">
        <div id="social-editor-list" class="drag-list"></div>
        <button type="button" id="add-social-btn">Add Social Link</button>
      </div>
    `;

    editorFields.appendChild(socialWrap);

    const list = socialWrap.querySelector("#social-editor-list");

    socials.forEach(social => {
      const row = document.createElement("div");
      row.className = "editor-field-group drag-item collapsed";
      row.dataset.socialId = social.id;
      row.draggable = true;

      row.innerHTML = `
        <div class="builder-collapsible-head">
          <div class="builder-section-head-left">
            <button type="button" class="drag-handle" title="Drag to reorder">
              <i class="fa-solid fa-grip-lines"></i>
            </button>
            <div class="social-preview-row">
              <span class="social-preview-icon ${getSocialIconClass(social.platform)} ${getSocialColorClass(social.platform)}"></span>
              <strong>${prettyLabel(social.platform)}</strong>
            </div>
          </div>
          <span class="builder-section-caret">▾</span>
        </div>

        <div class="builder-collapsible-body">
          <label>Platform</label>
          <select class="social-platform" data-social-id="${social.id}">
            ${SOCIAL_PLATFORMS.map(platform => `
              <option value="${platform}" ${social.platform === platform ? "selected" : ""}>
                ${prettyLabel(platform)}
              </option>
            `).join("")}
          </select>

          <label>URL</label>
          <input type="text" class="social-url" data-social-id="${social.id}" value="${escapeHtml(social.draft_url || "")}" />

          <label>
            <input type="checkbox" class="social-enabled" data-social-id="${social.id}" ${social.is_enabled ? "checked" : ""} />
            Enabled
          </label>

          <button type="button" class="delete-social-btn" data-social-id="${social.id}">
            Delete Social Link
          </button>
        </div>
      `;
      list.appendChild(row);
    });

    socialWrap.querySelector("#add-social-btn").addEventListener("click", async () => {
      await addSocialLink();
    });

    bindSocialAutosave();
    bindSocialDeleteButtons();
    bindDragList(
      list,
      ".drag-item[data-social-id]",
      "socialId",
      saveSocialOrderFromList
    );
    bindCollapsibleCards();
  }

  function bindSectionFieldAutosave() {
    editorFields.querySelectorAll('[data-field-type="section-content"], [data-field-type="section-style"]').forEach(el => {
      el.addEventListener("change", async () => {
        const sectionId = el.dataset.sectionId;
        await saveSectionDraft(sectionId);
      });
    });

    editorFields.querySelectorAll('[data-field-type="section-content-html"]').forEach(el => {
      el.addEventListener("blur", async () => {
        setTimeout(async () => {
          const active = document.activeElement;
          if (active && (
            active.classList.contains("rt-btn") ||
            active.classList.contains("highlight-color-btn") ||
            active.classList.contains("faq-rt-btn") ||
            active.classList.contains("faq-highlight-color-btn") ||
            active.classList.contains("custom-highlight-picker") ||
            active.classList.contains("text-color-picker") ||
            active.classList.contains("toolbar-font-size") ||
            active.classList.contains("rt-color-btn")
          )) {
            return;
          }
    
          const sectionId = el.dataset.sectionId;
          await saveSectionDraft(sectionId);
        }, 10);
      });
    });
  }

  function bindImagePreviewUpdates() {
    editorFields.querySelectorAll('[data-key="image_url"][data-section-id]').forEach(input => {
      input.addEventListener("input", () => {
        const sectionId = input.dataset.sectionId;
        const preview = editorFields.querySelector(`[data-image-preview="${sectionId}"]`);
        if (!preview) return;

        const value = String(input.value || "").trim();
        if (value) {
          preview.src = value;
          preview.classList.remove("hidden");
        } else {
          preview.src = "";
          preview.classList.add("hidden");
        }
      });
    });
  }
  
  function bindFaqFieldAutosave() {
    editorFields.querySelectorAll('[data-faq-type="question"], .faq-enabled-toggle').forEach(el => {
      el.addEventListener("change", async () => {
        const faqId = el.dataset.faqId;
        await saveFaqDraft(faqId);
      });
    });

    editorFields.querySelectorAll('[data-faq-type="answer-html"]').forEach(el => {
      el.addEventListener("blur", async () => {
        setTimeout(async () => {
          const active = document.activeElement;
          if (active && (
            active.classList.contains("rt-btn") ||
            active.classList.contains("highlight-color-btn") ||
            active.classList.contains("faq-rt-btn") ||
            active.classList.contains("faq-highlight-color-btn")
          )) {
            return;
          }
    
          const faqId = el.dataset.faqId;
          await saveFaqDraft(faqId);
        }, 10);
      });
    });
  }

  function bindFaqDeleteButtons() {
    editorFields.querySelectorAll(".delete-faq-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const faqId = btn.dataset.faqId;
        await deleteFaq(faqId);
      });
    });
  }
  
  function bindSocialAutosave() {
    editorFields.querySelectorAll(".social-platform, .social-url, .social-enabled").forEach(el => {
      el.addEventListener("change", async () => {
        const socialId = el.dataset.socialId;
        await saveSocialDraft(socialId);
      });
    });
  }

  function bindSocialDeleteButtons() {
    editorFields.querySelectorAll(".delete-social-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const socialId = btn.dataset.socialId;
        await deleteSocialLink(socialId);
      });
    });
  }

  async function saveSettings() {
    setSaveStatus("saving", "Saving...");
  
    const payload = {
      theme_mode: themeModeEl.value,
      photo_shape: photoShapeEl.value,
      font_preset: fontSelect.value,
  
      button_radius: `${document.getElementById("builder-button-radius")?.value || 14}px`,
      button_bg_color: document.getElementById("builder-button-bg")?.value || "#545454",
      button_text_color: document.getElementById("builder-button-text")?.value || "#ffffff",
      button_border_color: document.getElementById("builder-button-border-color")?.value || "#272727",
      button_border_width: `${document.getElementById("builder-button-border-width")?.value || 1}px`,
      button_border_style: document.getElementById("builder-button-border-style")?.value || "solid",
  
      home_enabled: !!toggleHomePage.checked,
      about_enabled: !!toggleAboutPage.checked,
      careers_enabled: !!toggleCareersPage.checked,
      faqs_enabled: !!toggleFaqsPage.checked,
      draft_updated_at: new Date().toISOString(),
      page_bg_mode: document.getElementById("builder-page-bg-mode")?.value || "default",
      page_bg_custom: document.getElementById("builder-page-bg-custom")?.value || "#ffffff",
    };
  
    const { error } = await supabase
      .from("agent_page_settings")
      .update(payload)
      .eq("agent_id", targetAgentId);
  
    if (error) {
      console.error("[builder] save settings failed", error);
      setSaveStatus("error", "Save failed");
      showToast("Failed to save settings.", "error");
      return false;
    }
  
    Object.assign(settings, payload);
    setSaveStatus("saved", "Saved just now");
    return true;
  }

  async function saveSectionToggle(sectionId, isEnabled) {
    const { error } = await supabase
      .from("agent_page_sections")
      .update({
        is_enabled: isEnabled,
        updated_at: new Date().toISOString()
      })
      .eq("id", sectionId);
  
    if (error) {
      console.error("[builder] save section toggle failed", error);
      alert("Failed to save section toggle.");
      return;
    }
  
    const row = sections.find(s => s.id === sectionId);
    if (row) row.is_enabled = isEnabled;
  
    renderSectionToggles(pageSelect.value);
    await saveSettings();
    refreshPreview();
  }

  async function saveSectionDraft(sectionId) {
    const row = sections.find(s => s.id === sectionId);
    if (!row) return;
  
    setSaveStatus("saving", "Saving...");
  
    const contentInputs = editorFields.querySelectorAll(
      `[data-field-type="section-content"][data-section-id="${sectionId}"]`
    );
    const styleInputs = editorFields.querySelectorAll(
      `[data-field-type="section-style"][data-section-id="${sectionId}"]`
    );
  
    const draftContent = { ...(row.draft_content || {}) };
    const draftStyle = { ...(row.draft_style || {}) };
  
    contentInputs.forEach(input => {
      draftContent[input.dataset.key] = input.value;
    });
  
    editorFields
      .querySelectorAll(`.rich-editor[data-section-id="${sectionId}"][data-key]`)
      .forEach(editor => {
        draftContent[editor.dataset.key] = sanitizeRichHtml(editor.innerHTML);
      });
  
    styleInputs.forEach(input => {
      const key = input.dataset.key;
      let value = input.value;
  
      if (
        key === "image_border_width" ||
        key === "image_border_radius" ||
        key === "border_width" ||
        key === "border_radius" ||
        key === "shadow_blur" ||
        key === "shadow_x" ||
        key === "shadow_y"
      ) {
        value = `${input.value}px`;
      }
  
      draftStyle[key] = value;
    });
  
    const { error } = await supabase
      .from("agent_page_sections")
      .update({
        draft_content: draftContent,
        draft_style: draftStyle,
        updated_at: new Date().toISOString()
      })
      .eq("id", sectionId);
  
    if (error) {
      console.error("[builder] save section draft failed", error);
      setSaveStatus("error", "Save failed");
      showToast("Failed to save section.", "error");
      return;
    }
  
    row.draft_content = draftContent;
    row.draft_style = draftStyle;
  
    await saveSettings();
    setSaveStatus("saved", "Saved just now");
    refreshPreview();
  }

  async function addFaq(pageKey) {
    const pageFaqs = getCurrentPageFaqs(pageKey);
    const nextSort = pageFaqs.length ? Math.max(...pageFaqs.map(f => f.sort_order || 0)) + 1 : 1;

    const { data, error } = await supabase
      .from("agent_page_faqs")
      .insert({
        agent_id: targetAgentId,
        page_key: pageKey,
        is_enabled: true,
        sort_order: nextSort,
        draft_question: "",
        draft_answer: "",
        published_question: "",
        published_answer: ""
      })
      .select("*")
      .single();

    if (error) {
      console.error("[builder] add faq failed", error);
      alert("Failed to add FAQ.");
      return;
    }

    faqs.push(data);
    showToast("FAQ added.", "success");
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function saveFaqDraft(faqId) {
    const faq = faqs.find(f => f.id === faqId);
    if (!faq) return;
  
    setSaveStatus("saving", "Saving...");
  
    const questionEl = editorFields.querySelector(
      `[data-faq-type="question"][data-faq-id="${faqId}"]`
    );
    const answerEl = editorFields.querySelector(
      `.faq-rich-editor[data-faq-id="${faqId}"]`
    );
    const enabledEl = editorFields.querySelector(
      `.faq-enabled-toggle[data-faq-id="${faqId}"]`
    );
  
    const payload = {
      draft_question: questionEl ? questionEl.value : "",
      draft_answer: answerEl ? sanitizeRichHtml(answerEl.innerHTML) : "",
      is_enabled: enabledEl ? !!enabledEl.checked : true,
      updated_at: new Date().toISOString()
    };
  
    const { error } = await supabase
      .from("agent_page_faqs")
      .update(payload)
      .eq("id", faqId);
  
    if (error) {
      console.error("[builder] save faq failed", error);
      setSaveStatus("error", "Save failed");
      showToast("Failed to save FAQ.", "error");
      return;
    }
  
    Object.assign(faq, payload);
    await saveSettings();
    setSaveStatus("saved", "Saved just now");
    refreshPreview();
  }

  async function deleteFaq(faqId) {
    const ok = window.confirm("Delete this FAQ?");
    if (!ok) return;

    const { error } = await supabase
      .from("agent_page_faqs")
      .delete()
      .eq("id", faqId);

    if (error) {
      console.error("[builder] delete faq failed", error);
      alert("Failed to delete FAQ.");
      return;
    }

    faqs = faqs.filter(f => f.id !== faqId);
    showToast("FAQ deleted.", "info");
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function addSocialLink() {
    const nextSort = socials.length ? Math.max(...socials.map(s => s.sort_order || 0)) + 1 : 1;

    const { data, error } = await supabase
      .from("agent_social_links")
      .insert({
        agent_id: targetAgentId,
        platform: "website",
        is_enabled: true,
        sort_order: nextSort,
        draft_url: "",
        published_url: ""
      })
      .select("*")
      .single();

    if (error) {
      console.error("[builder] add social failed", error);
      alert("Failed to add social link.");
      return;
    }

    socials.push(data);
    showToast("Social link added.", "success");
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function saveSocialDraft(socialId) {
    const social = socials.find(s => s.id === socialId);
    if (!social) return;
  
    setSaveStatus("saving", "Saving...");
  
    const platformEl = editorFields.querySelector(
      `.social-platform[data-social-id="${socialId}"]`
    );
    const urlEl = editorFields.querySelector(
      `.social-url[data-social-id="${socialId}"]`
    );
    const enabledEl = editorFields.querySelector(
      `.social-enabled[data-social-id="${socialId}"]`
    );
  
    const payload = {
      platform: platformEl ? platformEl.value : "website",
      draft_url: urlEl ? urlEl.value : "",
      is_enabled: enabledEl ? !!enabledEl.checked : true,
      updated_at: new Date().toISOString()
    };
  
    const { error } = await supabase
      .from("agent_social_links")
      .update(payload)
      .eq("id", socialId);
  
    if (error) {
      console.error("[builder] save social failed", error);
      setSaveStatus("error", "Save failed");
      showToast("Failed to save social link.", "error");
      return;
    }
  
    Object.assign(social, payload);
    await saveSettings();
    setSaveStatus("saved", "Saved just now");
    refreshPreview();
  }

  async function deleteSocialLink(socialId) {
    const ok = window.confirm("Delete this social link?");
    if (!ok) return;

    const { error } = await supabase
      .from("agent_social_links")
      .delete()
      .eq("id", socialId);

    if (error) {
      console.error("[builder] delete social failed", error);
      alert("Failed to delete social link.");
      return;
    }

    socials = socials.filter(s => s.id !== socialId);
    showToast("Social link deleted.", "info");
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function submitForApproval() {
    const res = await fetch("/.netlify/functions/publishAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "submit",
        agent_id: targetAgentId
      })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[builder] submit for review failed", json);
      alert(json.error || "Failed to submit for approval.");
      return;
    }

    settings.status = "pending_review";
    setStatusBadge("pending_review");
    showToast("Draft submitted for approval.", "success");
  }

  async function publishNow() {
    if (!isAdmin) {
      alert("Only admins can publish.");
      return;
    }

    const reviewerId = currentAgentRow?.id || null;

    const res = await fetch("/.netlify/functions/publishAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "publish",
        agent_id: targetAgentId,
        reviewer_id: reviewerId
      })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[builder] publish failed", json);
      alert(json.error || "Failed to publish.");
      return;
    }

    settings.status = "published";
    setStatusBadge("published");
    showToast("Page published successfully.", "success");
    refreshPreview();
  }

  async function rejectDraft() {
    if (!isAdmin) {
      alert("Only admins can reject.");
      return;
    }

    const reason = window.prompt("Reason for rejection?") || "";

    const res = await fetch("/.netlify/functions/publishAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "reject",
        agent_id: targetAgentId,
        rejection_reason: reason
      })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[builder] reject failed", json);
      alert(json.error || "Failed to reject.");
      return;
    }

    settings.status = "draft";
    setStatusBadge("draft");
    showToast("Draft rejected.", "info");
  }

  async function resetCurrentPage() {
    if (!isAdmin) {
      alert("Only admins can reset pages.");
      return;
    }

    const pageKey = pageSelect.value;
    const ok = window.confirm(`Reset the entire ${prettyLabel(pageKey)} page to defaults?`);
    if (!ok) return;

    const res = await fetch("/.netlify/functions/resetAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: targetAgentId,
        page_key: pageKey,
        mode: "page"
      })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[builder] reset page failed", json);
      alert(json.error || "Failed to reset page.");
      return;
    }

    await loadAll();
    showToast(`${prettyLabel(pageKey)} reset to defaults.`, "success");
  }

  async function resetCurrentSection() {
    if (!isAdmin) {
      alert("Only admins can reset sections.");
      return;
    }

    const pageKey = pageSelect.value;
    const firstSection = getCurrentPageSections(pageKey)[0];
    if (!firstSection) {
      alert("No section found.");
      return;
    }

    const sectionKey = window.prompt(
      `Type the section key to reset.\nAvailable: ${getCurrentPageSections(pageKey).map(s => s.section_key).join(", ")}`
    );

    if (!sectionKey) return;

    const sectionExists = getCurrentPageSections(pageKey).some(s => s.section_key === sectionKey);
    if (!sectionExists) {
      alert("That section key does not exist on this page.");
      return;
    }

    const ok = window.confirm(`Reset section "${sectionKey}" on ${prettyLabel(pageKey)}?`);
    if (!ok) return;

    const res = await fetch("/.netlify/functions/resetAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: targetAgentId,
        page_key: pageKey,
        section_key: sectionKey,
        mode: "section"
      })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[builder] reset section failed", json);
      alert(json.error || "Failed to reset section.");
      return;
    }

    await loadAll();
    showToast(`Section "${sectionKey}" reset to defaults.`, "success");
  }
  
  function setPreviewMode(mode) {
    const desktopBtn = document.getElementById("preview-desktop-btn");
    const mobileBtn = document.getElementById("preview-mobile-btn");

    if (mode === "mobile") {
      previewFrame.classList.add("preview-mobile");
      if (desktopBtn) desktopBtn.classList.remove("active");
      if (mobileBtn) mobileBtn.classList.add("active");
    } else {
      previewFrame.classList.remove("preview-mobile");
      if (desktopBtn) desktopBtn.classList.add("active");
      if (mobileBtn) mobileBtn.classList.remove("active");
    }
  }
  
  function refreshPreview() {
    const page = pageSelect.value;
    const cacheBust = `t=${Date.now()}`;
    const url =
      page === "home"
        ? `/a/${encodeURIComponent(slug)}?preview=draft&agent_id=${encodeURIComponent(targetAgentId)}&${cacheBust}`
        : `/a/${page}?slug=${encodeURIComponent(slug)}&preview=draft&agent_id=${encodeURIComponent(targetAgentId)}&${cacheBust}`;

    previewFrame.src = url;
  }

  pageSelect.addEventListener("change", () => {
    renderPageEditor(pageSelect.value);
    refreshPreview();
  });

  [
    themeModeEl,
    photoShapeEl,
    fontSelect,
    buttonStyleEl,
    document.getElementById("builder-button-radius"),
    document.getElementById("builder-button-bg"),
    document.getElementById("builder-button-text"),
    document.getElementById("builder-button-border-color"),
    document.getElementById("builder-button-border-width"),
    document.getElementById("builder-button-border-style"),
    toggleHomePage,
    toggleAboutPage,
    toggleCareersPage,
    toggleFaqsPage
  ].filter(Boolean).forEach(el => {
    el.addEventListener("change", async () => {
      await saveSettings();
      styleBuilderButtonsPreview();
      refreshPreview();
    });
  });

  const previewDesktopBtn = document.getElementById("preview-desktop-btn");
  const previewMobileBtn = document.getElementById("preview-mobile-btn");

  if (previewDesktopBtn) {
    previewDesktopBtn.addEventListener("click", () => setPreviewMode("desktop"));
  }

  if (previewMobileBtn) {
    previewMobileBtn.addEventListener("click", () => setPreviewMode("mobile"));
  }

  if (saveDraftBtn) {
    saveDraftBtn.addEventListener("click", async () => {
      const ok = await saveSettings();
      if (ok) {
        showToast("Draft saved.", "success");
        refreshPreview();
      }
    });
  }

  if (submitReviewBtn) {
    submitReviewBtn.addEventListener("click", async () => {
      await saveSettings();
      await submitForApproval();
    });
  }

  if (previewDraftBtn) {
    previewDraftBtn.addEventListener("click", () => {
      refreshPreview();
    });
  }

  if (publishNowBtn) {
    publishNowBtn.addEventListener("click", async () => {
      await saveSettings();
      if (!validateBeforePublish()) return;
      await publishNow();
    });
  }
  
  if (rejectDraftBtn) {
    rejectDraftBtn.addEventListener("click", async () => {
      await rejectDraft();
    });
  }

  if (resetPageBtn) {
    resetPageBtn.addEventListener("click", async () => {
      await resetCurrentPage();
    });
  }

  if (resetSectionBtn) {
    resetSectionBtn.addEventListener("click", async () => {
      await resetCurrentSection();
    });
  }

  const ok = await loadCurrentUserPermissions();
  if (!ok) return;
  
  bindPageTogglePills();
  bindPaneToggles();
    leftPane.classList.add("collapsed");
  applyPaneState();
  setPreviewMode("desktop");
  setSaveStatus("idle", "Idle");
  await loadAll();
  bindPxSliders();
  bindPageBackgroundControls();
  bindCollapsibleCards();

  document.querySelectorAll(".editor-subcard, .editor-field-group, .builder-section-card").forEach(card => {
    if (
      card.querySelector(":scope > .builder-collapsible-head") ||
      card.querySelector(":scope > .builder-section-head")
    ) {
      setCollapsibleState(card, card.classList.contains("collapsed"));
    }
  });
});
