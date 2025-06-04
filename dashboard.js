import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

alert("Step 3: Checking session from dashboard...");

document.addEventListener("DOMContentLoaded", async () => {
  alert("Step 4: DOM loaded, checking Supabase session...");

  try {
    const sessionResult = await supabase.auth.getSession();
    alert("Step 5: Session result received!");

    const session = sessionResult.data.session;
    if (!session) {
      alert("Step 6: No session found");
      document.body.innerHTML = "<h1>Session not found. Please log in again.</h1>";
      return;
    }

    alert("Step 7: Session found! Email: " + session.user.email);

    // ✅ Step 8: Admin check
    const user = session.user;
    const isAdmin =
      user.email === 'fvinsuranceagency@gmail.com' ||
      user.email === 'johnsondemesi@gmail.com';

    alert("Step 8: Admin status: " + isAdmin);

    // ✅ Step 9: Show/hide admin-only elements
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = isAdmin ? 'inline' : 'none';
    });

    alert("Step 9: Admin-only elements updated.");

    const loadingScreen = document.getElementById('loading-screen');
if (loadingScreen) {
  loadingScreen.style.display = 'none';
  loadingScreen.style.visibility = 'hidden';
  loadingScreen.style.opacity = '0';
  loadingScreen.style.zIndex = '-1';
}
alert("Step 10: Loading screen hidden.");
    // ✅ Only call once inside your main DOMContentLoaded block
// Only preload requested leads, but keep it hidden until tab click
if (isAdmin) {
  await loadRequestedLeads();
  // Ensure it's hidden just in case
  const adminTab = document.getElementById('admin-requested-tab');
  if (adminTab) adminTab.style.display = 'none';
} 
    document.querySelectorAll('.tab-content').forEach(tab => {
  tab.style.display = 'none';
});

const defaultTab = document.getElementById('profile-tab');
if (defaultTab) {
  defaultTab.style.display = 'block';
}
  } catch (err) {
    alert("Step X: Error while checking session: " + err.message);
    document.body.innerHTML = "<h1>Error checking session. Please log in again.</h1>";
  }
});

// ✅ Step 11: Tab switching logic
document.querySelectorAll('nav a[data-tab]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();

    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.style.display = 'none';
    });

    // Remove active class from all nav links
    document.querySelectorAll('nav a').forEach(link => {
      link.classList.remove('active');
    });

    // Show the selected tab
    const tabId = link.getAttribute('data-tab');
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.style.display = 'block';
    }

    // Add active class to clicked nav link
    link.classList.add('active');
  });
});

// Optional: show the first tab by default


// ✅ Step 12: Lead form submission
const leadForm = document.getElementById('lead-form');
if (leadForm) {
  leadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
      const user = (await supabase.auth.getSession()).data.session.user;

      const leadData = {
        first_name: document.getElementById('lead-first').value.trim(),
        last_name: document.getElementById('lead-last').value.trim(),
        age: parseInt(document.getElementById('lead-age').value),
        city: document.getElementById('lead-city').value.trim(),
        zip: document.getElementById('lead-zip').value.trim(),
        phone: document.getElementById('lead-phone').value.trim(),
        lead_type: document.getElementById('lead-type').value,
        notes: document.getElementById('lead-notes').value.trim(),
        submitted_by: user.id,
        assigned_to: null,
        assigned_at: null
      };

      const { error } = await supabase.from('leads').insert(leadData);

      if (error) {
        alert("Error submitting lead: " + error.message);
      } else {
        alert("Lead submitted successfully!");
        leadForm.reset();
      }

    } catch (err) {
      alert("Unexpected error: " + err.message);
    }
  });
}
// ✅ Step 13: Lead request form submission
const leadRequestForm = document.getElementById('lead-request-form');
const requestMessage = document.getElementById('request-message');

if (leadRequestForm) {
  leadRequestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    requestMessage.textContent = "Submitting request...";

    try {
      const session = await supabase.auth.getSession();
      const user = session.data.session.user;

      const requestData = {
        city: document.getElementById('request-city').value.trim(),
        zip: document.getElementById('request-zip').value.trim(),
        lead_type: document.getElementById('request-type').value,
        notes: document.getElementById('request-notes').value.trim(),
        submitted_by: user.id
      };

      const { error } = await supabase.from('lead_requests').insert(requestData);

      if (error) {
        requestMessage.textContent = "Error: " + error.message;
        requestMessage.style.color = "red";
      } else {
        requestMessage.textContent = "Request submitted successfully!";
        requestMessage.style.color = "green";
        leadRequestForm.reset();
      }
    } catch (err) {
      requestMessage.textContent = "Unexpected error: " + err.message;
      requestMessage.style.color = "red";
    }
  });
}
// ✅ Step 14: Fetch and display requested leads (admin-only)
async function loadRequestedLeads() {
  const session = await supabase.auth.getSession();
  const user = session.data.session.user;

  const isAdmin =
    user.email === 'fvinsuranceagency@gmail.com' ||
    user.email === 'johnsondemesi@gmail.com';

  if (!isAdmin) return; // Non-admins shouldn't see this

  const container = document.getElementById('requested-leads-container');
  container.innerHTML = '<p>Loading requested leads...</p>';

  const { data, error } = await supabase
    .from('lead_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    container.innerHTML = `<p style="color:red;">Error: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = '<p>No requested leads found.</p>';
    return;
  }

  const leadCards = data.map(lead => {
    return `
      <div class="lead-request-card" style="border:1px solid #ccc; padding:10px; margin:10px 0;">
        <p><strong>City:</strong> ${lead.city || 'N/A'}</p>
        <p><strong>ZIP:</strong> ${lead.zip || 'N/A'}</p>
        <p><strong>Type:</strong> ${lead.lead_type || 'N/A'}</p>
        <p><strong>Notes:</strong> ${lead.notes || 'None'}</p>
        <button class="assign-btn" data-id="${lead.id}">Assign to Agent</button>
      </div>
    `;
  });

  container.innerHTML = leadCards.join('');
  // Attach click handlers to each assign button
container.querySelectorAll('.assign-btn').forEach(button => {
  button.addEventListener('click', async () => {
    const leadId = button.dataset.id;
    const agentId = prompt("Enter the Agent's Supabase ID to assign this lead:");

    if (!agentId) {
      alert("Assignment canceled.");
      return;
    }

    const { error } = await supabase
      .from('lead_requests')
      .update({ assigned_to: agentId, assigned_at: new Date().toISOString() })
      .eq('id', leadId);

    if (error) {
      alert("Error assigning lead: " + error.message);
    } else {
      alert("Lead successfully assigned!");
      await loadRequestedLeads(); // Refresh the list
    }
  });
});
}



/*import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
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

  let user, error;
  try {
    const result = await getUserWithTimeout();
    user = result.data.user;
    error = result.error;
  } catch (err) {
    error = err;
  }

  if (error || !user) {
    loadingScreen.textContent = 'Authentication failed or timed out.';
    return;
  }

  const isAdmin = (
    user.email === 'fvinsuranceagency@gmail.com' ||
    user.email === 'johnsondemesi@gmail.com'
  );

  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? 'inline' : 'none';
  });

  const navLinks = document.querySelectorAll('.header-flex-container a[data-tab]');
  const tabSections = document.querySelectorAll('.tab-content');

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = link.dataset.tab;

      tabSections.forEach(section => section.style.display = 'none');
      navLinks.forEach(link => link.classList.remove('active-tab'));

      const target = document.getElementById(tabId);
      if (target) {
        target.style.display = 'block';
        link.classList.add('active-tab');
      }
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

      emailjs.send('service_ozjnfcd', 'template_diztcbn', {
        first_name: payload.first_name,
        last_name: payload.last_name,
        age: payload.age,
        city: payload.city,
        zip: payload.zip,
        phone: payload.phone,
        lead_type: payload.lead_type,
        notes: payload.notes
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

setTimeout(() => {
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen?.style.display !== 'none') {
    loadingScreen.style.display = 'none';
  }
}, 7000);

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
};*/
