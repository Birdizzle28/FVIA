// scripts/scheduling.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ---- Supabase (same project keys you’re using elsewhere) ----
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

document.addEventListener('DOMContentLoaded', async () => {
  /* ---------------- Auth gate + header dropdown ---------------- */
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const user = session.user;

  // Agent Hub dropdown (kept consistent with other pages)
  const toggle = document.getElementById('agent-hub-toggle');
  const menu   = document.getElementById('agent-hub-menu');
  if (menu) menu.style.display = 'none';
  toggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu) return;
    menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown') && menu) menu.style.display = 'none';
  });

  /* ---------------- Flatpickr ---------------- */
  const dtInput = document.getElementById('datetime');
  const fp = flatpickr('#datetime', {
    enableTime: true,
    dateFormat: 'Y-m-d H:i',
    minDate: 'today'
  });

  /* ---------------- Helpers ---------------- */
  const toE164 = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    if (s.startsWith('+')) return s.replace(/[^\d+]/g, '');
    const d = s.replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 10) return `+1${d}`;
    if (d.length === 11 && d.startsWith('1')) return `+${d}`;
    return `+${d}`;
  };
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');

  function splitName(full) {
    const t = (full || '').trim();
    if (!t) return { first: null, last: null };
    const parts = t.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: null };
    return { first: parts.slice(0, -1).join(' '), last: parts.slice(-1)[0] };
  }

  async function findOrCreateContact({ fullName, contactValue }) {
    const { first, last } = splitName(fullName);
    const email = isEmail(contactValue) ? contactValue.trim() : null;
    const phoneE164 = !email ? toE164(contactValue) : null;
    const phone10   = phoneE164 ? phoneE164.replace(/\D/g, '').slice(-10) : null;

    // 1) Try by exact email in contacts.emails[]
    if (email) {
      const r = await supabase
        .from('contacts')
        .select('id, emails, phones, first_name, last_name')
        .contains('emails', [email])
        .maybeSingle();
      if (r.data) return r.data.id;
    }
    // 2) Try by E.164 in contacts.phones[]
    if (phoneE164) {
      const r = await supabase
        .from('contacts')
        .select('id, phones')
        .contains('phones', [phoneE164])
        .maybeSingle();
      if (r.data) return r.data.id;
    }
    // 3) Try by 10-digit in contacts.phones[]
    if (phone10) {
      const r = await supabase
        .from('contacts')
        .select('id, phones')
        .contains('phones', [phone10])
        .maybeSingle();
      if (r.data) return r.data.id;
    }

    // 4) Create new contact (store both E.164 and 10-digit if available)
    const phonesArr = [];
    if (phoneE164) phonesArr.push(phoneE164);
    if (phone10 && phone10 !== phoneE164?.replace(/\D/g, '').slice(-10)) phonesArr.push(phone10);
    const emailsArr = email ? [email] : [];

    const { data: inserted, error } = await supabase.from('contacts').insert({
      first_name: first,
      last_name:  last,
      // full_name is a generated column — will populate automatically
      phones: phonesArr,
      emails: emailsArr,
      owning_agent_id: user.id
    }).select('id').single();

    if (error) throw error;
    return inserted.id;
  }

  /* ---------------- Load appointments -> FullCalendar events ---------------- */
  async function loadAppointments() {
    // Join contact for name display
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        id,
        scheduled_for,
        lead_id,
        contact_id,
        contacts:contact_id ( first_name, last_name, full_name )
      `)
      .order('scheduled_for', { ascending: true });

    if (error) {
      console.error('Failed to load appointments:', error);
      alert('Failed to load appointments.');
      return [];
    }

    return (data || []).map(row => {
      const name = row.contacts?.full_name
                || [row.contacts?.first_name, row.contacts?.last_name].filter(Boolean).join(' ')
                || 'Appointment';
      return {
        id: row.id,
        title: name,                     // we use contact name as the title
        start: row.scheduled_for,        // ISO
        allDay: false,
        extendedProps: {
          contact_id: row.contact_id,
          lead_id: row.lead_id || null
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
    editable: true,        // allow drag to reschedule
    selectable: true,      // click day to prefill
    events: initialEvents,

    dateClick: (info) => {
      // Prefill the picker with clicked date/time
      const clicked = info.date;
      fp?.setDate(clicked, true);
      document.getElementById('title')?.focus();
      document.getElementById('appointment-form')?.scrollIntoView({ behavior: 'smooth' });
    },

    eventClick: async (info) => {
      const ok = confirm(`Delete appointment for "${info.event.title}"?`);
      if (!ok) return;
      const { error } = await supabase.from('appointments').delete().eq('id', info.event.id);
      if (error) { alert('Failed to delete appointment.'); console.error(error); return; }
      info.event.remove();
    },

    eventDrop: async (info) => {
      // Only scheduled_for supported — we’ll ignore event.end
      const when = info.event.start?.toISOString();
      if (!when) { info.revert(); return; }
      const { error } = await supabase.from('appointments').update({
        scheduled_for: when
      }).eq('id', info.event.id);
      if (error) {
        alert('Could not reschedule (reverting).');
        console.error(error);
        info.revert();
      }
    },

    eventResize: (info) => {
      // We don’t store end/duration in schema — prevent resize
      alert('Duration editing is not enabled for appointments.');
      info.revert();
    }
  });

  calendar.render();

  /* ---------------- Create appointment (form submit) ---------------- */
  const form = document.getElementById('appointment-form');
  const titleInput = document.getElementById('title'); // purely cosmetic right now
  const nameInput  = document.getElementById('client-name');
  const contactInput = document.getElementById('client-contact');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Validate datetime
    const dtVal = dtInput.value?.trim();
    if (!dtVal) { alert('Please select a date and time.'); return; }
    // Flatpickr’s parse
    const selected = fp?.selectedDates?.[0] || new Date(dtVal);
    if (!selected || Number.isNaN(+selected)) { alert('Invalid date/time.'); return; }
    const whenIso = selected.toISOString();

    // Build / find contact
    const fullName = (nameInput.value || '').trim();
    const contactValue = (contactInput.value || '').trim();
    let contactId = null;
    try {
      if (fullName || contactValue) {
        contactId = await findOrCreateContact({ fullName, contactValue });
      }
    } catch (err) {
      console.error('Contact create failed:', err);
      alert('Could not save/find the contact.');
      return;
    }

    // Insert appointment
    const { data: inserted, error } = await supabase
      .from('appointments')
      .insert({
        contact_id: contactId,          // may be null if no info was provided
        agent_id: user.id,
        lead_id: null,                  // tie to a lead later if you want
        scheduled_for: whenIso
      })
      .select('id')
      .single();

    if (error) {
      console.error('Insert failed:', error);
      alert('Failed to create appointment.');
      return;
    }

    // Add to calendar UI — we display the contact name (or the free-typed title if no name)
    const displayTitle =
      (fullName && fullName.trim()) || titleInput.value.trim() || 'Appointment';

    calendar.addEvent({
      id: inserted.id,
      title: displayTitle,
      start: whenIso,
      allDay: false,
      extendedProps: { contact_id: contactId }
    });

    // Reset form
    form.reset();
    fp?.clear();
    alert('Appointment created!');
  });
});
