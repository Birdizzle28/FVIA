import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient('https://ddlbgkolnayqrxslzsxn.supabase.co', 'YOUR_PUBLIC_ANON_KEY_HERE');

// Check session and user role
let currentUser = null;
let currentUserId = null;

document.addEventListener("DOMContentLoaded", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return window.location.href = "login.html";

  currentUser = session.user;
  currentUserId = currentUser.id;

  const { data: profile } = await supabase.from('profiles').select().eq('id', currentUserId).single();
  if (!profile || profile.role !== 'admin') return window.location.href = "../login.html";

  document.querySelectorAll(".admin-only").forEach(el => el.style.display = "block");

  await loadRequestedLeads();
  await loadAgentsDropdown();
  await loadLeadsWithFilters();
  await loadAssignmentHistory();

  document.getElementById("apply-filters").addEventListener("click", loadLeadsWithFilters);
  document.getElementById("reset-filters").addEventListener("click", resetFilters);
  document.getElementById("bulk-assign-btn").addEventListener("click", handleBulkAssign);
  document.getElementById("cancel-reassign-btn").addEventListener("click", () => document.getElementById("reassign-warning-modal").style.display = "none");
  document.getElementById("submit-anyway-btn").addEventListener("click", assignLeadsAnyway);
  document.getElementById("export-btn").addEventListener("click", () => document.getElementById("export-options").style.display = "block");
  document.getElementById("export-pdf").addEventListener("click", exportPDF);
  document.getElementById("export-csv").addEventListener("click", exportCSV);
  document.getElementById("export-print").addEventListener("click", () => window.print());

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    window.location.href = "../login.html";
  });
});

async function loadRequestedLeads() {
  const { data, error } = await supabase.from('lead_requests').select().order('created_at', { ascending: false });
  const container = document.getElementById('requested-leads-container');
  container.innerHTML = "";

  if (error || !data.length) {
    container.innerHTML = "<p>No requests found.</p>";
    return;
  }

  data.forEach(request => {
    const div = document.createElement("div");
    div.className = "request-entry";
    div.innerHTML = `
      <strong>${request.created_at.split("T")[0]}</strong> — ${request.request_count} ${request.request_type} leads for ${request.request_city}, ${request.request_state}
      <br>Submitted by: ${request.submitted_by_name || 'Unknown'}
      <br>Notes: ${request.notes || 'None'}
      <hr>
    `;
    container.appendChild(div);
  });
}

async function loadAgentsDropdown() {
  const { data: agents } = await supabase.from('profiles').select('id, full_name').eq('role', 'agent');
  const dropdown = document.getElementById("bulk-assign-agent");
  const filter = document.getElementById("agent-filter");
  dropdown.innerHTML = "<option value=''>Select Agent</option>";
  filter.innerHTML = "<option value=''>All Agents</option>";

  agents.forEach(agent => {
    const opt1 = document.createElement("option");
    opt1.value = agent.id;
    opt1.textContent = agent.full_name;
    dropdown.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = agent.id;
    opt2.textContent = agent.full_name;
    filter.appendChild(opt2);
  });
}

let selectedLeads = new Set();

async function loadLeadsWithFilters() {
  const tbody = document.querySelector("#leads-table tbody");
  tbody.innerHTML = "";

  let query = supabase.from('leads').select('*').order('created_at', { ascending: false });

  const assigned = document.getElementById("assigned-filter").value;
  const agentId = document.getElementById("agent-filter").value;
  const zip = document.getElementById("zip-filter").value;
  const city = document.getElementById("city-filter").value;
  const state = document.getElementById("state-filter").value;
  const first = document.getElementById("first-name-filter").value;
  const last = document.getElementById("last-name-filter").value;
  const type = document.getElementById("lead-type-filter").value;

  if (assigned === "true") query = query.eq('assigned_to', agentId || null).not('assigned_to', 'is', null);
  if (assigned === "false") query = query.is('assigned_to', null);
  if (agentId) query = query.eq('assigned_to', agentId);
  if (zip) query = query.eq('zip', zip);
  if (city) query = query.ilike('city', `%${city}%`);
  if (state) query = query.eq('state', state);
  if (first) query = query.ilike('first_name', `%${first}%`);
  if (last) query = query.ilike('last_name', `%${last}%`);
  if (type) query = query.ilike('lead_type', `%${type}%`);

  const { data: leads, error } = await query;

  if (!leads || error) return tbody.innerHTML = "<tr><td colspan='14'>No leads found.</td></tr>";

  leads.forEach(lead => {
    const row = document.createElement("tr");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.id = lead.id;
    checkbox.addEventListener("change", (e) => {
      if (e.target.checked) {
        selectedLeads.add(lead.id);
      } else {
        selectedLeads.delete(lead.id);
      }
      document.getElementById("bulk-assign-controls").style.display = selectedLeads.size ? "block" : "none";
      document.getElementById("selected-count").textContent = selectedLeads.size;
    });

    const phoneList = (lead.phone || []).join(', ');
    row.innerHTML = `
      <td></td>
      <td>${new Date(lead.created_at).toLocaleDateString()}</td>
      <td>${lead.submitted_by_name || 'N/A'}</td>
      <td>${lead.first_name}</td>
      <td>${lead.last_name}</td>
      <td>${lead.age}</td>
      <td>${phoneList}</td>
      <td>${lead.address || ''}</td>
      <td>${lead.city || ''}</td>
      <td>${lead.state || ''}</td>
      <td>${lead.zip || ''}</td>
      <td>${lead.lead_type || ''}</td>
      <td>${lead.notes || ''}</td>
      <td>N/A</td>
    `;
    row.children[0].appendChild(checkbox);
    tbody.appendChild(row);
  });
}

function resetFilters() {
  document.querySelectorAll("#admin-filters input, #admin-filters select").forEach(input => input.value = "");
  loadLeadsWithFilters();
}

function handleBulkAssign() {
  const hasAssigned = Array.from(selectedLeads).some(id => {
    const row = [...document.querySelectorAll("#leads-table tbody tr")]
      .find(r => r.querySelector("input[type='checkbox']")?.dataset.id === id);
    return row?.children[2]?.textContent?.trim() !== 'N/A';
  });

  if (hasAssigned) {
    document.getElementById("reassign-warning-modal").style.display = "flex";
  } else {
    assignLeadsAnyway();
  }
}

async function assignLeadsAnyway() {
  const agentId = document.getElementById("bulk-assign-agent").value;
  if (!agentId || !selectedLeads.size) return alert("Select leads and an agent.");

  const updates = Array.from(selectedLeads).map(id => ({
    id,
    assigned_to: agentId,
    assigned_at: new Date().toISOString()
  }));

  const { error } = await supabase.from('leads').upsert(updates, { onConflict: 'id' });
  if (error) return alert("Failed to assign leads.");

  await supabase.from('lead_assignments').insert(updates.map(u => ({
    lead_id: u.id,
    assigned_to: u.assigned_to,
    assigned_by: currentUserId
  })));

  selectedLeads.clear();
  document.getElementById("selected-count").textContent = "0";
  document.getElementById("bulk-assign-controls").style.display = "none";
  document.getElementById("reassign-warning-modal").style.display = "none";
  await loadLeadsWithFilters();
  await loadAssignmentHistory();
}

async function loadAssignmentHistory() {
  const tbody = document.querySelector("#assignment-history-table tbody");
  tbody.innerHTML = "";

  const { data, error } = await supabase
    .from("lead_assignments")
    .select("created_at, lead_id, assigned_to, assigned_by, profiles!lead_assignments_assigned_to_fkey(full_name), admin:profiles!lead_assignments_assigned_by_fkey(full_name)")
    .order("created_at", { ascending: false });

  if (error || !data?.length) {
    tbody.innerHTML = "<tr><td colspan='4'>No history found.</td></tr>";
    return;
  }

  data.forEach(entry => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${new Date(entry.created_at).toLocaleDateString()}</td>
      <td>${entry.lead_id}</td>
      <td>${entry.profiles?.full_name || "Unknown"}</td>
      <td>${entry.admin?.full_name || "Unknown"}</td>
    `;
    tbody.appendChild(row);
  });
}

function exportCSV() {
  const rows = [["Submitted", "Agent", "First", "Last", "Age", "Phone", "Address", "City", "State", "ZIP", "Type", "Notes"]];
  document.querySelectorAll("#leads-table tbody tr").forEach(tr => {
    const cells = [...tr.children].slice(1, -1).map(td => td.textContent.trim());
    rows.push(cells);
  });

  const csvContent = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const table = document.getElementById("leads-table");

  doc.setFont("helvetica", "bold");
  doc.text("Lead Export", 14, 15);
  doc.autoTable({ html: table, startY: 20, styles: { font: "helvetica", fontSize: 9 } });
  doc.save("leads.pdf");
}
