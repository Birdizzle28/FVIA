document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error("Supabase missing");
    return;
  }

  const statusFilter = document.getElementById("review-status-filter");
  const tableBody = document.getElementById("review-table-body");

  let currentUser = null;
  let currentAgent = null;
  let rows = [];

  async function loadPermissions() {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      alert("You must be logged in.");
      window.location.href = "/login.html";
      return false;
    }

    currentUser = userRes.user;

    const { data: me, error: meErr } = await supabase
      .from("agents")
      .select("id, user_id, is_admin, is_active")
      .eq("user_id", currentUser.id)
      .maybeSingle();

    if (meErr || !me?.id) {
      alert("Your agent account could not be found.");
      return false;
    }

    currentAgent = me;

    if (!me.is_admin) {
      alert("Admins only.");
      window.location.href = "/dashboard.html";
      return false;
    }

    return true;
  }

  async function loadRows() {
    const { data, error } = await supabase
      .from("agent_page_settings")
      .select(`
        agent_id,
        status,
        home_enabled,
        about_enabled,
        careers_enabled,
        faqs_enabled,
        draft_updated_at,
        submitted_for_review_at,
        published_at,
        agents:agent_id (
          id,
          full_name,
          email,
          agent_slug
        )
      `)
      .order("draft_updated_at", { ascending: false });

    if (error) {
      console.error("[review] load failed", error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="review-empty">Failed to load review rows.</td>
        </tr>
      `;
      return;
    }

    rows = data || [];
    renderRows();
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString();
  }

  function renderPageTags(row) {
    const tags = [];
    if (row.home_enabled) tags.push("Home");
    if (row.about_enabled) tags.push("About");
    if (row.careers_enabled) tags.push("Careers");
    if (row.faqs_enabled) tags.push("FAQs");

    if (!tags.length) return `<span class="review-page-tag">None</span>`;

    return tags.map(tag => `<span class="review-page-tag">${tag}</span>`).join("");
  }

  function renderRows() {
    const filter = statusFilter.value;
    const filtered = rows.filter(row => filter === "all" ? true : row.status === filter);

    if (!filtered.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="review-empty">No matching agent page drafts found.</td>
        </tr>
      `;
      return;
    }

    tableBody.innerHTML = filtered.map(row => {
      const agent = row.agents || {};
      const fullName = agent.full_name || "Unnamed Agent";
      const email = agent.email || "";
      const slug = agent.agent_slug || "";
      const statusClass = `review-status review-status-${row.status || "draft"}`;

      return `
        <tr>
          <td>
            <strong>${escapeHtml(fullName)}</strong><br>
            <span>${escapeHtml(email)}</span><br>
            <small>${escapeHtml(slug)}</small>
          </td>

          <td>
            <span class="${statusClass}">
              ${escapeHtml(row.status || "draft")}
            </span>
          </td>

          <td>
            <div class="review-page-tags">
              ${renderPageTags(row)}
            </div>
          </td>

          <td>${escapeHtml(formatDate(row.draft_updated_at))}</td>
          <td>${escapeHtml(formatDate(row.submitted_for_review_at))}</td>
          <td>${escapeHtml(formatDate(row.published_at))}</td>

          <td>
            <div class="review-btn-row">
              <button
                type="button"
                class="review-btn review-btn-builder"
                data-action="builder"
                data-agent-id="${row.agent_id}"
                data-slug="${escapeHtml(slug)}"
              >
                Open Builder
              </button>

              <button
                type="button"
                class="review-btn review-btn-publish"
                data-action="publish"
                data-agent-id="${row.agent_id}"
              >
                Publish
              </button>

              <button
                type="button"
                class="review-btn review-btn-reject"
                data-action="reject"
                data-agent-id="${row.agent_id}"
              >
                Reject
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    bindRowActions();
  }

  function bindRowActions() {
    tableBody.querySelectorAll("[data-action]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        const agentId = btn.dataset.agentId;
        const slug = btn.dataset.slug || "";

        if (action === "builder") {
          window.location.href = `/agent-site-builder.html?agent_id=${encodeURIComponent(agentId)}&slug=${encodeURIComponent(slug)}&reviewer_id=${encodeURIComponent(currentAgent.id)}`;
          return;
        }

        if (action === "publish") {
          await publishAgent(agentId);
          return;
        }

        if (action === "reject") {
          await rejectAgent(agentId);
        }
      });
    });
  }

  async function publishAgent(agentId) {
    const ok = window.confirm("Publish this agent page draft?");
    if (!ok) return;

    const res = await fetch("/.netlify/functions/publishAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "publish",
        agent_id: agentId,
        reviewer_id: currentAgent.id
      })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[review] publish failed", json);
      alert(json.error || "Failed to publish.");
      return;
    }

    await loadRows();
    alert("Agent page published.");
  }

  async function rejectAgent(agentId) {
    const reason = window.prompt("Reason for rejection?") || "";

    const res = await fetch("/.netlify/functions/publishAgentPageDraft", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "reject",
        agent_id: agentId,
        rejection_reason: reason
      })
    });

    const json = await res.json();
    if (!res.ok || !json.ok) {
      console.error("[review] reject failed", json);
      alert(json.error || "Failed to reject.");
      return;
    }

    await loadRows();
    alert("Agent page draft rejected.");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  statusFilter.addEventListener("change", renderRows);

  const ok = await loadPermissions();
  if (!ok) return;

  await loadRows();
});
