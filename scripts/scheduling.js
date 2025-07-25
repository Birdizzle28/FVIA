// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

document.addEventListener('DOMContentLoaded', async () => {
  const loadingScreen = document.getElementById('loading-screen');
  const { data: { session } } = await supabase.auth.getSession();
  const toggle = document.getElementById("agent-hub-toggle");
  const menu = document.getElementById("agent-hub-menu");

  // Initialize dropdown menu (Agent Hub) behavior
  menu.style.display = "none";
  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = (menu.style.display === "block") ? "none" : "block";
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      menu.style.display = "none";
    }
  });

  // If no user session, redirect to login (internal use protection)
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  const user = session.user;
  // Hide loading screen now that we're authenticated
  if (loadingScreen) loadingScreen.style.display = 'none';

  // Initialize flatpickr on the datetime input
  flatpickr("#datetime", {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    minDate: "today"  // don't allow selecting past dates for new appointments
  });

  // Reference to form and calendar container
  const form = document.getElementById('appointment-form');
  const titleInput = document.getElementById('title');
  const clientNameInput = document.getElementById('client-name');
  const clientContactInput = document.getElementById('client-contact');
  const datetimeInput = document.getElementById('datetime');

  // Fetch existing appointments from Supabase
  let events = [];
  try {
    const { data: appointments, error } = await supabase.from('appointments').select('*');
    if (error) throw error;
    events = (appointments || []).map(appt => ({
      id: appt.id,
      title: appt.title || "Appointment",
      start: appt.start_time,        // assuming timestamp string (ISO format) from DB
      end: appt.end_time || null,    // end_time could be null for, say, 1-hour default duration
      extendedProps: {
        clientName: appt.client_name,
        clientContact: appt.client_email || appt.client_phone // store contact (if any) for reference
      }
    }));
  } catch (err) {
    console.error("Error loading appointments:", err);
    alert("Failed to load appointments.");
  }

  // FullCalendar initialization
  const calendarEl = document.getElementById('calendar');
  const calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,timeGridWeek,timeGridDay,listWeek'
    },
    editable: true,       // allow drag and drop
    selectable: true,     // allow clicking/dragging to select
    selectHelper: true,
    events: events,       // load initial events
    dateClick: (info) => {
      // Autofill the form date/time when a date cell is clicked
      const clickedDate = info.date; // a JS Date object
      // If in week/day view with a specific time slot clicked, use that exact time:
      let picked = clickedDate;
      if (!info.allDay) {
        picked = clickedDate; // already includes time in info.date for time slots
      }
      // Set the flatpickr input to the selected date/time
      datetimeInput.value = FullCalendar.formatDate(picked, {
        // format to match flatpickr's format
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
        hour12: false,    // use 24h format
        delimiter: '-'    // FullCalendar's formatDate needs a delimiter if custom?
      });
      // Alternatively, we could do: flatpickrInstance.setDate(picked) if we keep a reference to flatpickr.
      datetimeInput._flatpickr?.setDate(picked);  // this sets the picker if available

      titleInput.focus();
      // Scroll to form if needed (for mobile, ensure user sees the form to input details)
      form.scrollIntoView({ behavior: 'smooth' });
    },
    eventClick: async (info) => {
      // Clicking an event prompts to delete it (for simplicity, or could open detail view/edit form)
      const event = info.event;
      const confirmDel = confirm(`Delete appointment "${event.title}"?`);
      if (confirmDel) {
        const eventId = event.id;
        // Remove from database
        const { error } = await supabase.from('appointments').delete().eq('id', eventId);
        if (error) {
          alert("Failed to delete appointment.");
          console.error(error);
        } else {
          event.remove(); // remove from calendar UI
        }
      }
    },
    eventDrop: async (info) => {
      // Event dragged to a new date or time
      const event = info.event;
      const id = event.id;
      const updates = {
        start_time: event.start.toISOString()
      };
      if (event.end) updates.end_time = event.end.toISOString();
      // Update in Supabase
      const { error } = await supabase.from('appointments').update(updates).eq('id', id);
      if (error) {
        console.error("Update failed", error);
        alert("Could not reschedule appointment (reverting change).");
        info.revert(); // undo move in the calendar UI
      } else {
        console.log("Appointment rescheduled:", event.title, event.start, "->", event.end);
        // TODO: send updated notifications (email/SMS) about rescheduled appointment
        sendEmailNotification(event, /*updated=*/true);
        sendSMSNotification(event, /*updated=*/true);
      }
    },
    eventResize: async (info) => {
      // Event duration changed by drag (handles to extend/shrink)
      const event = info.event;
      const id = event.id;
      const updates = {
        start_time: event.start.toISOString(),
        end_time: event.end ? event.end.toISOString() : null
      };
      const { error } = await supabase.from('appointments').update(updates).eq('id', id);
      if (error) {
        console.error("Update failed", error);
        alert("Could not update appointment time (reverting change).");
        info.revert();
      } else {
        console.log("Appointment duration updated:", event.title, "end time ->", event.end);
        // Optionally, send out a notification about the time change
        sendEmailNotification(event, /*updated=*/true);
        sendSMSNotification(event, /*updated=*/true);
      }
    }
  });
  calendar.render();

  // Handle new appointment form submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const clientName = clientNameInput.value.trim();
    const clientContact = clientContactInput.value.trim();
    const dateTimeStr = datetimeInput.value.trim();
    if (!title || !dateTimeStr) {
      alert("Please enter a title and date/time for the appointment.");
      return;
    }
    // Prepare appointment data
    let startTime, endTime = null;
    try {
      // If we want, parse the datetime (assuming flatpickr gives us "YYYY-MM-DD HH:MM")
      startTime = new Date(dateTimeStr);
      // Optionally, you could define a default duration, e.g., 1 hour:
      const defaultDurationMin = 60;
      endTime = new Date(startTime.getTime() + defaultDurationMin * 60000);
    } catch (err) {
      console.error("Invalid date format:", err);
      alert("Please select a valid date and time.");
      return;
    }
    // Construct object to insert
    const newAppt = {
      title: title,
      start_time: startTime.toISOString(),
      end_time: endTime ? endTime.toISOString() : null,
      client_name: clientName || null,
      // If clientContact contains an "@" assume it's an email, else assume phone
      client_email: clientContact.includes('@') ? clientContact : null,
      client_phone: clientContact && !clientContact.includes('@') ? clientContact : null,
      created_by: user.id  // assuming we want to track which agent created it
    };
    // Insert into Supabase
    const { data: insertData, error } = await supabase.from('appointments').insert(newAppt).select().single();
    if (error) {
      alert("Error creating appointment. Please try again.");
      console.error("Insert error:", error);
      return;
    }
    // Insert successful, we have the new appointment record
    const appt = insertData;
    // Add to calendar UI
    calendar.addEvent({
      id: appt.id,
      title: appt.title,
      start: appt.start_time,
      end: appt.end_time,
      extendedProps: {
        clientName: appt.client_name,
        clientContact: appt.client_email || appt.client_phone
      }
    });
    // Reset form fields
    form.reset();
    // Optionally, reset flatpickr selected date
    datetimeInput._flatpickr?.clear();
    alert("Appointment scheduled on " + new Date(appt.start_time).toLocaleString());
    // Send notifications (email/SMS) for the new appointment
    sendEmailNotification(appt, /*updated=*/false);
    sendSMSNotification(appt, /*updated=*/false);
  });

  // Placeholder: sending email notification (to client/agent)
  function sendEmailNotification(appt, updated=false) {
    // Here you would integrate with your email service (SendGrid, etc.)
    // For example, you might call a Supabase Function (via fetch) that triggers an email.
    if (!appt) return;
    const when = updated ? "updated" : "created";
    console.log(`(DEBUG) Email notification: Appointment "${appt.title}" ${when}. Client: ${appt.client_email || appt.client_name}`);
    // TODO: implement actual email API call (using fetch or third-party library)
  }

  // Placeholder: sending SMS notification
  function sendSMSNotification(appt, updated=false) {
    // Integrate with Twilio or another SMS API here.
    if (!appt) return;
    const when = updated ? "updated" : "created";
    console.log(`(DEBUG) SMS notification: Appointment "${appt.title}" ${when}. Client contact: ${appt.client_phone || appt.client_email}`);
    // TODO: implement actual SMS API call (e.g., call an Edge Function that uses Twilio)
  }
});

// Logout button handler (preserved from existing code)
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signOut();
  if (error) {
    alert('Logout failed!');
    console.error(error);
  } else {
    window.location.href = '../index.html';
  }
});
