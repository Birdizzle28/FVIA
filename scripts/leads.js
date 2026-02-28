// scripts/leads.js — DROP-IN REPLACEMENT

let agentProfile = null;
let agentCurrentPage = 1;
let agentTotalPages = 1;
const PAGE_SIZE = 25;

let contactChoices = null;
let dncChoices = null;

let bulkSelecting = false;

let contacts = [];
let selectMode = false;
const selectedIds = new Set();

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

/* Set DNC message text */
function setDncMsg(text, isError = false) {
  const el = $("#dnc-msg");
  if (!el) return;
  el.style.color = isError ? "#b00020" : "";
  el.textContent = text || "";
}

/* Normalize last-7-digit input */
function normalizeLocal7Input(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 7);
}

/* Render DNC result box */
function showDncResult({ onList, areaCode, local7 }) {
  const box = $("#dnc-result");
  const dot = $("#dnc-dot");
  const title = $("#dnc-result-title");
  const sub = $("#dnc-result-sub");
  if (!box || !dot || !title || !sub) return;

  box.style.display = "flex";

  if (onList) {
    dot.style.background = "#ff2a2a";
    dot.style.boxShadow = "0 0 10px rgba(255,42,42,.85), 0 0 18px rgba(255,42,42,.6)";
    title.textContent = "ON NATIONAL DNC (Do NOT call)";
  } else {
    dot.style.background = "#27b7ff";
    dot.style.boxShadow = "0 0 10px rgba(39,183,255,.8), 0 0 18px rgba(39,183,255,.55)";
    title.textContent = "NOT on our DNC list (OK to call)";
  }

  sub.textContent = `Checked: (${areaCode}) ${String(local7).padStart(7, "0")}`;
}

/* Load DNC area codes into dropdown */
async function loadDncAreaCodesIntoDropdown() {
  const sel = $("#dnc-area-code");
  if (!sel) return;

  const { data, error } = await supabase
    .from("dnc_area_codes")
    .select("area_code")
    .order("area_code", { ascending: true });

  if (error) {
    console.error("load dnc_area_codes error:", error);
    setDncMsg("Failed to load area codes.", true);
    return;
  }

  const codes = (data || [])
    .map(r => String(r.area_code || "").trim())
    .filter(Boolean);

  sel.innerHTML = `<option value="" disabled selected hidden></option>`;
  for (const code of codes) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    sel.appendChild(opt);
  }

  if (window.Choices) {
    if (dncChoices) dncChoices.destroy();
    dncChoices = new Choices(sel, {
      searchEnabled: true,
      shouldSort: true,
      placeholder: true,
      placeholderValue: "Search area codes…",
      itemSelectText: "",
    });
  }

  initFloatingLabels(document);
}

/* Check a number against national DNC ranges */
async function checkNationalDnc() {
  const areaCode = ($("#dnc-area-code")?.value || "").trim();
  const localRaw = normalizeLocal7Input($("#dnc-local7")?.value);

  setDncMsg("");

  if (!areaCode) return setDncMsg("Pick an area code first (only what we have).", true);
  if (localRaw.length !== 7) return setDncMsg("Enter exactly 7 digits for the last 7 digits.", true);

  const local7 = parseInt(localRaw, 10);

  const { data, error } = await supabase
    .from("dnc_ranges")
    .select("area_code")
    .eq("area_code", areaCode)
    .lte("start_local7", local7)
    .gte("end_local7", local7)
    .limit(1);

  if (error) {
    console.error("dnc_ranges check error:", error);
    setDncMsg("DNC check failed.", true);
    return;
  }

  showDncResult({ onList: (data || []).length > 0, areaCode, local7: localRaw });
}

/* Bind DNC UI events */
function initDncUi() {
  const btn = $("#dnc-check-btn");
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  const local = $("#dnc-local7");

  local?.addEventListener("input", () => {
    const clean = normalizeLocal7Input(local.value);
    local.value = clean;
    local.closest(".field")?.classList.toggle("filled", !!clean);
  });

  btn.addEventListener("click", checkNationalDnc);

  local?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    checkNationalDnc();
  });
}

/* Export selected leads via Netlify function */
async function exportSelectedLeads(format) {
  const ids = getSelectedLeadIds();
  if (!ids.length) return;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return alert("Please log in again.");

  const url =
    `/.netlify/functions/exportLeads?format=${encodeURIComponent(format)}` +
    `&ids=${encodeURIComponent(JSON.stringify(ids))}`;

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (!resp.ok) {
    const txt = await resp.text();
    return alert(txt || `Export failed (${resp.status})`);
  }

  if (format === "print") {
    const html = await resp.text();
    const w = window.open("", "_blank");
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }

  const blob = await resp.blob();
  const blobUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = (format === "csv") ? `FVIA_Leads_${ids.length}.csv` : `FVIA_Leads_${ids.length}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
}

/* Get selected lead IDs */
function getSelectedLeadIds() {
  return $$(".lead-checkbox:checked").map(cb => cb.dataset.id).filter(Boolean);
}

/* Update bulk UI state for leads */
function updateLeadBulkUi() {
  const count = getSelectedLeadIds().length;

  const archiveBtn = $("#agent-archive-btn");
  const exportWrap = $("#agent-export-wrap");
  const exportMenu = $("#agent-export-menu");

  if (archiveBtn) archiveBtn.style.display = count > 0 ? "inline-flex" : "none";
  if (exportWrap) exportWrap.style.display = count > 0 ? "inline-block" : "none";
  if (count === 0 && exportMenu) exportMenu.style.display = "none";

  const master = $("#select-all");
  const boxes = $$(".lead-checkbox");
  if (master) master.checked = boxes.length > 0 && boxes.every(b => b.checked);
}

/* Bind export dropdown open/close */
function initExportDropdown() {
  const wrap = $("#agent-export-wrap");
  const btn = $("#agent-export-btn");
  const menu = $("#agent-export-menu");
  if (!wrap || !btn || !menu) return;
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    if (getSelectedLeadIds().length === 0) return;
    menu.style.display = (menu.style.display === "block") ? "none" : "block";
  });

  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) menu.style.display = "none";
  });
}

/* Bind export action buttons */
function initLeadExportButtons() {
  const map = [
    ["pdf", "#export-pdf,[data-export='pdf'],[data-export-format='pdf']"],
    ["csv", "#export-csv,[data-export='csv'],[data-export-format='csv']"],
    ["print", "#export-print,[data-export='print'],[data-export-format='print']"],
  ];

  for (const [fmt, selector] of map) {
    for (const btn of $$(selector)) {
      if (btn.dataset.boundExport === "1") continue;
      btn.dataset.boundExport = "1";
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (!getSelectedLeadIds().length) return alert("Select at least one lead first.");
        await exportSelectedLeads(fmt);
        const menu = $("#agent-export-menu");
        if (menu) menu.style.display = "none";
      });
    }
  }
}

/* Escape HTML for safe rendering */
function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* Convert textarea lines to array */
function linesToArray(v) {
  return String(v || "").split("\n").map(s => s.trim()).filter(Boolean);
}

/* Convert array to textarea lines */
function arrToLines(arr) {
  return (arr || []).filter(Boolean).join("\n");
}

/* Fetch contact leads (restricted to assigned_to = me) */
async function fetchContactLeads(contactId) {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("leads")
    .select("id, created_at, product_type, lead_type")
    .eq("contact_id", contactId)
    .eq("assigned_to", user.id)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("fetchContactLeads error:", error);
    return [];
  }
  return data || [];
}

/* Fetch contact policies */
async function fetchContactPolicies(contactId) {
  const { data, error } = await supabase
    .from("policies")
    .select("id, policy_number, product_line, policy_type, carrier_name, created_at")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("fetchContactPolicies error:", error);
    return [];
  }
  return data || [];
}

/* Check whether contact is on internal DNC */
async function contactHasInternalDnc(contactId) {
  const { data, error } = await supabase
    .from("internal_dnc")
    .select("id")
    .eq("contact_id", contactId)
    .eq("is_active", true)
    .limit(1);

  if (error) {
    console.error("DNC check failed", error);
    return true;
  }
  return (data || []).length > 0;
}

/* Check duplicate by first+last and phone overlap */
async function duplicateContactExists(first, last, phones) {
  if (!first || !last || !phones?.length) return false;
  const digits = phones.map(p => p.replace(/\D/g, "").slice(-10));

  const { data, error } = await supabase
    .from("contacts")
    .select("id, phones")
    .ilike("first_name", first.trim())
    .ilike("last_name", last.trim());

  if (error) {
    console.error(error);
    return true;
  }

  return (data || []).some(c =>
    (c.phones || []).some(p => digits.includes(p.replace(/\D/g, "").slice(-10)))
  );
}

/* Block creating new lead if same name+phone exists with active internal DNC */
async function duplicateOnInternalDnc(first, last, phones) {
  if (!first || !last || !phones?.length) return false;

  const norm = (s) => (s || "").trim().toLowerCase();
  const digits10 = (s) => String(s || "").replace(/\D/g, "").slice(-10);

  const phoneDigits = phones.map(digits10).filter(Boolean);
  if (!phoneDigits.length) return false;

  const { data, error } = await supabase
    .from("contacts")
    .select(`
      id,
      first_name,
      last_name,
      phones,
      internal_dnc:internal_dnc!internal_dnc_contact_id_fkey ( id, is_active )
    `)
    .ilike("first_name", norm(first))
    .ilike("last_name", norm(last));

  if (error) {
    console.error("DNC duplicate check failed:", error);
    return true;
  }

  return (data || []).some(c => {
    const hasActiveDnc = (c.internal_dnc || []).some(d => d.is_active);
    if (!hasActiveDnc) return false;
    const existingPhones = (c.phones || []).map(digits10);
    return existingPhones.some(p => phoneDigits.includes(p));
  });
}

/* Convert phone to E.164-ish */
function toE164(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

/* Escape vCard fields */
function vcardEscape(v) {
  return String(v || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/* Convert contact to vCard */
function contactToVCard(c) {
  const first = c.first_name || "";
  const last = c.last_name || "";
  const org = "FVG Prospect";

  const phones = Array.isArray(c.phones) ? c.phones : (c.phones ? [c.phones] : []);
  const emails = Array.isArray(c.emails) ? c.emails : (c.emails ? [c.emails] : []);

  const addr1 = (c.address_line1 || "").trim();
  const addr2 = (c.address_line2 || "").trim();
  const street = [addr1, addr2].filter(Boolean).join(" ").trim();
  const city = (c.city || "").trim();
  const state = (c.state || "").trim();
  const zip = (c.zip || "").trim();
  const hasAddress = !!(street || city || state || zip);

  const note = (c.notes || "").trim();

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${vcardEscape(last)};${vcardEscape(first)};;;`,
    `FN:${vcardEscape([first, last].filter(Boolean).join(" ") || "Contact")}`,
    `ORG:${vcardEscape(org)}`,
    ...phones.map(p => `TEL;TYPE=CELL:${toE164(p) || p}`),
    ...emails.map(e => `EMAIL;TYPE=INTERNET:${vcardEscape(e)}`),
    ...(hasAddress
      ? [`ADR;TYPE=HOME:;;${vcardEscape(street)};${vcardEscape(city)};${vcardEscape(state)};${vcardEscape(zip)};USA`]
      : []),
    ...(note ? [`NOTE:${vcardEscape(note)}`] : []),
    "END:VCARD",
  ];

  return lines.join("\r\n");
}

/* Download a text blob */
function downloadText(filename, text, mime = "text/vcard;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* Render DNC dot HTML */
function dotHtml(needsDncCheck) {
  const cls = needsDncCheck ? "dnc-dot dnc-dot--bad" : "dnc-dot dnc-dot--ok";
  const label = needsDncCheck ? "Needs DNC check" : "DNC OK";
  return `<span class="${cls}" title="${label}" aria-label="${label}"></span>`;
}

/* Determine DNC state for a lead via linked contact */
function leadNeedsDnc(lead, contactMap) {
  const c = lead.contact_id ? contactMap.get(lead.contact_id) : null;
  if (!c) return true;

  const v = c.needs_dnc_check;
  if (v === null || v === undefined) return true;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return true;
}

/* Floating label init */
function initFloatingLabels(scope = document) {
  scope.querySelectorAll(".field select, .field input, .field textarea").forEach((el) => {
    const parent = el.closest(".field");
    const set = () => {
      if (!parent) return;
      const hasValue = el.tagName === "SELECT" ? !!el.value : !!String(el.value || "").trim();
      parent.classList.toggle("filled", hasValue);
    };
    el.addEventListener("change", set);
    el.addEventListener("input", set);
    set();
  });
}

/* Format US phone for display */
function formatUSPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "").slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

/* Collect phone values (digits only) */
function getPhoneValues() {
  return Array.from(document.querySelectorAll(".lead-phone-input"))
    .map(i => String(i.value || "").replace(/\D/g, ""))
    .filter(v => v.length > 0);
}

/* Add a phone input row */
function renderPhoneField(value = "") {
  const phoneList = $("#phone-list");
  if (!phoneList) return;

  const wrap = document.createElement("div");
  wrap.className = "field phone-field";
  wrap.innerHTML = `
    <div class="phone-row">
      <input type="tel" class="lead-phone-input" placeholder=" " inputmode="tel" autocomplete="tel">
      <button type="button" class="remove-phone" aria-label="Remove phone">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
    <label>Phone</label>
  `;

  const input = wrap.querySelector("input");
  const removeBtn = wrap.querySelector(".remove-phone");

  input.value = value;

  input.addEventListener("input", () => {
    input.value = formatUSPhone(input.value);
    wrap.classList.toggle("filled", !!input.value.trim());
  });

  removeBtn.addEventListener("click", () => {
    wrap.remove();
    if ($$(".lead-phone-input").length === 0) renderPhoneField("");
  });

  phoneList.appendChild(wrap);
  wrap.classList.toggle("filled", !!input.value.trim());
}

/* Initialize phone UI */
function initPhonesUI() {
  const phoneList = $("#phone-list");
  const addBtn = $("#add-phone");
  if (!phoneList || !addBtn) return;

  if (phoneList.children.length === 0) renderPhoneField("");
  addBtn.addEventListener("click", () => renderPhoneField(""));
}

/* Get nav buttons */
const getNavButtons = () => ({
  view: $("#nav-view"),
  submit: $("#nav-submit"),
  request: $("#nav-request"),
  contacts: $("#nav-contacts"),
  dnc: $("#nav-dnc"),
});

/* Get page sections */
const getSections = () => ({
  view: $("#lead-viewer-section"),
  submit: $("#submit-lead-section"),
  request: $("#request-leads-section"),
  contacts: $("#contacts-section"),
  dnc: $("#dnc-list-section"),
});

/* Hide all sections */
function hideAll() {
  const secs = getSections();
  for (const el of Object.values(secs)) if (el) el.style.display = "none";
  const navs = getNavButtons();
  for (const btn of Object.values(navs)) btn?.classList.remove("active");
}

/* Show one section */
function showSection(name) {
  const secs = getSections();
  const navs = getNavButtons();
  hideAll();
  if (secs[name]) secs[name].style.display = "block";
  navs[name]?.classList.add("active");
}

/* Initialize Agent Hub dropdown */
function initAgentHubMenu() {
  const toggle = $("#agent-hub-toggle");
  const menu = $("#agent-hub-menu");
  if (!toggle || !menu) return;

  menu.style.display = "none";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = (menu.style.display === "block") ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) menu.style.display = "none";
  });
}

/* Close overlays on backdrop/close click */
function closeOverlaysOnClicks() {
  document.addEventListener("click", (e) => {
    if (!e.target.matches("[data-close], .overlay-backdrop")) return;
    const ov = e.target.closest(".overlay");
    if (!ov) return;
    ov.classList.remove("open");
    ov.setAttribute("aria-hidden", "true");
  });
}

/* Fetch agent profile row */
async function fetchAgentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from("agents").select("*").eq("id", user.id).single();
  if (error) {
    console.error(error);
    return null;
  }
  return data;
}

/* Initialize contact picker select */
async function initContactPicker() {
  const el = $("#contact-picker");
  if (!el) return;

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, phones, emails")
    .eq("owning_agent_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("contact picker load error:", error);
    return;
  }

  el.innerHTML = `<option value="">New contact (auto-create)</option>`;
  for (const c of (data || [])) {
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(No name)";
    const phone = c.phones?.[0] ? ` • ${c.phones[0]}` : "";
    const email = c.emails?.[0] ? ` • ${c.emails[0]}` : "";
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${name}${phone}${email}`;
    el.appendChild(opt);
  }

  if (window.Choices) {
    if (contactChoices) contactChoices.destroy();
    contactChoices = new Choices(el, {
      searchEnabled: true,
      shouldSort: false,
      placeholder: true,
      placeholderValue: "Search contacts…",
      itemSelectText: "",
    });

    const sync = () => {
      const field = el.closest(".field");
      if (!field) return;
      field.classList.toggle("filled", String(el.value || "").trim().length > 0);
    };

    ["change", "input", "blur"].forEach(evt => el.addEventListener(evt, sync));
    sync();
    setTimeout(sync, 0);
    setTimeout(sync, 50);
  }

  initFloatingLabels(document);
}

/* Digits last-10 helper */
function digits10(v) {
  return String(v || "").replace(/\D/g, "").slice(-10);
}

/* Convert phone to area + local7 parts */
function phoneToAreaAndLocal7(phone) {
  const d = digits10(phone);
  if (d.length !== 10) return null;
  const areaCode = d.slice(0, 3);
  const local7Str = d.slice(3);
  const local7Int = parseInt(local7Str, 10);
  return { areaCode, local7Str, local7Int };
}

/* Check one phone against national DNC table */
async function isPhoneOnNationalDnc(phone) {
  const parts = phoneToAreaAndLocal7(phone);
  if (!parts) return false;

  const { areaCode, local7Int } = parts;

  const { data, error } = await supabase
    .from("dnc_ranges")
    .select("area_code")
    .eq("area_code", areaCode)
    .lte("start_local7", local7Int)
    .gte("end_local7", local7Int)
    .limit(1);

  if (error) {
    console.error("dnc_ranges check error:", error);
    return true;
  }

  return (data || []).length > 0;
}

/* Check multiple phones: any match => on DNC */
async function phonesOnNationalDnc(phones) {
  const list = Array.isArray(phones) ? phones : [];
  for (const p of list) if (await isPhoneOnNationalDnc(p)) return true;
  return false;
}

/* Read contacts.needs_dnc_check safely */
async function getContactNeedsDnc(contactId) {
  const { data, error } = await supabase
    .from("contacts")
    .select("needs_dnc_check")
    .eq("id", contactId)
    .single();

  if (error) {
    console.error("getContactNeedsDnc error:", error);
    return true;
  }
  return !!data?.needs_dnc_check;
}

/* Ensure contact exists: create if none selected */
async function ensureContactIdFromLeadForm() {
  const picker = $("#contact-picker");
  const chosenId = picker?.value || "";
  if (chosenId) return chosenId;

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not logged in.");

  const phones = getPhoneValues();
  const onNationalDnc = await phonesOnNationalDnc(phones);

  const contactPayload = {
    first_name: $("#lead-first")?.value?.trim() || null,
    last_name: $("#lead-last")?.value?.trim() || null,
    phones: phones.length ? phones : null,
    owning_agent_id: user.id,
    address_line1: $("#lead-address")?.value?.trim() || null,
    address_line2: null,
    city: $("#lead-city")?.value?.trim() || null,
    state: $("#lead-state")?.value || null,
    zip: $("#lead-zip")?.value?.trim() || null,
    needs_dnc_check: onNationalDnc,
  };

  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert(contactPayload)
    .select("id, needs_dnc_check")
    .single();

  if (error) {
    console.error("create contact error:", error);
    throw error;
  }

  await initContactPicker();
  return inserted.id;
}

/* Update pagination controls */
function updatePaginationControls() {
  const label = $("#agent-current-page");
  const prev = $("#agent-prev-page");
  const next = $("#agent-next-page");
  if (label) label.textContent = `Page ${agentCurrentPage}`;
  if (prev) prev.disabled = agentCurrentPage === 1;
  if (next) next.disabled = agentCurrentPage === agentTotalPages;
}

/* Load agent leads into table */
async function loadAgentLeads() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  let { data: leads, error } = await supabase
    .from("leads")
    .select(`
      *,
      assigned_agent:assigned_to ( id, first_name, last_name ),
      contacts:contact_id (
        id,
        needs_dnc_check,
        internal_dnc:internal_dnc!internal_dnc_contact_id_fkey ( id )
      )
    `)
    .eq("assigned_to", user.id)
    .eq("archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("load leads error:", error);
    leads = [];
  }

  leads = (leads || []).filter(l => (l.contacts?.internal_dnc || []).length === 0);

  agentTotalPages = Math.max(1, Math.ceil((leads.length || 0) / PAGE_SIZE));
  if (agentCurrentPage > agentTotalPages) agentCurrentPage = agentTotalPages;

  const start = (agentCurrentPage - 1) * PAGE_SIZE;
  const page = leads.slice(start, start + PAGE_SIZE);

  const tbody = $("#agent-leads-table tbody");
  if (!tbody) return;

  const contactMap = new Map();
  for (const l of leads) if (l.contacts?.id) contactMap.set(l.contacts.id, l.contacts);

  tbody.innerHTML = "";
  for (const l of page) {
    const needsDnc = leadNeedsDnc(l, contactMap);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="lead-checkbox" data-id="${l.id}"></td>
      <td class="dnc-cell"><div class="cell">${dotHtml(needsDnc)}</div></td>
      <td><div class="cell">${l.created_at ? new Date(l.created_at).toLocaleDateString() : ""}</div></td>
      <td><div class="cell">${
        l.assigned_agent ? `${l.assigned_agent.first_name || ""} ${l.assigned_agent.last_name || ""}`.trim() : ""
      }</div></td>
      <td><div class="cell">${escapeHtml(l.first_name || "")}</div></td>
      <td><div class="cell">${escapeHtml(l.last_name || "")}</div></td>
      <td><div class="cell">${l.age ?? ""}</div></td>
      <td><div class="cell">${escapeHtml((l.phone || []).join(", "))}</div></td>
      <td><div class="cell">${escapeHtml(l.address || "")}</div></td>
      <td><div class="cell">${escapeHtml(l.city || "")}</div></td>
      <td><div class="cell">${escapeHtml(l.state || "")}</div></td>
      <td><div class="cell">${escapeHtml(l.zip || "")}</div></td>
      <td><div class="cell">${escapeHtml(l.lead_type || "")}</div></td>
      <td><div class="cell">${escapeHtml(l.product_type || "")}</div></td>
      <td><div class="cell">${escapeHtml(l.notes || "")}</div></td>
    `;
    tbody.appendChild(tr);
  }

  for (const cb of $$(".lead-checkbox")) {
    cb.addEventListener("change", () => {
      if (bulkSelecting) return;
      updateLeadBulkUi();
    });
  }

  updateLeadBulkUi();
  updatePaginationControls();
}

/* Bind select-all checkbox */
function initSelectAll() {
  const master = $("#select-all");
  if (!master) return;
  if (master.dataset.bound === "1") return;
  master.dataset.bound = "1";

  master.addEventListener("change", () => {
    bulkSelecting = true;
    const on = master.checked;
    for (const cb of $$(".lead-checkbox")) cb.checked = on;
    bulkSelecting = false;
    updateLeadBulkUi();
  });
}

/* Archive selected leads */
async function archiveSelectedLeads() {
  const ids = $$(".lead-checkbox:checked").map(cb => cb.dataset.id).filter(Boolean);
  if (!ids.length) return alert("Select at least one lead.");

  const warning =
`⚠️ WARNING: Archive Leads

You are about to archive ${ids.length} lead(s).

• Archived leads will NO LONGER be visible to you
• They CANNOT be restored by you
• They still count toward lead history & reporting

This action is effectively permanent for agents.

Do you want to continue?`;

  if (!confirm(warning)) return;

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return alert("You are not logged in.");

  const { error } = await supabase
    .from("leads")
    .update({ archived: true, archived_at: new Date().toISOString(), archived_by: user.id })
    .in("id", ids)
    .eq("assigned_to", user.id);

  if (error) {
    console.error(error);
    return alert("Failed to archive leads.");
  }

  alert(`Archived ${ids.length} lead(s).`);
  const sa = $("#select-all");
  if (sa) sa.checked = false;

  await loadAgentLeads();
}

const NOTE_STATUS = [
  "No Answer",
  "Answered",
  "No Answer (Door Knock)",
  "Answered (Door Knock)",
  "Called Back",
  "Appointment",
  "Straight to Voicemail",
  "Dead Air",
  "Wrong Number",
  "Other",
];

/* Convert status to abbreviations */
function statusAbbr(s) {
  const map = {
    "No Answer": "NA",
    "Answered": "A",
    "No Answer (Door Knock)": "NA(DK)",
    "Answered (Door Knock)": "A(DK)",
    "Straight to Voicemail": "STV",
    "Called Back": "CB",
    "Dead Air": "DA",
    "Wrong Number": "WN",
    "Appointment": "Appt",
    "Other": "O",
  };
  return map[s] || "O";
}

/* Status to color class */
function statusColorClass(s) {
  const blue = new Set(["Answered", "Answered (Door Knock)", "Called Back", "Appointment"]);
  const red = new Set(["No Answer", "Straight to Voicemail", "No Answer (Door Knock)", "Dead Air", "Wrong Number"]);
  if (blue.has(s)) return "note-pill--blue";
  if (red.has(s)) return "note-pill--red";
  return "note-pill--yellow";
}

/* Format local datetime */
function formatLocalDateTime(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  const opt = { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, { ...opt, timeZone: tz || undefined }).format(d);
}

/* Format local long datetime */
function formatLocalLong(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  const opt = { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" };
  return new Intl.DateTimeFormat(undefined, { ...opt, timeZone: tz || undefined }).format(d);
}

/* Fetch appointments for a contact */
async function fetchContactAppointments(contactId) {
  const { data, error } = await supabase
    .from("appointments")
    .select("id, scheduled_for, ends_at, location_type, url")
    .eq("contact_id", contactId)
    .order("scheduled_for", { ascending: true })
    .limit(300);

  if (error) {
    console.error("fetchContactAppointments error:", error);
    return [];
  }
  return data || [];
}

/* Fetch structured notes for a contact */
async function fetchContactNoteDetails(contactId) {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return [];

  const { data, error } = await supabase
    .from("contact_notes_details")
    .select("*")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("fetchContactNoteDetails error:", error);
    return [];
  }
  return data || [];
}

/* Insert structured note */
async function insertContactNote({ contactId, status, details, phone }) {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not logged in.");

  const payload = {
    contact_id: contactId,
    agent_id: user.id,
    status,
    details: (details || "").trim() || null,
    phone: (phone || "").trim() || null,
  };

  const { data, error } = await supabase
    .from("contact_notes_details")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/* Update structured note */
async function updateContactNote(noteId, patch) {
  const { data, error } = await supabase
    .from("contact_notes_details")
    .update(patch)
    .eq("id", noteId)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/* Delete structured note */
async function deleteContactNote(noteId) {
  const { error } = await supabase.from("contact_notes_details").delete().eq("id", noteId);
  if (error) throw error;
}

/* Build phone dropdown options for note modal */
function phoneOptionsFromContact(c) {
  const phones = Array.isArray(c.phones) ? c.phones : [];
  const opts = phones
    .map(p => `<option value="${escapeHtml(p)}">${escapeHtml(formatUSPhone(p))}</option>`)
    .join("");
  return `<option value="">(optional)</option>${opts}`;
}

/* Update contact bulk bar UI */
function updateBulkBar() {
  const bar = $("#contacts-bulk-actions");
  $("#contacts-selected-count") && ($("#contacts-selected-count").textContent = String(selectedIds.size));
  if (bar) bar.style.display = selectedIds.size > 0 ? "flex" : "none";
}

/* Build schedule URL for selected contacts */
function buildScheduleUrlFromContacts(picked) {
  const fullName = (c) => `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Unknown";
  const firstPhone = (c) => (Array.isArray(c.phones) && c.phones.length ? c.phones[0] : "—");
  const title = picked.map(fullName).join(", ");
  const notes = picked.map(c => `${fullName(c)}: ${firstPhone(c)}`).join(", ");
  return (
    `scheduling.html?appointment_type=contact` +
    `&prefill_title=${encodeURIComponent(title)}` +
    `&prefill_notes=${encodeURIComponent(notes)}` +
    `&contact_ids=${encodeURIComponent(JSON.stringify(picked.map(c => c.id)))}`
  );
}

/* Format note stamp */
function formatNoteStamp(iso, tz) {
  const d = iso ? new Date(iso) : new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (t) => parts.find(p => p.type === t)?.value || "";
  return `${get("month")}/${get("day")}/${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

/* Build append line for contacts.notes */
function buildContactNotesAppendLine({ status, created_at, details, phone, tz }) {
  const abbr = statusAbbr(status);
  const stamp = formatNoteStamp(created_at, tz);
  const det = (details || "").trim();
  const ph = (phone || "").trim();
  return `[${abbr}] [${stamp}] [${det}] ${ph ? `[${formatUSPhone(ph)}]` : ""}\n\n\t`;
}

/* Append a line to contacts.notes */
async function appendToContactNotes(contactId, appendLine) {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) throw new Error("Not logged in.");

  const { data: row, error: readErr } = await supabase
    .from("contacts")
    .select("notes")
    .eq("id", contactId)
    .eq("owning_agent_id", user.id)
    .single();

  if (readErr) throw readErr;

  const existing = String(row?.notes || "");
  const next = existing ? (existing + appendLine) : appendLine;

  const { error: updErr } = await supabase
    .from("contacts")
    .update({ notes: next })
    .eq("id", contactId)
    .eq("owning_agent_id", user.id);

  if (updErr) throw updErr;
}

/* Open contact detail modal */
async function openContactDetail(c) {
  const modal = $("#contact-detail-modal");
  const title = $("#contact-modal-name");
  const body = $("#contact-modal-body");
  if (!modal || !title || !body) return;

  const scope = modal;
  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contact";
  title.textContent = name;

  const addrText = [c.address_line1, c.address_line2, c.city, c.state, c.zip].filter(Boolean).join(", ");

  body.innerHTML = `
    <div class="contact-ov">
      <div class="contact-sec" data-sec="name">
        <div class="contact-sec-head">
          <strong class="sec-title"><i class="fa-solid fa-user"></i><span class="sec-title-text">Name</span></strong>
          <button class="contact-edit-btn" data-edit="name" title="Edit name"><i class="fa-solid fa-pen-to-square"></i></button>
        </div>
        <div class="contact-sec-view" data-view="name"><span id="contact-name-view">${escapeHtml(name || "—")}</span></div>
        <div class="contact-sec-edit" data-form="name" style="display:none;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <input id="edit-first" type="text" placeholder="First name" value="${escapeHtml(c.first_name || "")}">
            <input id="edit-last" type="text" placeholder="Last name" value="${escapeHtml(c.last_name || "")}">
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="name">Cancel</button>
            <button class="see-all" data-save="name"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <div class="contact-sec" data-sec="phones">
        <div class="contact-sec-head">
          <strong class="sec-title"><i class="fa-solid fa-phone"></i><span class="sec-title-text">Phone(s)</span></strong>
          <button class="contact-edit-btn" data-edit="phones" title="Edit phones"><i class="fa-solid fa-pen-to-square"></i></button>
        </div>
        <div class="contact-sec-view" data-view="phones">
          ${
            (c.phones || []).length
              ? (c.phones || []).map(p => {
                  const d10 = digits10(p);
                  return `<a class="contact-phone" data-phone-d10="${escapeHtml(d10)}" href="tel:${escapeHtml(toE164(p) || p)}">${escapeHtml(formatUSPhone(p))}</a>`;
                }).join("<br>")
              : "—"
          }
        </div>
        <div class="contact-sec-edit" data-form="phones" style="display:none;">
          <textarea id="edit-phones" rows="4">${escapeHtml(arrToLines(c.phones || []))}</textarea>
          <small style="opacity:.75;">One phone per line</small>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="phones">Cancel</button>
            <button class="see-all" data-save="phones"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <div class="contact-sec" data-sec="emails">
        <div class="contact-sec-head">
          <strong class="sec-title"><i class="fa-solid fa-envelope"></i><span class="sec-title-text">Email(s)</span></strong>
          <button class="contact-edit-btn" data-edit="emails" title="Edit emails"><i class="fa-solid fa-pen-to-square"></i></button>
        </div>
        <div class="contact-sec-view" data-view="emails">
          ${
            (c.emails || []).length
              ? (c.emails || []).map(e => `<a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a>`).join("<br>")
              : "—"
          }
        </div>
        <div class="contact-sec-edit" data-form="emails" style="display:none;">
          <textarea id="edit-emails" rows="4">${escapeHtml(arrToLines(c.emails || []))}</textarea>
          <small style="opacity:.75;">One email per line</small>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="emails">Cancel</button>
            <button class="see-all" data-save="emails"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <div class="contact-sec" data-sec="address">
        <div class="contact-sec-head">
          <strong class="sec-title"><i class="fa-solid fa-location-dot"></i><span class="sec-title-text">Address</span></strong>
          <button class="contact-edit-btn" data-edit="address" title="Edit address"><i class="fa-solid fa-pen-to-square"></i></button>
        </div>
        <div class="contact-sec-view" data-view="address">${escapeHtml(addrText || "—")}</div>
        <div class="contact-sec-edit" data-form="address" style="display:none;">
          <input id="edit-address1" type="text" placeholder="Address line 1" value="${escapeHtml(c.address_line1 || "")}">
          <input id="edit-address2" type="text" placeholder="Address line 2" value="${escapeHtml(c.address_line2 || "")}" style="margin-top:8px;">
          <div style="display:grid;grid-template-columns:1fr 120px 120px;gap:8px;margin-top:8px;">
            <input id="edit-city" type="text" placeholder="City" value="${escapeHtml(c.city || "")}">
            <input id="edit-state" type="text" placeholder="State" value="${escapeHtml(c.state || "")}">
            <input id="edit-zip" type="text" placeholder="ZIP" value="${escapeHtml(c.zip || "")}">
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="address">Cancel</button>
            <button class="see-all" data-save="address"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <div class="contact-sec" data-sec="notes">
        <div class="contact-sec-head notes-head">
          <div class="notes-left">
            <strong class="sec-title"><i class="fa-solid fa-note-sticky"></i><span class="sec-title-text">Notes</span></strong>
          </div>
          <div class="notes-mid">
            <input id="note-filter-range" type="text" placeholder="Date" readonly title="Filter by date range" />
            <select id="note-filter-status" title="Filter by type">
              <option value="">Type</option>
              ${NOTE_STATUS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
            </select>
            <button id="note-filter-clear" class="see-all" type="button" title="Clear filters">Clear</button>
          </div>
          <div class="notes-right">
            <button id="add-note-btn" class="see-all note-add-btn" type="button" title="Add note">+</button>
          </div>
        </div>

        <div id="contact-notes-chips" class="note-chip-row" style="margin-top:10px;opacity:.95;">Loading…</div>
      </div>

      <div id="add-note-modal" class="mini-modal" aria-hidden="true">
        <div class="mm-backdrop" data-mm-close></div>
        <div class="mm-panel">
          <div class="mm-head">
            <strong>Add Note</strong>
            <button class="mm-close" data-mm-close>&times;</button>
          </div>

          <div class="mm-grid">
            <div>
              <label class="mm-label">Status</label>
              <select id="note-status">
                ${NOTE_STATUS.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
              </select>
            </div>

            <div id="note-phone-wrap" style="display:none;">
              <label class="mm-label">Phone (optional)</label>
              <select id="note-phone">${phoneOptionsFromContact(c)}</select>
            </div>
          </div>

          <div id="note-details-wrap" style="display:none;margin-top:10px;">
            <label class="mm-label">Additional Details</label>
            <input id="note-details" type="text" placeholder="Type extra details…">
          </div>

          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">
            <button class="see-all" data-mm-close>Cancel</button>
            <button id="note-save-btn" class="see-all"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <div id="note-detail-modal" class="mini-modal" aria-hidden="true">
        <div class="mm-backdrop" data-nd-close></div>
        <div class="mm-panel">
          <div class="mm-head">
            <strong>Note</strong>
            <button class="mm-close" data-nd-close>&times;</button>
          </div>
          <div id="note-detail-body" style="line-height:1.45;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap;">
            <button id="note-delete-btn" class="see-all"><i class="fa-solid fa-trash"></i> Delete</button>
            <button id="note-edit-btn" class="see-all"><i class="fa-solid fa-pen-to-square"></i> Edit</button>
          </div>
        </div>
      </div>

      <div class="contact-sec" data-sec="appointments">
        <div class="contact-sec-head">
          <strong><i class="fa-solid fa-calendar-days"></i><span class="sec-title-text">Appointments</span></strong>
        </div>
        <div id="contact-appointments-list" style="margin-top:10px;opacity:.9;">Loading…</div>
      </div>

      <div class="contact-sec" data-sec="policies">
        <div class="contact-sec-head">
          <strong class="sec-title"><i class="fa-solid fa-file-shield"></i><span class="sec-title-text">Policies</span></strong>
        </div>
        <div id="contact-policies-list" style="margin-top:10px;opacity:.9;">Loading…</div>
      </div>

      <div class="contact-sec" data-sec="leads">
        <div class="contact-sec-head">
          <strong class="sec-title"><i class="fa-solid fa-link"></i><span class="sec-title-text">Leads</span></strong>
        </div>
        <div id="contact-leads-list" style="opacity:.85;">Loading…</div>
      </div>

      <div class="contact-actions-sticky">
        <button id="contact-schedule-one" class="see-all"><i class="fa-solid fa-calendar-check"></i> Schedule</button>
        <button id="contact-save-one" class="see-all"><i class="fa-solid fa-download"></i> Save to phone (.vcf)</button>
      </div>
    </div>
  `;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;

  let noteRange = { start: null, end: null };
  let noteRangePicker = null;

  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

  const openMini = (id) => { const mm = $(id); if (!mm) return; mm.classList.add("open"); mm.setAttribute("aria-hidden", "false"); };
  const closeMini = (id) => { const mm = $(id); if (!mm) return; mm.classList.remove("open"); mm.setAttribute("aria-hidden", "true"); };

  scope.querySelectorAll("[data-mm-close]").forEach(x => x.addEventListener("click", () => closeMini("#add-note-modal")));
  scope.querySelectorAll("[data-nd-close]").forEach(x => x.addEventListener("click", () => closeMini("#note-detail-modal")));

  const statusEl = $("#note-status");
  const detailsWrap = $("#note-details-wrap");
  const phoneWrap = $("#note-phone-wrap");

  const updateAddNoteFields = () => {
    const s = statusEl?.value || "";
    const showDetails = ["Answered", "Called Back", "Answered (Door Knock)", "Other"].includes(s);
    const showPhone = ["Wrong Number", "Other"].includes(s);
    if (detailsWrap) detailsWrap.style.display = showDetails ? "block" : "none";
    if (phoneWrap) phoneWrap.style.display = showPhone ? "block" : "none";
    if (!showDetails && $("#note-details")) $("#note-details").value = "";
    if (!showPhone && $("#note-phone")) $("#note-phone").value = "";
  };

  statusEl?.addEventListener("change", updateAddNoteFields);
  updateAddNoteFields();

  let noteCache = [];

  const applyWrongPhoneHighlights = (notes) => {
    const wrongSet = new Set(
      (notes || [])
        .filter(n => String(n.status || "").trim().toLowerCase() === "wrong number" && n.phone)
        .map(n => digits10(n.phone))
        .filter(Boolean)
    );

    scope.querySelectorAll(".contact-phone[data-phone-d10]").forEach(a => {
      const d10 = digits10(a.getAttribute("data-phone-d10"));
      a.classList.toggle("contact-phone--wrong", wrongSet.has(d10));
    });
  };

  const getActiveNoteFilters = () => ({ statusVal: ($("#note-filter-status")?.value || "").trim() });

  async function renderNoteChips() {
    const box = $("#contact-notes-chips");
    if (!box) return;

    noteCache = await fetchContactNoteDetails(c.id);
    applyWrongPhoneHighlights(noteCache);

    const { statusVal } = getActiveNoteFilters();
    let list = noteCache.slice();

    if (statusVal) list = list.filter(n => (n.status || "") === statusVal);

    if (noteRange.start && noteRange.end) {
      list = list.filter(n => {
        if (!n.created_at) return false;
        const d = new Date(n.created_at);
        return d >= noteRange.start && d <= noteRange.end;
      });
    }

    if (!list.length) {
      box.innerHTML = `<div style="opacity:.7;">No notes match your filters.</div>`;
      return;
    }

    box.innerHTML = list.map(n => {
      const abbr = statusAbbr(n.status);
      const glow = statusColorClass(n.status);
      const glow2 = glow
        .replace("note-pill--blue", "note-glow--blue")
        .replace("note-pill--red", "note-glow--red")
        .replace("note-pill--yellow", "note-glow--yellow");

      const dt = formatLocalDateTime(n.created_at, tz);
      const det = (n.details || "").trim();
      const phone = (n.phone || "").trim();

      return `
        <div class="note-chip" data-note-id="${n.id}">
          <span class="note-bubble ${glow2}">${escapeHtml(abbr)}</span>
          <span class="note-bubble note-bubble--date ${glow2}">${escapeHtml(dt)}</span>
          ${det ? `<span class="note-bubble note-bubble--details ${glow2}" title="${escapeHtml(det)}">${escapeHtml(det)}</span>` : ""}
          ${phone ? `<span class="note-bubble note-bubble--phone ${glow2}">${escapeHtml(formatUSPhone(phone))}</span>` : ""}
        </div>
      `;
    }).join("");

    box.querySelectorAll(".note-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        const id = chip.dataset.noteId;
        const note = noteCache.find(x => x.id === id);
        if (note) openNoteDetail(note);
      });
    });
  }

  function openNoteDetail(note) {
    const bodyEl = $("#note-detail-body");
    if (!bodyEl) return;

    const lastEdit = (note.edited_on && note.edited_on.length) ? note.edited_on[note.edited_on.length - 1] : null;

    bodyEl.innerHTML = `
      <div><strong>Status:</strong> ${escapeHtml(note.status)}</div>
      <div style="margin-top:6px;"><strong>Date and Time:</strong> ${escapeHtml(formatLocalLong(note.created_at, tz))}</div>
      ${note.details ? `<div style="margin-top:6px;"><strong>Additional Details:</strong> ${escapeHtml(note.details)}</div>` : ""}
      ${note.phone ? `<div style="margin-top:6px;"><strong>Phone:</strong> ${escapeHtml(formatUSPhone(note.phone))}</div>` : ""}
      ${lastEdit ? `<div style="margin-top:6px;"><strong>Last edited on:</strong> ${escapeHtml(formatLocalLong(lastEdit, tz))}</div>` : ""}
    `;

    $("#note-delete-btn").onclick = async () => {
      if (!confirm("Delete this note? This cannot be undone.")) return;
      try {
        await deleteContactNote(note.id);
        closeMini("#note-detail-modal");
        await renderNoteChips();
      } catch (e) {
        console.error(e);
        alert("Failed to delete note.");
      }
    };

    $("#note-edit-btn").onclick = () => {
      closeMini("#note-detail-modal");
      openMini("#add-note-modal");

      $("#note-status").value = note.status;
      updateAddNoteFields();

      if ($("#note-details")) $("#note-details").value = note.details || "";
      if ($("#note-phone")) $("#note-phone").value = note.phone || "";

      const saveBtn = $("#note-save-btn");
      if (saveBtn) {
        saveBtn.dataset.mode = "edit";
        saveBtn.dataset.noteId = note.id;
      }
    };

    openMini("#note-detail-modal");
  }

  $("#add-note-btn")?.addEventListener("click", () => {
    const saveBtn = $("#note-save-btn");
    if (saveBtn) {
      saveBtn.dataset.mode = "create";
      saveBtn.dataset.noteId = "";
    }
    if ($("#note-status")) $("#note-status").value = "No Answer";
    if ($("#note-details")) $("#note-details").value = "";
    if ($("#note-phone")) $("#note-phone").value = "";
    updateAddNoteFields();
    openMini("#add-note-modal");
  });

  $("#note-save-btn")?.addEventListener("click", async () => {
    const s = ($("#note-status")?.value || "").trim();
    const details = ($("#note-details")?.value || "").trim();
    const phone = ($("#note-phone")?.value || "").trim();

    if (!s) return alert("Pick a status.");

    try {
      const btn = $("#note-save-btn");
      const mode = btn?.dataset.mode || "create";
      const noteId = btn?.dataset.noteId || "";

      if (mode === "edit" && noteId) {
        await updateContactNote(noteId, { status: s, details: details || null, phone: phone || null });
      } else {
        const inserted = await insertContactNote({ contactId: c.id, status: s, details, phone });

        const appendLine = buildContactNotesAppendLine({
          status: inserted.status,
          created_at: inserted.created_at,
          details: inserted.details,
          phone: inserted.phone,
          tz
        });

        try { await appendToContactNotes(c.id, appendLine); } catch (e) { console.error("appendToContactNotes failed:", e); }

        const SHOULD_TOUCH = new Set(["Answered", "Answered (Door Knock)", "Called Back", "Appointment", "Other"]);
        if (SHOULD_TOUCH.has(s)) {
          const { error: touchErr } = await supabase.rpc("mark_leads_contacted", { p_contact_id: c.id });
          if (touchErr) console.error("mark_leads_contacted failed:", touchErr);
        }
      }

      closeMini("#add-note-modal");
      await renderNoteChips();
    } catch (e) {
      console.error(e);
      alert("Failed to save note.");
    }
  });

  $("#note-filter-status")?.addEventListener("change", renderNoteChips);

  $("#note-filter-clear")?.addEventListener("click", () => {
    if ($("#note-filter-status")) $("#note-filter-status").value = "";
    noteRange.start = null;
    noteRange.end = null;
    try { noteRangePicker?.clear?.(); } catch (_) {}
    if ($("#note-filter-range")) $("#note-filter-range").value = "";
    renderNoteChips();
  });

  if (window.flatpickr && $("#note-filter-range")) {
    try { noteRangePicker?.destroy?.(); } catch (_) {}
    noteRangePicker = flatpickr("#note-filter-range", {
      mode: "range",
      dateFormat: "Y-m-d",
      allowInput: false,
      clickOpens: true,
      onChange: (selectedDates) => {
        if (!selectedDates || selectedDates.length === 0) {
          noteRange.start = null;
          noteRange.end = null;
        } else if (selectedDates.length === 1) {
          noteRange.start = startOfDay(selectedDates[0]);
          noteRange.end = endOfDay(selectedDates[0]);
        } else {
          const s = selectedDates[0] < selectedDates[1] ? selectedDates[0] : selectedDates[1];
          const e = selectedDates[0] < selectedDates[1] ? selectedDates[1] : selectedDates[0];
          noteRange.start = startOfDay(s);
          noteRange.end = endOfDay(e);
        }
        renderNoteChips();
      },
    });
  }

  const apptBox = $("#contact-appointments-list");
  const appts = await fetchContactAppointments(c.id);
  const fmtWhen = (iso) => formatLocalLong(iso, tz) || "—";

  if (apptBox) {
    if (!appts.length) apptBox.textContent = "—";
    else {
      apptBox.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${appts.map(a => {
            const when = `${fmtWhen(a.scheduled_for)} → ${fmtWhen(a.ends_at)}`;
            const loc = (a.location_type || "—");
            const url = (a.url || "").trim();
            return `
              <div style="border:1px solid #eef0f6;border-radius:12px;padding:10px;">
                <div style="font-weight:800;">${escapeHtml(when)}</div>
                <div style="opacity:.85;margin-top:4px;">
                  ${escapeHtml(loc)}
                  ${url ? ` • <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ""}
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }
  }

  await renderNoteChips();

  $("#contact-schedule-one")?.addEventListener("click", () => { window.location.href = buildScheduleUrlFromContacts([c]); });
  $("#contact-save-one")?.addEventListener("click", () => downloadText(`${(name || "contact")}.vcf`, contactToVCard(c)));

  const polBox = $("#contact-policies-list");
  const policies = await fetchContactPolicies(c.id);
  if (polBox) {
    if (!policies.length) polBox.textContent = "—";
    else {
      polBox.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${policies.map(p => `
            <div style="border:1px solid #eef0f6;border-radius:12px;padding:10px;">
              <div style="font-weight:800;">${escapeHtml(p.policy_number || "—")}</div>
              <div style="opacity:.85;margin-top:4px;">
                ${escapeHtml(p.product_line || "—")} • ${escapeHtml(p.policy_type || "—")} • ${escapeHtml(p.carrier_name || "—")}
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }
  }

  const leadsBox = $("#contact-leads-list");
  const leadRows = await fetchContactLeads(c.id);
  if (leadsBox) {
    if (!leadRows.length) leadsBox.textContent = "—";
    else {
      leadsBox.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${leadRows.map(l => {
            const d = l.created_at ? new Date(l.created_at).toLocaleDateString() : "";
            const what = l.product_type || l.lead_type || "Lead";
            return `<div style="border:1px solid #eef0f6;padding:8px;">
              <strong>${escapeHtml(what)}</strong><br>
              <span style="opacity:.8;">${escapeHtml(d)}</span>
            </div>`;
          }).join("")}
        </div>
      `;
    }
  }

  const showEdit = (sec) => {
    scope.querySelector(`[data-view="${sec}"]`)?.setAttribute("style", "display:none;");
    scope.querySelector(`[data-form="${sec}"]`)?.setAttribute("style", "display:block;");
  };
  const hideEdit = (sec) => {
    scope.querySelector(`[data-form="${sec}"]`)?.setAttribute("style", "display:none;");
    scope.querySelector(`[data-view="${sec}"]`)?.setAttribute("style", "display:block;");
  };

  scope.querySelectorAll("[data-edit]").forEach(btn => btn.addEventListener("click", () => showEdit(btn.getAttribute("data-edit"))));
  scope.querySelectorAll("[data-cancel]").forEach(btn => btn.addEventListener("click", () => hideEdit(btn.getAttribute("data-cancel"))));

  scope.querySelectorAll("[data-save]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const sec = btn.getAttribute("data-save");
      const update = {};

      if (sec === "name") {
        update.first_name = ($("#edit-first")?.value || "").trim() || null;
        update.last_name = ($("#edit-last")?.value || "").trim() || null;
      } else if (sec === "phones") {
        update.phones = linesToArray($("#edit-phones")?.value);
      } else if (sec === "emails") {
        update.emails = linesToArray($("#edit-emails")?.value);
      } else if (sec === "address") {
        update.address_line1 = ($("#edit-address1")?.value || "").trim() || null;
        update.address_line2 = ($("#edit-address2")?.value || "").trim() || null;
        update.city = ($("#edit-city")?.value || "").trim() || null;
        update.state = ($("#edit-state")?.value || "").trim() || null;
        update.zip = ($("#edit-zip")?.value || "").trim() || null;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;

      const { data: updated, error } = await supabase
        .from("contacts")
        .update(update)
        .eq("id", c.id)
        .eq("owning_agent_id", user.id)
        .select("*")
        .single();

      if (error) {
        console.error(error);
        return alert("Failed to save contact changes.");
      }

      const idx = contacts.findIndex(x => x.id === c.id);
      if (idx >= 0) contacts[idx] = updated;

      renderContacts();
      openContactDetail(updated);
    });
  });
}

/* Render contacts list */
function renderContacts() {
  const wrap = $("#contacts-list");
  if (!wrap) return;

  wrap.innerHTML = "";

  const q = ($("#contacts-search")?.value || "").toLowerCase();
  const order = $("#contacts-order")?.value || "created_desc";

  let list = contacts.slice();

  if (q) {
    list = list.filter(c => {
      const name = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
      const phones = (c.phones || []).join(" ").toLowerCase();
      const emails = (Array.isArray(c.emails) ? c.emails : [])
        .map(e => String(e || "").trim())
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return name.includes(q) || phones.includes(q) || emails.includes(q);
    });
  }

  list.sort((a, b) => {
    if (order === "created_desc") return new Date(b.created_at) - new Date(a.created_at);
    if (order === "created_asc") return new Date(a.created_at) - new Date(b.created_at);

    const A = `${a.first_name || ""} ${a.last_name || ""}`.toLowerCase().trim();
    const B = `${b.first_name || ""} ${b.last_name || ""}`.toLowerCase().trim();
    if (order === "name_asc") return A.localeCompare(B);
    if (order === "name_desc") return B.localeCompare(A);
    return 0;
  });

  const head = document.createElement("div");
  head.className = "contacts-head";
  head.innerHTML = `
    <div>${selectMode ? '<i class="fa-regular fa-square-check"></i>' : ""}</div>
    <div><strong>Name</strong></div>
    <div><strong>Phone</strong></div>
    <div><strong>Email</strong></div>
  `;
  wrap.appendChild(head);

  for (const c of list) {
    const row = document.createElement("div");
    row.className = "contact-row";

    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(No name)";
    const phone = c.phones?.[0] ? c.phones[0] : "";
    const email = (Array.isArray(c.emails) ? c.emails : [])
      .map(e => String(e || "").trim())
      .find(e => e.length > 0) || "";
    const checked = selectedIds.has(c.id) ? "checked" : "";

    const needs = (c.needs_dnc_check === true) || (c.needs_dnc_check === 1) || (String(c.needs_dnc_check).toLowerCase() === "true");

    row.innerHTML = `
      <div>${
        selectMode
          ? `<input type="checkbox" class="contact-cb" data-id="${c.id}" ${checked}>`
          : `${dotHtml(needs)}`
      }</div>
      <div><i class="fa-solid fa-id-card-clip" style="margin-right:6px;"></i>${escapeHtml(name)}</div>
      <div><i class="fa-solid fa-phone" style="margin-right:6px;"></i>${escapeHtml(phone || "—")}</div>
      <div><i class="fa-solid fa-envelope" style="margin-right:6px;"></i>${escapeHtml(email || "—")}</div>
    `;

    row.addEventListener("click", (e) => {
      if (selectMode) {
        const cb = row.querySelector(".contact-cb");
        if (!cb) return;
        if (e.target !== cb) cb.checked = !cb.checked;
        if (cb.checked) selectedIds.add(c.id);
        else selectedIds.delete(c.id);
        updateBulkBar();
      } else {
        openContactDetail(c);
      }
    });

    wrap.appendChild(row);
  }

  updateBulkBar();
}

/* Load contacts (restricted to owning_agent_id) */
async function loadContacts() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  const { data, error } = await supabase
    .from("contacts")
    .select(`
      id,
      created_at,
      first_name,
      last_name,
      phones,
      emails,
      needs_dnc_check,
      owning_agent_id,
      internal_dnc:internal_dnc!internal_dnc_contact_id_fkey ( id, is_active )
    `)
    .eq("owning_agent_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("contacts load error", error);
    contacts = [];
    renderContacts();
    return;
  }

  contacts = (data || []).filter(c => (c.internal_dnc || []).length === 0);
  renderContacts();
}

/* Download selected contacts as .vcf */
function saveSelectedContacts() {
  const pick = contacts.filter(c => selectedIds.has(c.id));
  if (!pick.length) return;
  const text = pick.map(contactToVCard).join("\r\n\r\n");
  downloadText(`FVIA_Contacts_${pick.length}.vcf`, text);
}

/* Add selected contacts to internal DNC */
async function addSelectedContactsToDnc() {
  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  const ok = confirm(
    `⚠️ Add to Do Not Call\n\nYou are about to mark ${ids.length} contact(s) as INTERNAL DNC (active).\n\nThey will disappear from your contacts list and their leads will be filtered out.\n\nContinue?`
  );
  if (!ok) return;

  const { data, error } = await supabase.rpc("add_contacts_to_internal_dnc", {
    p_contact_ids: ids,
    p_reason: "Agent marked Do Not Call",
    p_notes: null,
  });

  if (error) {
    console.error(error);
    return alert("Failed to add to internal DNC.");
  }

  const inserted = Array.isArray(data) ? data[0]?.inserted_count : data?.inserted_count;
  alert(`Done. Added ${inserted ?? 0} contact(s) to internal DNC.`);

  selectedIds.clear();
  await loadContacts();
  await loadAgentLeads();
}

/* Submit lead form */
function submitLeadToSupabase(agentProfile) {
  const form = $("#lead-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = $("#lead-message");
    if (msg) msg.textContent = "Submitting...";

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      if (msg) msg.textContent = "You are not logged in.";
      return;
    }

    const phones = getPhoneValues();
    if (!phones.length) {
      if (msg) msg.textContent = "Please add at least 1 phone number.";
      return;
    }

    const picker = $("#contact-picker");
    const chosenId = picker?.value || "";

    if (!chosenId) {
      const blocked = await duplicateOnInternalDnc($("#lead-first")?.value, $("#lead-last")?.value, phones);
      if (blocked) {
        if (msg) msg.textContent = "This person has requested not to be contacted. Lead submission blocked.";
        return;
      }
    }

    let contactId = null;

    try {
      contactId = await ensureContactIdFromLeadForm();
      if (await contactHasInternalDnc(contactId)) {
        if (msg) msg.textContent = "This contact is on the internal Do Not Contact list.";
        return;
      }
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = "Failed creating contact.";
      return;
    }

    await getContactNeedsDnc(contactId);

    const payload = {
      first_name: $("#lead-first")?.value?.trim() || null,
      last_name: $("#lead-last")?.value?.trim() || null,
      contact_id: contactId,
      age: Number($("#lead-age")?.value || "") || null,
      address: $("#lead-address")?.value?.trim() || null,
      city: $("#lead-city")?.value?.trim() || null,
      state: $("#lead-state")?.value || null,
      zip: $("#lead-zip")?.value?.trim() || null,
      product_type: $("#lead-product-type")?.value || null,
      notes: $("#lead-notes")?.value?.trim() || null,
      phone: phones,
      submitted_by: session.user.id,
      assigned_to: session.user.id,
      submitted_by_name: agentProfile ? `${agentProfile.first_name || ""} ${agentProfile.last_name || ""}`.trim() : null,
    };

    const { error } = await supabase.from("leads").insert(payload);
    if (error) {
      console.error("Insert lead error:", error);
      if (msg) msg.textContent = `Failed: ${error.message}`;
      return;
    }

    if (msg) msg.textContent = "Lead submitted!";

    form.reset();
    $$("#lead-form .field").forEach(f => f.classList.remove("filled"));

    const phoneList = $("#phone-list");
    if (phoneList) phoneList.innerHTML = "";
    renderPhoneField("");

    agentCurrentPage = 1;
    await loadAgentLeads();
    showSection("view");
  });
}

/* Submit lead request form */
function submitLeadRequestToSupabase(agentProfile) {
  const form = $("#lead-request-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = $("#request-message");
    if (msg) msg.textContent = "Submitting request...";

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      if (msg) msg.textContent = "You are not logged in.";
      return;
    }

    const productType = $("#request-product-type")?.value || null;
    const leadType = $("#request-lead-type")?.value || null;

    const qtyRaw = ($("#request-qty")?.value ?? "").trim();
    const qty = qtyRaw === "" ? 1 : parseInt(qtyRaw, 10);

    if (!Number.isFinite(qty) || qty < 1) {
      if (msg) msg.textContent = "Requested quantity must be 1 or more.";
      return;
    }

    const payload = {
      submitted_by: user.id,
      submitted_by_name: agentProfile ? `${agentProfile.first_name || ""} ${agentProfile.last_name || ""}`.trim() : null,
      requested_count: qty,
      product_type: productType,
      lead_type: leadType,
      state: $("#request-state")?.value || null,
      city: ($("#request-city")?.value || "").trim() || null,
      zip: ($("#request-zip")?.value || "").trim() || null,
      notes: ($("#request-notes")?.value || "").trim() || null,
    };

    const { error } = await supabase.from("lead_requests").insert(payload);

    if (error) {
      console.error("lead_requests insert error:", error);
      if (msg) msg.textContent = `Failed: ${error.message}`;
      return;
    }

    if (msg) msg.textContent = "Request submitted!";
    form.reset();
    $$("#lead-request-form .field").forEach(f => f.classList.remove("filled"));
  });
}

/* DOM boot */
document.addEventListener("DOMContentLoaded", async () => {
  initAgentHubMenu();
  closeOverlaysOnClicks();
  initFloatingLabels(document);
  initLeadExportButtons();
  initExportDropdown();
  initSelectAll();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return (window.location.href = "login.html");

  const { error: dncErr } = await supabase.rpc("expire_dnc_for_agent_contacts", { p_agent_id: session.user.id });
  if (dncErr) console.error("expire_dnc_for_agent_contacts failed:", dncErr);

  agentProfile = await fetchAgentProfile();

  submitLeadRequestToSupabase(agentProfile);

  if (!agentProfile?.is_admin) $$(".admin-only").forEach(el => (el.style.display = "none"));

  const navs = getNavButtons();
  navs.view?.addEventListener("click", () => showSection("view"));
  navs.submit?.addEventListener("click", () => showSection("submit"));
  navs.request?.addEventListener("click", () => showSection("request"));

  navs.contacts?.addEventListener("click", async () => {
    showSection("contacts");
    await loadContacts();
  });

  navs.dnc?.addEventListener("click", async () => {
    showSection("dnc");
    initDncUi();
    await loadDncAreaCodesIntoDropdown();
    setDncMsg("");
    if ($("#dnc-result")) $("#dnc-result").style.display = "none";
  });

  showSection("view");

  await loadAgentLeads();

  $("#agent-next-page")?.addEventListener("click", async () => {
    if (agentCurrentPage >= agentTotalPages) return;
    agentCurrentPage++;
    await loadAgentLeads();
  });

  $("#agent-prev-page")?.addEventListener("click", async () => {
    if (agentCurrentPage <= 1) return;
    agentCurrentPage--;
    await loadAgentLeads();
  });

  $("#agent-archive-btn")?.addEventListener("click", archiveSelectedLeads);

  $("#contacts-refresh")?.addEventListener("click", loadContacts);
  $("#contacts-search")?.addEventListener("input", renderContacts);
  $("#contacts-order")?.addEventListener("change", renderContacts);

  $("#contacts-bulk-route")?.addEventListener("click", () => alert("Route: coming soon"));
  $("#contacts-bulk-quote")?.addEventListener("click", () => alert("Quote: coming soon"));

  $("#contacts-bulk-schedule")?.addEventListener("click", () => {
    const picked = contacts.filter(c => selectedIds.has(c.id));
    if (!picked.length) return alert("Select at least 1 contact first.");
    window.location.href = buildScheduleUrlFromContacts(picked);
  });

  $("#contacts-bulk-dnc")?.addEventListener("click", addSelectedContactsToDnc);

  $("#contacts-select-toggle")?.addEventListener("click", () => {
    selectMode = !selectMode;
    if (!selectMode) selectedIds.clear();
    const btn = $("#contacts-select-all");
    if (btn) btn.style.display = selectMode ? "inline-block" : "none";
    renderContacts();
  });

  $("#contacts-select-all")?.addEventListener("click", () => {
    const allIds = contacts.map(c => c.id);
    const allSelected = allIds.length > 0 && allIds.every(id => selectedIds.has(id));
    if (allSelected) allIds.forEach(id => selectedIds.delete(id));
    else allIds.forEach(id => selectedIds.add(id));
    renderContacts();
  });

  $("#contacts-bulk-save")?.addEventListener("click", saveSelectedContacts);

  await initContactPicker();
  initPhonesUI();
  submitLeadToSupabase(agentProfile);

  $("#logout-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signOut();
    if (error) alert("Logout failed!");
    else window.location.href = "../index.html";
  });
});
