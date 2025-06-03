// ✅ Import & Initialize Supabase
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    window.location.href = '/login.html';
    return;
  }

  // ✅ TAB SWITCHING
  const navLinks = document.querySelectorAll('.header-flex-container a[data-tab]');
  const tabSections = document.querySelectorAll('.tab-content');

  navLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const tabId = link.dataset.tab;

      tabSections.forEach(section => section.style.display = 'none');
      navLinks.forEach(link => link.classList.remove('active-tab'));

      const selected = document.getElementById(tabId);
      if (selected) {
        selected.style.display = 'block';
        link.classList.add('active-tab');
      }
    });
  });

  // Show default tab
  document.getElementById('profile-tab').style.display = 'block';
  document.querySelector('[data-tab="profile-tab"]')?.classList.add('active-tab');

  // ✅ LEAD FORM SUBMISSION
  const leadForm = document.getElementById('lead-form');
  if (leadForm) {
    leadForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const message = document.getElementById('lead-message');
      message.textContent = '';
      message.style.color = 'red';

      try {
        const firstName = document.getElementById('lead-first').value.trim();
        const lastName = document.getElementById('lead-last').value.trim();
        const age = parseInt(document.getElementById('lead-age').value.trim(), 10);
        const city = document.getElementById('lead-city').value.trim();
        const zip = document.getElementById('lead-zip').value.trim();
        const phone = document.getElementById('lead-phone').value.trim();
        const leadType = document.getElementById('lead-type').value;
        const notes = document.getElementById('lead-notes').value.trim();

        if (!firstName || !lastName || !age || !leadType) {
          message.textContent = 'First, last, age, and type are required.';
          return;
        }

        const insertResult = await supabase
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
            submitted_by: user.id,
            assigned_to: user.id, // 🟢 So they immediately own it
            assigned_at: new Date().toISOString()
          }]);

        if (insertResult.error) {
          message.textContent = 'Failed to submit lead: ' + insertResult.error.message;
        } else {
          message.style.color = 'green';
          message.textContent = 'Lead submitted successfully!';
          leadForm.reset();
        }
      } catch (err) {
        message.textContent = 'An unexpected error occurred.';
        console.error('Lead submit error:', err);
      }
    });
    // ✅ REQUEST FORM HANDLING
const requestForm = document.getElementById('lead-request-form');
const requestMessage = document.getElementById('request-message');

if (requestForm) {
  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    requestMessage.textContent = '';
    requestMessage.style.color = 'red';

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      requestMessage.textContent = 'User not authenticated.';
      return;
    }

    const city = document.getElementById('request-city').value.trim();
    const zip = document.getElementById('request-zip').value.trim();
    const leadType = document.getElementById('request-type').value;
    const notes = document.getElementById('request-notes').value.trim();

    const { error } = await supabase.from('lead_requests').insert([{
      city,
      zip,
      lead_type: leadType,
      notes,
      submitted_by: user.id
    }]);

    if (error) {
      requestMessage.textContent = 'Failed to submit request: ' + error.message;
    } else {
      requestMessage.style.color = 'green';
      requestMessage.textContent = 'Request submitted successfully!';
      requestForm.reset();
    }
  });
}
  }
});
