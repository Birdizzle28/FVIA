let sb = null;
let me = null;
let isAdmin = false;
let currentEventId = null;

const BLOCKED_AGENT_ID = "906a707c-69bb-4e6e-be1d-1415f45561c4";
const PAGE_SIZE = 10;

let agentsCache = [];
let prospectsCache = [];
let allProspectsCache = [];
let eventAgentsCache = [];
let agentMap = new Map();

let attendingAgentsChoices = null;
let eventSearchChoices = null;
let workspaceAddAgentsChoices = null;
let eventProspectsChannel = null;

let currentPage = 1;

document.addEventListener("DOMContentLoaded", async () => {
  document.documentElement.style.visibility = "visible";

  sb = window.supabaseClient;

  if (!sb) {
    console.error("Supabase client missing");
    return;
  }

  initUI();
  setupWorkspaceLayout();
  await initSession();
  await loadTodaysEvents();
});

async function initSession() {
  try {
    const {
      data: { session },
      error: sessionError
    } = await sb.auth.getSession();

    if (sessionError) {
      console.error("Session error:", sessionError);
      setPublicMode();
      return;
    }

    if (!session?.user) {
      setPublicMode();
      return;
    }

    const authUserId = session.user.id;

    let profile = null;
    let profileError = null;

    const attempts = [
      () => sb.from("agents").select("*").eq("id", authUserId).maybeSingle(),
      () => sb.from("agents").select("*").eq("user_id", authUserId).maybeSingle(),
      () => sb.from("agents").select("*").eq("auth_user_id", authUserId).maybeSingle()
    ];

    for (const attempt of attempts) {
      try {
        const { data, error } = await attempt();
        if (!error && data) {
          profile = data;
          break;
        }
        if (error) profileError = error;
      } catch (err) {
        profileError = err;
      }
    }

    if (!profile) {
      console.warn("No matching agent profile found.", profileError);
      setPublicMode();
      return;
    }

    me = profile;
    isAdmin = !!(
      profile.is_admin ||
      profile.admin === true ||
      profile.role === "admin" ||
      profile.user_role === "admin"
    );

    enableAgentMode();
    await loadAgentsForEventForm();
    await loadAgentEvents();
  } catch (err) {
    console.error("initSession failed:", err);
    setPublicMode();
  }
}

function setPublicMode() {
  const loginLink = document.getElementById("public-login-link");
  const nav = document.getElementById("navcontainer");
  const menu = document.getElementById("mobile-menu");
  const switchWrap = document.getElementById("mode-switch-wrap");
  const hero = document.querySelector(".event-page-head");
  const pageTitle = document.querySelector(".event-page-shell");

  if (loginLink) loginLink.style.display = "block";
  if (nav) nav.classList.add("hidden");
  if (menu) menu.classList.remove("open");
  if (switchWrap) switchWrap.style.display = "none";
  if (hero) hero.style.display = "none";

  if (pageTitle) {
    pageTitle.style.gap = "0";
  }

  switchMode("prospect");
}

function enableAgentMode() {
  const loginLink = document.getElementById("public-login-link");
  const nav = document.getElementById("navcontainer");
  const menu = document.getElementById("mobile-menu");
  const switchWrap = document.getElementById("mode-switch-wrap");
  const hero = document.querySelector(".event-page-head");

  if (loginLink) loginLink.style.display = "none";
  if (nav) nav.classList.remove("hidden");
  if (menu) menu.classList.remove("open");
  if (switchWrap) switchWrap.style.display = "flex";
  if (hero) hero.style.display = "block";
}

function initUI() {
  document.getElementById("mode-prospect-btn")?.addEventListener("click", () => switchMode("prospect"));
  document.getElementById("mode-agent-btn")?.addEventListener("click", () => switchMode("agent"));

  document.getElementById("prospect-form")?.addEventListener("submit", submitProspect);

  document.getElementById("show-create-event-btn")?.addEventListener("click", () => showAgentScreen("create"));
  document.getElementById("show-search-event-btn")?.addEventListener("click", async () => {
    showAgentScreen("search");
    await loadAgentEvents();
  });

  document.getElementById("back-to-agent-start-from-create")?.addEventListener("click", () => showAgentScreen("start"));
  document.getElementById("back-to-agent-start-from-search")?.addEventListener("click", () => showAgentScreen("start"));
  document.getElementById("back-to-agent-start-from-workspace")?.addEventListener("click", () => {
    unsubscribeFromEventProspects();
    currentEventId = null;
    prospectsCache = [];
    allProspectsCache = [];
    eventAgentsCache = [];
    currentPage = 1;
    showAgentScreen("start");
  });

  document.getElementById("create-event-form")?.addEventListener("submit", createEvent);
  document.getElementById("open-selected-event-btn")?.addEventListener("click", openSelectedEvent);

  document.getElementById("randomize-allocations-btn")?.addEventListener("click", randomizeAllocations);
  document.getElementById("agree-allocation-btn")?.addEventListener("click", handleAgreementButtonClick);

  document.getElementById("event-prospect-search")?.addEventListener("input", filterProspects);

  bindInputFormatting();
  wireMobileMenu();
  initPickers();
}

function setupWorkspaceLayout() {
  const refreshBtn = document.getElementById("refresh-event-btn");
  const finalizeBtn = document.getElementById("finalize-event-btn");
  const optOutBtn = document.getElementById("opt-out-allocation-btn");
  const agreeBtn = document.getElementById("agree-allocation-btn");

  if (refreshBtn) refreshBtn.style.display = "none";
  if (finalizeBtn) finalizeBtn.style.display = "none";
  if (optOutBtn) optOutBtn.style.display = "none";

  const toolbarRight = document.querySelector(".toolbar-right");
  if (toolbarRight) {
    toolbarRight.style.display = "flex";
    toolbarRight.style.flexWrap = "wrap";
    toolbarRight.style.gap = "0.75rem";
  }

  const prospectsList = document.getElementById("event-prospects-list");
  const summaryGrid = document.querySelector(".workspace-summary-grid");
  const counterCard = document.querySelector(".allocation-counter-card");
  const agreeBottomWrapId = "workspace-bottom-agree-wrap";
  let bottomWrap = document.getElementById(agreeBottomWrapId);

  if (!bottomWrap && prospectsList) {
    bottomWrap = document.createElement("div");
    bottomWrap.id = agreeBottomWrapId;
    bottomWrap.style.display = "flex";
    bottomWrap.style.justifyContent = "center";
    bottomWrap.style.marginTop = "1rem";
    bottomWrap.style.marginBottom = "1rem";
    prospectsList.insertAdjacentElement("afterend", bottomWrap);
  }

  if (agreeBtn && bottomWrap) {
    agreeBtn.style.width = "auto";
    agreeBtn.style.minWidth = "220px";
    bottomWrap.appendChild(agreeBtn);
  }

  if (prospectsList && summaryGrid && counterCard) {
    const parent = prospectsList.parentElement;
    parent.appendChild(summaryGrid);
    parent.appendChild(counterCard);
  }

  injectWorkspaceAgentAdder();
}

function injectWorkspaceAgentAdder() {
  const workspace = document.getElementById("agent-event-workspace");
  const toolbarLeft = document.querySelector(".toolbar-left");
  if (!workspace || !toolbarLeft) return;
  if (document.getElementById("workspace-agent-adder")) return;

  const wrap = document.createElement("div");
  wrap.id = "workspace-agent-adder";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "0.75rem";
  wrap.style.flexWrap = "wrap";
  wrap.style.width = "100%";
  wrap.style.marginTop = "0.75rem";

  wrap.innerHTML = `
    <div style="min-width:260px;flex:1 1 320px;">
      <select id="workspace-add-agents" multiple></select>
    </div>
    <button id="workspace-add-agents-btn" class="secondary-btn" type="button">Add Agents</button>
  `;

  toolbarLeft.appendChild(wrap);

  document.getElementById("workspace-add-agents-btn")?.addEventListener("click", addAgentsToCurrentEvent);
}

function switchMode(mode) {
  const prospectMode = document.getElementById("prospect-mode");
  const agentMode = document.getElementById("agent-mode");
  const prospectBtn = document.getElementById("mode-prospect-btn");
  const agentBtn = document.getElementById("mode-agent-btn");

  if (prospectMode) prospectMode.style.display = mode === "prospect" ? "block" : "none";
  if (agentMode) agentMode.style.display = mode === "agent" ? "block" : "none";

  prospectBtn?.classList.toggle("active", mode === "prospect");
  agentBtn?.classList.toggle("active", mode === "agent");
}

function showAgentScreen(screen) {
  ["agent-start-screen", "agent-create-screen", "agent-search-screen", "agent-event-workspace"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const map = {
    start: "agent-start-screen",
    create: "agent-create-screen",
    search: "agent-search-screen",
    workspace: "agent-event-workspace"
  };

  const target = document.getElementById(map[screen]);
  if (target) target.style.display = "block";
}

function wireMobileMenu() {
  const toggle = document.getElementById("menu-toggle");
  const menu = document.getElementById("mobile-menu");
  const toolkitToggle = document.getElementById("toolkit-toggle");
  const toolkitSubmenu = document.getElementById("toolkit-submenu");

  if (toggle && menu) {
    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        menu.classList.remove("open");
      }
    });
  }

  if (toolkitToggle && toolkitSubmenu) {
    toolkitToggle.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const expanded = toolkitToggle.getAttribute("aria-expanded") === "true";
      toolkitToggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      toolkitSubmenu.classList.toggle("open", !expanded);
    });
  }
}

function initPickers() {
  if (window.flatpickr) {
    flatpickr("#create-event-date", { dateFormat: "Y-m-d" });
    flatpickr("#create-event-time", {
      enableTime: true,
      noCalendar: true,
      dateFormat: "H:i",
      time_24hr: false
    });
  }
}

function bindInputFormatting() {
  document.addEventListener("input", (e) => {
    const target = e.target;
    if (!target) return;

    if (
      target.id === "prospect-phone" ||
      target.dataset.field === "phone"
    ) {
      target.value = formatPhone(target.value);
    }

    if (
      target.id === "prospect-email" ||
      target.dataset.field === "email"
    ) {
      target.value = normalizeEmail(target.value);
    }
  });

  document.addEventListener("change", (e) => {
    const target = e.target;
    if (!target) return;

    if (
      target.id === "prospect-phone" ||
      target.dataset.field === "phone"
    ) {
      target.value = formatPhone(target.value);
    }

    if (
      target.id === "prospect-email" ||
      target.dataset.field === "email"
    ) {
      target.value = normalizeEmail(target.value);
    }
  });
}

function formatPhone(value = "") {
  const digits = String(value).replace(/\D/g, "").slice(0, 10);
  const a = digits.slice(0, 3);
  const b = digits.slice(3, 6);
  const c = digits.slice(6, 10);

  if (!a) return "";
  if (digits.length < 4) return `(${a}`;
  if (digits.length < 7) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function normalizeEmail(value = "") {
  return String(value).replace(/\s+/g, "").toLowerCase();
}

async function loadTodaysEvents() {
  try {
    const select = document.getElementById("prospect-event-id");
    if (!select) return;

    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const { data, error } = await sb
      .from("events")
      .select("id, event_name, city, state, event_date, event_time, status")
      .eq("event_date", localDate)
      .in("status", ["open", "draft"])
      .order("event_time", { ascending: true });

    select.innerHTML = '<option value="">Select today’s event</option>';

    if (error) {
      console.error("Error loading today’s events:", error);
      return;
    }

    (data || []).forEach((event) => {
      const opt = document.createElement("option");
      opt.value = event.id;
      opt.textContent = buildEventLabel(event);
      select.appendChild(opt);
    });

    if (!data || !data.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No events scheduled for today";
      select.appendChild(opt);
    }
  } catch (err) {
    console.error("loadTodaysEvents failed:", err);
  }
}

async function loadAgentsForEventForm() {
  const select = document.getElementById("create-attending-agents");
  if (!select) return;

  try {
    const { data, error } = await sb
      .from("agents")
      .select("id, first_name, last_name")
      .neq("id", BLOCKED_AGENT_ID)
      .order("first_name", { ascending: true });

    if (error) {
      console.error("Error loading agents:", error);
      return;
    }

    agentsCache = data || [];
    agentMap = new Map();

    select.innerHTML = "";

    agentsCache.forEach((agent) => {
      const fullName = `${agent.first_name || ""} ${agent.last_name || ""}`.trim() || agent.id;
      agentMap.set(agent.id, fullName);

      const option = document.createElement("option");
      option.value = agent.id;
      option.textContent = fullName;
      select.appendChild(option);
    });

    if (attendingAgentsChoices) {
      attendingAgentsChoices.destroy();
    }

    if (window.Choices) {
      attendingAgentsChoices = new Choices(select, {
        removeItemButton: true,
        searchEnabled: true,
        shouldSort: false,
        placeholder: true,
        placeholderValue: "Select attending agents"
      });
    }
  } catch (err) {
    console.error("loadAgentsForEventForm failed:", err);
  }
}

async function loadAvailableAgentsForCurrentEvent() {
  const select = document.getElementById("workspace-add-agents");
  if (!select || !currentEventId) return;

  const currentIds = new Set(
    (eventAgentsCache || [])
      .map((ea) => ea.agent_id)
      .filter((id) => id && id !== BLOCKED_AGENT_ID)
  );

  select.innerHTML = "";

  const available = agentsCache.filter((agent) => !currentIds.has(agent.id));

  available.forEach((agent) => {
    const fullName = `${agent.first_name || ""} ${agent.last_name || ""}`.trim() || agent.id;
    const option = document.createElement("option");
    option.value = agent.id;
    option.textContent = fullName;
    select.appendChild(option);
  });

  if (workspaceAddAgentsChoices) {
    workspaceAddAgentsChoices.destroy();
  }

  if (window.Choices) {
    workspaceAddAgentsChoices = new Choices(select, {
      removeItemButton: true,
      searchEnabled: true,
      shouldSort: false,
      placeholder: true,
      placeholderValue: available.length ? "Add more agents to this event" : "No more agents available"
    });
  }
}

async function addAgentsToCurrentEvent() {
  if (!currentEventId) return;

  const selectedIds = workspaceAddAgentsChoices
    ? workspaceAddAgentsChoices.getValue(true)
    : Array.from(document.getElementById("workspace-add-agents")?.selectedOptions || []).map((o) => o.value);

  const cleanIds = [...new Set((selectedIds || []).filter((id) => id && id !== BLOCKED_AGENT_ID))];

  if (!cleanIds.length) {
    setWorkspaceMessage("Select at least one agent to add.", true);
    return;
  }

  try {
    const rows = cleanIds.map((agentId) => ({
      event_id: currentEventId,
      agent_id: agentId,
      role: "participant",
      is_active: true
    }));

    const { error } = await sb.from("event_agents").insert(rows);

    if (error) {
      console.error("addAgentsToCurrentEvent error:", error);
      setWorkspaceMessage("Could not add agents to this event.", true);
      return;
    }

    setWorkspaceMessage("Agents added to the event.", false);
    await loadEventWorkspace();
  } catch (err) {
    console.error("addAgentsToCurrentEvent failed:", err);
    setWorkspaceMessage("Could not add agents to this event.", true);
  }
}

async function submitProspect(e) {
  e.preventDefault();

  const submitBtn = document.getElementById("prospect-submit-btn");
  if (submitBtn) submitBtn.disabled = true;

  const eventId = document.getElementById("prospect-event-id")?.value;
  const firstName = document.getElementById("prospect-first-name")?.value.trim();
  const lastName = document.getElementById("prospect-last-name")?.value.trim();
  const ageRaw = document.getElementById("prospect-age")?.value.trim();
  const phone = formatPhone(document.getElementById("prospect-phone")?.value.trim());
  const email = normalizeEmail(document.getElementById("prospect-email")?.value.trim());
  const lookingFor = document.getElementById("prospect-looking-for")?.value;
  const tcpaText = document.getElementById("prospect-tcpa-text")?.innerText?.trim() || "";

  if (!eventId || !firstName || !lastName || !phone || !lookingFor) {
    setFormMessage("prospect-form-message", "Please complete all required fields.", true);
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  const payload = {
    event_id: eventId,
    first_name: firstName,
    last_name: lastName,
    age: ageRaw ? parseInt(ageRaw, 10) : null,
    phone,
    email: email || null,
    looking_for: lookingFor,
    tcpa_consent: true,
    tcpa_consent_text: tcpaText,
    tcpa_consent_at: new Date().toISOString(),
    tcpa_capture_method: me ? "agent_assisted" : "self_submit",
    tcpa_captured_by_agent_id: me?.id || null,
    submitted_by_agent_id: me?.id || null,
    tcpa_user_agent: navigator.userAgent || null
  };

  try {
    const { error } = await sb.from("event_prospects").insert(payload);

    if (error) {
      console.error("submitProspect error:", error);
      setFormMessage("prospect-form-message", "There was a problem submitting the form.", true);
    } else {
      setFormMessage("prospect-form-message", "Submitted successfully!", false);
      e.target.reset();
      await loadTodaysEvents();

      if (currentEventId && currentEventId === eventId) {
        await loadEventWorkspace();
      }
    }
  } catch (err) {
    console.error("submitProspect failed:", err);
    setFormMessage("prospect-form-message", "There was a problem submitting the form.", true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function createEvent(e) {
  e.preventDefault();

  const submitBtn = document.getElementById("create-event-submit-btn");
  if (submitBtn) submitBtn.disabled = true;

  const attendingAgentIds = attendingAgentsChoices
    ? attendingAgentsChoices.getValue(true)
    : Array.from(document.getElementById("create-attending-agents")?.selectedOptions || []).map((o) => o.value);

  const payload = {
    event_name: document.getElementById("create-event-name")?.value.trim(),
    address: document.getElementById("create-event-address")?.value.trim() || null,
    city: document.getElementById("create-event-city")?.value.trim() || null,
    state: document.getElementById("create-event-state")?.value.trim() || null,
    zip: document.getElementById("create-event-zip")?.value.trim() || null,
    event_date: document.getElementById("create-event-date")?.value.trim(),
    event_time: document.getElementById("create-event-time")?.value.trim() || null,
    created_by: me.id,
    status: "open"
  };

  if (!payload.event_name || !payload.event_date) {
    setFormMessage("create-event-message", "Event name and date are required.", true);
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  try {
    const { data: event, error } = await sb
      .from("events")
      .insert(payload)
      .select()
      .single();

    if (error) {
      console.error("createEvent error:", error);
      setFormMessage("create-event-message", "Error creating event.", true);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    const uniqueAgentIds = [
      ...new Set(
        [me.id, ...attendingAgentIds]
          .filter(Boolean)
          .filter((id) => id !== BLOCKED_AGENT_ID)
      )
    ];

    const eventAgentRows = uniqueAgentIds.map((agentId) => ({
      event_id: event.id,
      agent_id: agentId,
      role: agentId === me.id ? "owner" : "participant",
      is_active: true
    }));

    const { error: eventAgentsError } = await sb.from("event_agents").insert(eventAgentRows);

    if (eventAgentsError) {
      console.error("event_agents insert error:", eventAgentsError);
      setFormMessage("create-event-message", "Event was created, but attending agents failed to save.", true);
      if (submitBtn) submitBtn.disabled = false;
      return;
    }

    setFormMessage("create-event-message", "Event created successfully.", false);
    currentEventId = event.id;
    currentPage = 1;

    await loadTodaysEvents();
    await loadAgentEvents();
    showAgentScreen("workspace");
    await loadEventWorkspace();
  } catch (err) {
    console.error("createEvent failed:", err);
    setFormMessage("create-event-message", "Error creating event.", true);
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadAgentEvents() {
  const select = document.getElementById("agent-event-search");
  if (!select) return;

  try {
    setFormMessage("agent-search-message", "", false);

    let data = [];
    let error = null;

    if (isAdmin) {
      const res = await sb
        .from("events")
        .select("id, event_name, city, state, event_date, event_time, status")
        .order("event_date", { ascending: false });

      data = res.data || [];
      error = res.error;
    } else {
      const { data: assignedRows, error: assignedError } = await sb
        .from("event_agents")
        .select("event_id")
        .eq("agent_id", me.id)
        .eq("is_active", true);

      if (assignedError) {
        error = assignedError;
      } else {
        const eventIds = [...new Set((assignedRows || []).map((r) => r.event_id).filter(Boolean))];

        if (eventIds.length) {
          const res = await sb
            .from("events")
            .select("id, event_name, city, state, event_date, event_time, status")
            .in("id", eventIds)
            .order("event_date", { ascending: false });

          data = res.data || [];
          error = res.error;
        } else {
          data = [];
        }
      }
    }

    if (error) {
      console.error("loadAgentEvents error:", error);
      setFormMessage("agent-search-message", "Could not load events.", true);
      return;
    }

    if (eventSearchChoices) {
      eventSearchChoices.destroy();
      eventSearchChoices = null;
    }

    select.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = data.length ? "Select an event" : "No events available";
    select.appendChild(placeholder);

    data.forEach((event) => {
      const option = document.createElement("option");
      option.value = event.id;
      option.textContent = buildEventLabel(event);
      select.appendChild(option);
    });

    if (window.Choices) {
      eventSearchChoices = new Choices(select, {
        searchEnabled: true,
        shouldSort: false,
        placeholder: true,
        placeholderValue: "Search assigned events",
        itemSelectText: ""
      });
    }

    if (!data.length) {
      setFormMessage("agent-search-message", "No assigned events found yet.", false);
    }
  } catch (err) {
    console.error("loadAgentEvents failed:", err);
    setFormMessage("agent-search-message", "Could not load events.", true);
  }
}

function openSelectedEvent() {
  let value = "";

  if (eventSearchChoices) {
    const selected = eventSearchChoices.getValue(true);
    value = Array.isArray(selected) ? selected[0] : selected;
  } else {
    value = document.getElementById("agent-event-search")?.value || "";
  }

  if (!value) {
    setFormMessage("agent-search-message", "Please choose an event.", true);
    return;
  }

  currentEventId = value;
  currentPage = 1;
  showAgentScreen("workspace");
  loadEventWorkspace();
}

function unsubscribeFromEventProspects() {
  if (eventProspectsChannel) {
    sb.removeChannel(eventProspectsChannel);
    eventProspectsChannel = null;
  }
}

function subscribeToEventProspects(eventId) {
  unsubscribeFromEventProspects();

  if (!eventId) return;

  eventProspectsChannel = sb
    .channel(`event-prospects-${eventId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "event_prospects",
        filter: `event_id=eq.${eventId}`
      },
      async () => {
        await loadEventWorkspace();
        await loadTodaysEvents();
      }
    )
    .subscribe();
}

async function loadEventWorkspace() {
  if (!currentEventId) return;

  subscribeToEventProspects(currentEventId);

  try {
    clearWorkspaceMessage();

    const { data: event, error: eventError } = await sb
      .from("events")
      .select("*")
      .eq("id", currentEventId)
      .single();

    if (eventError || !event) {
      console.error("loadEventWorkspace event error:", eventError);
      setWorkspaceMessage("Could not load the event.", true);
      return;
    }

    document.getElementById("workspace-event-name").textContent = event.event_name || "Event";
    document.getElementById("workspace-event-meta").textContent =
      `Event ID: ${event.id} • ${buildEventLabel(event)}`;

    const { data: eventAgents, error: eventAgentsError } = await sb
      .from("event_agents")
      .select("*")
      .eq("event_id", currentEventId)
      .eq("is_active", true);

    if (eventAgentsError) {
      console.error("loadEventWorkspace event_agents error:", eventAgentsError);
    }

    eventAgentsCache = (eventAgents || []).filter((ea) => ea.agent_id !== BLOCKED_AGENT_ID);

    const { data: prospects, error: prospectsError } = await sb
      .from("event_prospects")
      .select("*")
      .eq("event_id", currentEventId)
      .eq("archived", false)
      .order("created_at", { ascending: true });

    if (prospectsError) {
      console.error("loadEventWorkspace prospects error:", prospectsError);
      setWorkspaceMessage("Could not load event prospects.", true);
      return;
    }

    allProspectsCache = prospects || [];
    prospectsCache = [...allProspectsCache];

    await loadAvailableAgentsForCurrentEvent();
    renderProspects();
    updateCounters();
    updateAgreementStatus();
  } catch (err) {
    console.error("loadEventWorkspace failed:", err);
    setWorkspaceMessage("Could not load the event workspace.", true);
  }
}

function renderProspects() {
  const container = document.getElementById("event-prospects-list");
  if (!container) return;

  container.innerHTML = "";

  if (!prospectsCache.length) {
    container.innerHTML = `<div class="empty-state">No prospects found.</div>`;
    renderPagination();
    document.getElementById("workspace-total-prospects").textContent = "0";
    return;
  }

  const totalPages = Math.max(1, Math.ceil(prospectsCache.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const pageItems = prospectsCache.slice(start, start + PAGE_SIZE);

  pageItems.forEach((prospect) => {
    const assignedName = getAgentName(prospect.assigned_to) || "Unassigned";
    const notesValue = prospect.notes || "";

    const wrapper = document.createElement("div");
    wrapper.className = "prospect-item";

    wrapper.innerHTML = `
      <div class="prospect-summary">
        <div class="prospect-main-name">
          <div class="prospect-name">${escapeHtml(prospect.first_name || "")} ${escapeHtml(prospect.last_name || "")}</div>
          <div class="prospect-subline">
            ${escapeHtml(prospect.phone || "")}${prospect.email ? ` • ${escapeHtml(prospect.email)}` : ""}
          </div>
        </div>

        <div class="prospect-interest">
          <span class="prospect-chip">${escapeHtml(prospect.looking_for || prospect.product_type_normalized || "Other")}</span>
        </div>

        <div class="prospect-assignee">
          <label style="display:block;font-size:.82rem;margin-bottom:.25rem;color:#666879;">Assign</label>
          <select class="inline-assign-select">
            ${buildAssignedAgentOptions(prospect.assigned_to)}
          </select>
        </div>

        <div class="prospect-toggle-icon">
          <i class="fa-solid fa-chevron-down"></i>
        </div>
      </div>

      <div class="prospect-details">
        <div class="prospect-details-grid">
          <div class="prospect-detail-block">
            <label>First Name</label>
            <input type="text" data-field="first_name" value="${escapeAttr(prospect.first_name || "")}" />
          </div>

          <div class="prospect-detail-block">
            <label>Last Name</label>
            <input type="text" data-field="last_name" value="${escapeAttr(prospect.last_name || "")}" />
          </div>

          <div class="prospect-detail-block">
            <label>Age</label>
            <input type="number" min="0" max="130" data-field="age" value="${prospect.age ?? ""}" />
          </div>

          <div class="prospect-detail-block">
            <label>Phone</label>
            <input type="text" data-field="phone" value="${escapeAttr(prospect.phone || "")}" />
          </div>

          <div class="prospect-detail-block">
            <label>Email</label>
            <input type="email" data-field="email" value="${escapeAttr(prospect.email || "")}" />
          </div>

          <div class="prospect-detail-block">
            <label>Looking For</label>
            <select data-field="looking_for">
              ${buildLookingForOptions(prospect.looking_for)}
            </select>
          </div>

          <div class="prospect-detail-block full">
            <label>Agent Notes</label>
            <textarea data-field="notes" placeholder="Add notes here...">${escapeHtml(notesValue)}</textarea>
          </div>

          <div class="prospect-detail-block full">
            <label>Assign Lead To</label>
            <select data-field="assigned_to">
              ${buildAssignedAgentOptions(prospect.assigned_to)}
            </select>
          </div>
        </div>

        <div class="prospect-detail-actions">
          <button class="primary-btn save-prospect-btn" type="button">Save Changes</button>
        </div>
      </div>
    `;

    const summary = wrapper.querySelector(".prospect-summary");
    const saveBtn = wrapper.querySelector(".save-prospect-btn");
    const inlineAssign = wrapper.querySelector(".inline-assign-select");

    summary.addEventListener("click", () => {
      wrapper.classList.toggle("open");
    });

    inlineAssign.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    inlineAssign.addEventListener("change", async (e) => {
      const newAgentId = e.target.value || null;
      await assignProspectDirectly(prospect.id, newAgentId);
    });

    saveBtn.addEventListener("click", async () => {
      await saveProspectChanges(prospect.id, wrapper);
    });

    container.appendChild(wrapper);
  });

  renderPagination();
  document.getElementById("workspace-total-prospects").textContent = String(allProspectsCache.length);
}

function renderPagination() {
  let pagination = document.getElementById("event-prospects-pagination");
  const list = document.getElementById("event-prospects-list");
  if (!list) return;

  if (!pagination) {
    pagination = document.createElement("div");
    pagination.id = "event-prospects-pagination";
    pagination.style.display = "flex";
    pagination.style.justifyContent = "center";
    pagination.style.alignItems = "center";
    pagination.style.gap = "0.75rem";
    pagination.style.marginTop = "1rem";
    list.insertAdjacentElement("afterend", pagination);
  }

  const totalPages = Math.max(1, Math.ceil(prospectsCache.length / PAGE_SIZE));

  pagination.innerHTML = `
    <button type="button" class="ghost-btn" id="page-prev-btn" ${currentPage <= 1 ? "disabled" : ""}>Previous</button>
    <span style="font-weight:700;color:#353468;">Page ${currentPage} of ${totalPages}</span>
    <button type="button" class="ghost-btn" id="page-next-btn" ${currentPage >= totalPages ? "disabled" : ""}>Next</button>
  `;

  document.getElementById("page-prev-btn")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderProspects();
    }
  });

  document.getElementById("page-next-btn")?.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage += 1;
      renderProspects();
    }
  });
}

async function assignProspectDirectly(prospectId, assignedTo) {
  try {
    const { error } = await sb.rpc("assign_event_prospect", {
      p_prospect_id: prospectId,
      p_assigned_to: assignedTo,
      p_assigned_by: me.id
    });

    if (error) {
      console.error("assignProspectDirectly error:", error);
      setWorkspaceMessage("Could not update assignment.", true);
      return;
    }

    setWorkspaceMessage("Assignment updated.", false);
    await loadEventWorkspace();
  } catch (err) {
    console.error("assignProspectDirectly failed:", err);
    setWorkspaceMessage("Could not update assignment.", true);
  }
}

async function saveProspectChanges(prospectId, wrapper) {
  const fields = wrapper.querySelectorAll("[data-field]");
  const updates = {};

  fields.forEach((field) => {
    const key = field.dataset.field;
    let value = field.value;

    if (key === "age") {
      value = value.trim() === "" ? null : parseInt(value, 10);
    } else {
      value = value.trim();

      if (key === "phone") value = formatPhone(value);
      if (key === "email") value = normalizeEmail(value);

      if (["email", "notes", "assigned_to"].includes(key) && value === "") {
        value = null;
      }
    }

    updates[key] = value;
  });

  try {
    if (updates.assigned_to !== undefined) {
      await sb.rpc("assign_event_prospect", {
        p_prospect_id: prospectId,
        p_assigned_to: updates.assigned_to,
        p_assigned_by: me.id
      });
      delete updates.assigned_to;
    }

    if (Object.keys(updates).length) {
      const { error } = await sb.from("event_prospects").update(updates).eq("id", prospectId);

      if (error) {
        console.error("saveProspectChanges error:", error);
        setWorkspaceMessage("Could not save changes.", true);
        return;
      }
    }

    setWorkspaceMessage("Prospect updated.", false);
    await loadEventWorkspace();
  } catch (err) {
    console.error("saveProspectChanges failed:", err);
    setWorkspaceMessage("Could not save changes.", true);
  }
}

async function randomizeAllocations() {
  if (!currentEventId) return;

  try {
    const { error } = await sb.rpc("randomize_event_prospect_assignments", {
      p_event_id: currentEventId,
      p_actor_id: me.id
    });

    if (error) {
      console.error("randomizeAllocations error:", error);
      setWorkspaceMessage("Could not randomize allocations.", true);
      return;
    }

    setWorkspaceMessage("Lead allocations randomized.", false);
    await loadEventWorkspace();
  } catch (err) {
    console.error("randomizeAllocations failed:", err);
    setWorkspaceMessage("Could not randomize allocations.", true);
  }
}

async function handleAgreementButtonClick() {
  if (!currentEventId || !me?.id) return;

  const myRow = eventAgentsCache.find((ea) => ea.agent_id === me.id);
  const requiredAgents = eventAgentsCache.filter((ea) => ea.is_active && !ea.allocation_opt_out);
  const everyoneAgreed = requiredAgents.length > 0 && requiredAgents.every((ea) => ea.allocation_agreed);

  try {
    if (myRow?.allocation_opt_out) {
      const { error } = await sb.rpc("set_event_agent_opt_out", {
        p_event_id: currentEventId,
        p_agent_id: me.id,
        p_opt_out: false
      });

      if (error) {
        console.error("rejoin error:", error);
        setWorkspaceMessage("Could not rejoin review.", true);
        return;
      }

      setWorkspaceMessage("You rejoined the allocation review.", false);
      await loadEventWorkspace();
      return;
    }

    if (myRow?.allocation_agreed && !everyoneAgreed) {
      const { error } = await sb.rpc("set_event_agent_opt_out", {
        p_event_id: currentEventId,
        p_agent_id: me.id,
        p_opt_out: true
      });

      if (error) {
        console.error("opt out error:", error);
        setWorkspaceMessage("Could not opt out.", true);
        return;
      }

      setWorkspaceMessage("You opted out of the remaining agreement review.", false);
      await loadEventWorkspace();
      return;
    }

    const { error } = await sb.rpc("set_event_agent_agreement", {
      p_event_id: currentEventId,
      p_agent_id: me.id,
      p_agree: true
    });

    if (error) {
      console.error("agree error:", error);
      setWorkspaceMessage("Could not record your agreement.", true);
      return;
    }

    setWorkspaceMessage("Your agreement has been recorded.", false);
    await loadEventWorkspace();
    await autoFinalizeIfReady();
  } catch (err) {
    console.error("handleAgreementButtonClick failed:", err);
    setWorkspaceMessage("Could not update agreement status.", true);
  }
}

async function autoFinalizeIfReady() {
  if (!currentEventId || !me?.id) return;

  const requiredAgents = eventAgentsCache.filter((ea) => ea.is_active && !ea.allocation_opt_out);
  const everyoneAgreed = requiredAgents.length > 0 && requiredAgents.every((ea) => ea.allocation_agreed);
  const allAssigned = allProspectsCache.every((p) => !!p.assigned_to);

  if (!everyoneAgreed || !allAssigned) return;

  try {
    const { data, error } = await sb.rpc("finalize_event_allocations", {
      p_event_id: currentEventId,
      p_actor_id: me.id,
      p_actor_is_admin: !!isAdmin
    });

    if (error) {
      console.error("autoFinalizeIfReady error:", error);
      setWorkspaceMessage(error.message || "Could not auto-finalize the event.", true);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const message = result
      ? `Event finalized. Promoted ${result.prospects_promoted} prospects, created ${result.contacts_created} contacts, ${result.leads_created} leads, and ${result.notes_created} notes.`
      : "Event finalized successfully.";

    setWorkspaceMessage(message, false);
    await loadAgentEvents();
    await loadEventWorkspace();
  } catch (err) {
    console.error("autoFinalizeIfReady failed:", err);
    setWorkspaceMessage("Could not auto-finalize the event.", true);
  }
}

function filterProspects(e) {
  const term = (e.target.value || "").trim().toLowerCase();

  if (!term) {
    prospectsCache = [...allProspectsCache];
    currentPage = 1;
    renderProspects();
    return;
  }

  prospectsCache = allProspectsCache.filter((p) => {
    const haystack = [
      p.first_name,
      p.last_name,
      p.phone,
      p.email,
      p.looking_for,
      p.notes
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(term);
  });

  currentPage = 1;
  renderProspects();
}

function updateCounters() {
  const counts = {};

  allProspectsCache.forEach((p) => {
    if (!p.assigned_to) return;
    counts[p.assigned_to] = (counts[p.assigned_to] || 0) + 1;
  });

  const container = document.getElementById("allocation-counter-list");
  if (!container) return;

  container.innerHTML = "";

  eventAgentsCache.forEach((ea) => {
    const agentId = ea.agent_id;
    const count = counts[agentId] || 0;
    const div = document.createElement("div");
    div.className = "counter-pill";
    div.innerHTML = `
      <span class="counter-pill-name">${escapeHtml(getAgentName(agentId) || "Unknown Agent")}</span>
      <span class="counter-pill-count">${count}</span>
    `;
    container.appendChild(div);
  });

  document.getElementById("workspace-total-prospects").textContent = String(allProspectsCache.length);
}

function updateAgreementStatus() {
  const el = document.getElementById("allocation-agreement-status");
  const agreeBtn = document.getElementById("agree-allocation-btn");
  if (!el || !agreeBtn) return;

  const activeRequiredAgents = eventAgentsCache.filter((ea) => ea.is_active && !ea.allocation_opt_out);
  const agreedCount = activeRequiredAgents.filter((ea) => ea.allocation_agreed).length;
  const myRow = eventAgentsCache.find((ea) => ea.agent_id === me?.id);
  const allAssigned = allProspectsCache.every((p) => !!p.assigned_to);
  const everyoneAgreed = activeRequiredAgents.length > 0 && activeRequiredAgents.every((ea) => ea.allocation_agreed);

  if (!activeRequiredAgents.length) {
    el.textContent = "No required agent approvals are pending.";
  } else {
    const names = activeRequiredAgents
      .map((ea) => `${getAgentName(ea.agent_id)}: ${ea.allocation_agreed ? "Agreed" : "Pending"}`)
      .join(" • ");

    el.textContent = `${agreedCount}/${activeRequiredAgents.length} required agents agreed. ${names}${allAssigned ? "" : " • Some leads are still unassigned."}`;
  }

  if (myRow?.allocation_opt_out) {
    agreeBtn.textContent = "Rejoin Review";
  } else if (myRow?.allocation_agreed && !everyoneAgreed) {
    agreeBtn.textContent = "Opt Out";
  } else if (everyoneAgreed) {
    agreeBtn.textContent = "All Agents Agreed";
  } else {
    agreeBtn.textContent = "Agree to Split";
  }

  agreeBtn.disabled = everyoneAgreed && allAssigned;
}

function buildAssignedAgentOptions(selectedId) {
  const options = ['<option value="">Unassigned</option>'];

  eventAgentsCache
    .filter((ea) => ea.agent_id !== BLOCKED_AGENT_ID)
    .forEach((ea) => {
      const agentId = ea.agent_id;
      const selected = selectedId === agentId ? "selected" : "";
      options.push(
        `<option value="${escapeAttr(agentId)}" ${selected}>${escapeHtml(getAgentName(agentId) || agentId)}</option>`
      );
    });

  return options.join("");
}

function buildLookingForOptions(selectedValue) {
  const choices = [
    "Life Insurance",
    "Health Insurance",
    "Auto Insurance",
    "Home Insurance",
    "Business Insurance",
    "Pet Insurance",
    "Other"
  ];

  return choices
    .map((choice) => {
      const selected = choice === selectedValue ? "selected" : "";
      return `<option value="${escapeAttr(choice)}" ${selected}>${escapeHtml(choice)}</option>`;
    })
    .join("");
}

function getAgentName(agentId) {
  if (!agentId) return "";
  return agentMap.get(agentId) || agentId;
}

function buildEventLabel(event) {
  const name = event.event_name || "Event";
  const cityState = [event.city, event.state].filter(Boolean).join(", ");
  const date = event.event_date || "";
  return [name, cityState, date].filter(Boolean).join(" • ");
}

function setFormMessage(id, msg, isError = false) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || "";
  el.className = `form-message ${isError ? "error" : "success"}`;
}

function setWorkspaceMessage(msg, isError = false) {
  setFormMessage("workspace-message", msg, isError);
}

function clearWorkspaceMessage() {
  const el = document.getElementById("workspace-message");
  if (!el) return;
  el.textContent = "";
  el.className = "form-message";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
