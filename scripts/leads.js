// scripts/leads.js — DROP-IN REPLACEMENT

let agentProfile = null;
let agentCurrentPage = 1;
let agentTotalPages = 1;
const PAGE_SIZE = 25;

let contactChoices = null;

// ---------- helpers ----------
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
  const org = "Family Values Insurance Agency";
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
});

const getSections = () => ({
  view: $("#lead-viewer-section"),
  submit: $("#submit-lead-section"),
  request: $("#request-leads-section"),
  contacts: $("#contacts-section"),
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

  const { data, error } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, phones, emails")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("contact picker load error:", error);
    return;
  }

  el.innerHTML = `<option value="">New contact (auto-create)</option>`;
  (data || []).forEach((c) => {
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

async function ensureContactIdFromLeadForm() {
  const picker = document.getElementById("contact-picker");
  const chosenId = picker?.value || "";
  if (chosenId) return chosenId;

  const phones = getPhoneValues();

  // ✅ contacts schema uses address_line1 / address_line2 (NOT address)
  const contactPayload = {
    first_name: $("#lead-first")?.value?.trim() || null,
    last_name: $("#lead-last")?.value?.trim() || null,
    phones: phones.length ? phones : null,

    address_line1: $("#lead-address")?.value?.trim() || null,
    address_line2: null,

    city: $("#lead-city")?.value?.trim() || null,
    state: $("#lead-state")?.value || null,
    zip: $("#lead-zip")?.value?.trim() || null,
    notes: $("#lead-notes")?.value?.trim() || null,
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
  $("#agent-current-page") && ($("#agent-current-page").textContent = `Page ${agentCurrentPage}`);
  $("#agent-prev-page")?.toggleAttribute("disabled", agentCurrentPage === 1);
  $("#agent-next-page")?.toggleAttribute("disabled", agentCurrentPage === agentTotalPages);
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

  const master = $("#select-all");
  if (master) {
    $$(".lead-checkbox").forEach((cb) => {
      cb.addEventListener("change", () => {
        const boxes = $$(".lead-checkbox");
        master.checked = boxes.length > 0 && boxes.every((b) => b.checked);
      });
    });
  }

  updatePaginationControls();
}

function initSelectAll() {
  const master = $("#select-all");
  if (!master) return;
  master.addEventListener("change", () => {
    const on = master.checked;
    $$(".lead-checkbox").forEach((cb) => (cb.checked = on));
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

function openContactDetail(c) {
  const modal = $("#contact-detail-modal");
  const title = $("#contact-modal-name");
  const body = $("#contact-modal-body");
  if (!modal || !title || !body) return;

  const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Contact";

  title.textContent = name;

  // ✅ contacts schema uses address_line1/address_line2
  const addr = [
    c.address_line1,
    c.address_line2,
    c.city,
    c.state,
    c.zip
  ].filter(Boolean).join(", ");

  body.innerHTML = `
    <p><strong><i class="fa-solid fa-phone"></i> Phone(s):</strong><br>${
      (c.phones || []).map((p) => `<a href="tel:${toE164(p) || p}">${p}</a>`).join("<br>") || "—"
    }</p>
    <p><strong><i class="fa-solid fa-envelope"></i> Email(s):</strong><br>${
      (c.emails || []).map((e) => `<a href="mailto:${e}">${e}</a>`).join("<br>") || "—"
    }</p>
    <p><strong><i class="fa-solid fa-location-dot"></i> Address:</strong><br>${addr || "—"}</p>
    ${c.notes ? `<p><strong><i class="fa-solid fa-note-sticky"></i> Notes:</strong><br>${c.notes}</p>` : ""}
    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
      <button id="contact-save-one" class="see-all"><i class="fa-solid fa-download"></i> Save to phone (.vcf)</button>
    </div>
  `;

  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");

  $("#contact-save-one")?.addEventListener("click", () =>
    downloadText(`${name || "contact"}.vcf`, contactToVCard(c))
  );
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
  contacts = (data || []).filter(c => {
    const dnc = c.internal_dnc || [];
    return dnc.length === 0;
  });
  renderContacts();
}

function saveSelectedContacts() {
  const pick = contacts.filter((c) => selectedIds.has(c.id));
  if (!pick.length) return;
  const text = pick.map(contactToVCard).join("\r\n");
  downloadText(`FVIA_Contacts_${pick.length}.vcf`, text);
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

// ---------- DOMContentLoaded ----------
document.addEventListener("DOMContentLoaded", async () => {
  initAgentHubMenu();
  closeOverlaysOnClicks();
  initFloatingLabels(document);

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

  initSelectAll();
  $("#agent-archive-btn")?.addEventListener("click", archiveSelectedLeads);

  // Contacts wiring
  $("#contacts-refresh")?.addEventListener("click", loadContacts);
  $("#contacts-search")?.addEventListener("input", renderContacts);
  $("#contacts-order")?.addEventListener("change", renderContacts);

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
