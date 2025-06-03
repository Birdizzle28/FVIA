alert("dashboard.js is loading!");
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import emailjs from 'https://cdn.jsdelivr.net/npm/emailjs-com@3.2.0/dist/email.min.js';

emailjs.init("1F4lpn3PcqgBkk5eF");

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

const getUserWithTimeout = (timeout = 5000) => {
  return Promise.race([
    supabase.auth.getUser(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Supabase auth timed out')), timeout)
    ),
  ]);
};

document.addEventListener('DOMContentLoaded', async () => {
  const loadingScreen = document.getElementById('loading-screen');
  const debugMsg = document.getElementById('debug-msg');
  if (debugMsg) debugMsg.textContent = "dashboard.js is running...";

  let user = null, error = null;

  try {
    const result = await getUserWithTimeout();
    user = result.data.user;
    error = result.error;
  } catch (err) {
    error = err;
  }

  if (!user || error) {
    if (loadingScreen) loadingScreen.textContent = 'Authentication failed or timed out.';
    return;
  }

  const isAdmin = ['fvinsuranceagency@gmail.com', 'johnsondemesi@gmail.com'].includes(user.email);

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? 'inline' : 'none';
  });

  document.querySelectorAll('.header-flex-container a[data-tab]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const tabId = link.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(tab => tab.style.display = 'none');
      document.querySelectorAll('.header-flex-container a[data-tab]').forEach(l => l.classList.remove('active-tab'));
      const target = document.getElementById(tabId);
      if (target) {
        target.style.display = 'block';
        link.classList.add('active-tab');
      }
    });
  });

  document.getElementById('profile-tab').style.display = 'block';

  const leadForm = document.getElementById('lead-form');
  leadForm?.addEventListener('submit', async e => {
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
      emailjs.send('service_ozjnfcd', 'template_diztcbn', payload);
    }
  });

  const requestForm = document.getElementById('lead-request-form');
  requestForm?.addEventListener('submit', async e => {
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

  if (isAdmin) {
    const container = document.getElementById('requested-leads-container');
    const { data: leads, error: loadErr } = await supabase
      .from('leads')
      .select('*')
      .is('assigned_to', null);

    if (loadErr || !leads?.length) {
      container.innerHTML = '<p>No requested leads available.</p>';
    } else {
      leads.forEach(lead => {
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

  if (loadingScreen) loadingScreen.style.display = 'none';
});

// Hide the loading screen after 7 seconds max (fallback)
setTimeout(() => {
  const screen = document.getElementById('loading-screen');
  if (screen && screen.style.display !== 'none') {
    screen.style.display = 'none';
  }
}, 7000);

// Assign lead to agent
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
