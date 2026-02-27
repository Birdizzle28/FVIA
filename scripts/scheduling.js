// scripts/scheduling.js — Calendar-style fields + recurring rendering per view range

document.addEventListener("DOMContentLoaded", async () => {
  /* ---------------- Auth gate ---------------- */
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = "login.html"; return; }
  const user = session.user;
  
  // ---------------- Timezone capture (save once per user) ----------------
  async function ensureUserTimezoneSaved() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    if (!tz) return;
  
    // ✅ UPDATE ONLY (no inserts), so you won't hit NOT NULL email or INSERT RLS
    const { error } = await supabase
      .from("agents")
      .update({ timezone: tz })
      .eq("id", user.id);
  
    if (error) console.warn("[TZ SAVE] update failed:", error.message);
  }

  await ensureUserTimezoneSaved();
  
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
  
  /* ---------------- Appointment Details Modal ---------------- */
  const apptModal = document.getElementById("appt-modal");
  const apptStatusEl = document.getElementById("appt-modal-status");
  const apptTitleEl = document.getElementById("appt-title");
  const apptWhenEl = document.getElementById("appt-when");
  const apptLocationEl = document.getElementById("appt-location");
  const apptRepeatRow = document.getElementById("appt-repeat-row");
  const apptRepeatEl = document.getElementById("appt-repeat");
  const apptUrlRow = document.getElementById("appt-url-row");
  const apptUrlEl = document.getElementById("appt-url");
  const apptNotesRow = document.getElementById("appt-notes-row");
  const apptNotesEl = document.getElementById("appt-notes");
  const EVENT_PURPLE = "#363465";
  const EVENT_PINK = "#E2A1A7";
  
  const apptEditBtn = document.getElementById("appt-edit");
  const apptDeleteBtn = document.getElementById("appt-delete");
  
  let activeClickedEvent = null;

  function getContactIdsFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("contact_ids");
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  (function prefillFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const apptType = (params.get("appointment_type") || "").toLowerCase();
    window.__newAppointmentType = apptType || ""; // "contact" or ""
  
    // ✅ capture passed contact ids
    window.__contactIdsFromQuery = getContactIdsFromUrl();
  
    if (apptType !== "contact") return;
  
    const t = params.get("prefill_title");
    const n = params.get("prefill_notes");
  
    if (t && titleInput) titleInput.value = t;
    if (n && notesInput) notesInput.value = n;
  
    if (typeof initFloatingLabels === "function") initFloatingLabels(document);
  })();

  function sameLocalTimeOnDate(baseLocalDateTime, y, m, d) {
    return new Date(
      y, m, d,
      baseLocalDateTime.getHours(),
      baseLocalDateTime.getMinutes(),
      0, 0
    );
  }
  
  function addDaysLocal(d, days) {
    const x = new Date(d);
    x.setDate(x.getDate() + days); // local-calendar day step (DST-safe)
    return x;
  }
  
  function setApptStatus(msg, show = true) {
    if (!apptStatusEl) return;
    if (!show || !msg) {
      apptStatusEl.style.display = "none";
      apptStatusEl.textContent = "";
      return;
    }
    apptStatusEl.style.display = "block";
    apptStatusEl.textContent = msg;
  }
  
  function closeApptModal() {
    if (!apptModal) return;
    apptModal.hidden = true;
    apptModal.setAttribute("aria-hidden", "true");
    activeClickedEvent = null;
    setApptStatus("", false);
  }
  
  function openApptModal(fcEvent) {
    activeClickedEvent = fcEvent;
    setApptStatus("", false);
  
    const props = fcEvent.extendedProps || {};
    const title = (fcEvent.title || "Appointment").trim();
  
    const start = fcEvent.start ? new Date(fcEvent.start) : null;
    const end = fcEvent.end ? new Date(fcEvent.end) : null;
  
    const when = start
      ? `${start.toLocaleString()}${end ? ` → ${end.toLocaleString()}` : ""}`
      : "";
  
    const locType = (props.location_type || "").toLowerCase();
    let locationText = "—";
    if (locType === "virtual") locationText = "Virtual";
    if (locType === "physical") locationText = props.location_address ? props.location_address : "Physical (no address)";
    if (!locType) locationText = props.location_address || "—";
  
    const repeatRule = (props.repeat_rule || "never").toLowerCase();
    let repeatText = "";
    if (repeatRule && repeatRule !== "never") {
      if (repeatRule === "daily") repeatText = "Every day";
      else if (repeatRule === "weekly") repeatText = "Every week";
      else if (repeatRule === "biweekly") repeatText = "Every 2 weeks";
      else if (repeatRule === "monthly") repeatText = "Every month";
      else if (repeatRule === "yearly") repeatText = "Every year";
      else if (repeatRule === "custom") {
        try {
          const parsed = props.repeat_custom ? JSON.parse(props.repeat_custom) : null;
          if (parsed?.interval && parsed?.unit) {
            repeatText = `Every ${parsed.interval} ${parsed.unit}`;
          } else {
            repeatText = "Custom repeat";
          }
        } catch {
          repeatText = "Custom repeat";
        }
      } else {
        repeatText = props.repeat_rule || "Repeat";
      }
    }
  
    if (apptTitleEl) apptTitleEl.textContent = title;
    if (apptWhenEl) apptWhenEl.textContent = when;
    if (apptLocationEl) apptLocationEl.textContent = locationText;
  
    if (apptRepeatRow) apptRepeatRow.style.display = repeatText ? "grid" : "none";
    if (apptRepeatEl) apptRepeatEl.textContent = repeatText || "";
  
    const url = props.url || "";
    if (apptUrlRow) apptUrlRow.style.display = url ? "grid" : "none";
    if (apptUrlEl) {
      apptUrlEl.href = url || "#";
      apptUrlEl.textContent = url ? "Open link" : "";
    }
  
    const notes = props.notes || "";
    if (apptNotesRow) apptNotesRow.style.display = notes ? "grid" : "none";
    if (apptNotesEl) apptNotesEl.textContent = notes || "";
  
    apptModal.hidden = false;
    apptModal.setAttribute("aria-hidden", "false");
  }
  
  // close by clicking backdrop or cancel
  document.querySelectorAll("[data-appt-close]").forEach(el => el.addEventListener("click", closeApptModal));
  
  apptDeleteBtn?.addEventListener("click", async () => {
    try {
      if (!activeClickedEvent) return;
  
      const props = activeClickedEvent.extendedProps || {};
      const seriesId = props.series_id || activeClickedEvent.id;
  
      // If it’s an occurrence id like "uuid__2026-...", delete series
      const confirmed = confirm(`Delete "${activeClickedEvent.title}"?\n\nRecurring deletes the whole series for now.`);
      if (!confirmed) return;
  
      setApptStatus("Deleting…", true);
  
      const { error } = await supabase.from("appointments").delete().eq("id", seriesId);
      if (error) throw error;
  
      closeApptModal();
      calendar.refetchEvents();
    } catch (err) {
      console.error(err);
      setApptStatus(err?.message || "Failed to delete appointment.", true);
    }
  });
  
  apptEditBtn?.addEventListener("click", () => {
    if (!activeClickedEvent) return;
  
    const props = activeClickedEvent.extendedProps || {};
    const seriesId = props.series_id || activeClickedEvent.id;
  
    // Fill the form with the clicked event’s data
    titleInput.value = activeClickedEvent.title || "";
    initFloatingLabels(document);
  
    const locType = (props.location_type || "").toLowerCase();
    if (locationType) {
      locationType.value = locType || "";
      locationChoices?.setChoiceByValue?.(locationType.value);
    }
    if (locationAddress) locationAddress.value = props.location_address || "";
    toggleLocationFields();
  
    const start = activeClickedEvent.start ? new Date(activeClickedEvent.start) : null;
    const end = activeClickedEvent.end ? new Date(activeClickedEvent.end) : null;
  
    if (start) window.fpStart?.setDate(start, true);
    if (end) window.fpEnd?.setDate(end, true);
  
    if (repeatRule) {
      repeatRule.value = (props.repeat_rule || "never");
      repeatChoices?.setChoiceByValue?.(repeatRule.value);
    }
  
    if ((props.repeat_rule || "").toLowerCase() === "custom") {
      try {
        const parsed = props.repeat_custom ? JSON.parse(props.repeat_custom) : null;
        if (repeatInterval) repeatInterval.value = String(parsed?.interval || 1);
        if (repeatUnit) repeatUnit.value = String(parsed?.unit || "days");
        window.repeatUnitChoices?.setChoiceByValue?.(repeatUnit.value);
      } catch {}
    }
  
    if (urlInput) urlInput.value = props.url || "";
    if (notesInput) notesInput.value = props.notes || "";
  
    toggleRepeatCustom();
    initFloatingLabels(document);
  
    // Put the id somewhere so we know we’re editing (not creating)
    form.dataset.editingId = seriesId;
  
    closeApptModal();
    form.scrollIntoView({ behavior: "smooth" });
  
    // Change button label (optional)
    const btn = document.getElementById("create-appointment");
    if (btn) btn.textContent = "Save Changes";
  });

  /* ---------------- Reminder modal elements ---------------- */
  const reminderModal = document.getElementById("reminder-modal");
  const reminderStatusEl = document.getElementById("reminder-modal-status");
  const reminderCancelBtn = document.getElementById("reminder-cancel");
  const reminderSaveBtn = document.getElementById("reminder-save");
  const cardYes = document.getElementById("reminder-card-yes");
  const cardNo = document.getElementById("reminder-card-no");
  const timeBtn = document.getElementById("reminder-time-btn");
  const timeLabel = document.getElementById("reminder-time-label");
  
  // timewheel modal
  const timewheelModal = document.getElementById("timewheel-modal");
  const wheelHours = document.getElementById("wheel-hours");
  const wheelMins = document.getElementById("wheel-mins");
  const timewheelDone = document.getElementById("timewheel-done");
  const timewheelCancel = document.getElementById("timewheel-cancel");
  
  let pendingAppointmentPayload = null; // hold form data until modal Save
  let reminderChoice = "no";            // "yes" | "no"
  let remindHours = 0;
  let remindMins = 5;

  function setReminderStatus(msg, show=true){
    if (!reminderStatusEl) return;
    if (!show || !msg){
      reminderStatusEl.style.display = "none";
      reminderStatusEl.textContent = "";
      return;
    }
    reminderStatusEl.style.display = "block";
    reminderStatusEl.textContent = msg;
  }
  
  function openReminderModal(payload){
    pendingAppointmentPayload = payload;
    setReminderStatus("", false);
  
    selectReminderCard("no"); // default
    updateTimeLabel();
  
    reminderModal.hidden = false;
    reminderModal.setAttribute("aria-hidden", "false");
  }
  
  function closeReminderModal(){
    reminderModal.hidden = true;
    reminderModal.setAttribute("aria-hidden", "true");
    pendingAppointmentPayload = null;
    setReminderStatus("", false);
  }
  
  function selectReminderCard(choice){
    reminderChoice = choice;
    cardYes?.classList.toggle("selected", choice === "yes");
    cardNo?.classList.toggle("selected", choice === "no");
  }
  
  function updateTimeLabel(){
    const hh = String(remindHours).padStart(2,"0");
    const mm = String(remindMins).padStart(2,"0");
    if (timeLabel) timeLabel.textContent = `${hh} hours ${mm} min`;
  }

  // --- TIMEWHEEL SETTINGS ---
  // IMPORTANT: This MUST match your CSS .wheel-item height (px)
  const WHEEL_ITEM_HEIGHT = 44;
  
  function spacerHeightPx(listEl) {
    return Math.max(0, Math.floor(listEl.clientHeight / 2 - WHEEL_ITEM_HEIGHT / 2));
  }
  
  function buildWheel(listEl, max) {
    listEl.innerHTML = "";
  
    const top = document.createElement("div");
    top.className = "wheel-spacer";
    top.style.height = `${spacerHeightPx(listEl)}px`;
    listEl.appendChild(top);
  
    for (let i = 0; i <= max; i++) {
      const item = document.createElement("div");
      item.className = "wheel-item";
      item.dataset.val = String(i);
      item.textContent = String(i);
      listEl.appendChild(item);
    }
  
    const bottom = document.createElement("div");
    bottom.className = "wheel-spacer";
    bottom.style.height = `${spacerHeightPx(listEl)}px`;
    listEl.appendChild(bottom);
  }
  
  function setActiveByIndex(listEl, idx) {
    const items = Array.from(listEl.querySelectorAll(".wheel-item"));
    items.forEach((it, i) => it.classList.toggle("active", i === idx));
  }
  
  function getOffset(listEl) {
    const topSpacer = listEl.querySelector(".wheel-spacer");
    return topSpacer ? topSpacer.offsetHeight : 0;
  }
  
  // ✅ Spacer-aware, pixel-safe centered index (NO getBoundingClientRect)
  function getCenteredIndex(listEl) {
    const items = Array.from(listEl.querySelectorAll(".wheel-item"));
    if (!items.length) return 0;
  
    const offset = getOffset(listEl);
    const centerAdjust = listEl.clientHeight / 2 - WHEEL_ITEM_HEIGHT / 2;
  
    const raw = (listEl.scrollTop + centerAdjust - offset) / WHEEL_ITEM_HEIGHT;
    const idx = Math.round(raw);
  
    return Math.max(0, Math.min(idx, items.length - 1));
  }
  
  function snapWheel(listEl) {
    const items = Array.from(listEl.querySelectorAll(".wheel-item"));
    if (!items.length) return;
  
    const idx = getCenteredIndex(listEl);
  
    const offset = getOffset(listEl);
    const centerAdjust = listEl.clientHeight / 2 - WHEEL_ITEM_HEIGHT / 2;
  
    const targetTop = offset + idx * WHEEL_ITEM_HEIGHT - centerAdjust;
  
    listEl.dataset.programSnap = "1";
    listEl.scrollTo({ top: targetTop, behavior: "auto" });
    setActiveByIndex(listEl, idx);
  
    requestAnimationFrame(() => delete listEl.dataset.programSnap);
  }
  
  function scrollToValue(listEl, val) {
    const items = Array.from(listEl.querySelectorAll(".wheel-item"));
    const idx = items.findIndex((it) => it.dataset.val === String(val));
    if (idx === -1) return;
  
    const offset = getOffset(listEl);
    const centerAdjust = listEl.clientHeight / 2 - WHEEL_ITEM_HEIGHT / 2;
  
    const targetTop = offset + idx * WHEEL_ITEM_HEIGHT - centerAdjust;
  
    listEl.dataset.programSnap = "1";
    listEl.scrollTo({ top: targetTop, behavior: "auto" });
    setActiveByIndex(listEl, idx);
  
    requestAnimationFrame(() => delete listEl.dataset.programSnap);
  }
  
  function getCenteredValue(listEl) {
    const items = Array.from(listEl.querySelectorAll(".wheel-item"));
    const idx = getCenteredIndex(listEl);
    setActiveByIndex(listEl, idx);
    return parseInt(items[idx]?.dataset.val || "0", 10);
  }
  
  function wireWheelSnap(listEl) {
    if (listEl.dataset.snapWired === "1") return;
    listEl.dataset.snapWired = "1";
  
    let t = null;
  
    listEl.addEventListener("scroll", () => {
      if (listEl.dataset.programSnap === "1") return;
  
      // allow 0 (0 is valid)
      if (listEl.scrollTop < 0) listEl.scrollTop = 0;
  
      if (t) clearTimeout(t);
      t = setTimeout(() => snapWheel(listEl), 90);
    }, { passive: true });
  }
  
  function openTimewheel() {
    timewheelModal.hidden = false;
    timewheelModal.setAttribute("aria-hidden", "false");
  
    requestAnimationFrame(() => {
      buildWheel(wheelHours, 23);
      buildWheel(wheelMins, 59);
  
      wireWheelSnap(wheelHours);
      wireWheelSnap(wheelMins);
  
      scrollToValue(wheelHours, remindHours);
      scrollToValue(wheelMins, remindMins);
    });
  }
  
  function closeTimewheel(){
    timewheelModal.hidden = true;
    timewheelModal.setAttribute("aria-hidden", "true");
  }

  // close by clicking backdrop
  document.querySelectorAll("[data-reminder-close]").forEach(el => el.addEventListener("click", closeReminderModal));
  document.querySelectorAll("[data-timewheel-close]").forEach(el => el.addEventListener("click", closeTimewheel));
  
  reminderCancelBtn?.addEventListener("click", closeReminderModal);
  reminderSaveBtn?.addEventListener("click", async () => {
    try {
      if (!pendingAppointmentPayload) return;
  
      setReminderStatus("Saving…", true);
  
      const remindBeforeMinutes = (remindHours * 60) + remindMins;
  
      // If they chose reminders, ensure browser push is enabled + stored
      if (reminderChoice === "yes") {
        await ensurePushSubscription();
      }
  
      // ✅ Attach reminder settings to the appointment payload
      const payloadToInsert = {
        ...pendingAppointmentPayload,
        remind_enabled: reminderChoice === "yes",
        remind_before_minutes: reminderChoice === "yes" ? remindBeforeMinutes : null,
      };
  
      const contactIds = Array.isArray(window.__contactIdsFromQuery)
        ? window.__contactIdsFromQuery
        : [];
      
      const isContactAppt = ((window.__newAppointmentType || "").toLowerCase() === "contact");
      
      // ✅ If multiple contact ids were passed, insert one appointment per contact
      if (isContactAppt && contactIds.length > 1) {
        const rows = contactIds.map((cid) => ({
          ...payloadToInsert,
          contact_id: cid,
        }));
      
        const { error } = await supabase.from("appointments").insert(rows);
        if (error) throw error;
      
      } else {
        const row = {
          ...payloadToInsert,
          contact_id: (isContactAppt && contactIds.length ? contactIds[0] : payloadToInsert.contact_id || null),
        };
      
        const { error } = await supabase.from("appointments").insert(row);
        if (error) throw error;
      }
  
      closeReminderModal();
  
      // Reset UI like before
      form.reset();
      window.fpStart?.clear?.();
      window.fpEnd?.clear?.();
      toggleLocationFields();
      toggleRepeatCustom();
      initFloatingLabels(document);
  
      calendar.refetchEvents();
  
    } catch (err) {
      console.error(err);
      setReminderStatus(err?.message || "Failed to save appointment.", true);
    }
  });
  
  cardYes?.addEventListener("click", () => selectReminderCard("yes"));
  cardNo?.addEventListener("click", () => selectReminderCard("no"));
  
  timeBtn?.addEventListener("click", () => {
    selectReminderCard("yes");
    openTimewheel();
  });
  
  timewheelCancel?.addEventListener("click", closeTimewheel);
  
  timewheelDone?.addEventListener("click", () => {
    remindHours = getCenteredValue(wheelHours);
    remindMins = getCenteredValue(wheelMins);
    updateTimeLabel();
    closeTimewheel();
  });

  const VAPID_PUBLIC_KEY = "BD2IGcWhq7PWFauNfIAkQdh44nwKycEs2RMlHjk-ypuWsW4jdmoPy7_sDyHuYkMqKCMg1D0wZpc8QjRWKXfOCW0"; // safe to be public

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }
  
  async function ensurePushSubscription(){
    // NOTE: iOS Safari only supports web push for PWA installed to Home Screen.
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      throw new Error("Your browser doesn’t support push notifications here.");
    }
  
    if (Notification.permission === "denied") {
      throw new Error("Notifications are blocked in browser/site settings.");
    }
  
    if (Notification.permission !== "granted") {
      const r = await Notification.requestPermission();
      if (r !== "granted") throw new Error("Notification permission was not granted.");
    }
  
    const reg = await navigator.serviceWorker.ready;
  
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
  
    // send subscription to Netlify function for storage
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
  
    const resp = await fetch("/.netlify/functions/push-subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ subscription: sub }),
    });
  
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`Failed to save push subscription: ${t}`);
    }
  
    return sub;
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
  window.fpStart = flatpickr("#starts", {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    minDate: "today",
    disableMobile: true, // ✅ force real flatpickr input on iOS
  });
  
  window.fpEnd = flatpickr("#ends", {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    minDate: "today",
    disableMobile: true, // ✅
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
        appointment_type,
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
    const isContact = (row.appointment_type || "").toLowerCase() === "contact";
    const bg = isContact ? EVENT_PINK : EVENT_PURPLE;
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
          backgroundColor: bg,
          borderColor: bg,
          textColor: "#ffffff",
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
    
      // repeating rules: generate only for this view range
      const baseLocal = new Date(row.scheduled_for); // local view of the first occurrence
      let cur = new Date(baseLocal);
      
      // fast-forward to view start (by local days, DST-safe)
      while (cur < rangeStart) {
        if (rule === "daily") cur = addDaysLocal(cur, 1);
        else if (rule === "weekly") cur = addDaysLocal(cur, 7);
        else if (rule === "biweekly") cur = addDaysLocal(cur, 14);
        else if (rule === "monthly") cur = addMonths(cur, 1);
        else if (rule === "yearly") cur = addYears(cur, 1);
        else break;
      }
      
      while (cur < rangeEnd) {
        // ✅ rebuild occurrence using SAME local time on the CURRENT date
        const occStart = sameLocalTimeOnDate(baseLocal, cur.getFullYear(), cur.getMonth(), cur.getDate());
        const occEnd = addMinutes(occStart, durMin);
      
        if (occStart < rangeEnd && occEnd > rangeStart) {
          out.push({
            id: occId(row.id, occStart),
            title: baseTitle,
            start: occStart.toISOString(),
            end: occEnd.toISOString(),
            allDay: false,
            backgroundColor: bg,
            borderColor: bg,
            textColor: "#ffffff",
            extendedProps: { ...baseProps, occurrence_start: occStart.toISOString() },
          });
        }
      
        if (rule === "daily") cur = addDaysLocal(cur, 1);
        else if (rule === "weekly") cur = addDaysLocal(cur, 7);
        else if (rule === "biweekly") cur = addDaysLocal(cur, 14);
        else if (rule === "monthly") cur = addMonths(cur, 1);
        else if (rule === "yearly") cur = addYears(cur, 1);
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
          backgroundColor: bg,
          borderColor: bg,
          textColor: "#ffffff",
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
      window.fpStart?.setDate(start, true);
      window.fpEnd?.setDate(end, true);
      titleInput?.focus();
      form.scrollIntoView({ behavior: "smooth" });
    },
  
    eventClick: async (info) => {
      openApptModal(info.event);
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

    const start = window.fpStart?.selectedDates?.[0] || null;
    const end = window.fpEnd?.selectedDates?.[0] || null;

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

    const contactIds = Array.isArray(window.__contactIdsFromQuery)
      ? window.__contactIdsFromQuery
      : [];
    
    const isContactAppt = ((window.__newAppointmentType || "").toLowerCase() === "contact");
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
      contact_id: (isContactAppt && contactIds.length ? contactIds[0] : null),
      appointment_type: (window.__newAppointmentType || "").toLowerCase() || null,
      remind_enabled: false,
      remind_before_minutes: null,
    };

    const editingId = form.dataset.editingId || "";
    
    if (editingId) {
    // ✅ EDIT MODE: update existing series immediately (don’t use reminder modal here yet)
    const { error } = await supabase
      .from("appointments")
      .update({
        scheduled_for: payload.scheduled_for,
        ends_at: payload.ends_at,
        title: payload.title,
        location_type: payload.location_type,
        location_address: payload.location_address,
        repeat_rule: payload.repeat_rule,
        repeat_custom: payload.repeat_custom,
        url: payload.url,
        notes: payload.notes,
      })
      .eq("id", editingId);
  
      if (error) { console.error(error); alert("Failed to update appointment."); return; }
    
      // reset edit mode
      delete form.dataset.editingId;
      const btn = document.getElementById("create-appointment");
      if (btn) btn.textContent = "Create Appointment";
    
      form.reset();
      window.fpStart?.clear?.();
      window.fpEnd?.clear?.();
      toggleLocationFields();
      toggleRepeatCustom();
      initFloatingLabels(document);
    
      calendar.refetchEvents();
      return;
    }
    
    // ✅ CREATE MODE: use reminder modal flow
    pendingAppointmentPayload = payload;
    openReminderModal(payload);
  });
});

