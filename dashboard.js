
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
import emailjs from 'https://cdn.jsdelivr.net/npm/emailjs-com@3.2.0/dist/email.min.js';

emailjs.init("1F4lpn3PcqgBkk5eF");
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

  const isAdmin = user.email === 'fvinsuranceagency@gmail.com' || user.email === 'johnsondemesi@gmail.com';

  if (isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'inline');
  }

  const navLinks = document.querySelectorAll('.header-flex-container a[data-tab]');
  const tabSections = document.querySelectorAll('.tab-content');
  navLinks.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const tabId = link.dataset.tab;
      tabSections.forEach(section => section.style.display = 'none');
      navLinks.forEach(link => link.classList.remove('active-tab'));
      document.getElementById(tabId).style.display = 'block';
      link.classList.add('active-tab');
    });
  });
  document.getElementById('profile-tab').style.display = 'block';

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
      // EmailJS: Send notification
emailjs.send('service_ozjnfcd', 'template_diztcbn', {
  first_name: payload.first_name,
  last_name: payload.last_name,
  age: payload.age,
  city: payload.city,
  zip: payload.zip,
  phone: payload.phone,
  lead_type: payload.lead_type,
  notes: payload.notes
}, '1F4lpn3PcqgBkk5eF')
.then(() => {
  console.log('Email sent!');
})
.catch((err) => {
  console.error('Email failed:', err);
});
    }
  });

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

  const requestedLeadsContainer = document.createElement('div');
  requestedLeadsContainer.id = 'requested-leads-list';
  document.getElementById('lead-tab').appendChild(requestedLeadsContainer);

  const { data: unassignedLeads, error: unassignedErr } = await supabase
    .from('leads')
    .select('*')
    .is('assigned_to', null);

  if (unassignedErr || !unassignedLeads?.length) {
    requestedLeadsContainer.innerHTML = '<p>No requested leads available.</p>';
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
      requestedLeadsContainer.appendChild(card);
    });
  }
});

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
