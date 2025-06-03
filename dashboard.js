// Import Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// Initialize Supabase
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'your-public-anon-key' // Replace with your actual anon key
);

// Handle tab switching
document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.querySelectorAll(".header-flex-container a[data-tab]");
  const tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach(tab => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();

      const targetId = tab.getAttribute("data-tab");

      tabContents.forEach(content => content.style.display = "none");
      tabs.forEach(t => t.classList.remove("active-tab"));

      const targetTab = document.getElementById(targetId);
      if (targetTab) {
        targetTab.style.display = "block";
        tab.classList.add("active-tab");
      }
    });
  });

  // Default to showing Profile tab
  const defaultTab = document.querySelector(".header-flex-container a[data-tab='profile-tab']");
  const profileSection = document.getElementById("profile-tab");

  if (defaultTab && profileSection) {
    defaultTab.classList.add("active-tab");
    profileSection.style.display = "block";
  }
});

// Handle lead form submission
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
    }]);

  if (error) {
    message.textContent = 'Failed to submit lead: ' + error.message;
  } else {
    message.style.color = 'green';
    message.textContent = 'Lead submitted successfully! Awaiting admin assignment.';
    e.target.reset();
  }
});
