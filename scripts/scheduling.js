// scripts/scheduling.js — upgraded form fields + schema support

document.addEventListener('DOMContentLoaded', async () => {
  /* ---------------- Auth gate ---------------- */
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const user = session.user;

  /* ---------------- Floating Labels ---------------- */
  function initFloatingLabels(scope = document){
    const fields = scope.querySelectorAll('.fl-field');
    fields.forEach(fl => {
      const input = fl.querySelector('input, textarea, select');
      if (!input) return;

      const setHV = () => {
        const val = (input.tagName === "SELECT") ? (input.value || "") : (input.value || "").trim();
        fl.classList.toggle('has-value', !!val);
      };

      setHV();
      input.addEventListener('focus', () => fl.classList.add('is-focused'));
      input.addEventListener('blur',  () => { fl.classList.remove('is-focused'); setHV(); });
      input.addEventListener('input', setHV);
      input.addEventListener('change', setHV);
    });
  }

  /* ---------------- Elements ---------------- */
  const form = document.getElementById('appointment-form');
  const titleInput = document.getElementById('title');

  const locationType = document.getElementById('location-type');
  const locationAddressWrap = document.getElementById('location-address-wrap');
  const locationAddress = document.getElementById('location-address');

  const startsInput = document.getElementById('starts');
  const endsInput = document.getElementById('ends');

  const repeatRule = document.getElementById('repeat-rule');
  const repeatCustomWrap = document.getElementById('repeat-custom-wrap');
  const repeatCustom = document.getElementById('repeat-custom');

  const urlInput = document.getElementById('url');
  const notesInput = document.getElementById('notes');

  if (!form) return;

  function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60000);
  }
  
  function sameOrAfter(a, b) { return a.getTime() >= b.getTime(); }
  function sameOrBefore(a, b) { return a.getTime() <= b.getTime(); }
  
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
  
    // handle month rollover (e.g., Jan 31 -> Feb)
    if (x.getDate() !== day) {
      x.setDate(0); // last day of previous month
    }
    return x;
  }
  
  function addYears(d, years) {
    const x = new Date(d);
    x.setFullYear(x.getFullYear() + years);
    return x;
  }
  
  // Builds a per-occurrence id so FullCalendar doesn’t treat all instances as same event
  function occId(baseId, occStart) {
    return `${baseId}__${occStart.toISOString()}`;
  }
  
  /* ---------------- Choices.js (optional) ---------------- */
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
  }

  /* ---------------- Flatpickr ---------------- */
  const fpStart = flatpickr('#starts', {
    enableTime: true,
    dateFormat: 'Y-m-d H:i',
    minDate: 'today'
  });

  const fpEnd = flatpickr('#ends', {
    enableTime: true,
    dateFormat: 'Y-m-d H:i',
    minDate: 'today'
  });

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
    if (!show && repeatCustom) repeatCustom.value = "";
    initFloatingLabels(document);
  }

  locationType?.addEventListener("change", toggleLocationFields);
  repeatRule?.addEventListener("change", toggleRepeatCustom);

  initChoices();
  initFloatingLabels(document);
  toggleLocationFields();
  toggleRepeatCustom();

  /* ---------------- Load appointments ---------------- */
  async function loadAppointments() {
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id,
        agent_id,
        contact_id,
        lead_id,
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
      .order('scheduled_for', { ascending: true });

    if (error) {
      console.error('Failed to load appointments:', error);
      alert('Failed to load appointments.');
      return [];
    }

    // show only my appointments (change this if you want shared calendar)
    const mine = (data || []).filter(r => r.agent_id === user.id);

    return mine.map(row => {
      const startIso = row.scheduled_for;
      const endIso   = row.ends_at || null;

      // display title fallback
      const displayTitle = (row.title || "Appointment").trim() || "Appointment";

      // build a “location” string for FullCalendar hover/details
      let locText = "";
      if (row.location_type === "physical") locText = row.location_address || "";
      if (row.location_type === "virtual") locText = row.url || "Virtual";

      return {
        id: row.id,
        title: displayTitle,
        start: startIso,
        end: endIso,
        allDay: false,
        extendedProps: {
          location_type: row.location_type || null,
          location_address: row.location_address || null,
          repeat_rule: row.repeat_rule || "never",
          repeat_custom: row.repeat_custom || null,
          url: row.url || null,
          notes: row.notes || null,
          locationText: locText
        }
      };
    });
  }

  const calendarEl = document.getElementById('calendar');
  async function fetchSeriesRows() {
    const { data, error } = await supabase
      .from('appointments')
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
      .order('scheduled_for', { ascending: true });
  
    if (error) throw error;
  
    // show only my appointments (keep your current behavior)
    return (data || []).filter(r => r.agent_id === user.id);
  }
  
  function expandSeriesIntoRange(row, rangeStart, rangeEnd) {
    const rule = (row.repeat_rule || "never").toLowerCase();
  
    const seriesStart = new Date(row.scheduled_for);
    const seriesEnd = row.ends_at ? new Date(row.ends_at) : addMinutes(seriesStart, 30);
    const durMin = getDurationMinutes(seriesStart, seriesEnd);
  
    const baseTitle = (row.title || "Appointment").trim() || "Appointment";
  
    const baseProps = {
      series_id: row.id,
      is_occurrence: rule !== "never",
      location_type: row.location_type || null,
      location_address: row.location_address || null,
      repeat_rule: row.repeat_rule || "never",
      repeat_custom: row.repeat_custom || null,
      url: row.url || null,
      notes: row.notes || null,
    };
  
    const out = [];
  
    // NEVER: just include if it intersects the range
    if (rule === "never" || rule === "") {
      // include if start is within range OR overlaps range
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
  
    // CUSTOM (for now): store it but don’t auto-generate until you define structure
    if (rule === "custom") {
      // MVP behavior: show only the base occurrence if it’s in range
      if (clampToRange(seriesStart, rangeStart, rangeEnd)) {
        out.push({
          id: occId(row.id, seriesStart),
          title: baseTitle,
          start: seriesStart.toISOString(),
          end: addMinutes(seriesStart, durMin).toISOString(),
          allDay: false,
          extendedProps: baseProps,
        });
      }
      return out;
    }
  
    // For repeating rules: generate occurrences within range
    // Start from the seriesStart and step forward until we pass rangeEnd
    let cur = new Date(seriesStart);
  
    // Optimization: fast-forward near rangeStart for daily/weekly/biweekly
    if (rule === "daily" || rule === "weekly" || rule === "biweekly") {
      const stepDays = rule === "daily" ? 1 : (rule === "weekly" ? 7 : 14);
      if (cur < rangeStart) {
        const diffDays = Math.floor((rangeStart - cur) / (24 * 60 * 60 * 1000));
        const jumps = Math.floor(diffDays / stepDays);
        cur = new Date(cur.getTime() + jumps * stepDays * 24 * 60 * 60 * 1000);
        // if still behind, step until >= rangeStart
        while (cur < rangeStart) cur = new Date(cur.getTime() + stepDays * 24 * 60 * 60 * 1000);
      }
    }
  
    // Generate occurrences
    while (cur < rangeEnd) {
      const occStart = new Date(cur);
      const occEnd = addMinutes(occStart, durMin);
  
      // Only include if it intersects the visible range
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
  
      // Step forward
      if (rule === "daily") cur = new Date(cur.getTime() + 1 * 24 * 60 * 60 * 1000);
      else if (rule === "weekly") cur = new Date(cur.getTime() + 7 * 24 * 60 * 60 * 1000);
      else if (rule === "biweekly") cur = new Date(cur.getTime() + 14 * 24 * 60 * 60 * 1000);
      else if (rule === "monthly") cur = addMonths(cur, 1);
      else if (rule === "yearly") cur = addYears(cur, 1);
      else break; // safety
    }
  
    return out;
  }
  
  async function eventSourceByViewRange(info, successCallback, failureCallback) {
    try {
      const rows = await fetchSeriesRows();
  
      const rangeStart = info.start; // Date
      const rangeEnd = info.end;     // Date
  
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

  calendar.render();

  /* ---------------- Create appointment ---------------- */
  form.addEventListener('submit', async (e) => {
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
    const repCustom = (rep === "custom") ? ((repeatCustom?.value || "").trim() || null) : null;

    const addr = (locType === "physical")
      ? ((locationAddress?.value || "").trim() || null)
      : null;

    const url = (urlInput?.value || "").trim() || null;
    const notes = (notesInput?.value || "").trim() || null;

    // Insert appointment
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
      notes
    };

    const { data: inserted, error } = await supabase
      .from('appointments')
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      console.error('Insert failed:', error);
      alert('Failed to create appointment.');
      return;
    }

    calendar.addEvent({
      id: inserted.id,
      title,
      start: payload.scheduled_for,
      end: payload.ends_at,
      allDay: false,
      extendedProps: {
        location_type: locType,
        location_address: addr,
        repeat_rule: rep,
        repeat_custom: repCustom,
        url,
        notes,
        locationText: (locType === "physical") ? (addr || "") : (url || "Virtual")
      }
    });

    form.reset();
    fpStart.clear();
    fpEnd.clear();
    toggleLocationFields();
    toggleRepeatCustom();
    initFloatingLabels(document);

    alert('Appointment created!');
  });
});
