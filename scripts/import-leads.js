import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/**
 * Prefer your existing initialized client if present.
 * Otherwise fall back to createClient.
 */
const supabase =
  window.supabaseClient ||
  window.supabase ||
  createClient(
    "https://ddlbgkolnayqrxslzsxn.supabase.co",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho"
  );

/**
 * ✅ Round-robin assignment target agents
 * Row 0 -> agentIds[0]
 * Row 1 -> agentIds[1]
 * Row 2 -> agentIds[0]
 * ...
 */
const agentIds = [
  "1153ef63-bfb1-4d94-ad21-9c4031e5fd77",
  "75c1df7d-938e-4236-9494-d3f57058dddb",
];

// ---------- DOM ----------
const csvFile = document.getElementById("csvFile");
const parseBtn = document.getElementById("parseBtn");
const importBtn = document.getElementById("importBtn");

const rowCount = document.getElementById("rowCount");
const parsedCount = document.getElementById("parsedCount");
const importedCount = document.getElementById("importedCount");
const errorCount = document.getElementById("errorCount");
const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");

const previewHead = document.getElementById("previewHead");
const previewBody = document.getElementById("previewBody");

const hubToggle = document.getElementById("agent-hub-toggle");
const hubMenu = document.getElementById("agent-hub-menu");

let parsedRows = [];
let headers = [];

// ---------- helpers ----------
const digitsOnly = (v) => String(v || "").replace(/\D/g, "");

function normalizePhone10(v) {
  const d = digitsOnly(v);
  const last10 = d.length > 10 ? d.slice(-10) : d;
  if (last10.length < 10) return null;
  return last10;
}

function pickPhonesFromRow(r) {
  const out = [];
  const cols = [
    r.cell_phone,
    r.landline,
    r.recent_cell_phone_1,
    r.recent_cell_phone_2,
    r.recent_cell_phone_3,
    r.recent_landline_1,
  ];
  cols.forEach((x) => {
    const p = normalizePhone10(x);
    if (p && !out.includes(p)) out.push(p);
  });
  return out;
}

function pickEmailsFromRow(r) {
  const out = [];
  const cols = [r.email, r.recent_email_1, r.recent_email_2];
  cols.forEach((x) => {
    const e = String(x || "").trim();
    if (!e) return;
    if (!out.includes(e)) out.push(e);
  });
  return out;
}

function zip5(zipPlusFour) {
  const z = String(zipPlusFour || "").trim();
  if (!z) return null;
  const m = z.match(/^(\d{5})/);
  return m ? m[1] : z;
}

function safeIsoDate(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Everything that isn’t mapped cleanly gets shoved in notes as JSON.
 */
function buildExtraNotes(row) {
  const mapped = new Set([
    "lead_id",
    "first_name",
    "last_name",
    "applicant_name",
    "address",
    "city",
    "state",
    "zip_plus_four",
    "cell_phone",
    "landline",
    "recent_cell_phone_1",
    "recent_cell_phone_2",
    "recent_cell_phone_3",
    "recent_landline_1",
    "email",
    "recent_email_1",
    "recent_email_2",
    "policy_type",
    "date_requested",
    "jornaya_lead_id",
    "trusted_form",
  ]);

  const extra = {};
  Object.keys(row || {}).forEach((k) => {
    if (mapped.has(k)) return;
    const v = row[k];
    if (v === null || v === undefined || String(v).trim() === "") return;
    extra[k] = v;
  });

  if (row.lead_id) extra.source_lead_id = row.lead_id;
  if (row.jornaya_lead_id) extra.jornaya_lead_id = row.jornaya_lead_id;
  if (row.trusted_form) extra.trusted_form = row.trusted_form;

  if (!Object.keys(extra).length) return "";
  return `\n\n--- IMPORT EXTRA (NextWave) ---\n${JSON.stringify(extra, null, 2)}`;
}

function setStatus(text, isBad = false) {
  statusEl.textContent = text;
  statusEl.style.color = isBad ? "#b00020" : "#353468";
}

function setProgress(pct) {
  progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function showOneError(e) {
  const msg =
    e?.message ||
    e?.error_description ||
    e?.hint ||
    (typeof e === "string" ? e : "") ||
    "Unknown error (check console)";
  setStatus(`ERROR: ${msg}`, true);
}

// ---------- header dropdown ----------
function initAgentHubMenu() {
  if (!hubToggle || !hubMenu) return;
  hubMenu.style.display = "none";
  hubToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    hubMenu.style.display = hubMenu.style.display === "block" ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) hubMenu.style.display = "none";
  });
}

// ---------- auth gate ----------
async function requireLogin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }

  // hide admin-only if not admin
  const { data: me } = await supabase
    .from("agents")
    .select("is_admin, first_name, last_name")
    .eq("id", session.user.id)
    .single();

  if (!me?.is_admin) {
    document.querySelectorAll(".admin-only").forEach((el) => (el.style.display = "none"));
  }

  return { session, me };
}

// ---------- CSV parsing ----------
function renderPreview(rows) {
  previewHead.innerHTML = "";
  previewBody.innerHTML = "";

  const cols = headers.slice(0, 10);
  const trh = document.createElement("tr");
  cols.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    trh.appendChild(th);
  });
  previewHead.appendChild(trh);

  rows.slice(0, 10).forEach((r) => {
    const tr = document.createElement("tr");
    cols.forEach((h) => {
      const td = document.createElement("td");
      td.textContent = r[h] ?? "";
      tr.appendChild(td);
    });
    previewBody.appendChild(tr);
  });
}

function parseCsvFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      complete: (res) => resolve(res),
      error: (err) => reject(err),
    });
  });
}

// ---------- Supabase helpers ----------
async function findExistingContactByPhone(phone10) {
  const { data, error } = await supabase
    .from("contacts")
    .select("id, phones")
    .contains("phones", [phone10])
    .limit(1);

  if (error) return null;
  return data?.[0] || null;
}

async function createContactFromRow(row, targetAgentId) {
  const phones = pickPhonesFromRow(row);
  const emails = pickEmailsFromRow(row);

  // Reuse contact if we match by first phone
  if (phones.length) {
    const existing = await findExistingContactByPhone(phones[0]);
    if (existing?.id) return { id: existing.id, reused: true };
  }

  const consentAt = safeIsoDate(row.date_requested);
  const tcpaconsent = !!(
    String(row.jornaya_lead_id || "").trim() ||
    String(row.trusted_form || "").trim()
  );

  const baseNotes =
    `Imported from NextWave\n` +
    `date_requested: ${row.date_requested || "—"}\n` +
    `policy_type: ${row.policy_type || "—"}\n` +
    (row.jornaya_lead_id ? `jornaya_lead_id: ${row.jornaya_lead_id}\n` : "") +
    (row.trusted_form ? `trusted_form: ${row.trusted_form}\n` : "");

  const extraNotes = buildExtraNotes(row);

  const payload = {
    first_name: (row.first_name || "").trim() || null,
    last_name: (row.last_name || "").trim() || null,
    phones: phones.length ? phones : [],
    emails: emails.length ? emails : [],
    address_line1: (row.address || "").trim() || null,
    address_line2: null,
    city: (row.city || "").trim() || null,
    state: (row.state || "").trim() || null,
    zip: zip5(row.zip_plus_four),
    owning_agent_id: targetAgentId,

    // Your schema supports these:
    consent_source: "NextWave",
    consent_at: consentAt,
    tcpaconsent,
    // safest default: flag for review
    needs_dnc_check: true,

    // you also have contacts.email text (single) — we’ll mirror first email if present
    email: emails[0] || null,

    notes: (baseNotes + extraNotes).trim() || null,
  };

  const { data, error } = await supabase
    .from("contacts")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;
  return { id: data.id, reused: false };
}

async function createLeadFromRow(row, session, me, contactId, targetAgentId) {
  const phones = pickPhonesFromRow(row);
  const emails = pickEmailsFromRow(row);

  const baseNotes =
    `Imported from NextWave\n` +
    `source lead_id: ${row.lead_id || "—"}\n` +
    `date_requested: ${row.date_requested || "—"}\n` +
    `policy_type: ${row.policy_type || "—"}\n` +
    (row.jornaya_lead_id ? `jornaya_lead_id: ${row.jornaya_lead_id}\n` : "") +
    (row.trusted_form ? `trusted_form: ${row.trusted_form}\n` : "");

  const extraNotes = buildExtraNotes(row);

  const nowIso = new Date().toISOString();

  const payload = {
    first_name: (row.first_name || "").trim() || "Unknown",
    last_name: (row.last_name || "").trim() || "Unknown",
    contact_id,

    age: null,
    address: (row.address || "").trim() || null,
    city: (row.city || "").trim() || null,
    state: (row.state || "").trim() || null,
    zip: zip5(row.zip_plus_four),

    product_type: (row.policy_type || "").trim() || null,
    lead_type: "NextWave",

    notes: (baseNotes + extraNotes).trim() || null,

    phone: phones.length ? phones : [],
    email: emails[0] || null,

    // required
    submitted_by: session.user.id,

    // round robin assignment
    assigned_to: targetAgentId,
    assigned_at: nowIso,

    submitted_by_name: me
      ? `${me.first_name || ""} ${me.last_name || ""}`.trim()
      : null,
  };

  const { error } = await supabase.from("leads").insert(payload);
  if (error) throw error;
}

// ---------- concurrency pool ----------
async function runPool(items, worker, concurrency = 3) {
  let i = 0;
  const results = [];
  const runners = new Array(concurrency).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

// ---------- main ----------
document.addEventListener("DOMContentLoaded", async () => {
  initAgentHubMenu();

  const auth = await requireLogin();
  if (!auth) return;

  const { session, me } = auth;

  csvFile.addEventListener("change", () => {
    parseBtn.disabled = !csvFile.files?.[0];
    importBtn.disabled = true;
    parsedRows = [];
    headers = [];
    rowCount.textContent = "—";
    parsedCount.textContent = "—";
    importedCount.textContent = "0";
    errorCount.textContent = "0";
    setStatus("File selected. Click Parse.");
    setProgress(0);
    previewHead.innerHTML = "";
    previewBody.innerHTML = "";
  });

  parseBtn.addEventListener("click", async () => {
    const file = csvFile.files?.[0];
    if (!file) return;

    setStatus("Parsing CSV…");
    setProgress(10);

    try {
      const res = await parseCsvFile(file);
      headers = res.meta?.fields || Object.keys(res.data?.[0] || {});
      parsedRows = (res.data || []).filter((r) => {
        const hasName = String(r.first_name || r.last_name || "").trim().length > 0;
        const hasPhone = pickPhonesFromRow(r).length > 0;
        return hasName || hasPhone;
      });

      rowCount.textContent = String(res.data?.length || 0);
      parsedCount.textContent = String(parsedRows.length);
      renderPreview(parsedRows);

      importBtn.disabled = parsedRows.length === 0;
      setStatus(`Parsed ${parsedRows.length} row(s). Ready to import.`);
      setProgress(25);
    } catch (e) {
      console.error(e);
      showOneError(e);
      setProgress(0);
    }
  });

  importBtn.addEventListener("click", async () => {
    if (!parsedRows.length) return;

    const confirmed = window.confirm(
      `Import ${parsedRows.length} leads?\n\nThis will create Contacts + Leads in Supabase.\n\nAssignment will alternate between:\n1) ${agentIds[0]}\n2) ${agentIds[1]}`
    );
    if (!confirmed) return;

    importBtn.disabled = true;
    parseBtn.disabled = true;
    csvFile.disabled = true;

    let ok = 0;
    let bad = 0;
    importedCount.textContent = "0";
    errorCount.textContent = "0";
    setProgress(30);
    setStatus("Importing… do not close this tab.");

    let firstErrorShown = false;

    await runPool(
      parsedRows,
      async (row, idx) => {
        const targetAgentId = agentIds[idx % agentIds.length];

        try {
          const c = await createContactFromRow(row, targetAgentId);
          await createLeadFromRow(row, session, me, c.id, targetAgentId);

          ok++;
          importedCount.textContent = String(ok);
        } catch (e) {
          bad++;
          errorCount.textContent = String(bad);
          console.error("[IMPORT ERROR]", idx, e, row);

          if (!firstErrorShown) {
            firstErrorShown = true;
            showOneError(e);
          }
        } finally {
          const pct = 30 + Math.round(((idx + 1) / parsedRows.length) * 70);
          setProgress(pct);
          if (!firstErrorShown) {
            setStatus(`Importing… ${idx + 1}/${parsedRows.length} processed.`);
          }
        }
      },
      3
    );

    setProgress(100);
    if (bad === 0) {
      setStatus(`Done. Imported ${ok}/${parsedRows.length}. Errors: ${bad}.`);
    } else {
      setStatus(
        `Done with errors. Imported ${ok}/${parsedRows.length}. Errors: ${bad}. Check console for details.`,
        true
      );
    }

    importBtn.disabled = false;
    parseBtn.disabled = false;
    csvFile.disabled = false;
  });
});
