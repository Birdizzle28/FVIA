// scripts/leads.js — DROP-IN REPLACEMENT

let agentProfile = null;
let agentCurrentPage = 1;
let agentTotalPages = 1;
const PAGE_SIZE = 25;

let contactChoices = null;

// ---------- helpers ----------
// ---------- DNC (national) ----------
let dncChoices = null;

function setDncMsg(text, isError = false) {
  const el = $("#dnc-msg");
  if (!el) return;
  el.style.color = isError ? "#b00020" : "";
  el.textContent = text || "";
}

function normalizeLocal7Input(v) {
  return String(v || "").replace(/\D/g, "").slice(0, 7);
}

function showDncResult({ onList, areaCode, local7 }) {
  const box = $("#dnc-result");
  const dot = $("#dnc-dot");
  const title = $("#dnc-result-title");
  const sub = $("#dnc-result-sub");
  if (!box || !dot || !title || !sub) return;

  box.style.display = "flex";

  // Red neon (on list) / Blue neon (not on list)
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
  codes.forEach(code => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    sel.appendChild(opt);
  });

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

async function checkNationalDnc() {
  const areaCode = ($("#dnc-area-code")?.value || "").trim();
  const localRaw = normalizeLocal7Input($("#dnc-local7")?.value);

  setDncMsg("");

  if (!areaCode) {
    setDncMsg("Pick an area code first (only what we have).", true);
    return;
  }
  if (localRaw.length !== 7) {
    setDncMsg("Enter exactly 7 digits for the last 7 digits.", true);
    return;
  }

  const local7 = parseInt(localRaw, 10);

  const { data, error } = await supabase
    .from("dnc_ranges")
    .select("area_code") // any existing column works
    .eq("area_code", areaCode)
    .lte("start_local7", local7)
    .gte("end_local7", local7)
    .limit(1);

  if (error) {
    console.error("dnc_ranges check error:", error);
    setDncMsg("DNC check failed.", true);
    return;
  }

  const onList = (data || []).length > 0;
  showDncResult({ onList, areaCode, local7: localRaw });
}

function initDncUi() {
  const btn = $("#dnc-check-btn");
  if (btn && btn.dataset.bound === "1") return;
  if (btn) btn.dataset.bound = "1";

  const local = $("#dnc-local7");
  local?.addEventListener("input", () => {
    const clean = normalizeLocal7Input(local.value);
    local.value = clean;
    local.closest(".field")?.classList.toggle("filled", !!clean);
  });

  btn?.addEventListener("click", checkNationalDnc);

  local?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      checkNationalDnc();
    }
  });
}

async function exportSelectedLeads(format) {
  const ids = $$(".lead-checkbox:checked").map(cb => cb.dataset.id).filter(Boolean);
  if (!ids.length) return;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    alert("Please log in again.");
    return;
  }

  const url = `/.netlify/functions/exportLeads?format=${encodeURIComponent(format)}&ids=${encodeURIComponent(JSON.stringify(ids))}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!resp.ok) {
    const txt = await resp.text();
    alert(txt || `Export failed (${resp.status})`);
    return;
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

  // Download for pdf/csv
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = (format === "csv")
    ? `FVIA_Leads_${ids.length}.csv`
    : `FVIA_Leads_${ids.length}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
}

function getSelectedLeadIds() {
  return $$(".lead-checkbox:checked").map(cb => cb.dataset.id).filter(Boolean);
}

function updateLeadBulkUi() {
  const count = getSelectedLeadIds().length;

  // Your actual bulk controls in HTML
  const archiveBtn = $("#agent-archive-btn");
  const exportWrap = $("#agent-export-wrap");
  const exportMenu = $("#agent-export-menu");

  // Show/hide based on selection
  if (archiveBtn) archiveBtn.style.display = count > 0 ? "inline-flex" : "none";
  if (exportWrap) exportWrap.style.display = count > 0 ? "inline-block" : "none";

  // If nothing selected, force-close the export dropdown
  if (count === 0 && exportMenu) exportMenu.style.display = "none";

  // Keep master checkbox accurate
  const master = $("#select-all");
  const boxes = $$(".lead-checkbox");
  if (master) master.checked = boxes.length > 0 && boxes.every(b => b.checked);
}

function initExportDropdown() {
  const wrap = $("#agent-export-wrap");
  const btn  = $("#agent-export-btn");
  const menu = $("#agent-export-menu");
  if (!wrap || !btn || !menu) return;

  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    // only allow opening if something is selected
    if (getSelectedLeadIds().length === 0) return;
    menu.style.display = (menu.style.display === "block") ? "none" : "block";
  });

  // click outside closes it
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) menu.style.display = "none";
  });
}

function initLeadExportButtons() {
  const map = [
    ["pdf",  "#export-pdf,  [data-export='pdf'],  [data-export-format='pdf']"],
    ["csv",  "#export-csv,  [data-export='csv'],  [data-export-format='csv']"],
    ["print","#export-print,[data-export='print'],[data-export-format='print']"],
  ];

  map.forEach(([fmt, selector]) => {
    $$(selector).forEach(btn => {
      // prevent double-binding if load happens multiple times
      if (btn.dataset.boundExport === "1") return;
      btn.dataset.boundExport = "1";

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const ids = getSelectedLeadIds();
        if (!ids.length) {
          alert("Select at least one lead first.");
          return;
        }
        await exportSelectedLeads(fmt);
        $("#agent-export-menu") && ($("#agent-export-menu").style.display = "none");
      });
    });
  });
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function linesToArray(v) {
  return String(v || "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);
}

function arrToLines(arr) {
  return (arr || []).filter(Boolean).join("\n");
}

async function fetchContactLeads(contactId) {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return [];

  const isAdmin = !!agentProfile?.is_admin;

  let q = supabase
    .from("leads")
    .select("id, created_at, product_type, lead_type")
    .eq("contact_id", contactId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (!isAdmin) q = q.eq("assigned_to", user.id);

  const { data, error } = await q;

  if (error) {
    console.error("fetchContactLeads error:", error);
    return [];
  }
  return data || [];
}

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

async function contactHasInternalDnc(contactId) {
  const { data, error } = await supabase
    .from("internal_dnc")
    .select("id")
    .eq("contact_id", contactId)
    .eq("is_active", true)
    .limit(1);

  if (error) {
    console.error("DNC check failed", error);
    return true; // fail CLOSED
  }

  return (data || []).length > 0;
}

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
    return true; // fail closed
  }

  return (data || []).some(c =>
    (c.phones || []).some(p =>
      digits.includes(p.replace(/\D/g, "").slice(-10))
    )
  );
}
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
      internal_dnc:internal_dnc!internal_dnc_contact_id_fkey (
        id,
        is_active
      )
    `)
    .ilike("first_name", norm(first))
    .ilike("last_name", norm(last));

  if (error) {
    console.error("DNC duplicate check failed:", error);
    return true; // fail CLOSED
  }

  return (data || []).some(c => {
    // must have active internal DNC
    const hasActiveDnc = (c.internal_dnc || []).some(d => d.is_active);
    if (!hasActiveDnc) return false;

    // must match phone
    const existingPhones = (c.phones || []).map(digits10);
    return existingPhones.some(p => phoneDigits.includes(p));
  });
}
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

function contactToVCard(c) {
  const first = c.first_name || "";
  const last = c.last_name || "";
  const org = "Family Values Group";
  const phones = Array.isArray(c.phones) ? c.phones : (c.phones ? [c.phones] : []);
  const emails = Array.isArray(c.emails) ? c.emails : (c.emails ? [c.emails] : []);

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${last};${first};;;`,
    `FN:${[first, last].filter(Boolean).join(" ") || "Contact"}`,
    `ORG:${org}`,
    ...phones.map((p) => `TEL;TYPE=CELL:${toE164(p) || p}`),
    ...emails.map((e) => `EMAIL;TYPE=INTERNET:${e}`),
    "END:VCARD",
  ];
  return lines.join("\r\n");
}

function downloadText(filename, text, mime = "text/vcard;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
function dotHtml(needsDncCheck) {
  const cls = needsDncCheck ? "dnc-dot dnc-dot--bad" : "dnc-dot dnc-dot--ok";
  const label = needsDncCheck ? "Needs DNC check" : "DNC OK";
  return `<span class="${cls}" title="${label}" aria-label="${label}"></span>`;
}

// if lead has its own needs_dnc_check use it; otherwise fall back to the linked contact status
function leadNeedsDnc(lead, contactMap) {
  if (typeof lead.needs_dnc_check === "boolean") return lead.needs_dnc_check;
  const c = lead.contact_id ? contactMap.get(lead.contact_id) : null;
  if (c && typeof c.needs_dnc_check === "boolean") return c.needs_dnc_check;
  // safest default: if unknown, treat as needs check
  return true;
}
// ---------- floating labels ----------
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

// ---------- phone fields ----------
function formatUSPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "").slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function getPhoneValues() {
  return Array.from(document.querySelectorAll(".lead-phone-input"))
    .map((i) => String(i.value || "").replace(/\D/g, "")) // store digits only
    .filter((v) => v.length > 0);
}

function renderPhoneField(value = "") {
  const phoneList = document.getElementById("phone-list");
  if (!phoneList) return;

  const wrap = document.createElement("div");
  wrap.className = "field phone-field"; // <-- extra class for CSS targeting
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
    if (document.querySelectorAll(".lead-phone-input").length === 0) {
      renderPhoneField("");
    }
  });

  phoneList.appendChild(wrap);
  wrap.classList.toggle("filled", !!input.value.trim());
}

function initPhonesUI() {
  const phoneList = document.getElementById("phone-list");
  const addBtn = document.getElementById("add-phone");
  if (!phoneList || !addBtn) return;

  if (phoneList.children.length === 0) renderPhoneField("");

  addBtn.addEventListener("click", () => renderPhoneField(""));
}

// ---------- tab sections ----------
const getNavButtons = () => ({
  view: $("#nav-view"),
  submit: $("#nav-submit"),
  request: $("#nav-request"),
  contacts: $("#nav-contacts"),
  dnc: $("#nav-dnc"),
});

const getSections = () => ({
  view: $("#lead-viewer-section"),
  submit: $("#submit-lead-section"),
  request: $("#request-leads-section"),
  contacts: $("#contacts-section"),
  dnc: $("#dnc-list-section"),
});

function hideAll() {
  const secs = getSections();
  Object.values(secs).forEach((el) => el && (el.style.display = "none"));
  const navs = getNavButtons();
  Object.values(navs).forEach((btn) => btn?.classList.remove("active"));
}

function showSection(name) {
  const secs = getSections();
  const navs = getNavButtons();
  hideAll();
  secs[name] && (secs[name].style.display = "block");
  navs[name]?.classList.add("active");
}

// ---------- header dropdown ----------
function initAgentHubMenu() {
  const toggle = $("#agent-hub-toggle");
  const menu = $("#agent-hub-menu");
  if (!toggle || !menu) return;

  menu.style.display = "none";
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) menu.style.display = "none";
  });
}

// ---------- overlays ----------
function closeOverlaysOnClicks() {
  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-close], .overlay-backdrop")) {
      const ov = e.target.closest(".overlay");
      if (ov) {
        ov.classList.remove("open");
        ov.setAttribute("aria-hidden", "true");
      }
    }
  });
}

// ---------- profile ----------
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

// ---------- contact picker ----------
async function initContactPicker() {
  const el = document.getElementById("contact-picker");
  if (!el) return;

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  const isAdmin = !!agentProfile?.is_admin;

  let contactRows = [];

  if (isAdmin) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, phones, emails")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("contact picker load error:", error);
      return;
    }

    contactRows = data || [];
  } else {
    // get my contact ids via my leads
    const { data: myLeads, error: leadErr } = await supabase
      .from("leads")
      .select("contact_id")
      .eq("assigned_to", user.id)
      .not("contact_id", "is", null)
      .limit(5000);

    if (leadErr) {
      console.error("contact picker lead lookup error:", leadErr);
      return;
    }

    const ids = Array.from(new Set((myLeads || []).map(r => r.contact_id).filter(Boolean)));

    if (!ids.length) {
      contactRows = [];
    } else {
      const { data, error } = await supabase
        .from("contacts")
        .select("id, first_name, last_name, phones, emails")
        .in("id", ids)
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("contact picker load error:", error);
        return;
      }

      contactRows = data || [];
    }
  }

  el.innerHTML = `<option value="">New contact (auto-create)</option>`;
  (contactRows || []).forEach((c) => {
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(No name)";
    const phone = c.phones && c.phones[0] ? ` • ${c.phones[0]}` : "";
    const email = c.emails && c.emails[0] ? ` • ${c.emails[0]}` : "";
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${name}${phone}${email}`;
    el.appendChild(opt);
  });

  if (window.Choices) {
    if (contactChoices) contactChoices.destroy();
    contactChoices = new Choices(el, {
      searchEnabled: true,
      shouldSort: false,
      placeholder: true,
      placeholderValue: "Search contacts…",
      itemSelectText: "",
    });
  }

  initFloatingLabels(document);
}
function digits10(v) {
  return String(v || "").replace(/\D/g, "").slice(-10);
}

function phoneToAreaAndLocal7(phone) {
  const d = digits10(phone);
  if (d.length !== 10) return null;
  const areaCode = d.slice(0, 3);
  const local7Str = d.slice(3);        // keep leading zeros here (7 chars)
  const local7Int = parseInt(local7Str, 10); // integer for db compare
  return { areaCode, local7Str, local7Int };
}

async function isPhoneOnNationalDnc(phone) {
  const parts = phoneToAreaAndLocal7(phone);
  if (!parts) return false;

  const { areaCode, local7Int } = parts;

  const { data, error } = await supabase
    .from("dnc_ranges")
    .select("area_code")     // pick any existing column
    .eq("area_code", areaCode)
    .lte("start_local7", local7Int)
    .gte("end_local7", local7Int)
    .limit(1);

  if (error) {
    console.error("dnc_ranges check error:", error);
    // safest: if DNC check fails, treat as RED (on DNC) so you don't accidentally call
    return true;
  }

  return (data || []).length > 0;
}

async function phonesOnNationalDnc(phones) {
  const list = Array.isArray(phones) ? phones : [];
  for (const p of list) {
    if (await isPhoneOnNationalDnc(p)) return true; // ANY phone on DNC => RED
  }
  return false; // none on DNC => BLUE
}

async function getContactNeedsDnc(contactId) {
  const { data, error } = await supabase
    .from("contacts")
    .select("needs_dnc_check")
    .eq("id", contactId)
    .single();

  if (error) {
    console.error("getContactNeedsDnc error:", error);
    // safest fallback: RED
    return true;
  }
  return !!data?.needs_dnc_check;
}

async function ensureContactIdFromLeadForm() {
  const picker = document.getElementById("contact-picker");
  const chosenId = picker?.value || "";
  if (chosenId) return chosenId;

  const phones = getPhoneValues();
  const onNationalDnc = await phonesOnNationalDnc(phones);
  // ✅ contacts schema uses address_line1 / address_line2 (NOT address)
  const contactPayload = {
    first_name: $("#lead-first")?.value?.trim() || null,
    last_name: $("#lead-last")?.value?.trim() || null,
    phones: phones.length ? phones : null,
    owning_agent_id: (await supabase.auth.getSession()).data.session.user.id,
    address_line1: $("#lead-address")?.value?.trim() || null,
    address_line2: null,
    city: $("#lead-city")?.value?.trim() || null,
    state: $("#lead-state")?.value || null,
    zip: $("#lead-zip")?.value?.trim() || null,
    notes: $("#lead-notes")?.value?.trim() || null,
    needs_dnc_check: onNationalDnc,
  };

  const { data: inserted, error } = await supabase
    .from("contacts")
    .insert(contactPayload)
    .select("id")
    .single();

  if (error) {
    console.error("create contact error:", error);
    throw error;
  }

  await initContactPicker();
  return inserted.id;
}

// ---------- leads table ----------
function updatePaginationControls() {
  const label = $("#agent-current-page");
  const prev = $("#agent-prev-page");
  const next = $("#agent-next-page");

  if (label) label.textContent = `Page ${agentCurrentPage}`;

  if (prev) prev.disabled = agentCurrentPage === 1;
  if (next) next.disabled = agentCurrentPage === agentTotalPages;
}

async function loadAgentLeads() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  let { data: leads, error } = await supabase
    .from("leads")
    .select(`
      *,
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

  leads = (leads || []).filter(l => {
    const dnc = l.contacts?.internal_dnc || [];
    return dnc.length === 0; // keep only if NOT on internal DNC
  });
  agentTotalPages = Math.max(1, Math.ceil((leads.length || 0) / PAGE_SIZE));
  if (agentCurrentPage > agentTotalPages) agentCurrentPage = agentTotalPages;

  const start = (agentCurrentPage - 1) * PAGE_SIZE;
  const page = (leads || []).slice(start, start + PAGE_SIZE);

  const tbody = $("#agent-leads-table tbody");
  if (!tbody) return;
  
  const contactMap = new Map();
  (leads || []).forEach((l) => {
    if (l.contacts?.id) contactMap.set(l.contacts.id, l.contacts);
  });
  
  tbody.innerHTML = "";
  page.forEach((l) => {
    const tr = document.createElement("tr");
    const needsDnc = leadNeedsDnc(l, contactMap);
    tr.innerHTML = `
      <td><input type="checkbox" class="lead-checkbox" data-id="${l.id}"></td>
      <td class="dnc-cell">${dotHtml(needsDnc)}</td>
      <td>${l.created_at ? new Date(l.created_at).toLocaleDateString() : ""}</td>
      <td>${l.submitted_by_name || ""}</td>
      <td>${l.first_name || ""}</td>
      <td>${l.last_name || ""}</td>
      <td>${l.age ?? ""}</td>
      <td>${(l.phone || []).join(", ")}</td>
      <td>${l.address || ""}</td>
      <td>${l.city || ""}</td>
      <td>${l.state || ""}</td>
      <td>${l.zip || ""}</td>
      <td>${l.lead_type || ""}</td>
      <td>${l.product_type || ""}</td>
      <td>${l.notes || ""}</td>
    `;
    tbody.appendChild(tr);
  });

  // Keep bulk UI accurate when user checks/unchecks any row
  $$(".lead-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      if (bulkSelecting) return;
      updateLeadBulkUi();
    });
  });
  
  updateLeadBulkUi();
  updatePaginationControls();
}

let bulkSelecting = false;

function initSelectAll() {
  const master = $("#select-all");
  if (!master) return;

  if (master.dataset.bound === "1") return;
  master.dataset.bound = "1";

  master.addEventListener("change", () => {
    bulkSelecting = true;

    const on = master.checked;
    $$(".lead-checkbox").forEach(cb => { cb.checked = on; });

    bulkSelecting = false;
    updateLeadBulkUi();
  });
}

async function archiveSelectedLeads() {
  const ids = $$(".lead-checkbox:checked").map((cb) => cb.dataset.id);
  if (!ids.length) {
    alert("Select at least one lead.");
    return;
  }

  const warning = `
⚠️ WARNING: Archive Leads

You are about to archive ${ids.length} lead(s).

• Archived leads will NO LONGER be visible to you
• They CANNOT be restored by you
• They still count toward lead history & reporting

This action is effectively permanent for agents.

Do you want to continue?
`.trim();

  const confirmed = window.confirm(warning);
  if (!confirmed) return;

  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    alert("You are not logged in.");
    return;
  }

  const { error } = await supabase
    .from("leads")
    .update({
      archived: true,
      archived_at: new Date().toISOString(),
      archived_by: user.id,
    })
    .in("id", ids)
    .eq("assigned_to", user.id);

  if (error) {
    alert("Failed to archive leads.");
    console.error(error);
    return;
  }

  alert(`Archived ${ids.length} lead(s).`);

  const sa = $("#select-all");
  if (sa) sa.checked = false;

  await loadAgentLeads();
}

// ---------- contacts ----------
let contacts = [];
let selectMode = false;
const selectedIds = new Set();

function updateBulkBar() {
  const bar = $("#contacts-bulk-actions");
  const count = selectedIds.size;
  $("#contacts-selected-count") && ($("#contacts-selected-count").textContent = String(count));
  if (bar) bar.style.display = count > 0 ? "flex" : "none";
}

async function openContactDetail(c) {
  const modal = $("#contact-detail-modal");
  const title = $("#contact-modal-name");
  const body = $("#contact-modal-body");
  if (!modal || !title || !body) return;

  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contact";
  title.textContent = name;

  const addrText = [
    c.address_line1,
    c.address_line2,
    c.city,
    c.state,
    c.zip
  ].filter(Boolean).join(", ");

  body.innerHTML = `
    <div class="contact-ov">

      <!-- Phones -->
      <div class="contact-sec" data-sec="phones">
        <div class="contact-sec-head">
          <strong><i class="fa-solid fa-phone"></i> Phone(s)</strong>
          <button class="contact-edit-btn" data-edit="phones" title="Edit phones">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </div>

        <div class="contact-sec-view" data-view="phones">
          ${
            (c.phones || []).length
              ? (c.phones || []).map(p => `<a href="tel:${toE164(p) || p}">${escapeHtml(p)}</a>`).join("<br>")
              : "—"
          }
        </div>

        <div class="contact-sec-edit" data-form="phones" style="display:none;">
          <textarea id="edit-phones" rows="4" style="width:100%;padding:10px;border:1px solid #d6d9e2;border-radius:0;">${escapeHtml(arrToLines(c.phones || []))}</textarea>
          <small style="opacity:.75;">One phone per line</small>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="phones">Cancel</button>
            <button class="see-all" data-save="phones"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <!-- Emails -->
      <div class="contact-sec" data-sec="emails">
        <div class="contact-sec-head">
          <strong><i class="fa-solid fa-envelope"></i> Email(s)</strong>
          <button class="contact-edit-btn" data-edit="emails" title="Edit emails">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </div>

        <div class="contact-sec-view" data-view="emails">
          ${
            (c.emails || []).length
              ? (c.emails || []).map(e => `<a href="mailto:${escapeHtml(e)}">${escapeHtml(e)}</a>`).join("<br>")
              : "—"
          }
        </div>

        <div class="contact-sec-edit" data-form="emails" style="display:none;">
          <textarea id="edit-emails" rows="4" style="width:100%;padding:10px;border:1px solid #d6d9e2;border-radius:0;">${escapeHtml(arrToLines(c.emails || []))}</textarea>
          <small style="opacity:.75;">One email per line</small>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="emails">Cancel</button>
            <button class="see-all" data-save="emails"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <!-- Address -->
      <div class="contact-sec" data-sec="address">
        <div class="contact-sec-head">
          <strong><i class="fa-solid fa-location-dot"></i> Address</strong>
          <button class="contact-edit-btn" data-edit="address" title="Edit address">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </div>

        <div class="contact-sec-view" data-view="address">
          ${escapeHtml(addrText || "—")}
        </div>

        <div class="contact-sec-edit" data-form="address" style="display:none;">
          <input id="edit-address1" type="text" placeholder="Address line 1" value="${escapeHtml(c.address_line1 || "")}" style="width:100%;padding:10px;border:1px solid #d6d9e2;border-radius:0;margin-bottom:8px;">
          <input id="edit-address2" type="text" placeholder="Address line 2" value="${escapeHtml(c.address_line2 || "")}" style="width:100%;padding:10px;border:1px solid #d6d9e2;border-radius:0;margin-bottom:8px;">
          <div style="display:grid;grid-template-columns:1fr 120px 120px;gap:8px;">
            <input id="edit-city"  type="text" placeholder="City"  value="${escapeHtml(c.city || "")}" style="padding:10px;border:1px solid #d6d9e2;border-radius:0;">
            <input id="edit-state" type="text" placeholder="State" value="${escapeHtml(c.state || "")}" style="padding:10px;border:1px solid #d6d9e2;border-radius:0;">
            <input id="edit-zip"   type="text" placeholder="ZIP"   value="${escapeHtml(c.zip || "")}" style="padding:10px;border:1px solid #d6d9e2;border-radius:0;">
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="address">Cancel</button>
            <button class="see-all" data-save="address"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <!-- Notes -->
      <div class="contact-sec" data-sec="notes">
        <div class="contact-sec-head">
          <strong><i class="fa-solid fa-note-sticky"></i> Notes</strong>
          <button class="contact-edit-btn" data-edit="notes" title="Edit notes">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </div>

        <div class="contact-sec-view" data-view="notes">
          ${c.notes ? escapeHtml(c.notes) : "—"}
        </div>

        <div class="contact-sec-edit" data-form="notes" style="display:none;">
          <textarea id="edit-notes" rows="5" style="width:100%;padding:10px;border:1px solid #d6d9e2;border-radius:0;">${escapeHtml(c.notes || "")}</textarea>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;">
            <button class="see-all" data-cancel="notes">Cancel</button>
            <button class="see-all" data-save="notes"><i class="fa-solid fa-floppy-disk"></i> Save</button>
          </div>
        </div>
      </div>

      <!-- Connected Leads -->
      <div class="contact-sec" data-sec="leads">
        <div class="contact-sec-head">
          <strong><i class="fa-solid fa-link"></i> Connected Leads</strong>
        </div>
        <div id="contact-leads-list" style="opacity:.85;">Loading…</div>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
        <button id="contact-save-one" class="see-all"><i class="fa-solid fa-download"></i> Save to phone (.vcf)</button>
      </div>

    </div>
  `;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  // Save single
  $("#contact-save-one")?.addEventListener("click", () =>
    downloadText(`${name || "contact"}.vcf`, contactToVCard(c))
  );

  // Load connected leads
  const leadsBox = $("#contact-leads-list");
  const leads = await fetchContactLeads(c.id);
  if (leadsBox) {
    if (!leads.length) {
      leadsBox.textContent = "—";
    } else {
      leadsBox.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:6px;">
          ${leads.map(l => {
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

  // Edit toggles
  function showEdit(sec) {
    body.querySelector(`[data-view="${sec}"]`)?.setAttribute("style", "display:none;");
    body.querySelector(`[data-form="${sec}"]`)?.setAttribute("style", "display:block;");
  }
  function hideEdit(sec) {
    body.querySelector(`[data-form="${sec}"]`)?.setAttribute("style", "display:none;");
    body.querySelector(`[data-view="${sec}"]`)?.setAttribute("style", "display:block;");
  }

  body.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => showEdit(btn.getAttribute("data-edit")));
  });

  body.querySelectorAll("[data-cancel]").forEach(btn => {
    btn.addEventListener("click", () => hideEdit(btn.getAttribute("data-cancel")));
  });

  // Saves
  body.querySelectorAll("[data-save]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const sec = btn.getAttribute("data-save");
      let update = {};

      if (sec === "phones") {
        update.phones = linesToArray($("#edit-phones")?.value);
      }
      if (sec === "emails") {
        update.emails = linesToArray($("#edit-emails")?.value);
      }
      if (sec === "notes") {
        update.notes = ($("#edit-notes")?.value || "").trim() || null;
      }
      if (sec === "address") {
        update.address_line1 = ($("#edit-address1")?.value || "").trim() || null;
        update.address_line2 = ($("#edit-address2")?.value || "").trim() || null;
        update.city = ($("#edit-city")?.value || "").trim() || null;
        update.state = ($("#edit-state")?.value || "").trim() || null;
        update.zip = ($("#edit-zip")?.value || "").trim() || null;
      }

      const { data: updated, error } = await supabase
        .from("contacts")
        .update(update)
        .eq("id", c.id)
        .select("*")
        .single();

      if (error) {
        alert("Failed to save contact changes.");
        console.error(error);
        return;
      }

      // update local cache + re-render list
      const idx = contacts.findIndex(x => x.id === c.id);
      if (idx >= 0) contacts[idx] = updated;

      // reopen overlay with fresh data (keeps everything in sync)
      renderContacts();
      openContactDetail(updated);
    });
  });
}

function renderContacts() {
  const wrap = $("#contacts-list");
  if (!wrap) return;

  wrap.innerHTML = "";

  const q = ($("#contacts-search")?.value || "").toLowerCase();
  const order = $("#contacts-order")?.value || "created_desc";

  let list = contacts.slice();

  if (q) {
    list = list.filter((c) => {
      const name = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
      const phones = (c.phones || []).join(" ").toLowerCase();
      const emails = (c.emails || []).join(" ").toLowerCase();
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
  head.style.cssText =
    "display:grid;grid-template-columns:40px 1fr 1fr 1fr;gap:8px;padding:10px 14px;border-bottom:1px solid #eef0f6;background:#f9fafe;";
  head.innerHTML = `
    <div>${selectMode ? '<i class="fa-regular fa-square-check"></i>' : ""}</div>
    <div><strong>Name</strong></div>
    <div><strong>Phone</strong></div>
    <div><strong>Email</strong></div>
  `;
  wrap.appendChild(head);

  list.forEach((c) => {
    const row = document.createElement("div");
    row.className = "contact-row";
    row.style.cssText =
      "display:grid;grid-template-columns:40px 1fr 1fr 1fr;gap:8px;align-items:center;padding:12px 14px;border-bottom:1px solid #f1f2f6;cursor:pointer;";

    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "(No name)";
    const phone = c.phones && c.phones[0] ? c.phones[0] : "";
    const email = c.emails && c.emails[0] ? c.emails[0] : "";
    const checked = selectedIds.has(c.id) ? "checked" : "";

    row.innerHTML = `
      <div>${
        selectMode
          ? `<input type="checkbox" class="contact-cb" data-id="${c.id}" ${checked}>`
          : `${dotHtml(!!c.needs_dnc_check)}`
      }</div>
      <div><i class="fa-solid fa-id-card-clip" style="margin-right:6px;"></i>${name}</div>
      <div><i class="fa-solid fa-phone" style="margin-right:6px;"></i>${phone || "—"}</div>
      <div><i class="fa-solid fa-envelope" style="margin-right:6px;"></i>${email || "—"}</div>
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
  });

  updateBulkBar();
}

async function loadContacts() {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return;

  // Admins can see all contacts (optional)
  const isAdmin = !!agentProfile?.is_admin;
  if (isAdmin) {
    const { data, error } = await supabase
      .from("contacts")
      .select(`
        *,
        internal_dnc:internal_dnc!internal_dnc_contact_id_fkey ( id )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("contacts load error", error);
      return;
    }

    contacts = (data || []).filter(c => (c.internal_dnc || []).length === 0);
    renderContacts();
    return;
  }

  // 1) Get my lead-linked contact IDs
  const { data: myLeads, error: leadErr } = await supabase
    .from("leads")
    .select("contact_id")
    .eq("assigned_to", user.id)
    .eq("archived", false)
    .not("contact_id", "is", null)
    .limit(5000);

  if (leadErr) {
    console.error("contacts lead lookup error", leadErr);
    contacts = [];
    renderContacts();
    return;
  }

  const ids = Array.from(new Set((myLeads || []).map(r => r.contact_id).filter(Boolean)));
  if (!ids.length) {
    contacts = [];
    renderContacts();
    return;
  }

  // 2) Load only those contacts
  const { data, error } = await supabase
    .from("contacts")
    .select(`
      *,
      internal_dnc:internal_dnc!internal_dnc_contact_id_fkey ( id )
    `)
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("contacts load error", error);
    return;
  }

  contacts = (data || []).filter(c => (c.internal_dnc || []).length === 0);
  renderContacts();
}

function saveSelectedContacts() {
  const pick = contacts.filter((c) => selectedIds.has(c.id));
  if (!pick.length) return;
  const text = pick.map(contactToVCard).join("\r\n\r\n");
  downloadText(`FVIA_Contacts_${pick.length}.vcf`, text);
}

async function addSelectedContactsToDnc() {
  const ids = Array.from(selectedIds);
  if (!ids.length) return;

  const confirmed = window.confirm(
    `⚠️ Add to Do Not Call\n\nYou are about to mark ${ids.length} contact(s) as INTERNAL DNC (active).\n\nThey will disappear from your contacts list and their leads will be filtered out.\n\nContinue?`
  );
  if (!confirmed) return;

  const reason = "Agent marked Do Not Call";
  const notes = null;

  const { data, error } = await supabase.rpc("add_contacts_to_internal_dnc", {
    p_contact_ids: ids,
    p_reason: reason,
    p_notes: notes,
  });

  if (error) {
    console.error(error);
    alert("Failed to add to internal DNC.");
    return;
  }

  const inserted = Array.isArray(data) ? data[0]?.inserted_count : data?.inserted_count;
  alert(`Done. Added ${inserted ?? 0} contact(s) to internal DNC.`);

  // Clear selection + refresh lists
  selectedIds.clear();
  await loadContacts();
  await loadAgentLeads();
}

// ---------- submit lead ----------
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
    if (phones.length === 0) {
      if (msg) msg.textContent = "Please add at least 1 phone number.";
      return;
    }
      // 🚫 BLOCK NEW CONTACT IF SAME NAME + PHONE EXISTS ON INTERNAL DNC
    const picker = document.getElementById("contact-picker");
    const chosenId = picker?.value || "";
  
    // Only block here if creating a NEW contact
    if (!chosenId) {
      const blocked = await duplicateOnInternalDnc(
        $("#lead-first")?.value,
        $("#lead-last")?.value,
        phones
      );
  
      if (blocked) {
        if (msg) {
          msg.textContent =
            "This person has requested not to be contacted. Lead submission blocked.";
        }
        return;
      }
    }
    let contactId = null;
    
    try {
      contactId = await ensureContactIdFromLeadForm();
      // ❌ INTERNAL DNC BLOCK
      if (await contactHasInternalDnc(contactId)) {
        if (msg) msg.textContent = "This contact is on the internal Do Not Contact list.";
        return;
      }
    } catch (err) {
      console.error(err);
      if (msg) msg.textContent = "Failed creating contact.";
      return;
    }
    
    const contactNeedsDnc = chosenId
      ? await getContactNeedsDnc(contactId)      // attach => use existing contact color
      : await getContactNeedsDnc(contactId);     // new contact just created => read it back
    
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
      needs_dnc_check: contactNeedsDnc,
      submitted_by: session.user.id,
      assigned_to: session.user.id,

      submitted_by_name: agentProfile
        ? `${agentProfile.first_name || ""} ${agentProfile.last_name || ""}`.trim()
        : null,
    };

    const { error } = await supabase.from("leads").insert(payload);
    if (error) {
      console.error("Insert lead error:", error);
      if (msg) msg.textContent = `Failed: ${error.message}`;
      return;
    }

    if (msg) msg.textContent = "Lead submitted!";

    form.reset();
    $$("#lead-form .field").forEach((f) => f.classList.remove("filled"));

    const phoneList = $("#phone-list");
    if (phoneList) phoneList.innerHTML = "";
    renderPhoneField("");

    agentCurrentPage = 1;
    await loadAgentLeads();
    showSection("view");
  });
}
function submitLeadRequestToSupabase(agentProfile) {
  const form = document.getElementById("lead-request-form");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const msg = document.getElementById("request-message");
    if (msg) msg.textContent = "Submitting request...";

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      if (msg) msg.textContent = "You are not logged in.";
      return;
    }

    const productType = document.getElementById("request-product-type")?.value || null;
    const leadType    = document.getElementById("request-lead-type")?.value || null;
    const qtyEl = document.getElementById("request-qty");
    const qtyRaw = (qtyEl?.value ?? "").trim();
    const qty = qtyRaw === "" ? 1 : parseInt(qtyRaw, 10);
    
    if (!Number.isFinite(qty) || qty < 1) {
      if (msg) msg.textContent = "Requested quantity must be 1 or more.";
      return;
    }
    const notes       = (document.getElementById("request-notes")?.value || "").trim() || null;

    const state = document.getElementById("request-state")?.value || null;
    const city  = (document.getElementById("request-city")?.value || "").trim() || null;
    const zip   = (document.getElementById("request-zip")?.value || "").trim() || null;

    const payload = {
      submitted_by: user.id,
      submitted_by_name: agentProfile
        ? `${agentProfile.first_name || ""} ${agentProfile.last_name || ""}`.trim()
        : null,
      requested_count: qty,
      product_type: productType,
      lead_type: leadType,
      state,
      city,
      zip,
      notes
    };

    const { error } = await supabase.from("lead_requests").insert(payload);

    if (error) {
      console.error("lead_requests insert error:", error);
      if (msg) msg.textContent = `Failed: ${error.message}`;
      return;
    }

    if (msg) msg.textContent = "Request submitted!";
    form.reset();
    document.querySelectorAll("#lead-request-form .field").forEach((f) => f.classList.remove("filled"));
  });
}

// ---------- DOMContentLoaded ----------
document.addEventListener("DOMContentLoaded", async () => {
  initAgentHubMenu();
  closeOverlaysOnClicks();
  initFloatingLabels(document);
  initLeadExportButtons();
  initExportDropdown();
  initSelectAll();

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }
  const { error: dncErr } = await supabase.rpc('expire_dnc_for_agent_contacts', {
    p_agent_id: session.user.id
  });
  if (dncErr) console.error('expire_dnc_for_agent_contacts failed:', dncErr);
  agentProfile = await fetchAgentProfile();
  submitLeadRequestToSupabase(agentProfile);
  
  if (!agentProfile?.is_admin) {
    $$(".admin-only").forEach((el) => (el.style.display = "none"));
  }

  // Tabs
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
    $("#dnc-result") && ($("#dnc-result").style.display = "none");
  });
  

  showSection("view");

  // Leads
  await loadAgentLeads();
  $("#agent-next-page")?.addEventListener("click", async () => {
    if (agentCurrentPage < agentTotalPages) {
      agentCurrentPage++;
      await loadAgentLeads();
    }
  });
  $("#agent-prev-page")?.addEventListener("click", async () => {
    if (agentCurrentPage > 1) {
      agentCurrentPage--;
      await loadAgentLeads();
    }
  });

  $("#agent-archive-btn")?.addEventListener("click", archiveSelectedLeads);

  // Contacts wiring
  $("#contacts-refresh")?.addEventListener("click", loadContacts);
  $("#contacts-search")?.addEventListener("input", renderContacts);
  $("#contacts-order")?.addEventListener("change", renderContacts);
  $("#contacts-bulk-route")?.addEventListener("click", () => {
    alert("Route: coming soon");
  });
  $("#contacts-bulk-quote")?.addEventListener("click", () => {
    alert("Quote: coming soon");
  });
  $("#contacts-bulk-schedule")?.addEventListener("click", () => {
    alert("Schedule: coming soon");
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
    const allIds = contacts.map((c) => c.id);
    const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));
    if (allSelected) allIds.forEach((id) => selectedIds.delete(id));
    else allIds.forEach((id) => selectedIds.add(id));
    renderContacts();
  });

  $("#contacts-bulk-save")?.addEventListener("click", saveSelectedContacts);

  // Submit lead
  await initContactPicker();
  initPhonesUI();
  submitLeadToSupabase(agentProfile);

  // Logout
  $("#logout-btn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signOut();
    if (error) alert("Logout failed!");
    else window.location.href = "../index.html";
  });
});
