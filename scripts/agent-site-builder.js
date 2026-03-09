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

  FONT_PRESETS.forEach(font => {
    const opt = document.createElement("option");
    opt.value = font;
    opt.textContent = font;
    fontSelect.appendChild(opt);
  });

  // TODO: replace this with actual logged-in agent row lookup
  const agentId = new URLSearchParams(window.location.search).get("agent_id");
  if (!agentId) {
    editorFields.innerHTML = "<p>Missing agent_id in URL.</p>";
    return;
  }

  let settings = null;
  let sections = [];
  let faqs = [];
  let socials = [];

  async function loadAll() {
    const { data: settingsRow, error: settingsErr } = await supabase
      .from("agent_page_settings")
      .select("*")
      .eq("agent_id", agentId)
      .single();

    if (settingsErr) {
      console.error(settingsErr);
      return;
    }

    settings = settingsRow;

    const { data: sectionRows, error: sectionErr } = await supabase
      .from("agent_page_sections")
      .select("*")
      .eq("agent_id", agentId)
      .order("page_key")
      .order("sort_order");

    if (sectionErr) {
      console.error(sectionErr);
      return;
    }

    sections = sectionRows || [];

    const { data: faqRows } = await supabase
      .from("agent_page_faqs")
      .select("*")
      .eq("agent_id", agentId)
      .order("page_key")
      .order("sort_order");

    faqs = faqRows || [];

    const { data: socialRows } = await supabase
      .from("agent_social_links")
      .select("*")
      .eq("agent_id", agentId)
      .order("sort_order");

    socials = socialRows || [];

    hydrateSettingsUI();
    renderPageEditor(pageSelect.value);
    refreshPreview();
  }

  function hydrateSettingsUI() {
    document.getElementById("builder-theme-mode").value = settings.theme_mode || "dark";
    document.getElementById("builder-photo-shape").value = settings.photo_shape || "circle";
    document.getElementById("builder-font-preset").value = settings.font_preset || "Bellota Text";
    document.getElementById("builder-button-style").value = settings.button_style_preset || "soft-dark";

    document.getElementById("toggle-home-page").checked = !!settings.home_enabled;
    document.getElementById("toggle-about-page").checked = !!settings.about_enabled;
    document.getElementById("toggle-careers-page").checked = !!settings.careers_enabled;
    document.getElementById("toggle-faqs-page").checked = !!settings.faqs_enabled;
  }

  function renderSectionToggles(pageKey) {
    sectionToggleList.innerHTML = "";

    const pageSections = sections.filter(s => s.page_key === pageKey);
    pageSections.forEach(section => {
      const label = document.createElement("label");
      label.innerHTML = `
        <input type="checkbox" data-section-id="${section.id}" ${section.is_enabled ? "checked" : ""} />
        ${section.section_key}
      `;
      sectionToggleList.appendChild(label);
    });
  }

  function renderPageEditor(pageKey) {
    renderSectionToggles(pageKey);

    const pageSections = sections.filter(s => s.page_key === pageKey);
    editorFields.innerHTML = "";

    pageSections.forEach(section => {
      const content = section.draft_content || {};
      const wrap = document.createElement("div");
      wrap.className = "editor-field-group";
      wrap.innerHTML = `
        <h3>${pageKey} / ${section.section_key}</h3>
        <label>Heading</label>
        <input type="text" data-type="heading" data-id="${section.id}" value="${escapeHtml(content.heading || "")}" />

        <label>Subheading</label>
        <input type="text" data-type="subheading" data-id="${section.id}" value="${escapeHtml(content.subheading || "")}" />

        <label>Body</label>
        <textarea rows="5" data-type="body" data-id="${section.id}">${escapeHtml(content.body || "")}</textarea>

        <label>Button Text</label>
        <input type="text" data-type="button_text" data-id="${section.id}" value="${escapeHtml(content.button_text || "")}" />

        <label>Button Link</label>
        <input type="text" data-type="button_link" data-id="${section.id}" value="${escapeHtml(content.button_link || "")}" />
      `;
      editorFields.appendChild(wrap);
    });

    if (pageKey === "faqs" || pageKey === "careers") {
      const faqWrap = document.createElement("div");
      faqWrap.className = "editor-field-group";

      const pageFaqs = faqs.filter(f => f.page_key === pageKey);
      faqWrap.innerHTML = `<h3>${pageKey} FAQs</h3><div id="faq-editor-list"></div><button type="button" id="add-faq-btn">Add FAQ</button>`;
      editorFields.appendChild(faqWrap);

      const faqList = faqWrap.querySelector("#faq-editor-list");

      pageFaqs.forEach(faq => {
        const row = document.createElement("div");
        row.className = "editor-field-group";
        row.innerHTML = `
          <label>Question</label>
          <input type="text" data-faq-type="question" data-faq-id="${faq.id}" value="${escapeHtml(faq.draft_question || "")}" />
          <label>Answer</label>
          <textarea rows="4" data-faq-type="answer" data-faq-id="${faq.id}">${escapeHtml(faq.draft_answer || "")}</textarea>
        `;
        faqList.appendChild(row);
      });
    }
  }

  function refreshPreview() {
    const page = pageSelect.value;
    previewFrame.src = `/a/${page === "home" ? "" : page}?slug=preview-agent&preview=draft&agent_id=${encodeURIComponent(agentId)}`;
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

  document.getElementById("save-draft-btn").addEventListener("click", async () => {
    alert("Next step: wire save logic.");
  });

  document.getElementById("submit-review-btn").addEventListener("click", async () => {
    alert("Next step: wire submit for approval.");
  });

  document.getElementById("preview-draft-btn").addEventListener("click", () => {
    refreshPreview();
  });

  await loadAll();
});
