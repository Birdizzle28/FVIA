console.log("[admin-carriers] loaded from file");
/* scripts/admin-carriers.js
   Works with your admin-carriers.html as provided.
   Requires:
     - window.supabaseClient (from scripts/supabase-client.js)
     - general.js can handle menu/nav; this file includes a small fallback for admin-page-nav buttons
*/

(() => {
  "use strict";

  const LEVEL_MULTIPLIERS = [
    { level: "area_manager", mult: 0.90 },
    { level: "mga",          mult: 0.85 },
    { level: "manager",      mult: 0.80 },
    { level: "mit",          mult: 0.75 },
    { level: "agent",        mult: 0.70 },
  ];

  // ---------- DOM helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

   async function uploadCarrierLogoFile(file, carrierName) {
     if (!file) return null;
   
     // bucket name you created in Supabase Storage:
     const BUCKET = "carrier-logos";
   
     // safe-ish filename
     const ext = (file.name.split(".").pop() || "png").toLowerCase();
     const safeName = String(carrierName || "carrier")
       .toLowerCase()
       .replace(/[^a-z0-9]+/g, "-")
       .replace(/(^-|-$)/g, "");
   
     const path = `${safeName}/${crypto.randomUUID()}.${ext}`;
   
     // upload
     const { error: upErr } = await supabase
       .storage
       .from(BUCKET)
       .upload(path, file, {
         cacheControl: "3600",
         upsert: false,
         contentType: file.type || undefined
       });
   
     if (upErr) throw upErr;
   
     // get PUBLIC URL (bucket must be public)
     const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
     return data?.publicUrl || null;
   }
   
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
    // numeric(6,4) compatible
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

  // ---------- App state ----------
  let supabase;
  let sessionUserId = null;

  let carriers = [];
  const carrierById = new Map();

  let schedules = [];

  // used for "click carrier -> filter schedules"
  let selectedCarrierId = "";

  // ---------- Elements ----------
  const els = {
    // tabs/panels
    tabCarriers: $("#tab-carriers"),
    tabSchedules: $("#tab-schedules"),
    panelCarriers: $("#panel-carriers"),
    panelSchedules: $("#panel-schedules"),

    // carriers form
    carrierName: $("#carrier-name"),
    carrierLogo: $("#carrier-logo"),
    carrierUrl: $("#carrier-url"),
    carrierNotes: $("#carrier-notes"),
    addCarrierBtn: $("#add-carrier-btn"),
    carrierAddMsg: $("#carrier-add-msg"),
     carrierLogoFile: $("#carrier-logo-file"),

    // carriers list
    carrierSearch: $("#carrier-search"),
    carriersTableBody: $("#carriers-table tbody"),

    // carrier edit modal
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

    // schedule create form
    schedCarrier: $("#sched-carrier"),
    schedProductLine: $("#sched-product-line"),
    schedPolicyType: $("#sched-policy-type"),
    schedTermLength: $("#sched-term-length"),
    schedFvgRate: $("#sched-fvg-rate"),
    schedAdvanceRate: $("#sched-advance-rate"),
    schedEffectiveFrom: $("#sched-effective-from"),
    schedEffectiveTo: $("#sched-effective-to"),
    schedNotes: $("#sched-notes"),
    createScheduleBtn: $("#create-schedule-btn"),
    schedCreateMsg: $("#sched-create-msg"),

    // bands builder
    bandsContainer: $("#bands-container"),
    addBandBtn: $("#add-band-btn"),
    previewJsonBtn: $("#preview-json-btn"),
    jsonPreviewModal: $("#json-preview-modal"),
    jsonPreview: $("#json-preview"),
    closeJsonPreview: $("#close-json-preview"),

    // schedules list/filters
    refreshSchedulesBtn: $("#refresh-schedules-btn"),
    filterCarrier: $("#filter-carrier"),
    filterProductLine: $("#filter-product-line"),
    filterPolicyType: $("#filter-policy-type"),
    filterAgentLevel: $("#filter-agent-level"),
    filterActiveOnly: $("#filter-active-only"),
    applyScheduleFilters: $("#apply-schedule-filters"),
    resetScheduleFilters: $("#reset-schedule-filters"),
    schedulesTableBody: $("#schedules-table tbody"),
    schedulesMsg: $("#schedules-msg"),

    // schedule edit modal
    editScheduleModal: $("#edit-schedule-modal"),
    editSchedId: $("#edit-sched-id"),
    editSchedCarrierName: $("#edit-sched-carrier-name"),
    editSchedAgentLevel: $("#edit-sched-agent-level"),
    editSchedProductLine: $("#edit-sched-product-line"),
    editSchedPolicyType: $("#edit-sched-policy-type"),
    editSchedBase: $("#edit-sched-base"),
    editSchedAdvance: $("#edit-sched-advance"),
    editSchedTerm: $("#edit-sched-term"),
    editSchedEffFrom: $("#edit-sched-effective-from"),
    editSchedEffTo: $("#edit-sched-effective-to"),
    editSchedRenewalJson: $("#edit-sched-renewal-json"),
    editSchedNotes: $("#edit-sched-notes"),
    saveSchedBtn: $("#save-sched-btn"),
    cancelSchedBtn: $("#cancel-sched-btn"),
    closeEditSchedule: $("#close-edit-schedule"),
    editSchedMsg: $("#edit-sched-msg"),
  };

  // ---------- Nav fallback (admin page buttons) ----------
  function wireAdminPageNavFallback() {
    const nav = $("#admin-page-nav");
    if (!nav) return;
    nav.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-href]");
      if (!btn) return;
      const href = btn.getAttribute("data-href");
      if (!href) return;
      if (href.endsWith("admin-carriers.html")) return; // already here
      window.location.href = href;
    });
  }

    function showTab(name) {
     const carriersPanel = els.panelCarriers;
     const schedulesPanel = els.panelSchedules;
   
     if (name === "carriers") {
       els.tabCarriers?.classList.add("active");
       els.tabSchedules?.classList.remove("active");
   
       if (carriersPanel) carriersPanel.style.display = "block";     // ✅ force visible
       if (schedulesPanel) schedulesPanel.style.display = "none";
       return;
     }
   
     // schedules
     els.tabSchedules?.classList.add("active");
     els.tabCarriers?.classList.remove("active");
   
     if (schedulesPanel) schedulesPanel.style.display = "block";     // ✅ force visible
     if (carriersPanel) carriersPanel.style.display = "none";
   }

  // ---------- Carriers ----------
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
        const logo = c.carrier_logo ? `<a href="${esc(c.carrier_logo)}" target="_blank" rel="noopener">link</a>` : "";
        const url = c.carrier_url ? `<a href="${esc(c.carrier_url)}" target="_blank" rel="noopener">${esc(c.carrier_url)}</a>` : "";
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

    // row interactions
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

      // click carrier name -> set schedules filter and switch tabs
      selectedCarrierId = id;
      if (els.filterCarrier) els.filterCarrier.value = id;
      if (els.schedCarrier) els.schedCarrier.value = id;
      showTab("schedules");
      // load schedules filtered
      refreshSchedules();
    };
  }

  function populateCarrierSelects() {
    // Create schedule carrier select
    if (els.schedCarrier) {
      els.schedCarrier.innerHTML = carriers
        .map((c) => `<option value="${esc(c.id)}">${esc(c.carrier_name)}</option>`)
        .join("");
      // preserve selectedCarrierId if set
      if (selectedCarrierId) els.schedCarrier.value = selectedCarrierId;
    }

    // Filter carrier select
    if (els.filterCarrier) {
      const opts =
        `<option value="">All</option>` +
        carriers.map((c) => `<option value="${esc(c.id)}">${esc(c.carrier_name)}</option>`).join("");
      els.filterCarrier.innerHTML = opts;
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
   
     // optional manual URL (if you kept the text box)
     const manualLogoUrl = toNullableStr(els.carrierLogo?.value);
   
     // optional uploaded file
     const file = els.carrierLogoFile?.files?.[0] || null;
   
     els.addCarrierBtn.disabled = true;
   
     try {
       let carrier_logo = manualLogoUrl;
   
       // ✅ if a file is selected, upload it and use its URL
       if (file) {
         carrier_logo = await uploadCarrierLogoFile(file, carrier_name);
       }
   
       const { error } = await supabase
         .from("carriers")
         .insert([{ carrier_name, carrier_logo, carrier_url, notes }]);
   
       if (error) throw error;
   
       // clear form
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
    els.editCarrierLogo.value = carrier.carrier_logo || "";
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
   
     // manual URL field
     const manualLogoUrl = toNullableStr(els.editCarrierLogo.value);
   
     // optional uploaded file
     const file = els.editCarrierLogoFile?.files?.[0] || null;
   
     els.saveCarrierBtn.disabled = true;
   
     try {
       let carrier_logo = manualLogoUrl;
   
       // ✅ if user picked a file, upload it and use that URL
       if (file) {
         carrier_logo = await uploadCarrierLogoFile(file, carrier_name);
       }
   
       const payload = {
         carrier_name,
         carrier_url,
         carrier_logo,
         notes,
       };
   
       const { error } = await supabase
         .from("carriers")
         .update(payload)
         .eq("id", id);
   
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

      // clear selected carrier if it was this one
      if (selectedCarrierId === carrier.id) selectedCarrierId = "";
      await loadCarriers();
      setStatus(els.carrierAddMsg, `Deleted ${carrier.carrier_name}.`, "ok");
      // refresh schedules too
      await refreshSchedules();
    } catch (err) {
      setStatus(els.carrierAddMsg, err.message || "Failed to delete carrier.", "err");
    }
  }

  // ---------- Renewal bands UI ----------
  function bandRowTemplate({ rate = "", start_year = "2", end_year = "" } = {}) {
    // end_year blank => null
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

  function readBands() {
    if (!els.bandsContainer) return [];
    const bandEls = Array.from(els.bandsContainer.querySelectorAll("[data-band]"));
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

    // sort by start_year for cleanliness
    bands.sort((a, b) => (a.start_year ?? 0) - (b.start_year ?? 0));
    return bands;
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

  // ---------- Commission schedules ----------
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

    const policy_type = toNullableStr(els.schedPolicyType?.value);
    const term_length_months = parseNullableInt(els.schedTermLength?.value);
    if (term_length_months != null && (term_length_months < 1 || term_length_months > 24)) {
      setStatus(els.schedCreateMsg, "Term length must be 1–24 months (or blank).", "err");
      return;
    }

    const fvgRate = parseNullableNum(els.schedFvgRate?.value);
    if (!Number.isFinite(fvgRate) || fvgRate == null || fvgRate <= 0) {
      setStatus(els.schedCreateMsg, "FVG base commission rate must be a positive decimal (e.g., 0.1000).", "err");
      return;
    }

    const advance_rate = parseNullableNum(els.schedAdvanceRate?.value);
    if (!Number.isFinite(advance_rate) || advance_rate == null || advance_rate < 0) {
      setStatus(els.schedCreateMsg, "Advance rate must be a valid decimal (e.g., 0.7500).", "err");
      return;
    }

    const effective_from = els.schedEffectiveFrom?.value || todayISO();
    const effective_to = els.schedEffectiveTo?.value || null;

    let renewal_trail_rule;
    try {
      renewal_trail_rule = buildRenewalTrailRuleJSON(); // {bands:[...]}
    } catch (err) {
      setStatus(els.schedCreateMsg, err.message || "Invalid renewal bands.", "err");
      return;
    }

    // read the "FVG renewal bands" once
   const baseRule = buildRenewalTrailRuleJSON(); // { bands: [...] }
   
   // create 5 rows
   const rows = LEVEL_MULTIPLIERS.map(({ level, mult }) => {
     const base_commission_rate = round4(fvgRate * mult);
   
     // ✅ scale renewal band rates per agent level (same mult as base)
     const renewal_trail_rule = {
       bands: (baseRule.bands || []).map(b => ({
         ...b,
         rate: round4(Number(b.rate) * mult),
       }))
     };
   
     return {
       carrier_id: carrier.id,
       carrier_name: carrier.carrier_name,
       product_line,
       policy_type,
       agent_level: level,
       base_commission_rate,
       advance_rate: round4(advance_rate),
       effective_from,
       effective_to,
       created_by: sessionUserId,
       notes: toNullableStr(els.schedNotes?.value),
       renewal_trail_rule,
       term_length_months,
     };
   });

    els.createScheduleBtn.disabled = true;
    try {
      const { error } = await supabase.from("commission_schedules").insert(rows);
      if (error) throw error;

      setStatus(els.schedCreateMsg, "Created 5 rows.", "ok");

      // switch to schedules tab and load
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
    const carrier_id = els.filterCarrier?.value || "";
    const product_line = (els.filterProductLine?.value || "").trim();
    const policy_type = (els.filterPolicyType?.value || "").trim();
    const agent_level = els.filterAgentLevel?.value || "";
    const activeOnly = !!els.filterActiveOnly?.checked;
    return { carrier_id, product_line, policy_type, agent_level, activeOnly };
  }

  async function loadSchedules(filters) {
    setStatus(els.schedulesMsg, "", "");

    let q = supabase
      .from("commission_schedules")
      .select(
        "id, carrier_id, carrier_name, product_line, policy_type, agent_level, base_commission_rate, advance_rate, effective_from, effective_to, renewal_trail_rule, term_length_months, notes, created_at"
      )
      .order("carrier_name", { ascending: true })
      .order("product_line", { ascending: true })
      .order("policy_type", { ascending: true })
      .order("agent_level", { ascending: true })
      .order("effective_from", { ascending: false })
      .limit(500);

    if (filters.carrier_id) q = q.eq("carrier_id", filters.carrier_id);
    if (filters.agent_level) q = q.eq("agent_level", filters.agent_level);

    if (filters.product_line) q = q.ilike("product_line", `%${filters.product_line}%`);
    if (filters.policy_type) q = q.ilike("policy_type", `%${filters.policy_type}%`);

    if (filters.activeOnly) {
      const t = todayISO();
      // effective_to is null OR effective_to >= today
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
        <tr><td colspan="10" class="mini">No schedules found for the current filters.</td></tr>
      `;
      return;
    }

    els.schedulesTableBody.innerHTML = schedules
      .map((s) => {
        const eff = `${esc(s.effective_from)}${s.effective_to ? " → " + esc(s.effective_to) : " → (open)"}`;
        const term = s.term_length_months == null ? "" : esc(s.term_length_months);
        const bandsShort = formatBandsShort(s.renewal_trail_rule);
        return `
          <tr data-sched-id="${esc(s.id)}">
            <td>${esc(s.carrier_name)}</td>
            <td>${esc(s.product_line)}</td>
            <td>${esc(s.policy_type ?? "")}</td>
            <td><span class="pill">${esc(s.agent_level)}</span></td>
            <td>${esc(s.base_commission_rate)}</td>
            <td>${esc(s.advance_rate)}</td>
            <td>${term}</td>
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
    if (els.filterAgentLevel) els.filterAgentLevel.value = "";
    if (els.filterActiveOnly) els.filterActiveOnly.checked = false;
  }

  // ---------- Edit schedule modal ----------
  function openEditSchedule(row) {
    setStatus(els.editSchedMsg, "", "");
    els.editSchedId.value = row.id;
    els.editSchedCarrierName.value = row.carrier_name || "";
    els.editSchedAgentLevel.value = row.agent_level || "agent";
    els.editSchedProductLine.value = row.product_line || "";
    els.editSchedPolicyType.value = row.policy_type || "";
    els.editSchedBase.value = row.base_commission_rate ?? "";
    els.editSchedAdvance.value = row.advance_rate ?? "";
    els.editSchedTerm.value = row.term_length_months ?? "";
    els.editSchedEffFrom.value = row.effective_from || "";
    els.editSchedEffTo.value = row.effective_to || "";
    els.editSchedNotes.value = row.notes || "";

    const rule = row.renewal_trail_rule || { bands: [] };
    els.editSchedRenewalJson.value = JSON.stringify(rule, null, 2);

    openOverlay(els.editScheduleModal);
  }

  function validateRenewalJSON(text) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      throw new Error("Renewal JSON is not valid JSON.");
    }
    if (!obj || typeof obj !== "object") throw new Error("Renewal JSON must be an object.");
    if (!Array.isArray(obj.bands)) throw new Error('Renewal JSON must contain a "bands" array.');
    for (const b of obj.bands) {
      if (typeof b !== "object" || b == null) throw new Error("Each band must be an object.");
      if (!Number.isFinite(Number(b.rate))) throw new Error("Each band needs a numeric rate.");
      if (!Number.isFinite(Number(b.start_year))) throw new Error("Each band needs a numeric start_year.");
      // end_year can be null
      if (!(b.end_year === null || b.end_year === undefined || Number.isFinite(Number(b.end_year)))) {
        throw new Error("Band end_year must be a number or null.");
      }
    }
    return obj;
  }

  async function saveScheduleRow() {
    setStatus(els.editSchedMsg, "", "");

    const id = els.editSchedId.value;
    const product_line = (els.editSchedProductLine.value || "").trim();
    if (!product_line) {
      setStatus(els.editSchedMsg, "Product line is required.", "err");
      return;
    }

    const policy_type = toNullableStr(els.editSchedPolicyType.value);

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

    let renewal_trail_rule;
    try {
      renewal_trail_rule = validateRenewalJSON(els.editSchedRenewalJson.value);
    } catch (err) {
      setStatus(els.editSchedMsg, err.message || "Invalid renewal JSON.", "err");
      return;
    }

    const payload = {
      product_line,
      policy_type,
      base_commission_rate: round4(base),
      advance_rate: round4(adv),
      term_length_months: term,
      effective_from,
      effective_to,
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
      `Delete this schedule row?\n\n${row.carrier_name} • ${row.product_line} • ${row.policy_type || "(no policy type)"} • ${row.agent_level}`
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

  // ---------- JSON preview ----------
  function previewRenewalJSON() {
    try {
      const obj = buildRenewalTrailRuleJSON();
      els.jsonPreview.textContent = JSON.stringify(obj, null, 2);
      openOverlay(els.jsonPreviewModal);
    } catch (err) {
      setStatus(els.schedCreateMsg, err.message || "Invalid bands.", "err");
    }
  }

  // ---------- Wiring ----------
  function wireEvents() {
    // tabs
    els.tabCarriers?.addEventListener("click", () => showTab("carriers"));
    els.tabSchedules?.addEventListener("click", async () => {
      showTab("schedules");
      await refreshSchedules();
    });

    // carrier search
    els.carrierSearch?.addEventListener("input", renderCarriersTable);

    // add carrier
    els.addCarrierBtn?.addEventListener("click", addCarrier);

    // carrier edit modal
    els.saveCarrierBtn?.addEventListener("click", saveCarrier);
    els.cancelCarrierBtn?.addEventListener("click", () => closeOverlay(els.editCarrierModal));
    els.closeEditCarrier?.addEventListener("click", () => closeOverlay(els.editCarrierModal));
    els.editCarrierModal?.addEventListener("click", (e) => {
      if (e.target === els.editCarrierModal) closeOverlay(els.editCarrierModal);
    });

    // bands
    els.addBandBtn?.addEventListener("click", () => addBand({ rate: "", start_year: 2, end_year: "" }));
    els.bandsContainer?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-remove-band]");
      if (!btn) return;
      const row = btn.closest("[data-band]");
      row?.remove();
      ensureAtLeastOneBand();
    });

    els.previewJsonBtn?.addEventListener("click", previewRenewalJSON);
    els.closeJsonPreview?.addEventListener("click", () => closeOverlay(els.jsonPreviewModal));
    els.jsonPreviewModal?.addEventListener("click", (e) => {
      if (e.target === els.jsonPreviewModal) closeOverlay(els.jsonPreviewModal);
    });

    // create schedule batch
    els.createScheduleBtn?.addEventListener("click", createScheduleBatch);

    // schedules filters
    els.refreshSchedulesBtn?.addEventListener("click", refreshSchedules);
    els.applyScheduleFilters?.addEventListener("click", refreshSchedules);
    els.resetScheduleFilters?.addEventListener("click", async () => {
      resetScheduleFilters();
      await refreshSchedules();
    });

    // edit schedule modal
    els.saveSchedBtn?.addEventListener("click", saveScheduleRow);
    els.cancelSchedBtn?.addEventListener("click", () => closeOverlay(els.editScheduleModal));
    els.closeEditSchedule?.addEventListener("click", () => closeOverlay(els.editScheduleModal));
    els.editScheduleModal?.addEventListener("click", (e) => {
      if (e.target === els.editScheduleModal) closeOverlay(els.editScheduleModal);
    });

    // helpful defaults
    if (els.schedEffectiveFrom && !els.schedEffectiveFrom.value) {
      els.schedEffectiveFrom.value = todayISO();
    }
  }

  // ---------- Init ----------
  async function init() {
    wireAdminPageNavFallback();

    supabase = window.supabaseClient;
    if (!supabase) {
      console.error("supabaseClient not found on window.");
      return;
    }

    // get session user id (for created_by)
    const { data: { session } = {} } = await supabase.auth.getSession();
    sessionUserId = session?.user?.id || null;

    // load carriers first
    await loadCarriers();

    // init band rows
    addBand({ rate: "", start_year: 2, end_year: "" });

    // wire events
    wireEvents();
   showTab("carriers");
    // schedules default load only if tab is opened; but if user lands and clicks schedules it refreshes.
    // If you prefer immediate load, uncomment:
    // await refreshSchedules();
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
     start(); // DOM already ready
   }
})();
