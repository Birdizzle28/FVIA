let sb = null;
let me = null;
let isAdmin = false;
let currentEventId = null;

let agentsCache = [];
let prospectsCache = [];

let attendingAgentsChoices = null;
let eventSearchChoices = null;

document.addEventListener("DOMContentLoaded", async () => {
  window.addEventListener("load", () => {
    document.documentElement.style.visibility = "visible";
  });
  
  sb = window.supabaseClient;

  if (!sb) {
    console.error("Supabase client missing");
    return;
  }

  await initSession();
  initUI();
  await loadTodaysEvents();
});

async function initSession() {
  const { data: { session } } = await sb.auth.getSession();

  if (!session) {
    setPublicMode();
    return;
  }

  const { data: profile } = await sb
    .from("agents")
    .select("*")
    .eq("id", session.user.id)
    .single();

  if (!profile) {
    setPublicMode();
    return;
  }

  me = profile;
  isAdmin = profile.is_admin || false;

  enableAgentMode();
}

function setPublicMode() {
  document.getElementById("public-login-link").style.display = "block";
  document.getElementById("navcontainer")?.classList.add("hidden");
  document.getElementById("mobile-menu")?.classList.add("hidden");
}

function enableAgentMode() {
  document.getElementById("mode-switch-wrap").style.display = "flex";
  document.getElementById("public-login-link").style.display = "none";
  document.getElementById("navcontainer")?.classList.remove("hidden");
  document.getElementById("mobile-menu")?.classList.add("hidden");
}

function initUI() {
  document.getElementById("mode-prospect-btn").onclick = () => switchMode("prospect");
  document.getElementById("mode-agent-btn").onclick = () => switchMode("agent");

  document.getElementById("prospect-form").addEventListener("submit", submitProspect);

  document.getElementById("show-create-event-btn").onclick = () => showAgentScreen("create");
  document.getElementById("show-search-event-btn").onclick = () => showAgentScreen("search");

  document.getElementById("back-to-agent-start-from-create").onclick = () => showAgentScreen("start");
  document.getElementById("back-to-agent-start-from-search").onclick = () => showAgentScreen("start");
  document.getElementById("back-to-agent-start-from-workspace").onclick = () => showAgentScreen("start");

  document.getElementById("create-event-form").addEventListener("submit", createEvent);
  document.getElementById("open-selected-event-btn").onclick = openSelectedEvent;

  document.getElementById("randomize-allocations-btn").onclick = randomizeAllocations;
  document.getElementById("agree-allocation-btn").onclick = agreeAllocation;
  document.getElementById("opt-out-allocation-btn").onclick = optOutAllocation;

  document.getElementById("event-prospect-search").addEventListener("input", filterProspects);

  initPickers();
}

function switchMode(mode) {
  document.getElementById("prospect-mode").style.display = mode === "prospect" ? "block" : "none";
  document.getElementById("agent-mode").style.display = mode === "agent" ? "block" : "none";

  document.getElementById("mode-prospect-btn").classList.toggle("active", mode === "prospect");
  document.getElementById("mode-agent-btn").classList.toggle("active", mode === "agent");
}

function showAgentScreen(screen) {
  ["agent-start-screen", "agent-create-screen", "agent-search-screen", "agent-event-workspace"]
    .forEach(id => document.getElementById(id).style.display = "none");

  if (screen === "start") document.getElementById("agent-start-screen").style.display = "block";
  if (screen === "create") document.getElementById("agent-create-screen").style.display = "block";
  if (screen === "search") loadAgentEvents();
  if (screen === "workspace") document.getElementById("agent-event-workspace").style.display = "block";
}

function initPickers() {
  flatpickr("#create-event-date", { dateFormat: "Y-m-d" });
  flatpickr("#create-event-time", { enableTime: true, noCalendar: true, dateFormat: "H:i" });
}

async function loadTodaysEvents() {
  const { data } = await sb.from("events_open_today").select("*");

  const select = document.getElementById("prospect-event-id");
  select.innerHTML = "";

  data?.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = `${e.event_name} (${e.city || ""})`;
    select.appendChild(opt);
  });
}

async function submitProspect(e) {
  e.preventDefault();

  const data = {
    event_id: document.getElementById("prospect-event-id").value,
    first_name: document.getElementById("prospect-first-name").value,
    last_name: document.getElementById("prospect-last-name").value,
    age: parseInt(document.getElementById("prospect-age").value) || null,
    phone: document.getElementById("prospect-phone").value,
    email: document.getElementById("prospect-email").value,
    looking_for: document.getElementById("prospect-looking-for").value,
    tcpa_consent: true,
    tcpa_consent_text: document.getElementById("prospect-tcpa-text").innerText,
    tcpa_consent_at: new Date().toISOString(),
    tcpa_capture_method: me ? "agent_assisted" : "self_submit",
    tcpa_captured_by_agent_id: me?.id || null,
    submitted_by_agent_id: me?.id || null
  };

  const { error } = await sb.from("event_prospects").insert(data);

  setFormMessage("prospect-form-message", error ? "Error submitting." : "Submitted successfully!", !!error);

  if (!error) e.target.reset();
}

async function createEvent(e) {
  e.preventDefault();

  const name = document.getElementById("create-event-name").value;
  const date = document.getElementById("create-event-date").value;

  const { data: event, error } = await sb
    .from("events")
    .insert({
      event_name: name,
      event_date: date,
      created_by: me.id
    })
    .select()
    .single();

  if (error) {
    setFormMessage("create-event-message", "Error creating event", true);
    return;
  }

  currentEventId = event.id;
  showAgentScreen("workspace");
  loadEventWorkspace();
}

async function loadAgentEvents() {
  const { data } = await sb
    .from("events")
    .select("*");

  const select = document.getElementById("agent-event-search");
  select.innerHTML = "";

  data.forEach(e => {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.event_name;
    select.appendChild(opt);
  });

  showAgentScreen("search");
}

function openSelectedEvent() {
  currentEventId = document.getElementById("agent-event-search").value;
  showAgentScreen("workspace");
  loadEventWorkspace();
}

async function loadEventWorkspace() {
  const { data: event } = await sb.from("events").select("*").eq("id", currentEventId).single();
  document.getElementById("workspace-event-name").textContent = event.event_name;

  const { data: prospects } = await sb
    .from("event_prospects")
    .select("*")
    .eq("event_id", currentEventId);

  prospectsCache = prospects || [];

  renderProspects();
  updateCounters();
}

function renderProspects() {
  const container = document.getElementById("event-prospects-list");
  container.innerHTML = "";

  if (!prospectsCache.length) {
    container.innerHTML = `<div class="empty-state">No prospects yet.</div>`;
    return;
  }

  prospectsCache.forEach(p => {
    const el = document.createElement("div");
    el.className = "prospect-item";

    el.innerHTML = `
      <div class="prospect-summary">
        <div>${p.first_name} ${p.last_name}</div>
        <div>${p.phone}</div>
        <div>${p.product_type_normalized}</div>
        <i class="fa-solid fa-chevron-down"></i>
      </div>

      <div class="prospect-details">
        <textarea data-id="${p.id}" placeholder="Notes">${p.notes || ""}</textarea>
        <button onclick="assignLead('${p.id}')">Assign</button>
      </div>
    `;

    el.querySelector(".prospect-summary").onclick = () => el.classList.toggle("open");

    container.appendChild(el);
  });
}

async function assignLead(id) {
  const agentId = prompt("Enter agent ID to assign");

  if (!agentId) return;

  await sb.rpc("assign_event_prospect", {
    p_prospect_id: id,
    p_assigned_to: agentId,
    p_assigned_by: me.id
  });

  loadEventWorkspace();
}

async function randomizeAllocations() {
  await sb.rpc("randomize_event_prospect_assignments", {
    p_event_id: currentEventId,
    p_actor_id: me.id
  });

  loadEventWorkspace();
}

async function agreeAllocation() {
  await sb.rpc("set_event_agent_agreement", {
    p_event_id: currentEventId,
    p_agent_id: me.id,
    p_agree: true
  });

  alert("You agreed.");
}

async function optOutAllocation() {
  await sb.rpc("set_event_agent_opt_out", {
    p_event_id: currentEventId,
    p_agent_id: me.id,
    p_opt_out: true
  });

  alert("Opted out.");
}

function updateCounters() {
  const counts = {};

  prospectsCache.forEach(p => {
    if (!p.assigned_to) return;
    counts[p.assigned_to] = (counts[p.assigned_to] || 0) + 1;
  });

  const container = document.getElementById("allocation-counter-list");
  container.innerHTML = "";

  Object.keys(counts).forEach(agent => {
    const div = document.createElement("div");
    div.className = "counter-pill";
    div.innerHTML = `<span>${agent}</span><span>${counts[agent]}</span>`;
    container.appendChild(div);
  });

  document.getElementById("workspace-total-prospects").textContent = prospectsCache.length;
}

function filterProspects(e) {
  const term = e.target.value.toLowerCase();

  prospectsCache = prospectsCache.filter(p =>
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(term)
  );

  renderProspects();
}

function setFormMessage(id, msg, isError) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = "form-message " + (isError ? "error" : "success");
}
