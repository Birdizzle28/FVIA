// scripts/admin-lead-requests.js
const sb = window.supabaseClient || window.supabase;

function $(id) { return document.getElementById(id); }

function escapeHtml(v) {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(dt) {
  if (!dt) return "—";
  try { return new Date(dt).toLocaleString(); }
  catch { return String(dt); }
}

async function loadRequestedLeads() {
  const container = $("requested-leads-container");
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding:10px; color:#666;">Loading…</div>`;

  const { data, error } = await sb
    .from("lead_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.warn("loadRequestedLeads error:", error);
    container.innerHTML = `<div style="padding:12px; color:#b00020;">Error loading lead requests.</div>`;
    return;
  }

  const rows = data || [];
  if (!rows.length) {
    container.innerHTML = `<div style="text-align:center; padding:10px; color:#666;">No requests found.</div>`;
    return;
  }

  container.innerHTML = "";

  rows.forEach((r) => {
    const box = document.createElement("div");
    box.className = "lead-request-box";

    box.innerHTML = `
      <p><strong>Requested By:</strong> ${escapeHtml(r.submitted_by_name || r.requested_by_name || "—")}</p>
      <p><strong>City:</strong> ${escapeHtml(r.city || "—")}</p>
      <p><strong>ZIP:</strong> ${escapeHtml(r.zip || "—")}</p>
      <p><strong>State:</strong> ${escapeHtml(r.state || "—")}</p>
      <p><strong>Lead Type:</strong> ${escapeHtml(r.lead_type || "—")}</p>
      <p><strong>Product Type:</strong> ${escapeHtml(r.product_type || "—")}</p>
      <p><strong>Quantity:</strong> ${escapeHtml(r.requested_count ?? r.quantity ?? "—")}</p>
      <p><strong>Notes:</strong> ${escapeHtml(r.notes || "—")}</p>
      <p><strong>Submitted:</strong> ${escapeHtml(formatDate(r.created_at))}</p>
      <button type="button" data-id="${escapeHtml(r.id)}">Delete</button>
    `;

    const btn = box.querySelector("button[data-id]");
    btn?.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      if (!id) return;
      if (!confirm("Delete this lead request?")) return;

      const { error: delErr } = await sb
        .from("lead_requests")
        .delete()
        .eq("id", id);

      if (delErr) {
        console.warn("delete request error:", delErr);
        alert("Failed to delete request.");
        return;
      }

      box.remove();
      if (!container.children.length) {
        container.innerHTML = `<div style="text-align:center; padding:10px; color:#666;">No requests found.</div>`;
      }
    });

    container.appendChild(box);
  });
}

function wireAdminNav() {
  const nav = document.getElementById("admin-page-nav");
  if (!nav) return;

  const current = (location.pathname.split("/").pop() || "").toLowerCase();

  nav.querySelectorAll("button[data-href]").forEach((btn) => {
    const href = (btn.getAttribute("data-href") || "").toLowerCase();
    if (!href) return;

    if (href === current) btn.classList.add("active");
    else btn.classList.remove("active");

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      location.href = btn.getAttribute("data-href");
    });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!sb) {
    console.warn("Supabase client missing (window.supabaseClient/window.supabase).");
    return;
  }

  wireAdminNav();

  const section = $("admin-requests-section");
  if (section) section.style.display = "block";

  await loadRequestedLeads();
});
