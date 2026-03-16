console.log("[admin-carriers] loaded from file");

(() => {
  "use strict";

  const LEVEL_MULTIPLIERS = [
    { level: "area_manager", mult: 0.90 },
    { level: "mga", mult: 0.85 },
    { level: "manager", mult: 0.80 },
    { level: "mit", mult: 0.75 },
    { level: "agent", mult: 0.70 },
  ];

  const $ = (sel) => document.querySelector(sel);

  let supabase;
  let sessionUserId = null;

  let carriers = [];
  const carrierById = new Map();

  let schedules = [];
  let selectedCarrierId = "";

  const els = {
    tabCarriers: $("#tab-carriers"),
    tabSchedules: $("#tab-schedules"),
    panelCarriers: $("#panel-carriers"),
    panelSchedules: $("#panel-schedules"),

    carrierName: $("#carrier-name"),
    carrierLogo: $("#carrier-logo"),
    carrierUrl: $("#carrier-url"),
    carrierNotes: $("#carrier-notes"),
    addCarrierBtn: $("#add-carrier-btn"),
    carrierAddMsg: $("#carrier-add-msg"),
    carrierLogoFile: $("#carrier-logo-file"),

    carrierSearch: $("#carrier-search"),
    carriersTableBody: $("#carriers-table tbody"),

    editCarrierModal: $("#edit-carrier-modal"),
    editCarrierId: $("#edit-carrier-id"),
    editCarrierName: $("#edit-carrier-name"),
    editCarrierUrl: $("#edit-carrier-url"),
    editCarrierLogo: $("#edit-carrier-logo"),
    editCarrierNotes: $("#edit-carrier-notes"),
    saveCarrierBtn: $("#save-carrier-btn"),
    cancelCarrierBtn: $("#cancel-carrier-btn"),
    closeEditCarrier: $("#close-edit-carrier"),
    editCarrierMsg: $("#edit-carrier-msg"),
    editCarrierLogoFile: $("#edit-carrier-logo-file"),

    schedCarrier: $("#sched-carrier"),
    schedProductLine: $("#sched-product-line"),
    schedPolicyType: $("#sched-policy-type"),
    schedTermLength: $("#sched-term-length"),
    schedFvgRate: $("#sched-fvg-rate"),
    schedAdvanceRate: $("#sched-advance-rate"),
    schedEffectiveFrom: $("#sched-effective-from"),
    schedEffectiveTo: $("#sched-effective-to"),
    schedLagWeeks: $("#sched-lag-weeks"),
    schedExclusiveMonths: $("#sched-exclusive-months"),
    schedRequiredLoas: $("#sched-required-loas"),
    schedNotes: $("#sched-notes"),
    createScheduleBtn: $("#create-schedule-btn"),
    schedCreateMsg: $("#sched-create-msg"),

    bandsContainer: $("#bands-container"),
    addBandBtn: $("#add-band-btn"),
    previewJsonBtn: $("#preview-json-btn"),
    jsonPreviewModal: $("#json-preview-modal"),
    jsonPreview: $("#json-preview"),
    closeJsonPreview: $("#close-json-preview"),

    attachmentsContainer: $("#attachments-container"),
    addAttachmentBtn: $("#add-attachment-btn"),

    refreshSchedulesBtn: $("#refresh-schedules-btn"),
    filterCarrier: $("#filter-carrier"),
    filterProductLine: $("#filter-product-line"),
    filterPolicyType: $("#filter-policy-type"),
    filterItemType: $("#filter-item-type"),
    filterParentPolicyType: $("#filter-parent-policy-type"),
    filterAgentLevel: $("#filter-agent-level"),
    filterActiveOnly: $("#filter-active-only"),
    applyScheduleFilters: $("#apply-schedule-filters"),
    resetScheduleFilters: $("#reset-schedule-filters"),
    schedulesTableBody: $("#schedules-table tbody"),
    schedulesMsg: $("#schedules-msg"),

    editScheduleModal: $("#edit-schedule-modal"),
    editSchedId: $("#edit-sched-id"),
    editSchedCarrierName: $("#edit-sched-carrier-name"),
    editSchedItemType: $("#edit-sched-item-type"),
    editSchedAgentLevel: $("#edit-sched-agent-level"),
    editSchedProductLine: $("#edit-sched-product-line"),
    editSchedParentPolicyType: $("#edit-sched-parent-policy-type"),
    editSchedPolicyType: $("#edit-sched-policy-type"),
    editSchedBase: $("#edit-sched-base"),
    editSchedAdvance: $("#edit-sched-advance"),
    editSchedTerm: $("#edit-sched-term"),
    editSchedEffFrom: $("#edit-sched-effective-from"),
    editSchedEffTo: $("#edit-sched-effective-to"),
    editSchedLagWeeks: $("#edit-sched-lag-weeks"),
    editSchedExclusiveMonths: $("#edit-sched-exclusive-months"),
    editSchedRequiredLoas: $("#edit-sched-required-loas"),
    editSchedRenewalJson: $("#edit-sched-renewal-json"),
    editSchedNotes: $("#edit-sched-notes"),
    saveSchedBtn: $("#save-sched-btn"),
    cancelSchedBtn: $("#cancel-sched-btn"),
    closeEditSchedule: $("#close-edit-schedule"),
    editSchedMsg: $("#edit-sched-msg"),
  };

  function setStatus(el, msg, type = "") {
    if (!el) return;
    el.textContent = msg || "";
    el.classList.remove("ok", "err");
    if (type) el.classList.add(type);
  }

  function esc(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function round4(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return null;
    return Math.round(x * 10000) / 10000;
  }

  function openOverlay(el) {
    if (!el) return;
    el.style.display = "flex";
    el.setAttribute("aria-hidden", "false");
  }

  function closeOverlay(el) {
    if (!el) return;
    el.style.display = "none";
    el.setAttribute("aria-hidden", "true");
  }

  function parseNullableInt(v) {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  }

  function parseNullableNum(v) {
    if (v === "" || v == null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  function toNullableStr(v) {
    const s = String(v ?? "").trim();
    return s.length ? s : null;
  }

  function parseExclusiveMonthsInput(v) {
    const raw = String(v ?? "").trim();
    if (!raw) return null;

    const nums = raw
      .split(",")
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isInteger(n));

    const deduped = [...new Set(nums)].sort((a, b) => a - b);

    if (!deduped.length) return null;
    if (deduped.some((n) => n < 1 || n > 12)) {
      throw new Error("Exclusive months must be comma-separated integers between 1 and 12.");
    }

    return deduped;
  }

  function formatExclusiveMonths(value) {
    if (!Array.isArray(value) || !value.length) return "";
    return value.join(",");
  }

  function readCheckedLoas(container) {
    if (!container) return null;

    const values = Array.from(
      container.querySelectorAll('input[type="checkbox"]:checked')
    )
      .map((cb) => String(cb.value || "").trim().toLowerCase())
      .filter(Boolean);

    const deduped = [...new Set(values)];
    return deduped.length ? deduped : null;
  }

  function setCheckedLoas(container, loas) {
    if (!container) return;
    const allowed = new Set(
      (Array.isArray(loas) ? loas : []).map((v) => String(v).trim().toLowerCase())
    );

    container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = allowed.has(String(cb.value).trim().toLowerCase());
    });
  }

  function formatLoas(loas) {
    if (!Array.isArray(loas) || !loas.length) return "";
    return loas.join(", ");
  }

  async function uploadCarrierLogoFile(file, carrierName) {
    if (!file) return null;

    const BUCKET = "carrier-logos";

    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const safeName = String(carrierName || "carrier")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const path = `${safeName}/${crypto.randomUUID()}.${ext}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });

    if (upErr) throw upErr;

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  }

  function wireAdminPageNavFallback() {
    const nav = $("#admin-page-nav");
    if (!nav) return;

    nav.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-href]");
      if (!btn) return;

      const href = btn.getAttribute("data-href");
      if (!href) return;
      if (href.endsWith("admin-carriers.html")) return;

      window.location.href = href;
    });
  }

  function showTab(name) {
    if (name === "carriers") {
      els.tabCarriers?.classList.add("active");
      els.tabSchedules?.classList.remove("active");
      if (els.panelCarriers) els.panelCarriers.style.display = "block";
      if (els.panelSchedules) els.panelSchedules.style.display = "none";
      return;
    }

    els.tabSchedules?.classList.add("active");
    els.tabCarriers?.classList.remove("active");
    if (els.panelSchedules) els.panelSchedules.style.display = "block";
    if (els.panelCarriers) els.panelCarriers.style.display = "none";
  }

  async function loadCarriers() {
    const { data, error } = await supabase
      .from("carriers")
      .select("id, carrier_name, carrier_logo, carrier_url, notes, created_at")
      .order("carrier_name", { ascending: true });

    if (error) throw error;

    carriers = data || [];
    carrierById.clear();
    for (const c of carriers) carrierById.set(c.id, c);

    renderCarriersTable();
    populateCarrierSelects();
  }

  function renderCarriersTable() {
    if (!els.carriersTableBody) return;

    const q = (els.carrierSearch?.value || "").trim().toLowerCase();
    const filtered = !q
      ? carriers
      : carriers.filter((c) =>
          (c.carrier_name || "").toLowerCase().includes(q) ||
          (c.carrier_url || "").toLowerCase().includes(q) ||
          (c.notes || "").toLowerCase().includes(q)
        );

    els.carriersTableBody.innerHTML = filtered
      .map((c) => {
        const logo = c.carrier_logo
          ? `<a href="${esc(c.carrier_logo)}" target="_blank" rel="noopener">link</a>`
          : "";
        const url = c.carrier_url
          ? `<a href="${esc(c.carrier_url)}" target="_blank" rel="noopener">${esc(c.carrier_url)}</a>`
          : "";
        const notes = c.notes ? esc(c.notes) : "";

        return `
          <tr data-carrier-id="${esc(c.id)}">
            <td class="clickable" title="Click to filter schedules">
              <strong>${esc(c.carrier_name)}</strong>
            </td>
            <td>${url}</td>
            <td>${logo}</td>
            <td>${notes}</td>
            <td>
              <button class="btn btn-muted" data-action="edit-carrier" type="button"><i class="fa-solid fa-pen"></i> Edit</button>
              <button class="btn btn-danger" data-action="delete-carrier" type="button"><i class="fa-solid fa-trash"></i> Delete</button>
            </td>
          </tr>
        `;
      })
      .join("");

    els.carriersTableBody.onclick = (e) => {
      const tr = e.target.closest("tr[data-carrier-id]");
      if (!tr) return;

      const id = tr.getAttribute("data-carrier-id");
      const actionBtn = e.target.closest("button[data-action]");
      const carrier = carrierById.get(id);
      if (!carrier) return;

      if (actionBtn) {
        const action = actionBtn.getAttribute("data-action");
        if (action === "edit-carrier") openEditCarrier(carrier);
        if (action === "delete-carrier") deleteCarrier(carrier);
        return;
      }

      selectedCarrierId = id;
      if (els.filterCarrier) els.filterCarrier.value = id;
      if (els.schedCarrier) els.schedCarrier.value = id;
      showTab("schedules");
      refreshSchedules();
    };
  }

  function populateCarrierSelects() {
    if (els.schedCarrier) {
      els.schedCarrier.innerHTML = carriers
        .map((c) => `<option value="${esc(c.id)}">${esc(c.carrier_name)}</option>`)
        .join("");

      if (selectedCarrierId) els.schedCarrier.value = selectedCarrierId;
    }

    if (els.filterCarrier) {
      els.filterCarrier.innerHTML =
        `<option value="">All</option>` +
        carriers
          .map((c) => `<option value="${esc(c.id)}">${esc(c.carrier_name)}</option>`)
          .join("");

      if (selectedCarrierId) els.filterCarrier.value = selectedCarrierId;
    }
  }

  async function addCarrier() {
    setStatus(els.carrierAddMsg, "", "");

    const carrier_name = (els.carrierName?.value || "").trim();
    if (!carrier_name) {
      setStatus(els.carrierAddMsg, "Carrier name is required.", "err");
      return;
    }

    const carrier_url = toNullableStr(els.carrierUrl?.value);
    const notes = toNullableStr(els.carrierNotes?.value);
    const manualLogoUrl = toNullableStr(els.carrierLogo?.value);
    const file = els.carrierLogoFile?.files?.[0] || null;

    els.addCarrierBtn.disabled = true;

    try {
      let carrier_logo = manualLogoUrl;

      if (file) {
        carrier_logo = await uploadCarrierLogoFile(file, carrier_name);
      }

      const { error } = await supabase
        .from("carriers")
        .insert([{ carrier_name, carrier_logo, carrier_url, notes }]);

      if (error) throw error;

      if (els.carrierName) els.carrierName.value = "";
      if (els.carrierLogo) els.carrierLogo.value = "";
      if (els.carrierLogoFile) els.carrierLogoFile.value = "";
      if (els.carrierUrl) els.carrierUrl.value = "";
      if (els.carrierNotes) els.carrierNotes.value = "";

      setStatus(els.carrierAddMsg, "Carrier added.", "ok");
      await loadCarriers();
    } catch (err) {
      setStatus(els.carrierAddMsg, err.message || "Failed to add carrier.", "err");
    } finally {
      els.addCarrierBtn.disabled = false;
    }
  }

  function openEditCarrier(carrier) {
    setStatus(els.editCarrierMsg, "", "");

    els.editCarrierId.value = carrier.id;
    els.editCarrierName.value = carrier.carrier_name || "";
    els.editCarrierUrl.value = carrier.carrier_url || "";
    if (els.editCarrierLogo) els.editCarrierLogo.value = carrier.carrier_logo || "";
    els.editCarrierNotes.value = carrier.notes || "";
    if (els.editCarrierLogoFile) els.editCarrierLogoFile.value = "";

    openOverlay(els.editCarrierModal);
  }

  async function saveCarrier() {
    setStatus(els.editCarrierMsg, "", "");

    const id = els.editCarrierId.value;
    const carrier_name = (els.editCarrierName.value || "").trim();

    if (!carrier_name) {
      setStatus(els.editCarrierMsg, "Carrier name is required.", "err");
      return;
    }

    const carrier_url = toNullableStr(els.editCarrierUrl.value);
    const notes = toNullableStr(els.editCarrierNotes.value);
    const manualLogoUrl = toNullableStr(els.editCarrierLogo?.value);
    const file = els.editCarrierLogoFile?.files?.[0] || null;

    els.saveCarrierBtn.disabled = true;

    try {
      let carrier_logo = manualLogoUrl;

      if (file) {
        carrier_logo = await uploadCarrierLogoFile(file, carrier_name);
      } else if (!els.editCarrierLogo) {
        const existing = carrierById.get(id);
        carrier_logo = existing?.carrier_logo || null;
      }

      const payload = {
        carrier_name,
        carrier_url,
        carrier_logo,
        notes,
      };

      const { error } = await supabase.from("carriers").update(payload).eq("id", id);
      if (error) throw error;

      setStatus(els.editCarrierMsg, "Saved.", "ok");
      await loadCarriers();
    } catch (err) {
      setStatus(els.editCarrierMsg, err.message || "Failed to save.", "err");
    } finally {
      els.saveCarrierBtn.disabled = false;
    }
  }

  async function deleteCarrier(carrier) {
    const ok = confirm(
      `Delete carrier "${carrier.carrier_name}"?\n\nThis will ALSO delete its commission schedules (cascade).`
    );
    if (!ok) return;

    try {
      const { error } = await supabase.from("carriers").delete().eq("id", carrier.id);
      if (error) throw error;

      if (selectedCarrierId === carrier.id) selectedCarrierId = "";
      await loadCarriers();
      setStatus(els.carrierAddMsg, `Deleted ${carrier.carrier_name}.`, "ok");
      await refreshSchedules();
    } catch (err) {
      setStatus(els.carrierAddMsg, err.message || "Failed to delete carrier.", "err");
    }
  }

  function bandRowTemplate({ rate = "", start_year = "2", end_year = "" } = {}) {
    return `
      <div class="band-row" data-band>
        <label>
          <div class="mini">Rate</div>
          <input data-rate type="number" step="0.0001" placeholder="0.0680" value="${esc(rate)}" />
        </label>
        <label>
          <div class="mini">Start Year</div>
          <input data-start type="number" min="1" step="1" placeholder="2" value="${esc(start_year)}" />
        </label>
        <label>
          <div class="mini">End Year (blank = open)</div>
          <input data-end type="number" min="1" step="1" placeholder="" value="${esc(end_year)}" />
        </label>
        <button class="btn btn-danger tight" data-remove-band type="button" title="Remove band">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;
  }

  function ensureAtLeastOneBand() {
    if (!els.bandsContainer) return;
    const bands = els.bandsContainer.querySelectorAll("[data-band]");
    if (bands.length === 0) addBand({ rate: "", start_year: 2, end_year: "" });
  }

  function addBand(band = {}) {
    if (!els.bandsContainer) return;
    els.bandsContainer.insertAdjacentHTML("beforeend", bandRowTemplate(band));
  }

  function readBandsFromContainer(containerEl) {
    if (!containerEl) return [];
    const bandEls = Array.from(containerEl.querySelectorAll("[data-band]"));
    const bands = [];

    for (const el of bandEls) {
      const rate = parseNullableNum(el.querySelector("[data-rate]")?.value);
      const start = parseNullableInt(el.querySelector("[data-start]")?.value);
      const endRaw = el.querySelector("[data-end]")?.value;
      const end = parseNullableInt(endRaw);

      if (!Number.isFinite(rate) || rate == null) {
        throw new Error("Each band needs a valid Rate.");
      }
      if (!Number.isFinite(start) || start == null || start < 1) {
        throw new Error("Each band needs a valid Start Year (>= 1).");
      }
      if (end != null && end < start) {
        throw new Error("End Year cannot be less than Start Year.");
      }

      bands.push({
        rate: round4(rate),
        start_year: start,
        end_year: endRaw === "" ? null : end,
      });
    }

    bands.sort((a, b) => (a.start_year ?? 0) - (b.start_year ?? 0));
    return bands;
  }

  function readBands() {
    return readBandsFromContainer(els.bandsContainer);
  }

  function buildRenewalTrailRuleJSON() {
    const bands = readBands();
    return { bands };
  }

  function formatBandsShort(rule) {
    const bands = rule?.bands || [];
    if (!bands.length) return "";
    return bands
      .map((b) => {
        const end = b.end_year == null ? "+" : `-${b.end_year}`;
        return `Y${b.start_year}${end}: ${b.rate}`;
      })
      .join(" | ");
  }

  function attachmentCardTemplate(index) {
    return `
      <div class="attachment-card" data-attachment-card>
        <div class="attachment-head">
          <div class="attachment-title">Attachment <span data-attachment-number>${index}</span></div>
          <button class="btn btn-danger tight" data-remove-attachment type="button">
            <i class="fa-solid fa-trash"></i> Remove
          </button>
        </div>

        <div class="row">
          <label>
            <div class="mini">Attachment Policy Type</div>
            <input data-attachment-policy-type type="text" placeholder="e.g., Term Rider" />
          </label>
          <label>
            <div class="mini">FVG Base Commission Rate</div>
            <input data-attachment-fvg-rate type="number" step="0.0001" placeholder="e.g., 0.0550" />
          </label>
          <label>
            <div class="mini">Advance Rate</div>
            <input data-attachment-advance-rate type="number" step="0.0001" placeholder="e.g., 0.5500" />
          </label>
        </div>

        <div style="margin-top:10px;">
          <div class="mini">Attachment Renewal Trail Rule (Bands)</div>
          <div data-attachment-bands style="margin-top:8px;"></div>
          <div class="band-actions">
            <button class="btn btn-muted" data-add-attachment-band type="button">
              <i class="fa-solid fa-plus"></i> Add Band
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function renumberAttachmentCards() {
    const cards = Array.from(els.attachmentsContainer?.querySelectorAll("[data-attachment-card]") || []);
    cards.forEach((card, idx) => {
      const num = card.querySelector("[data-attachment-number]");
      if (num) num.textContent = String(idx + 1);
    });
  }

  function addAttachmentCard(prefill = {}) {
    if (!els.attachmentsContainer) return;

    const nextIndex = (els.attachmentsContainer.querySelectorAll("[data-attachment-card]").length || 0) + 1;
    els.attachmentsContainer.insertAdjacentHTML("beforeend", attachmentCardTemplate(nextIndex));

    const card = els.attachmentsContainer.lastElementChild;
    if (!card) return;

    const policyTypeInput = card.querySelector("[data-attachment-policy-type]");
    const fvgRateInput = card.querySelector("[data-attachment-fvg-rate]");
    const advanceRateInput = card.querySelector("[data-attachment-advance-rate]");
    const bandsWrap = card.querySelector("[data-attachment-bands]");

    if (policyTypeInput) policyTypeInput.value = prefill.policy_type || "";
    if (fvgRateInput) fvgRateInput.value = prefill.fvg_rate ?? "";
    if (advanceRateInput) advanceRateInput.value = prefill.advance_rate ?? "";

    if (bandsWrap) {
      bandsWrap.insertAdjacentHTML(
        "beforeend",
        bandRowTemplate(prefill.band || { rate: "", start_year: 2, end_year: "" })
      );
    }

    renumberAttachmentCards();
  }

  function readAttachmentConfigs() {
    const cards = Array.from(els.attachmentsContainer?.querySelectorAll("[data-attachment-card]") || []);
    const results = [];

    for (const card of cards) {
      const attachmentPolicyType = toNullableStr(card.querySelector("[data-attachment-policy-type]")?.value);
      const fvgRate = parseNullableNum(card.querySelector("[data-attachment-fvg-rate]")?.value);
      const advanceRate = parseNullableNum(card.querySelector("[data-attachment-advance-rate]")?.value);
      const bandsWrap = card.querySelector("[data-attachment-bands]");

      if (!attachmentPolicyType) {
        throw new Error("Each attachment needs an Attachment Policy Type.");
      }
      if (!Number.isFinite(fvgRate) || fvgRate == null || fvgRate <= 0) {
        throw new Error(`Attachment "${attachmentPolicyType}" needs a positive FVG base commission rate.`);
      }
      if (!Number.isFinite(advanceRate) || advanceRate == null || advanceRate < 0) {
        throw new Error(`Attachment "${attachmentPolicyType}" needs a valid advance rate.`);
      }

      const renewal_trail_rule = { bands: readBandsFromContainer(bandsWrap) };

      results.push({
        policy_type: attachmentPolicyType,
        fvg_rate: fvgRate,
        advance_rate: advanceRate,
        renewal_trail_rule,
      });
    }

    return results;
  }

  function getCarrierFromSelect(selectEl) {
    const id = selectEl?.value || "";
    if (!id) return null;
    return carrierById.get(id) || null;
  }

  async function createScheduleBatch() {
    setStatus(els.schedCreateMsg, "", "");

    const carrier = getCarrierFromSelect(els.schedCarrier);
    if (!carrier) {
      setStatus(els.schedCreateMsg, "Choose a carrier.", "err");
      return;
    }

    const product_line = (els.schedProductLine?.value || "").trim();
    if (!product_line) {
      setStatus(els.schedCreateMsg, "Product line is required.", "err");
      return;
    }

    const mainPolicyType = toNullableStr(els.schedPolicyType?.value);
    if (!mainPolicyType) {
      setStatus(els.schedCreateMsg, "Policy type is required.", "err");
      return;
    }

    const term_length_months = parseNullableInt(els.schedTermLength?.value);
    if (term_length_months != null && (term_length_months < 1 || term_length_months > 24)) {
      setStatus(els.schedCreateMsg, "Term length must be 1–24 months (or blank).", "err");
      return;
    }

    const fvgRate = parseNullableNum(els.schedFvgRate?.value);
    if (!Number.isFinite(fvgRate) || fvgRate == null || fvgRate <= 0) {
      setStatus(
        els.schedCreateMsg,
        "FVG base commission rate must be a positive decimal (e.g., 0.1000).",
        "err"
      );
      return;
    }

    const advance_rate = parseNullableNum(els.schedAdvanceRate?.value);
    if (!Number.isFinite(advance_rate) || advance_rate == null || advance_rate < 0) {
      setStatus(
        els.schedCreateMsg,
        "Advance rate must be a valid decimal (e.g., 0.7500).",
        "err"
      );
      return;
    }

    const effective_from = els.schedEffectiveFrom?.value || todayISO();
    const effective_to = els.schedEffectiveTo?.value || null;

    const lag_time_weeks = parseNullableInt(els.schedLagWeeks?.value) ?? 0;
    if (lag_time_weeks < 0) {
      setStatus(els.schedCreateMsg, "Lag time must be 0 or greater.", "err");
      return;
    }

    let exclusive_months = null;
    try {
      exclusive_months = parseExclusiveMonthsInput(els.schedExclusiveMonths?.value);
    } catch (err) {
      setStatus(els.schedCreateMsg, err.message || "Invalid exclusive months.", "err");
      return;
    }

    const required_loas = readCheckedLoas(els.schedRequiredLoas);

    let baseRule;
    try {
      baseRule = buildRenewalTrailRuleJSON();
    } catch (err) {
      setStatus(els.schedCreateMsg, err.message || "Invalid renewal bands.", "err");
      return;
    }

    let attachments = [];
    try {
      attachments = readAttachmentConfigs();
    } catch (err) {
      setStatus(els.schedCreateMsg, err.message || "Invalid attachments.", "err");
      return;
    }

    const sharedFields = {
      carrier_id: carrier.id,
      carrier_name: carrier.carrier_name,
      product_line,
      effective_from,
      effective_to,
      lag_time_weeks,
      exclusive_months,
      required_loas,
      created_by: sessionUserId,
      notes: toNullableStr(els.schedNotes?.value),
      term_length_months,
    };

    const rows = [];

    for (const { level, mult } of LEVEL_MULTIPLIERS) {
      rows.push({
        ...sharedFields,
        commission_item_type: "policy",
        parent_policy_type: null,
        policy_type: mainPolicyType,
        agent_level: level,
        base_commission_rate: round4(fvgRate * mult),
        advance_rate: round4(advance_rate),
        renewal_trail_rule: {
          bands: (baseRule.bands || []).map((b) => ({
            ...b,
            rate: round4(Number(b.rate) * mult),
          })),
        },
      });

      for (const attachment of attachments) {
        rows.push({
          ...sharedFields,
          commission_item_type: "attachment",
          parent_policy_type: mainPolicyType,
          policy_type: attachment.policy_type,
          agent_level: level,
          base_commission_rate: round4(Number(attachment.fvg_rate) * mult),
          advance_rate: round4(attachment.advance_rate),
          renewal_trail_rule: {
            bands: (attachment.renewal_trail_rule?.bands || []).map((b) => ({
              ...b,
              rate: round4(Number(b.rate) * mult),
            })),
          },
        });
      }
    }

    els.createScheduleBtn.disabled = true;
    try {
      const { error } = await supabase.from("commission_schedules").insert(rows);
      if (error) throw error;

      const totalCreated = rows.length;
      setStatus(els.schedCreateMsg, `Created ${totalCreated} row(s).`, "ok");

      if (els.schedProductLine) els.schedProductLine.value = "";
      if (els.schedPolicyType) els.schedPolicyType.value = "";
      if (els.schedTermLength) els.schedTermLength.value = "";
      if (els.schedFvgRate) els.schedFvgRate.value = "";
      if (els.schedAdvanceRate) els.schedAdvanceRate.value = "";
      if (els.schedEffectiveTo) els.schedEffectiveTo.value = "";
      if (els.schedLagWeeks) els.schedLagWeeks.value = "";
      if (els.schedExclusiveMonths) els.schedExclusiveMonths.value = "";
      if (els.schedNotes) els.schedNotes.value = "";
      setCheckedLoas(els.schedRequiredLoas, []);

      if (els.bandsContainer) els.bandsContainer.innerHTML = "";
      addBand({ rate: "", start_year: 2, end_year: "" });

      if (els.attachmentsContainer) els.attachmentsContainer.innerHTML = "";

      selectedCarrierId = carrier.id;
      if (els.filterCarrier) els.filterCarrier.value = carrier.id;

      showTab("schedules");
      await refreshSchedules();
    } catch (err) {
      setStatus(els.schedCreateMsg, err.message || "Failed to create schedules.", "err");
    } finally {
      els.createScheduleBtn.disabled = false;
    }
  }

  function currentScheduleFilters() {
    return {
      carrier_id: els.filterCarrier?.value || "",
      product_line: (els.filterProductLine?.value || "").trim(),
      policy_type: (els.filterPolicyType?.value || "").trim(),
      commission_item_type: (els.filterItemType?.value || "").trim(),
      parent_policy_type: (els.filterParentPolicyType?.value || "").trim(),
      agent_level: els.filterAgentLevel?.value || "",
      activeOnly: !!els.filterActiveOnly?.checked,
    };
  }

  async function loadSchedules(filters) {
    setStatus(els.schedulesMsg, "", "");

    let q = supabase
      .from("commission_schedules")
      .select(
        "id, carrier_id, carrier_name, commission_item_type, parent_policy_type, product_line, policy_type, agent_level, base_commission_rate, advance_rate, effective_from, effective_to, lag_time_weeks, exclusive_months, required_loas, renewal_trail_rule, term_length_months, notes, created_at"
      )
      .order("carrier_name", { ascending: true })
      .order("commission_item_type", { ascending: true })
      .order("parent_policy_type", { ascending: true })
      .order("product_line", { ascending: true })
      .order("policy_type", { ascending: true })
      .order("agent_level", { ascending: true })
      .order("effective_from", { ascending: false })
      .limit(500);

    if (filters.carrier_id) q = q.eq("carrier_id", filters.carrier_id);
    if (filters.agent_level) q = q.eq("agent_level", filters.agent_level);
    if (filters.commission_item_type) q = q.eq("commission_item_type", filters.commission_item_type);
    if (filters.product_line) q = q.ilike("product_line", `%${filters.product_line}%`);
    if (filters.policy_type) q = q.ilike("policy_type", `%${filters.policy_type}%`);
    if (filters.parent_policy_type) q = q.ilike("parent_policy_type", `%${filters.parent_policy_type}%`);

    if (filters.activeOnly) {
      const t = todayISO();
      q = q.or(`effective_to.is.null,effective_to.gte.${t}`);
    }

    const { data, error } = await q;
    if (error) throw error;

    schedules = data || [];
    renderSchedulesTable();
  }

  function renderSchedulesTable() {
    if (!els.schedulesTableBody) return;

    if (!schedules.length) {
      els.schedulesTableBody.innerHTML = `
        <tr><td colspan="15" class="mini">No schedules found for the current filters.</td></tr>
      `;
      return;
    }

    els.schedulesTableBody.innerHTML = schedules
      .map((s) => {
        const eff = `${esc(s.effective_from)}${s.effective_to ? " → " + esc(s.effective_to) : " → (open)"}`;
        const lag = s.lag_time_weeks == null ? "0" : esc(s.lag_time_weeks);
        const exMonths =
          Array.isArray(s.exclusive_months) && s.exclusive_months.length
            ? esc(s.exclusive_months.join(","))
            : "";
        const term = s.term_length_months == null ? "" : esc(s.term_length_months);
        const requiredLoas = formatLoas(s.required_loas);
        const bandsShort = formatBandsShort(s.renewal_trail_rule);

        return `
          <tr data-sched-id="${esc(s.id)}">
            <td>${esc(s.carrier_name)}</td>
            <td><span class="pill">${esc(s.commission_item_type || "policy")}</span></td>
            <td>${esc(s.product_line)}</td>
            <td>${esc(s.parent_policy_type ?? "")}</td>
            <td>${esc(s.policy_type ?? "")}</td>
            <td><span class="pill">${esc(s.agent_level)}</span></td>
            <td>${esc(s.base_commission_rate)}</td>
            <td>${esc(s.advance_rate)}</td>
            <td>${lag}</td>
            <td>${exMonths}</td>
            <td>${term}</td>
            <td>${esc(requiredLoas)}</td>
            <td class="mini">${eff}</td>
            <td class="mini">${esc(bandsShort)}</td>
            <td>
              <button class="btn btn-muted" data-action="edit-sched" type="button"><i class="fa-solid fa-pen"></i> Edit</button>
              <button class="btn btn-danger" data-action="delete-sched" type="button"><i class="fa-solid fa-trash"></i> Delete</button>
            </td>
          </tr>
        `;
      })
      .join("");

    els.schedulesTableBody.onclick = (e) => {
      const tr = e.target.closest("tr[data-sched-id]");
      if (!tr) return;

      const id = tr.getAttribute("data-sched-id");
      const row = schedules.find((x) => x.id === id);
      if (!row) return;

      const btn = e.target.closest("button[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      if (action === "edit-sched") openEditSchedule(row);
      if (action === "delete-sched") deleteScheduleRow(row);
    };
  }

  async function refreshSchedules() {
    try {
      const filters = currentScheduleFilters();
      await loadSchedules(filters);
      setStatus(els.schedulesMsg, `Loaded ${schedules.length} row(s).`, "ok");
    } catch (err) {
      setStatus(els.schedulesMsg, err.message || "Failed to load schedules.", "err");
    }
  }

  function resetScheduleFilters() {
    if (els.filterCarrier) els.filterCarrier.value = selectedCarrierId || "";
    if (els.filterProductLine) els.filterProductLine.value = "";
    if (els.filterPolicyType) els.filterPolicyType.value = "";
    if (els.filterItemType) els.filterItemType.value = "";
    if (els.filterParentPolicyType) els.filterParentPolicyType.value = "";
    if (els.filterAgentLevel) els.filterAgentLevel.value = "";
    if (els.filterActiveOnly) els.filterActiveOnly.checked = false;
  }

  function openEditSchedule(row) {
    setStatus(els.editSchedMsg, "", "");

    els.editSchedId.value = row.id;
    els.editSchedCarrierName.value = row.carrier_name || "";
    els.editSchedItemType.value = row.commission_item_type || "policy";
    els.editSchedAgentLevel.value = row.agent_level || "agent";
    els.editSchedProductLine.value = row.product_line || "";
    els.editSchedParentPolicyType.value = row.parent_policy_type || "";
    els.editSchedPolicyType.value = row.policy_type || "";
    els.editSchedBase.value = row.base_commission_rate ?? "";
    els.editSchedAdvance.value = row.advance_rate ?? "";
    els.editSchedTerm.value = row.term_length_months ?? "";
    els.editSchedEffFrom.value = row.effective_from || "";
    els.editSchedEffTo.value = row.effective_to || "";
    els.editSchedLagWeeks.value = row.lag_time_weeks ?? 0;
    els.editSchedExclusiveMonths.value = formatExclusiveMonths(row.exclusive_months);
    setCheckedLoas(els.editSchedRequiredLoas, row.required_loas || []);
    els.editSchedNotes.value = row.notes || "";

    const rule = row.renewal_trail_rule || { bands: [] };
    els.editSchedRenewalJson.value = JSON.stringify(rule, null, 2);

    toggleEditParentPolicyType();
    openOverlay(els.editScheduleModal);
  }

  function validateRenewalJSON(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error("Renewal JSON is not valid JSON.");
    }

    if (!obj || typeof obj !== "object") {
      throw new Error("Renewal JSON must be an object.");
    }

    if (!Array.isArray(obj.bands)) {
      throw new Error('Renewal JSON must contain a "bands" array.');
    }

    for (const b of obj.bands) {
      if (typeof b !== "object" || b == null) {
        throw new Error("Each band must be an object.");
      }
      if (!Number.isFinite(Number(b.rate))) {
        throw new Error("Each band needs a numeric rate.");
      }
      if (!Number.isFinite(Number(b.start_year))) {
        throw new Error("Each band needs a numeric start_year.");
      }
      if (!(b.end_year === null || b.end_year === undefined || Number.isFinite(Number(b.end_year)))) {
        throw new Error("Band end_year must be a number or null.");
      }
    }

    return obj;
  }

  function toggleEditParentPolicyType() {
    const isAttachment = (els.editSchedItemType?.value || "policy") === "attachment";
    if (!els.editSchedParentPolicyType) return;

    els.editSchedParentPolicyType.disabled = !isAttachment;
    if (!isAttachment) {
      els.editSchedParentPolicyType.value = "";
    }
  }

  async function saveScheduleRow() {
    setStatus(els.editSchedMsg, "", "");

    const id = els.editSchedId.value;
    const commission_item_type = (els.editSchedItemType.value || "policy").trim();
    const product_line = (els.editSchedProductLine.value || "").trim();
    if (!product_line) {
      setStatus(els.editSchedMsg, "Product line is required.", "err");
      return;
    }

    const policy_type = toNullableStr(els.editSchedPolicyType.value);
    if (!policy_type) {
      setStatus(els.editSchedMsg, "Policy type is required.", "err");
      return;
    }

    let parent_policy_type = toNullableStr(els.editSchedParentPolicyType.value);
    if (commission_item_type === "attachment" && !parent_policy_type) {
      setStatus(els.editSchedMsg, "Parent Policy Type is required for attachments.", "err");
      return;
    }
    if (commission_item_type !== "attachment") {
      parent_policy_type = null;
    }

    const base = parseNullableNum(els.editSchedBase.value);
    const adv = parseNullableNum(els.editSchedAdvance.value);

    if (!Number.isFinite(base) || base == null) {
      setStatus(els.editSchedMsg, "Base commission rate must be a valid number.", "err");
      return;
    }
    if (!Number.isFinite(adv) || adv == null) {
      setStatus(els.editSchedMsg, "Advance rate must be a valid number.", "err");
      return;
    }

    const term = parseNullableInt(els.editSchedTerm.value);
    if (term != null && (term < 1 || term > 24)) {
      setStatus(els.editSchedMsg, "Term length must be 1–24 months (or blank).", "err");
      return;
    }

    const effective_from = els.editSchedEffFrom.value || null;
    if (!effective_from) {
      setStatus(els.editSchedMsg, "Effective From is required.", "err");
      return;
    }

    const effective_to = els.editSchedEffTo.value || null;

    const lag_time_weeks = parseNullableInt(els.editSchedLagWeeks.value) ?? 0;
    if (lag_time_weeks < 0) {
      setStatus(els.editSchedMsg, "Lag time must be 0 or greater.", "err");
      return;
    }

    let exclusive_months = null;
    try {
      exclusive_months = parseExclusiveMonthsInput(els.editSchedExclusiveMonths.value);
    } catch (err) {
      setStatus(els.editSchedMsg, err.message || "Invalid exclusive months.", "err");
      return;
    }

    const required_loas = readCheckedLoas(els.editSchedRequiredLoas);

    let renewal_trail_rule;
    try {
      renewal_trail_rule = validateRenewalJSON(els.editSchedRenewalJson.value);
    } catch (err) {
      setStatus(els.editSchedMsg, err.message || "Invalid renewal JSON.", "err");
      return;
    }

    const payload = {
      commission_item_type,
      parent_policy_type,
      product_line,
      policy_type,
      base_commission_rate: round4(base),
      advance_rate: round4(adv),
      term_length_months: term,
      effective_from,
      effective_to,
      lag_time_weeks,
      exclusive_months,
      required_loas,
      renewal_trail_rule,
      notes: toNullableStr(els.editSchedNotes.value),
    };

    els.saveSchedBtn.disabled = true;
    try {
      const { error } = await supabase.from("commission_schedules").update(payload).eq("id", id);
      if (error) throw error;

      setStatus(els.editSchedMsg, "Saved.", "ok");
      await refreshSchedules();
    } catch (err) {
      setStatus(els.editSchedMsg, err.message || "Failed to save.", "err");
    } finally {
      els.saveSchedBtn.disabled = false;
    }
  }

  async function deleteScheduleRow(row) {
    const ok = confirm(
      `Delete this schedule row?\n\n${row.carrier_name} • ${row.commission_item_type || "policy"} • ${row.parent_policy_type || "(no parent)"} • ${row.policy_type || "(no policy type)"} • ${row.agent_level}`
    );
    if (!ok) return;

    try {
      const { error } = await supabase.from("commission_schedules").delete().eq("id", row.id);
      if (error) throw error;

      await refreshSchedules();
      setStatus(els.schedulesMsg, "Deleted schedule row.", "ok");
    } catch (err) {
      setStatus(els.schedulesMsg, err.message || "Failed to delete schedule row.", "err");
    }
  }

  function previewRenewalJSON() {
    try {
      const obj = buildRenewalTrailRuleJSON();
      els.jsonPreview.textContent = JSON.stringify(obj, null, 2);
      openOverlay(els.jsonPreviewModal);
    } catch (err) {
      setStatus(els.schedCreateMsg, err.message || "Invalid bands.", "err");
    }
  }

  function wireEvents() {
    els.tabCarriers?.addEventListener("click", () => showTab("carriers"));
    els.tabSchedules?.addEventListener("click", async () => {
      showTab("schedules");
      await refreshSchedules();
    });

    els.carrierSearch?.addEventListener("input", renderCarriersTable);

    els.addCarrierBtn?.addEventListener("click", addCarrier);

    els.saveCarrierBtn?.addEventListener("click", saveCarrier);
    els.cancelCarrierBtn?.addEventListener("click", () => closeOverlay(els.editCarrierModal));
    els.closeEditCarrier?.addEventListener("click", () => closeOverlay(els.editCarrierModal));
    els.editCarrierModal?.addEventListener("click", (e) => {
      if (e.target === els.editCarrierModal) closeOverlay(els.editCarrierModal);
    });

    els.addBandBtn?.addEventListener("click", () => addBand({ rate: "", start_year: 2, end_year: "" }));
    els.bandsContainer?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-band]");
      if (!btn) return;

      const row = btn.closest("[data-band]");
      row?.remove();
      ensureAtLeastOneBand();
    });

    els.addAttachmentBtn?.addEventListener("click", () => addAttachmentCard());

    els.attachmentsContainer?.addEventListener("click", (e) => {
      const removeAttachmentBtn = e.target.closest("[data-remove-attachment]");
      if (removeAttachmentBtn) {
        const card = removeAttachmentBtn.closest("[data-attachment-card]");
        card?.remove();
        renumberAttachmentCards();
        return;
      }

      const addBandBtn = e.target.closest("[data-add-attachment-band]");
      if (addBandBtn) {
        const card = addBandBtn.closest("[data-attachment-card]");
        const wrap = card?.querySelector("[data-attachment-bands]");
        if (wrap) {
          wrap.insertAdjacentHTML("beforeend", bandRowTemplate({ rate: "", start_year: 2, end_year: "" }));
        }
        return;
      }

      const removeBandBtn = e.target.closest("[data-remove-band]");
      if (removeBandBtn) {
        const row = removeBandBtn.closest("[data-band]");
        const card = removeBandBtn.closest("[data-attachment-card]");
        const wrap = card?.querySelector("[data-attachment-bands]");
        row?.remove();

        if (wrap && wrap.querySelectorAll("[data-band]").length === 0) {
          wrap.insertAdjacentHTML("beforeend", bandRowTemplate({ rate: "", start_year: 2, end_year: "" }));
        }
      }
    });

    els.previewJsonBtn?.addEventListener("click", previewRenewalJSON);
    els.closeJsonPreview?.addEventListener("click", () => closeOverlay(els.jsonPreviewModal));
    els.jsonPreviewModal?.addEventListener("click", (e) => {
      if (e.target === els.jsonPreviewModal) closeOverlay(els.jsonPreviewModal);
    });

    els.createScheduleBtn?.addEventListener("click", createScheduleBatch);

    els.refreshSchedulesBtn?.addEventListener("click", refreshSchedules);
    els.applyScheduleFilters?.addEventListener("click", refreshSchedules);
    els.resetScheduleFilters?.addEventListener("click", async () => {
      resetScheduleFilters();
      await refreshSchedules();
    });

    els.editSchedItemType?.addEventListener("change", toggleEditParentPolicyType);

    els.saveSchedBtn?.addEventListener("click", saveScheduleRow);
    els.cancelSchedBtn?.addEventListener("click", () => closeOverlay(els.editScheduleModal));
    els.closeEditSchedule?.addEventListener("click", () => closeOverlay(els.editScheduleModal));
    els.editScheduleModal?.addEventListener("click", (e) => {
      if (e.target === els.editScheduleModal) closeOverlay(els.editScheduleModal);
    });

    if (els.schedEffectiveFrom && !els.schedEffectiveFrom.value) {
      els.schedEffectiveFrom.value = todayISO();
    }
  }

  async function init() {
    wireAdminPageNavFallback();

    supabase = window.supabaseClient;
    if (!supabase) {
      console.error("supabaseClient not found on window.");
      return;
    }

    const {
      data: { session } = {},
    } = await supabase.auth.getSession();

    sessionUserId = session?.user?.id || null;

    await loadCarriers();

    addBand({ rate: "", start_year: 2, end_year: "" });

    wireEvents();
    showTab("carriers");
  }

  function start() {
    init().catch((err) => {
      console.error(err);
      setStatus(els.carrierAddMsg, err.message || "Init failed.", "err");
      setStatus(els.schedulesMsg, err.message || "Init failed.", "err");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
