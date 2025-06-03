// Supabase init
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho' // replace this with your actual anon key
);

// TAB SWITCHING
document.addEventListener("DOMContentLoaded", () => {
  const navLinks = document.querySelectorAll('.header-flex-container a[data-tab]');
  const tabSections = document.querySelectorAll('.tab-content');

  navLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();

      // Hide all tabs
      tabSections.forEach(section => section.style.display = 'none');

      // Remove active classes
      navLinks.forEach(link => link.classList.remove('active-tab'));

      // Show selected tab
      const tabId = link.dataset.tab;
      const targetTab = document.getElementById(tabId);
      if (targetTab) {
        targetTab.style.display = 'block';
        link.classList.add('active-tab');
      }
    });
  });

  // Show default tab (profile)
  const defaultTab = document.getElementById('profile-tab');
  if (defaultTab) defaultTab.style.display = 'block';
});


// LEAD FORM
document.getElementById('lead-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const firstName = document.getElementById('lead-first').value.trim();
  const lastName = document.getElementById('lead-last').value.trim();
  const age = parseInt(document.getElementById('lead-age').value.trim(), 10);
  const city = document.getElementById('lead-city').value.trim();
  const zip = document.getElementById('lead-zip').value.trim();
  const phone = document.getElementById('lead-phone').value.trim();
  const leadType = document.getElementById('lead-type').value;
  const notes = document.getElementById('lead-notes').value.trim();
  const message = document.getElementById('lead-message');

  message.textContent = '';
  message.style.color = 'red';

  if (!firstName || !lastName || !age || !leadType) {
    message.textContent = 'First, last, age, and type are required.';
    return;
  }

  // ✅ Get current user ID for RLS enforcement
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    message.textContent = 'User not authenticated.';
    return;
  }

  const { error } = await supabase
    .from('leads')
    .insert([{
      first_name: firstName,
      last_name: lastName,
      age,
      city,
      zip,
      phone,
      lead_type: leadType,
      notes,
      submitted_by: user.id // ✅ Include for RLS policy!
    }]);

  if (error) {
    message.textContent = 'Failed to submit lead: ' + error.message;
  } else {
    message.style.color = 'green';
    message.textContent = 'Lead submitted successfully! Awaiting admin assignment.';
    e.target.reset();
  }
});
