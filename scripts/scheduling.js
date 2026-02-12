// scripts/scheduling.js — Calendar-style fields + recurring rendering per view range

document.addEventListener("DOMContentLoaded", async () => {
  /* ---------------- Auth gate ---------------- */
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }
  const user = session.user;

  /* ---------------- Elements ---------------- */
  const form = document.getElementById("appointment-form");
  const titleInput = document.getElementById("title");

  const locationType = document.getElementById("location-type");
  const locationAddressWrap = document.getElementById("location-address-wrap");
  const locationAddress = document.getElementById("location-address");

  const repeatRule = document.getElementById("repeat-rule");
  const repeatCustomWrap = document.getElementById("repeat-custom-wrap");
  const repeatInterval = document.getElementById("repeat-interval");
  const repeatUnit = document.getElementById("repeat-unit");

  const urlInput = document.getElementById("url");
  const notesInput = document.getElementById("notes");

  const calendarEl = document.getElementById("calendar");
  
  // ---------------- Sync Modal (open + actions) ----------------
  const syncModal = document.getElementById("sync-modal");
  const syncClose = document.getElementById("sync-close");
  const syncSkip = document.getElementById("sync-skip");
  const syncGoogle = document.getElementById("sync-google");
  const syncIcs = document.getElementById("sync-ics");
  const syncCopy = document.getElementById("sync-copy");
  const syncSummary = document.getElementById("sync-summary");
  
  let lastCreatedEvent = null;
  
  function pad2(n) { return String(n).padStart(2, "0"); }
  
  function formatLocalNice(dt) {
    if (!dt) return "";
    const d = new Date(dt);
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    let h = d.getHours();
    const m = pad2(d.getMinutes());
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${yyyy}-${mm}-${dd} ${h}:${m} ${ampm}`;
  }
  
  function toIcsUtc(dt) {
    const d = new Date(dt);
    return (
      d.getUTCFullYear() +
      pad2(d.getUTCMonth() + 1) +
      pad2(d.getUTCDate()) + "T" +
      pad2(d.getUTCHours()) +
      pad2(d.getUTCMinutes()) +
      pad2(d.getUTCSeconds()) + "Z"
    );
  }
  
  function escapeIcsText(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }
  
  function buildGoogleCalendarUrl(evt) {
    const start = new Date(evt.start);
    const end = new Date(evt.end);
  
    // Google expects local times in RFC3339-ish; easiest: ISO string without milliseconds
    const fmt = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  
    const dates = `${fmt(start).replace(/[-:]/g, "").replace(".000", "")}/${fmt(end).replace(/[-:]/g, "").replace(".000", "")}`;
  
    const params = new URLSearchParams();
    params.set("action", "TEMPLATE");
    params.set("text", evt.title || "Appointment");
    params.set("dates", dates);
  
    const detailsParts = [];
    if (evt.notes) detailsParts.push(evt.notes);
    if (evt.url) detailsParts.push(`Link: ${evt.url}`);
    if (evt.repeat_text) detailsParts.push(`Repeat: ${evt.repeat_text}`);
    params.set("details", detailsParts.join("\n\n"));
  
    if (evt.location) params.set("location", evt.location);
  
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }
  
  function buildIcsFile(evt) {
    const uid = `${Date.now()}-${Math.random().toString(16).slice(2)}@familyvaluesgroup`;
    const dtstamp = toIcsUtc(new Date());
    const dtstart = toIcsUtc(evt.start);
    const dtend = toIcsUtc(evt.end);
  
    let description = "";
    if (evt.notes) description += evt.notes;
    if (evt.url) description += (description ? "\n\n" : "") + `Link: ${evt.url}`;
    if (evt.repeat_text) description += (description ? "\n\n" : "") + `Repeat: ${evt.repeat_text}`;
  
    // Optional RRULE for custom interval (days/weeks/months/years)
    // Only if you want it; safe to include for custom.
    let rruleLine = "";
    if (evt.rrule) rruleLine = `RRULE:${evt.rrule}\r\n`;
  
    const lines =
  `BEGIN:VCALENDAR\r
  VERSION:2.0\r
  PRODID:-//Family Values Group//Scheduling//EN\r
  CALSCALE:GREGORIAN\r
  METHOD:PUBLISH\r
  BEGIN:VEVENT\r
  UID:${uid}\r
  DTSTAMP:${dtstamp}\r
  SUMMARY:${escapeIcsText(evt.title)}\r
  DTSTART:${dtstart}\r
  DTEND:${dtend}\r
  ${evt.location ? `LOCATION:${escapeIcsText(evt.location)}\r\n` : ""}${description ? `DESCRIPTION:${escapeIcsText(description)}\r\n` : ""}${rruleLine}END:VEVENT\r
  END:VCALENDAR\r`;
  
    return lines;
  }
  
  function downloadTextFile(filename, text, mime = "text/plain") {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  
  function closeSyncModal() {
    if (!syncModal) return;
    syncModal.classList.remove("open");
    syncModal.setAttribute("aria-hidden", "true");
  }
  
  function openSyncModal(evt) {
    lastCreatedEvent = evt;
  
    if (syncSummary) {
      const when = `${formatLocalNice(evt.start)} → ${formatLocalNice(evt.end)}`;
      const where = evt.location ? ` • ${evt.location}` : "";
      syncSummary.textContent = `Saved: ${evt.title} • ${when}${where}`;
    }
  
    if (!syncModal) return;
    syncModal.classList.add("open");
    syncModal.setAttribute("aria-hidden", "false");
  }
  
  // Close handlers
  syncClose?.addEventListener("click", closeSyncModal);
  syncSkip?.addEventListener("click", closeSyncModal);
  syncModal?.addEventListener("click", (e) => {
    if (e.target === syncModal) closeSyncModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSyncModal();
  });
  
  // Action handlers
  syncGoogle?.addEventListener("click", () => {
    if (!lastCreatedEvent) return;
    const url = buildGoogleCalendarUrl(lastCreatedEvent);
    window.open(url, "_blank", "noopener,noreferrer");
    closeSyncModal();
  });
  
  syncIcs?.addEventListener("click", () => {
    if (!lastCreatedEvent) return;
    const ics = buildIcsFile(lastCreatedEvent);
    const safeTitle = (lastCreatedEvent.title || "appointment").replace(/[^\w\-]+/g, "_").slice(0, 60);
    downloadTextFile(`${safeTitle}.ics`, ics, "text/calendar");
    closeSyncModal();
  });
  
  syncCopy?.addEventListener("click", async () => {
    if (!lastCreatedEvent) return;
  
    const lines = [
      `Title: ${lastCreatedEvent.title || ""}`,
      `Start: ${formatLocalNice(lastCreatedEvent.start)}`,
      `End: ${formatLocalNice(lastCreatedEvent.end)}`,
      lastCreatedEvent.location ? `Location: ${lastCreatedEvent.location}` : "",
      lastCreatedEvent.url ? `URL: ${lastCreatedEvent.url}` : "",
      lastCreatedEvent.repeat_text ? `Repeat: ${lastCreatedEvent.repeat_text}` : "",
      lastCreatedEvent.notes ? `Notes:\n${lastCreatedEvent.notes}` : "",
    ].filter(Boolean);
  
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch (err) {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = lines.join("\n");
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  
    closeSyncModal();
  });
  
  
  // ---------------- REPLACE your final alert in submit handler ----------------
  // After insert success, right where you currently do:
  //   calendar.refetchEvents();
  //   alert("Appointment created!");
  // Replace that with:
  
  // Build display + sync details from the payload you already have
  function buildRepeatText(rep, repCustomJson) {
    if (!rep || rep === "never") return "";
    if (rep === "daily") return "Every day";
    if (rep === "weekly") return "Every week";
    if (rep === "biweekly") return "Every 2 weeks";
    if (rep === "monthly") return "Every month";
    if (rep === "yearly") return "Every year";
    if (rep === "custom" && repCustomJson) {
      try {
        const x = JSON.parse(repCustomJson);
        const i = Math.max(1, parseInt(x.interval || 1, 10));
        const u = String(x.unit || "days");
        return `Every ${i} ${u}`;
      } catch { return "Custom"; }
    }
    return "";
  }
  
  function buildRrule(rep, repCustomJson) {
    // Optional: adds RRULE into ICS for custom repeats
    // Google URL recurrence can be added later; for now we include only ICS.
    if (rep !== "custom" || !repCustomJson) return "";
    try {
      const x = JSON.parse(repCustomJson);
      const i = Math.max(1, parseInt(x.interval || 1, 10));
      const u = String(x.unit || "days").toLowerCase();
  
      // Map to RRULE FREQ
      let freq = "";
      if (u === "days") freq = "DAILY";
      else if (u === "weeks") freq = "WEEKLY";
      else if (u === "months") freq = "MONTHLY";
      else if (u === "years") freq = "YEARLY";
      else return "";
  
      return `FREQ=${freq};INTERVAL=${i}`;
    } catch { return ""; }
  }
  if (!form || !calendarEl) return;

    // ✅ Header title control (your custom header element)
  const headerTitleEl = document.getElementById("cal-title");
  function setHeaderTitle(text) {
    if (headerTitleEl) headerTitleEl.textContent = text || "";
  }
  let activeMode = "month";          // day | week | month | year
  let activeYear = new Date().getFullYear();
  
  /* ---------------- Floating Labels ---------------- */
  function initFloatingLabels(scope = document) {
    scope.querySelectorAll(".fl-field").forEach((fl) => {
      const input = fl.querySelector("input, textarea, select");
      if (!input) return;

      const setHV = () => {
        const val = (input.tagName === "SELECT") ? (input.value || "") : (input.value || "").trim();
        fl.classList.toggle("has-value", !!val);
      };

      setHV();
      input.addEventListener("focus", () => fl.classList.add("is-focused"));
      input.addEventListener("blur", () => { fl.classList.remove("is-focused"); setHV(); });
      input.addEventListener("input", setHV);
      input.addEventListener("change", setHV);
    });
  }

  /* ---------------- Choices (dropdown UX) ---------------- */
  let locationChoices = null;
  let repeatChoices = null;

  function initChoices() {
    if (!window.Choices) return;

    if (locationType) {
      if (locationChoices) locationChoices.destroy();
      locationChoices = new Choices(locationType, {
        searchEnabled: false,
        shouldSort: false,
        itemSelectText: "",
        placeholder: true,
        placeholderValue: "Select…",
      });
    }

    if (repeatRule) {
      if (repeatChoices) repeatChoices.destroy();
      repeatChoices = new Choices(repeatRule, {
        searchEnabled: false,
        shouldSort: false,
        itemSelectText: "",
      });
    }

    // (Optional) style the custom unit dropdown too
    if (repeatUnit) {
      // you can reuse repeatChoices variable or create a new one; let's make a new one
      if (window.repeatUnitChoices) window.repeatUnitChoices.destroy();
      window.repeatUnitChoices = new Choices(repeatUnit, {
        searchEnabled: false,
        shouldSort: false,
        itemSelectText: "",
      });
    }
  }

  /* ---------------- Flatpickr ---------------- */
  const fpStart = flatpickr("#starts", {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    minDate: "today",
  });

  const fpEnd = flatpickr("#ends", {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    minDate: "today",
  });

  /* ---------------- UI toggles ---------------- */
  function toggleLocationFields() {
    const v = (locationType?.value || "").toLowerCase();
    const showPhysical = v === "physical";
    if (locationAddressWrap) locationAddressWrap.style.display = showPhysical ? "block" : "none";
    if (!showPhysical && locationAddress) locationAddress.value = "";
    initFloatingLabels(document);
  }

  function toggleRepeatCustom() {
    const v = (repeatRule?.value || "").toLowerCase();
    const show = v === "custom";
  
    if (repeatCustomWrap) repeatCustomWrap.style.display = show ? "block" : "none";
  
    if (!show) {
      if (repeatInterval) repeatInterval.value = "1";
      if (repeatUnit) repeatUnit.value = "days";
    }
  
    initFloatingLabels(document);
  }

  locationType?.addEventListener("change", toggleLocationFields);
  repeatRule?.addEventListener("change", toggleRepeatCustom);

  initChoices();
  initFloatingLabels(document);
  toggleLocationFields();
  toggleRepeatCustom();

  /* ---------------- Recurrence helpers ---------------- */
  function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  }

  function getDurationMinutes(start, end) {
    if (!start || !end) return 30;
    const ms = end.getTime() - start.getTime();
    return Math.max(5, Math.round(ms / 60000));
  }

  function clampToRange(dt, rangeStart, rangeEnd) {
    return dt.getTime() >= rangeStart.getTime() && dt.getTime() < rangeEnd.getTime();
  }

  function addMonths(d, months) {
    const x = new Date(d);
    const day = x.getDate();
    x.setMonth(x.getMonth() + months);
    if (x.getDate() !== day) x.setDate(0);
    return x;
  }

  function addYears(d, years) {
    const x = new Date(d);
    x.setFullYear(x.getFullYear() + years);
    return x;
  }

  function occId(baseId, occStart) {
    return `${baseId}__${occStart.toISOString()}`;
  }

  /* ---------------- Fetch series rows ---------------- */
  async function fetchSeriesRows() {
    const { data, error } = await supabase
      .from("appointments")
      .select(`
        id,
        agent_id,
        scheduled_for,
        ends_at,
        title,
        location_type,
        location_address,
        repeat_rule,
        repeat_custom,
        url,
        notes
      `)
      .order("scheduled_for", { ascending: true });

    if (error) throw error;

    // current behavior: show only my appointments
    return (data || []).filter((r) => r.agent_id === user.id);
  }

  function expandSeriesIntoRange(row, rangeStart, rangeEnd) {
    const rule = (row.repeat_rule || "never").toLowerCase();

    const seriesStart = new Date(row.scheduled_for);
    const seriesEnd = row.ends_at ? new Date(row.ends_at) : addMinutes(seriesStart, 30);
    const durMin = getDurationMinutes(seriesStart, seriesEnd);

    const baseTitle = (row.title || "Appointment").trim() || "Appointment";

    const baseProps = {
      series_id: row.id,
      location_type: row.location_type || null,
      location_address: row.location_address || null,
      repeat_rule: row.repeat_rule || "never",
      repeat_custom: row.repeat_custom || null,
      url: row.url || null,
      notes: row.notes || null,
    };

    const out = [];

    // NEVER: only include if intersects the visible range
    if (rule === "never" || rule === "") {
      const startsIn = clampToRange(seriesStart, rangeStart, rangeEnd);
      const endsIn = clampToRange(seriesEnd, rangeStart, rangeEnd);
      const overlaps = seriesStart < rangeEnd && seriesEnd > rangeStart;

      if (startsIn || endsIn || overlaps) {
        out.push({
          id: row.id,
          title: baseTitle,
          start: seriesStart.toISOString(),
          end: seriesEnd.toISOString(),
          allDay: false,
          extendedProps: baseProps,
        });
      }
      return out;
    }

    // CUSTOM: interval + unit ("Every 3 weeks")
    if (rule === "custom") {
      let interval = 1;
      let unit = "days";
    
      // repeat_custom is stored as JSON string: {"interval":3,"unit":"weeks"}
      if (row.repeat_custom) {
        try {
          const parsed = JSON.parse(row.repeat_custom);
          interval = Math.max(1, parseInt(parsed.interval || 1, 10));
          unit = String(parsed.unit || "days").toLowerCase();
        } catch (e) {
          // If older data is not JSON, fallback to base-only
          unit = "days";
          interval = 1;
        }
      }
    
      let cur = new Date(seriesStart);
    
      // fast-forward roughly (good enough for now)
      if (cur < rangeStart) {
        cur = new Date(rangeStart);
        cur.setHours(seriesStart.getHours(), seriesStart.getMinutes(), 0, 0);
      }
    
      while (cur < rangeEnd) {
        const occStart = new Date(cur);
        const occEnd = addMinutes(occStart, durMin);
    
        if (occStart < rangeEnd && occEnd > rangeStart) {
          out.push({
            id: occId(row.id, occStart),
            title: baseTitle,
            start: occStart.toISOString(),
            end: occEnd.toISOString(),
            allDay: false,
            extendedProps: { ...baseProps, occurrence_start: occStart.toISOString() },
          });
        }
    
        if (unit === "days") cur = new Date(cur.getTime() + interval * 24 * 60 * 60 * 1000);
        else if (unit === "weeks") cur = new Date(cur.getTime() + interval * 7 * 24 * 60 * 60 * 1000);
        else if (unit === "months") cur = addMonths(cur, interval);
        else if (unit === "years") cur = addYears(cur, interval);
        else break;
      }
    
      return out;
    }

    // repeating rules: generate only for this view range
    let cur = new Date(seriesStart);

    // fast-forward for daily/weekly/biweekly
    if (rule === "daily" || rule === "weekly" || rule === "biweekly") {
      const stepDays = rule === "daily" ? 1 : (rule === "weekly" ? 7 : 14);
      if (cur < rangeStart) {
        const diffDays = Math.floor((rangeStart - cur) / (24 * 60 * 60 * 1000));
        const jumps = Math.floor(diffDays / stepDays);
        cur = new Date(cur.getTime() + jumps * stepDays * 24 * 60 * 60 * 1000);
        while (cur < rangeStart) {
          cur = new Date(cur.getTime() + stepDays * 24 * 60 * 60 * 1000);
        }
      }
    }

    while (cur < rangeEnd) {
      const occStart = new Date(cur);
      const occEnd = addMinutes(occStart, durMin);

      if (occStart < rangeEnd && occEnd > rangeStart) {
        out.push({
          id: occId(row.id, occStart),
          title: baseTitle,
          start: occStart.toISOString(),
          end: occEnd.toISOString(),
          allDay: false,
          extendedProps: { ...baseProps, occurrence_start: occStart.toISOString() },
        });
      }

      if (rule === "daily") cur = new Date(cur.getTime() + 1 * 24 * 60 * 60 * 1000);
      else if (rule === "weekly") cur = new Date(cur.getTime() + 7 * 24 * 60 * 60 * 1000);
      else if (rule === "biweekly") cur = new Date(cur.getTime() + 14 * 24 * 60 * 60 * 1000);
      else if (rule === "monthly") cur = addMonths(cur, 1);
      else if (rule === "yearly") cur = addYears(cur, 1);
      else break;
    }

    return out;
  }

  async function eventSourceByViewRange(info, successCallback, failureCallback) {
    try {
      const rows = await fetchSeriesRows();
      const rangeStart = info.start;
      const rangeEnd = info.end;

      const expanded = [];
      for (const row of rows) {
        expanded.push(...expandSeriesIntoRange(row, rangeStart, rangeEnd));
      }

      successCallback(expanded);
    } catch (err) {
      console.error("Failed to load events:", err);
      failureCallback(err);
    }
  }

  /* ---------------- FullCalendar ---------------- */
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: "dayGridMonth",
    headerToolbar: false,
    expandRows: true,
    height: "auto",
    contentHeight: "auto",
    stickyHeaderDates: true,
    nowIndicator: true,
    scrollTime: "08:00:00",
    editable: true,
    selectable: true,
    events: eventSourceByViewRange,
    datesSet: () => {
      if (activeMode !== "year") setHeaderTitle(calendar.view.title);
    },
    dateClick: (info) => {
      const start = info.date;
      const end = addMinutes(start, 30);
      fpStart.setDate(start, true);
      fpEnd.setDate(end, true);
      titleInput?.focus();
      form.scrollIntoView({ behavior: "smooth" });
    },
  
    eventClick: async (info) => {
      const seriesId = info.event.extendedProps?.series_id || info.event.id;
      const ok = confirm(`Delete "${info.event.title}"?\n\n(Recurring deletes whole series for now.)`);
      if (!ok) return;
  
      const { error } = await supabase.from("appointments").delete().eq("id", seriesId);
      if (error) { console.error(error); alert("Failed to delete appointment."); return; }
      calendar.refetchEvents();
    },
  
    eventDrop: async (info) => {
      const seriesId = info.event.extendedProps?.series_id || info.event.id;
      const start = info.event.start;
      const end = info.event.end;
      if (!start || !end) { info.revert(); return; }
  
      const { error } = await supabase
        .from("appointments")
        .update({ scheduled_for: start.toISOString(), ends_at: end.toISOString() })
        .eq("id", seriesId);
  
      if (error) { console.error(error); alert("Could not reschedule (reverting)."); info.revert(); return; }
      calendar.refetchEvents();
    },
  
    eventResize: async (info) => {
      const seriesId = info.event.extendedProps?.series_id || info.event.id;
      const start = info.event.start;
      const end = info.event.end;
      if (!start || !end) { info.revert(); return; }
  
      const { error } = await supabase
        .from("appointments")
        .update({ scheduled_for: start.toISOString(), ends_at: end.toISOString() })
        .eq("id", seriesId);
  
      if (error) { console.error(error); alert("Could not update duration (reverting)."); info.revert(); return; }
      calendar.refetchEvents();
    },
  });

  calendar.render();
  // initial title after render
  setHeaderTitle(calendar.view.title);
    /* ---------------- Custom header buttons ---------------- */
  const prevBtn = document.getElementById("cal-prev");
  const nextBtn = document.getElementById("cal-next");
  const todayBtn = document.getElementById("cal-today");

  prevBtn?.addEventListener("click", () => {
    if (activeMode === "year") {
      renderYearGrid(activeYear - 1);
    } else {
      calendar.prev();
      setHeaderTitle(calendar.view.title);
    }
  });

  nextBtn?.addEventListener("click", () => {
    if (activeMode === "year") {
      renderYearGrid(activeYear + 1);
    } else {
      calendar.next();
      setHeaderTitle(calendar.view.title);
    }
  });

  todayBtn?.addEventListener("click", () => {
    if (activeMode === "year") {
      const y = new Date().getFullYear();
      renderYearGrid(y);
    } else {
      calendar.today();
      setHeaderTitle(calendar.view.title);
    }
  });

  /* ---------------- Apple-style Year view (no events) ---------------- */
const tabsWrap = document.getElementById("cal-tabs");
const yearViewEl = document.getElementById("year-view");
const yearTitleEl = document.getElementById("year-title");
const yearGridEl = document.getElementById("year-grid");

function setActiveTab(mode) {
  activeMode = mode;
  document.querySelectorAll(".cal-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === mode);
  });
}

function monthName(m) {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m];
}

function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

function firstDow(y, m) {
  // 0 = Sun
  return new Date(y, m, 1).getDay();
}

// Builds 12 mini calendars (Jan–Dec) with all day numbers.
// No appointments shown. Clicking a day can jump you to Day view (optional).
function renderYearGrid(year) {
  activeYear = year;
  setHeaderTitle(String(year));
  if (yearTitleEl) yearTitleEl.textContent = String(year);
  if (!yearGridEl) return;

  yearGridEl.innerHTML = "";

  for (let m = 0; m < 12; m++) {
    const wrap = document.createElement("div");
    wrap.className = "mini-month";

    const head = document.createElement("div");
    head.className = "mini-month-title";
    head.textContent = monthName(m);
    wrap.appendChild(head);

    const dow = document.createElement("div");
    dow.className = "mini-dow";
    dow.innerHTML = `<span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>`;
    wrap.appendChild(dow);

    const grid = document.createElement("div");
    grid.className = "mini-grid";

    const pad = firstDow(year, m);
    for (let i = 0; i < pad; i++) {
      const blank = document.createElement("span");
      blank.className = "mini-day blank";
      grid.appendChild(blank);
    }

    const dim = daysInMonth(year, m);
    for (let d = 1; d <= dim; d++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "mini-day";
      cell.textContent = String(d);

      // Optional: tap a date -> switch to Day view at that date
      cell.addEventListener("click", () => {
        setViewMode("day", new Date(year, m, d));
      });

      grid.appendChild(cell);
    }

    wrap.appendChild(grid);
    yearGridEl.appendChild(wrap);
  }
}

function showYearMode() {
  // Hide FullCalendar, show custom year grid
  if (calendarEl) calendarEl.style.display = "none";
  if (yearViewEl) yearViewEl.style.display = "block";

  // Show “just the year” at the top (Apple behavior)
  // Also ensures January is included (we always render Jan–Dec)
  renderYearGrid(activeYear);
  setHeaderTitle(String(activeYear));
}

function showCalendarMode(fcViewName, goToDate) {
  if (yearViewEl) yearViewEl.style.display = "none";
  if (calendarEl) calendarEl.style.display = "block";

  if (goToDate) calendar.gotoDate(goToDate);
  calendar.changeView(fcViewName);
  requestAnimationFrame(() => setHeaderTitle(calendar.view.title));
}

function setViewMode(mode, goToDate) {
  setActiveTab(mode);

  if (mode === "year") {
    // anchor year based on the current calendar date if coming from month/week/day
    if (goToDate) activeYear = goToDate.getFullYear();
    else activeYear = calendar.getDate().getFullYear();
    showYearMode();
    return;
  }

  // Day/Week/Month map
  if (mode === "day")   showCalendarMode("timeGridDay", goToDate);
  if (mode === "week")  showCalendarMode("timeGridWeek", goToDate);
  if (mode === "month") showCalendarMode("dayGridMonth", goToDate);
}

// Tabs click
tabsWrap?.addEventListener("click", (e) => {
  const btn = e.target?.closest?.(".cal-tab");
  if (!btn) return;
  setViewMode(btn.dataset.view);
});

// Swipe left/right on YEAR view -> previous/next year
(function enableYearSwipe() {
  if (!yearViewEl) return;

  let startX = 0, startY = 0, down = false;

  yearViewEl.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    down = true;
  }, { passive: true });

  yearViewEl.addEventListener("touchend", (e) => {
    if (!down) return;
    down = false;

    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;

    if (dx < 0) renderYearGrid(activeYear + 1);
    else renderYearGrid(activeYear - 1);
  }, { passive: true });
})();

// Default mode
setViewMode("month");
setHeaderTitle(calendar.view.title);
  (function enableSwipeNav() {
    let startX = 0, startY = 0, isDown = false;
  
    calendarEl.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      isDown = true;
    }, { passive: true });
  
    calendarEl.addEventListener("touchend", (e) => {
      if (!isDown) return;
      isDown = false;
  
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
  
      // only treat as swipe if mostly horizontal
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
  
      if (dx < 0) calendar.next(); // swipe left => next
      else calendar.prev();        // swipe right => prev
    }, { passive: true });
  })();

  /* ---------------- Create appointment ---------------- */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = (titleInput?.value || "").trim();
    if (!title) { alert("Title is required."); return; }

    const locType = (locationType?.value || "").trim();
    if (!locType) { alert("Select a Location type."); return; }

    const start = fpStart.selectedDates?.[0] || null;
    const end = fpEnd.selectedDates?.[0] || null;

    if (!start || !end) { alert("Starts and Ends are required."); return; }
    if (+end <= +start) { alert("Ends must be after Starts."); return; }

    const rep = (repeatRule?.value || "never").trim();

    let repCustom = null;
    if (rep === "custom") {
      const interval = Math.max(1, parseInt(repeatInterval?.value || "1", 10));
      const unit = (repeatUnit?.value || "days").toLowerCase();
    
      repCustom = JSON.stringify({ interval, unit }); // stored in text column
    }

    const addr = (locType === "physical")
      ? ((locationAddress?.value || "").trim() || null)
      : null;

    const url = (urlInput?.value || "").trim() || null;
    const notes = (notesInput?.value || "").trim() || null;

    const payload = {
      agent_id: user.id,
      scheduled_for: start.toISOString(),
      ends_at: end.toISOString(),
      title,
      location_type: locType,
      location_address: addr,
      repeat_rule: rep,
      repeat_custom: repCustom,
      url,
      notes,
    };

    const { error } = await supabase.from("appointments").insert(payload);

    if (error) {
      console.error("Insert failed:", error);
      alert("Failed to create appointment.");
      return;
    }

    form.reset();
    fpStart.clear();
    fpEnd.clear();
    toggleLocationFields();
    toggleRepeatCustom();
    initFloatingLabels(document);

    calendar.refetchEvents();

    openSyncModal({
      title,
      start,
      end,
      location: (locType === "physical" ? (addr || "") : "Virtual"),
      notes,
      url,
      repeat_text: buildRepeatText(rep, repCustom),
      rrule: buildRrule(rep, repCustom),
    });
  });
});
