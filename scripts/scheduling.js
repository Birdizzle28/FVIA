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
  const initialEvents = await loadAppointments();

  /* ---------------- FullCalendar ---------------- */
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    editable: true,
    selectable: true,
    events: initialEvents,

    dateClick: (info) => {
      // Prefill Starts/Ends when clicking a date
      const start = info.date;
      const end = new Date(start.getTime() + 30 * 60000); // default 30 mins
      fpStart.setDate(start, true);
      fpEnd.setDate(end, true);
      titleInput?.focus();
      form.scrollIntoView({ behavior: 'smooth' });
    },

    eventClick: async (info) => {
      const ev = info.event;
      const p = ev.extendedProps || {};

      const startText = ev.start ? new Date(ev.start).toLocaleString() : "";
      const endText = ev.end ? new Date(ev.end).toLocaleString() : "";

      const lines = [
        `Title: ${ev.title}`,
        p.location_type ? `Location: ${p.location_type === "physical" ? "Physical" : "Virtual"}` : "",
        p.location_address ? `Address: ${p.location_address}` : "",
        p.url ? `URL: ${p.url}` : "",
        startText ? `Starts: ${startText}` : "",
        endText ? `Ends: ${endText}` : "",
        p.repeat_rule ? `Repeat: ${p.repeat_rule}` : "",
        p.repeat_custom ? `Custom: ${p.repeat_custom}` : "",
        p.notes ? `Notes: ${p.notes}` : "",
        "",
        "Delete this appointment?"
      ].filter(Boolean).join("\n");

      const ok = confirm(lines);
      if (!ok) return;

      const { error } = await supabase.from('appointments').delete().eq('id', ev.id);
      if (error) { alert('Failed to delete appointment.'); console.error(error); return; }
      ev.remove();
    },

    eventDrop: async (info) => {
      const ev = info.event;
      if (!ev.start) { info.revert(); return; }

      // keep duration when dragging
      let newEndIso = null;
      if (ev.end) newEndIso = ev.end.toISOString();

      const { error } = await supabase
        .from('appointments')
        .update({
          scheduled_for: ev.start.toISOString(),
          ends_at: newEndIso
        })
        .eq('id', ev.id);

      if (error) {
        alert('Could not reschedule (reverting).');
        console.error(error);
        info.revert();
      }
    },

    eventResize: async (info) => {
      const ev = info.event;
      if (!ev.start) { info.revert(); return; }

      const { error } = await supabase
        .from('appointments')
        .update({
          scheduled_for: ev.start.toISOString(),
          ends_at: ev.end ? ev.end.toISOString() : null
        })
        .eq('id', ev.id);

      if (error) {
        alert('Could not update duration (reverting).');
        console.error(error);
        info.revert();
      }
    }
  });

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
