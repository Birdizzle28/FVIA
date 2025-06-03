import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import emailjs from 'https://cdn.jsdelivr.net/npm/emailjs-com@3.2.0/dist/email.min.js';

emailjs.init('1F4lpn3PcqgBkk5eF');

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// === PAGE LOAD HANDLING ===
document.addEventListener('DOMContentLoaded', async () => {
  const body = document.body;
  const loader = document.createElement('div');
  loader.textContent = 'Loading...';
  loader.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:#fff;color:#333;display:flex;
    align-items:center;justify-content:center;z-index:9999;font-size:24px;
  `;
  body.appendChild(loader);

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    window.location.href = '/login.html';
    return;
  }

  const isAdmin = ['fvinsuranceagency@gmail.com', 'johnsondemesi@gmail.com'].includes(user.email);

  // === NAVIGATION ===
  const navLinks = document.querySelectorAll('.header-flex-container a[data-tab]');
  const tabSections = document.querySelectorAll('.tab-content');

  // Show/hide admin tabs
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? 'inline' : 'none';
  });

  navLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const tabId = link.dataset.tab;
      tabSections.forEach(section => section.style.display = 'none');
      navLinks.forEach(l => l.classList.remove('active-tab'));

      const target = document.getElementById(tabId);
      if (target) {
        target.style.display = 'block';
        link.classList.add('active-tab');
      }
    });
  });

  // Show profile tab by default
  document.getElementById('profile-tab').style.display = 'block';

  // === LEAD SUBMISSION ===
  const leadForm = document.getElementById('lead-form');
  leadForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('lead-message');
    message.textContent = '';

    const payload = {
      first_name: document.getElementById('lead-first').value.trim(),
      last_name: document.getElementById('lead-last').value.trim(),
      age: parseInt(document.getElementById('lead-age').value.trim(), 10),
      city: document.getElementById('lead-city').value.trim(),
      zip: document.getElementById('lead-zip').value.trim(),
      phone: document.getElementById('lead-phone').value.trim(),
      lead_type: document.getElementById('lead-type').value,
      notes: document.getElementById('lead-notes').value.trim(),
      submitted_by: user.id,
      assigned_to: user.id,
      assigned_at: new Date().toISOString()
    };

    const { error } = await supabase.from('leads').insert([payload]);

    if (error) {
      message.textContent = 'Failed to submit lead: ' + error.message;
      message.style.color = 'red';
    } else {
      message.textContent = 'Lead submitted successfully!';
      message.style.color = 'green';
      leadForm.reset();

      emailjs.send('service_ozjnfcd', 'template_diztcbn', payload)
        .then(() => console.log('Email sent!'))
        .catch(err => console.error('Email failed:', err));
    }
  });

  // === LEAD REQUEST FORM ===
  const requestForm = document.getElementById('lead-request-form');
  requestForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = document.getElementById('request-message');
    message.textContent = '';

    const { error } = await supabase.from('lead_requests').insert([{
      city: document.getElementById('request-city').value.trim(),
      zip: document.getElementById('request-zip').value.trim(),
      lead_type: document.getElementById('request-type').value,
      notes: document.getElementById('request-notes').value.trim(),
      submitted_by: user.id
    }]);

    if (error) {
      message.textContent = 'Failed to submit request: ' + error.message;
      message.style.color = 'red';
    } else {
      message.textContent = 'Request submitted successfully!';
      message.style.color = 'green';
      requestForm.reset();
    }
  });

  // === REQUESTED LEADS (ADMIN ONLY) ===
  if (isAdmin) {
    const container = document.getElementById('requested-leads-container');
    const { data: unassignedLeads, error: unassignedErr } = await supabase
      .from('leads')
      .select('*')
      .is('assigned_to', null);

    if (unassignedErr || !unassignedLeads?.length) {
      container.innerHTML = '<p>No requested leads available.</p>';
    } else {
      unassignedLeads.forEach(lead => {
        const card = document.createElement('div');
        card.className = 'requested-lead-card';
        card.innerHTML = `
          <p><strong>${lead.first_name} ${lead.last_name}</strong>, Age ${lead.age}</p>
          <p>Type: ${lead.lead_type}</p>
          <p>City: ${lead.city} | ZIP: ${lead.zip}</p>
          <button onclick="assignLead('${lead.id}', '${user.id}')">Assign to Me</button>
        `;
        container.appendChild(card);
      });
    }
  }

  // Remove loading screen
  loader.remove();
});

// GLOBAL FUNCTION
window.assignLead = async (leadId, agentId) => {
  const { error } = await supabase
    .from('leads')
    .update({
      assigned_to: agentId,
      assigned_at: new Date().toISOString()
    })
    .eq('id', leadId);

  if (error) {
    alert('Error assigning lead: ' + error.message);
  } else {
    alert('Lead successfully assigned!');
    location.reload();
  }
};
