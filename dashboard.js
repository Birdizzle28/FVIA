document.addEventListener("DOMContentLoaded", () => {
  // Nav tab click handler
  const tabs = document.querySelectorAll(".header-flex-container a[data-tab]");
  const tabContents = document.querySelectorAll(".tab-content");

  tabs.forEach(tab => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();

      const targetId = tab.getAttribute("href").substring(1);

      // Hide all tab contents
      tabContents.forEach(content => {
        content.style.display = "none";
      });

      // Remove active class from all tabs
      tabs.forEach(t => t.classList.remove("active-tab"));

      // Show selected tab
      document.getElementById(targetId).style.display = "block";
      tab.classList.add("active-tab");
    });
  });

  // Default: Show Profile tab
  if (document.getElementById("profile-tab")) {
    document.getElementById("profile-tab").style.display = "block";
    document.querySelector(".header-flex-container a[data-tab='profile-tab']").classList.add("active-tab");
  }
});
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'your-public-anon-key')

// Lead form submission
document.getElementById('lead-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  
  const firstName = document.getElementById('lead-first').value.trim()
  const lastName = document.getElementById('lead-last').value.trim()
  const age = parseInt(document.getElementById('lead-age').value.trim(), 10)
  const city = document.getElementById('lead-city').value.trim()
  const zip = document.getElementById('lead-zip').value.trim()
  const phone = document.getElementById('lead-phone').value.trim()
  const leadType = document.getElementById('lead-type').value
  const notes = document.getElementById('lead-notes').value.trim()
  const message = document.getElementById('lead-message')

  message.textContent = ''
  message.style.color = 'red'

  if (!firstName || !lastName || !age || !leadType) {
    message.textContent = 'First, last, age, and type are required.'
    return
  }

  const { data, error } = await supabase
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
    }])

  if (error) {
    message.textContent = 'Failed to submit lead: ' + error.message
  } else {
    message.style.color = 'green'
    message.textContent = 'Lead submitted successfully! Awaiting admin assignment.'
    e.target.reset()
  }
})
