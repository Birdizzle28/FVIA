// /scripts/agent-site-builder.js

document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error("Supabase missing");
    return;
  }

  const FONT_PRESETS = [
    "Bellota Text",
    "Inter",
    "Lato",
    "Open Sans",
    "Montserrat",
    "Poppins",
    "Nunito",
    "Raleway",
    "PT Sans",
    "Source Sans 3",
    "Work Sans",
    "Merriweather",
    "Playfair Display",
    "Libre Baskerville",
    "Quicksand",
    "Rubik",
    "Cabin",
    "Oxygen",
    "DM Sans",
    "Figtree"
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

  const SECTION_MAP = {
    home: ["hero", "contact", "licenses", "quote"],
    about: ["hero", "summary", "story", "approach", "who_i_help", "licenses", "cta"],
    careers: ["intro", "notice", "roles", "cta", "faq"],
    faqs: ["intro", "list", "cta"]
  };

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

  const agentId = new URLSearchParams(window.location.search).get("agent_id");
  if (!agentId) {
    editorFields.innerHTML = "<p>Missing agent_id in URL.</p>";
    return;
  }

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

  async function loadAll() {
    const { data: settingsRow, error: settingsErr } = await supabase
      .from("agent_page_settings")
      .select("*")
      .eq("agent_id", agentId)
      .single();

    if (settingsErr) {
      console.error("[builder] settings load failed", settingsErr);
      return;
    }

    settings = settingsRow;

    const { data: sectionRows, error: sectionErr } = await supabase
      .from("agent_page_sections")
      .select("*")
      .eq("agent_id", agentId)
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
      .eq("agent_id", agentId)
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
      .eq("agent_id", agentId)
      .order("sort_order", { ascending: true });

    if (socialErr) {
      console.error("[builder] socials load failed", socialErr);
      return;
    }

    socials = socialRows || [];

    hydrateSettingsUI();
    renderPageEditor(pageSelect.value);
    refreshPreview();
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
  }

  function getPageEnabledField(pageKey) {
    if (pageKey === "home") return "home_enabled";
    if (pageKey === "about") return "about_enabled";
    if (pageKey === "careers") return "careers_enabled";
    if (pageKey === "faqs") return "faqs_enabled";
    return null;
  }

  function getCurrentPageSections(pageKey) {
    return sections.filter(s => s.page_key === pageKey);
  }

  function getCurrentPageFaqs(pageKey) {
    return faqs.filter(f => f.page_key === pageKey);
  }

  function renderSectionToggles(pageKey) {
    sectionToggleList.innerHTML = "";

    const pageSections = getCurrentPageSections(pageKey);
    if (!pageSections.length) {
      sectionToggleList.innerHTML = "<p>No sections found.</p>";
      return;
    }

    pageSections.forEach(section => {
      const label = document.createElement("label");
      label.innerHTML = `
        <input
          type="checkbox"
          class="section-toggle"
          data-section-id="${section.id}"
          ${section.is_enabled ? "checked" : ""}
        />
        ${prettyLabel(section.section_key)}
      `;
      sectionToggleList.appendChild(label);
    });

    sectionToggleList.querySelectorAll(".section-toggle").forEach(input => {
      input.addEventListener("change", async (e) => {
        const sectionId = e.target.dataset.sectionId;
        const isEnabled = !!e.target.checked;
        await saveSectionToggle(sectionId, isEnabled);
      });
    });
  }

  function renderPageEditor(pageKey) {
    renderSectionToggles(pageKey);
    editorFields.innerHTML = "";

    const pageSections = getCurrentPageSections(pageKey);

    pageSections.forEach(section => {
      const content = section.draft_content || {};
      const style = section.draft_style || {};

      const wrap = document.createElement("div");
      wrap.className = "editor-field-group";
      wrap.innerHTML = `
        <h3>${prettyLabel(pageKey)} / ${prettyLabel(section.section_key)}</h3>

        <label>Heading</label>
        <input
          type="text"
          data-field-type="section-content"
          data-section-id="${section.id}"
          data-key="heading"
          value="${escapeHtml(content.heading || "")}"
        />

        <label>Subheading</label>
        <input
          type="text"
          data-field-type="section-content"
          data-section-id="${section.id}"
          data-key="subheading"
          value="${escapeHtml(content.subheading || "")}"
        />

        <label>Body</label>
        <textarea
          rows="5"
          data-field-type="section-content"
          data-section-id="${section.id}"
          data-key="body"
        >${escapeHtml(content.body || "")}</textarea>

        <label>Button Text</label>
        <input
          type="text"
          data-field-type="section-content"
          data-section-id="${section.id}"
          data-key="button_text"
          value="${escapeHtml(content.button_text || "")}"
        />

        <label>Button Link</label>
        <input
          type="text"
          data-field-type="section-content"
          data-section-id="${section.id}"
          data-key="button_link"
          value="${escapeHtml(content.button_link || "")}"
        />

        <label>Image URL</label>
        <input
          type="text"
          data-field-type="section-content"
          data-section-id="${section.id}"
          data-key="image_url"
          value="${escapeHtml(content.image_url || "")}"
        />

        <label>Text Align</label>
        <select
          data-field-type="section-style"
          data-section-id="${section.id}"
          data-key="text_align"
        >
          <option value="left" ${style.text_align === "left" ? "selected" : ""}>Left</option>
          <option value="center" ${style.text_align === "center" ? "selected" : ""}>Center</option>
          <option value="right" ${style.text_align === "right" ? "selected" : ""}>Right</option>
        </select>

        <label>Heading Size</label>
        <select
          data-field-type="section-style"
          data-section-id="${section.id}"
          data-key="heading_size"
        >
          <option value="sm" ${style.heading_size === "sm" ? "selected" : ""}>Small</option>
          <option value="md" ${!style.heading_size || style.heading_size === "md" ? "selected" : ""}>Medium</option>
          <option value="lg" ${style.heading_size === "lg" ? "selected" : ""}>Large</option>
        </select>

        <label>Color Preset</label>
        <select
          data-field-type="section-style"
          data-section-id="${section.id}"
          data-key="color_preset"
        >
          <option value="default" ${!style.color_preset || style.color_preset === "default" ? "selected" : ""}>Default</option>
          <option value="pink" ${style.color_preset === "pink" ? "selected" : ""}>Pink</option>
          <option value="blue" ${style.color_preset === "blue" ? "selected" : ""}>Blue</option>
          <option value="dark" ${style.color_preset === "dark" ? "selected" : ""}>Dark</option>
          <option value="light" ${style.color_preset === "light" ? "selected" : ""}>Light</option>
        </select>
      `;

      editorFields.appendChild(wrap);
    });

    if (pageKey === "careers" || pageKey === "faqs") {
      renderFaqEditor(pageKey);
    }

    renderSocialEditor();

    bindSectionFieldAutosave();
  }

  function renderFaqEditor(pageKey) {
    const faqWrap = document.createElement("div");
    faqWrap.className = "editor-field-group";

    faqWrap.innerHTML = `
      <h3>${prettyLabel(pageKey)} FAQs</h3>
      <div id="faq-editor-list"></div>
      <button type="button" id="add-faq-btn">Add FAQ</button>
    `;

    editorFields.appendChild(faqWrap);

    const faqList = faqWrap.querySelector("#faq-editor-list");
    const pageFaqs = getCurrentPageFaqs(pageKey);

    pageFaqs.forEach(faq => {
      faqList.appendChild(buildFaqEditorRow(faq));
    });

    faqWrap.querySelector("#add-faq-btn").addEventListener("click", async () => {
      await addFaq(pageKey);
    });

    bindFaqFieldAutosave();
    bindFaqDeleteButtons();
  }

  function buildFaqEditorRow(faq) {
    const row = document.createElement("div");
    row.className = "editor-field-group";
    row.dataset.faqId = faq.id;

    row.innerHTML = `
      <label>Question</label>
      <input
        type="text"
        data-faq-type="question"
        data-faq-id="${faq.id}"
        value="${escapeHtml(faq.draft_question || "")}"
      />

      <label>Answer</label>
      <textarea
        rows="4"
        data-faq-type="answer"
        data-faq-id="${faq.id}"
      >${escapeHtml(faq.draft_answer || "")}</textarea>

      <label>
        <input
          type="checkbox"
          class="faq-enabled-toggle"
          data-faq-id="${faq.id}"
          ${faq.is_enabled ? "checked" : ""}
        />
        Enabled
      </label>

      <button type="button" class="delete-faq-btn" data-faq-id="${faq.id}">
        Delete FAQ
      </button>
    `;

    return row;
  }

  function renderSocialEditor() {
    let socialWrap = document.getElementById("social-editor-wrap");
    if (socialWrap) socialWrap.remove();

    socialWrap = document.createElement("div");
    socialWrap.className = "editor-field-group";
    socialWrap.id = "social-editor-wrap";

    socialWrap.innerHTML = `
      <h3>Social Links</h3>
      <div id="social-editor-list"></div>
      <button type="button" id="add-social-btn">Add Social Link</button>
    `;

    editorFields.appendChild(socialWrap);

    const list = socialWrap.querySelector("#social-editor-list");

    socials.forEach(social => {
      const row = document.createElement("div");
      row.className = "editor-field-group";
      row.dataset.socialId = social.id;
      row.innerHTML = `
        <label>Platform</label>
        <select class="social-platform" data-social-id="${social.id}">
          ${SOCIAL_PLATFORMS.map(platform => `
            <option value="${platform}" ${social.platform === platform ? "selected" : ""}>
              ${prettyLabel(platform)}
            </option>
          `).join("")}
        </select>

        <label>URL</label>
        <input
          type="text"
          class="social-url"
          data-social-id="${social.id}"
          value="${escapeHtml(social.draft_url || "")}"
        />

        <label>
          <input
            type="checkbox"
            class="social-enabled"
            data-social-id="${social.id}"
            ${social.is_enabled ? "checked" : ""}
          />
          Enabled
        </label>

        <button type="button" class="delete-social-btn" data-social-id="${social.id}">
          Delete Social Link
        </button>
      `;
      list.appendChild(row);
    });

    socialWrap.querySelector("#add-social-btn").addEventListener("click", async () => {
      await addSocialLink();
    });

    bindSocialAutosave();
  }

  function bindSectionFieldAutosave() {
    editorFields.querySelectorAll('[data-field-type="section-content"], [data-field-type="section-style"]').forEach(el => {
      el.addEventListener("change", async () => {
        const sectionId = el.dataset.sectionId;
        await saveSectionDraft(sectionId);
      });
    });
  }

  function bindFaqFieldAutosave() {
    editorFields.querySelectorAll("[data-faq-type], .faq-enabled-toggle").forEach(el => {
      el.addEventListener("change", async () => {
        const faqId = el.dataset.faqId;
        await saveFaqDraft(faqId);
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

    editorFields.querySelectorAll(".delete-social-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const socialId = btn.dataset.socialId;
        await deleteSocialLink(socialId);
      });
    });
  }

  async function saveSettings() {
    const payload = {
      theme_mode: themeModeEl.value,
      photo_shape: photoShapeEl.value,
      font_preset: fontSelect.value,
      button_style_preset: buttonStyleEl.value,
      home_enabled: !!toggleHomePage.checked,
      about_enabled: !!toggleAboutPage.checked,
      careers_enabled: !!toggleCareersPage.checked,
      faqs_enabled: !!toggleFaqsPage.checked,
      draft_updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("agent_page_settings")
      .update(payload)
      .eq("agent_id", agentId);

    if (error) {
      console.error("[builder] save settings failed", error);
      alert("Failed to save settings.");
      return false;
    }

    Object.assign(settings, payload);
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

    await saveSettings();
    refreshPreview();
  }

  async function saveSectionDraft(sectionId) {
    const row = sections.find(s => s.id === sectionId);
    if (!row) return;

    const contentInputs = editorFields.querySelectorAll(`[data-field-type="section-content"][data-section-id="${sectionId}"]`);
    const styleInputs = editorFields.querySelectorAll(`[data-field-type="section-style"][data-section-id="${sectionId}"]`);

    const draftContent = { ...(row.draft_content || {}) };
    const draftStyle = { ...(row.draft_style || {}) };

    contentInputs.forEach(input => {
      draftContent[input.dataset.key] = input.value;
    });

    styleInputs.forEach(input => {
      draftStyle[input.dataset.key] = input.value;
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
      alert("Failed to save section.");
      return;
    }

    row.draft_content = draftContent;
    row.draft_style = draftStyle;

    await saveSettings();
    refreshPreview();
  }

  async function addFaq(pageKey) {
    const pageFaqs = getCurrentPageFaqs(pageKey);
    const nextSort = pageFaqs.length ? Math.max(...pageFaqs.map(f => f.sort_order || 0)) + 1 : 1;

    const { data, error } = await supabase
      .from("agent_page_faqs")
      .insert({
        agent_id: agentId,
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
    renderPageEditor(pageKey);
    refreshPreview();
  }

  async function saveFaqDraft(faqId) {
    const faq = faqs.find(f => f.id === faqId);
    if (!faq) return;

    const questionEl = editorFields.querySelector(`[data-faq-type="question"][data-faq-id="${faqId}"]`);
    const answerEl = editorFields.querySelector(`[data-faq-type="answer"][data-faq-id="${faqId}"]`);
    const enabledEl = editorFields.querySelector(`.faq-enabled-toggle[data-faq-id="${faqId}"]`);

    const payload = {
      draft_question: questionEl ? questionEl.value : "",
      draft_answer: answerEl ? answerEl.value : "",
      is_enabled: enabledEl ? !!enabledEl.checked : true,
      updated_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("agent_page_faqs")
      .update(payload)
      .eq("id", faqId);

    if (error) {
      console.error("[builder] save faq failed", error);
      alert("Failed to save FAQ.");
      return;
    }

    Object.assign(faq, payload);
    await saveSettings();
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
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function addSocialLink() {
    const nextSort = socials.length ? Math.max(...socials.map(s => s.sort_order || 0)) + 1 : 1;

    const { data, error } = await supabase
      .from("agent_social_links")
      .insert({
        agent_id: agentId,
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
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function saveSocialDraft(socialId) {
    const social = socials.find(s => s.id === socialId);
    if (!social) return;

    const platformEl = editorFields.querySelector(`.social-platform[data-social-id="${socialId}"]`);
    const urlEl = editorFields.querySelector(`.social-url[data-social-id="${socialId}"]`);
    const enabledEl = editorFields.querySelector(`.social-enabled[data-social-id="${socialId}"]`);

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
      alert("Failed to save social link.");
      return;
    }

    Object.assign(social, payload);
    await saveSettings();
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
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  async function submitForApproval() {
    const { error } = await supabase
      .from("agent_page_settings")
      .update({
        status: "pending_review",
        submitted_for_review_at: new Date().toISOString(),
        draft_updated_at: new Date().toISOString()
      })
      .eq("agent_id", agentId);

    if (error) {
      console.error("[builder] submit for review failed", error);
      alert("Failed to submit for approval.");
      return;
    }

    settings.status = "pending_review";
    settings.submitted_for_review_at = new Date().toISOString();
    alert("Draft submitted for approval.");
  }

  function refreshPreview() {
    const page = pageSelect.value;
    const slug = new URLSearchParams(window.location.search).get("slug") || "preview-agent";
    const url =
      page === "home"
        ? `/a/${encodeURIComponent(slug)}?preview=draft&agent_id=${encodeURIComponent(agentId)}`
        : `/a/${page}?slug=${encodeURIComponent(slug)}&preview=draft&agent_id=${encodeURIComponent(agentId)}`;

    previewFrame.src = url;
  }

  function prettyLabel(value) {
    return String(value || "")
      .replaceAll("_", " ")
      .replace(/\b\w/g, m => m.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  pageSelect.addEventListener("change", () => {
    renderPageEditor(pageSelect.value);
    refreshPreview();
  });

  [themeModeEl, photoShapeEl, fontSelect, buttonStyleEl, toggleHomePage, toggleAboutPage, toggleCareersPage, toggleFaqsPage]
    .forEach(el => {
      el.addEventListener("change", async () => {
        await saveSettings();
        refreshPreview();
      });
    });

  document.getElementById("save-draft-btn").addEventListener("click", async () => {
    const ok = await saveSettings();
    if (ok) {
      alert("Draft saved.");
      refreshPreview();
    }
  });

  document.getElementById("submit-review-btn").addEventListener("click", async () => {
    await saveSettings();
    await submitForApproval();
  });

  document.getElementById("preview-draft-btn").addEventListener("click", () => {
    refreshPreview();
  });

  await loadAll();
});
