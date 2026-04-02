// agents.js

const supabase = window.supabaseClient;

/* ---------------- TAB SWITCHING ---------------- */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

/* ---------------- HELPERS ---------------- */
const getMultiSelectValues = (el) =>
  Array.from(el.selectedOptions).map(o => o.value);

const setMultiSelectValues = (el, values = []) => {
  Array.from(el.options).forEach(opt => {
    opt.selected = values.includes(opt.value);
  });
};

/* =========================================================
   AGENTS
========================================================= */

const agentsTbody = document.getElementById("agents-tbody");

async function loadAgents() {
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    agentsTbody.innerHTML = `<tr><td colspan="12">Error loading agents</td></tr>`;
    console.error(error);
    return;
  }

  if (!data.length) {
    agentsTbody.innerHTML = `<tr><td colspan="12" class="empty-row">No agents found</td></tr>`;
    return;
  }

  agentsTbody.innerHTML = data.map(a => `
    <tr>
      <td>${a.full_name || ""}</td>
      <td>${a.email || ""}</td>
      <td>${a.agent_id || ""}</td>
      <td>${a.level || ""}</td>
      <td>${a.recruiter_id || ""}</td>
      <td>${a.phone || ""}</td>
      <td><span class="badge ${a.is_active ? "yes" : "no"}">${a.is_active ? "Yes" : "No"}</span></td>
      <td><span class="badge ${a.is_admin ? "yes" : "no"}">${a.is_admin ? "Yes" : "No"}</span></td>
      <td><span class="badge ${a.is_available ? "yes" : "no"}">${a.is_available ? "Yes" : "No"}</span></td>
      <td><span class="badge ${a.receiving_leads ? "yes" : "no"}">${a.receiving_leads ? "Yes" : "No"}</span></td>
      <td>${(a.product_types || []).join(", ")}</td>
      <td class="table-actions">
        <button class="row-btn" onclick="editAgent('${a.id}')">Edit</button>
        <button class="row-btn danger" onclick="deleteAgent('${a.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

async function populateRecruiterDropdowns() {
  const { data } = await supabase.from("agents").select("id, full_name");

  const recruiterSelects = [
    document.getElementById("agent-recruiter-id"),
    document.getElementById("recruit-recruiter-id")
  ];

  recruiterSelects.forEach(select => {
    select.innerHTML = `<option value="">Select recruiter</option>` +
      data.map(a => `<option value="${a.id}">${a.full_name}</option>`).join("");
  });
}

/* -------- CREATE / UPDATE -------- */
document.getElementById("agents-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = document.getElementById("editing-agent-id").value;

  const payload = {
    email: document.getElementById("agent-email").value,
    agent_id: document.getElementById("agent-agent-id").value,
    first_name: document.getElementById("agent-first-name").value,
    last_name: document.getElementById("agent-last-name").value,
    full_name: document.getElementById("agent-full-name").value,
    phone: document.getElementById("agent-phone").value,
    level: document.getElementById("agent-level").value || null,
    recruiter_id: document.getElementById("agent-recruiter-id").value || null,
    agent_slug: document.getElementById("agent-agent-slug").value || null,
    is_active: document.getElementById("agent-is-active").checked,
    is_admin: document.getElementById("agent-is-admin").checked,
    is_available: document.getElementById("agent-is-available").checked,
    receiving_leads: document.getElementById("agent-receiving-leads").checked,
    show_on_about: document.getElementById("agent-show-on-about").checked,
    agent_page_enabled: document.getElementById("agent-page-enabled").checked,
    companies: getMultiSelectValues(document.getElementById("agent-companies")),
    product_types: getMultiSelectValues(document.getElementById("agent-product-types")),
    timezone: document.getElementById("agent-timezone").value || null,
    profile_picture_url: document.getElementById("agent-profile-picture-url").value || null,
    bio: document.getElementById("agent-bio").value || null
  };

  let res;
  if (id) {
    res = await supabase.from("agents").update(payload).eq("id", id);
  } else {
    res = await supabase.from("agents").insert(payload);
  }

  if (res.error) {
    alert("Error saving agent");
    console.error(res.error);
    return;
  }

  resetAgentForm();
  loadAgents();
});

/* -------- EDIT -------- */
window.editAgent = async (id) => {
  const { data } = await supabase.from("agents").select("*").eq("id", id).single();

  document.getElementById("editing-agent-id").value = data.id;
  document.getElementById("agent-email").value = data.email || "";
  document.getElementById("agent-agent-id").value = data.agent_id || "";
  document.getElementById("agent-first-name").value = data.first_name || "";
  document.getElementById("agent-last-name").value = data.last_name || "";
  document.getElementById("agent-full-name").value = data.full_name || "";
  document.getElementById("agent-phone").value = data.phone || "";
  document.getElementById("agent-level").value = data.level || "";
  document.getElementById("agent-recruiter-id").value = data.recruiter_id || "";
  document.getElementById("agent-agent-slug").value = data.agent_slug || "";

  document.getElementById("agent-is-active").checked = data.is_active;
  document.getElementById("agent-is-admin").checked = data.is_admin;
  document.getElementById("agent-is-available").checked = data.is_available;
  document.getElementById("agent-receiving-leads").checked = data.receiving_leads;
  document.getElementById("agent-show-on-about").checked = data.show_on_about;
  document.getElementById("agent-page-enabled").checked = data.agent_page_enabled;

  setMultiSelectValues(document.getElementById("agent-companies"), data.companies || []);
  setMultiSelectValues(document.getElementById("agent-product-types"), data.product_types || []);

  document.getElementById("agent-timezone").value = data.timezone || "";
  document.getElementById("agent-profile-picture-url").value = data.profile_picture_url || "";
  document.getElementById("agent-bio").value = data.bio || "";

  document.getElementById("cancel-agent-edit-btn").classList.remove("hidden");
};

/* -------- DELETE -------- */
window.deleteAgent = async (id) => {
  if (!confirm("Delete this agent?")) return;

  await supabase.from("agents").delete().eq("id", id);
  loadAgents();
};

/* -------- RESET -------- */
function resetAgentForm() {
  document.getElementById("agents-form").reset();
  document.getElementById("editing-agent-id").value = "";
  document.getElementById("cancel-agent-edit-btn").classList.add("hidden");
}

document.getElementById("reset-agent-form-btn").onclick = resetAgentForm;
document.getElementById("cancel-agent-edit-btn").onclick = resetAgentForm;

/* =========================================================
   RECRUITS
========================================================= */

const recruitsTbody = document.getElementById("recruits-tbody");

async function loadRecruits() {
  const { data, error } = await supabase
    .from("recruits")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    recruitsTbody.innerHTML = `<tr><td colspan="8">Error loading recruits</td></tr>`;
    return;
  }

  if (!data.length) {
    recruitsTbody.innerHTML = `<tr><td colspan="8" class="empty-row">No recruits found</td></tr>`;
    return;
  }

  recruitsTbody.innerHTML = data.map(r => `
    <tr>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
      <td>${new Date(r.stage_updated_at).toLocaleDateString()}</td>
      <td>${r.first_name || ""}</td>
      <td>${r.last_name || ""}</td>
      <td>${r.stage}</td>
      <td>${r.recruiter_id}</td>
      <td class="notes-cell">${r.notes || ""}</td>
      <td class="table-actions">
        <button class="row-btn" onclick="editRecruit('${r.id}')">Edit</button>
        <button class="row-btn danger" onclick="deleteRecruit('${r.id}')">Delete</button>
      </td>
    </tr>
  `).join("");
}

/* -------- CREATE / UPDATE -------- */
document.getElementById("recruits-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = document.getElementById("editing-recruit-id").value;

  const payload = {
    first_name: document.getElementById("recruit-first-name").value,
    last_name: document.getElementById("recruit-last-name").value,
    stage: document.getElementById("recruit-stage").value,
    recruiter_id: document.getElementById("recruit-recruiter-id").value,
    notes: document.getElementById("recruit-notes").value,
    stage_updated_at: new Date().toISOString()
  };

  let res;
  if (id) {
    res = await supabase.from("recruits").update(payload).eq("id", id);
  } else {
    res = await supabase.from("recruits").insert(payload);
  }

  if (res.error) {
    alert("Error saving recruit");
    console.error(res.error);
    return;
  }

  resetRecruitForm();
  loadRecruits();
});

/* -------- EDIT -------- */
window.editRecruit = async (id) => {
  const { data } = await supabase.from("recruits").select("*").eq("id", id).single();

  document.getElementById("editing-recruit-id").value = data.id;
  document.getElementById("recruit-first-name").value = data.first_name || "";
  document.getElementById("recruit-last-name").value = data.last_name || "";
  document.getElementById("recruit-stage").value = data.stage;
  document.getElementById("recruit-recruiter-id").value = data.recruiter_id;
  document.getElementById("recruit-notes").value = data.notes || "";

  document.getElementById("cancel-recruit-edit-btn").classList.remove("hidden");
};

/* -------- DELETE -------- */
window.deleteRecruit = async (id) => {
  if (!confirm("Delete this recruit?")) return;

  await supabase.from("recruits").delete().eq("id", id);
  loadRecruits();
};

/* -------- RESET -------- */
function resetRecruitForm() {
  document.getElementById("recruits-form").reset();
  document.getElementById("editing-recruit-id").value = "";
  document.getElementById("cancel-recruit-edit-btn").classList.add("hidden");
}

document.getElementById("reset-recruit-form-btn").onclick = resetRecruitForm;
document.getElementById("cancel-recruit-edit-btn").onclick = resetRecruitForm;

/* ---------------- INIT ---------------- */
(async () => {
  await populateRecruiterDropdowns();
  await loadAgents();
  await loadRecruits();
})();
