// scripts/admin-assignment-history.js
const sb = window.supabaseClient || window.supabase;

function $(id){ return document.getElementById(id); }

function escapeHtml(v){
  if (v == null) return '';
  return String(v)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function formatDate(dt){
  if (!dt) return '—';
  try { return new Date(dt).toLocaleString(); }
  catch { return String(dt); }
}

function wireAdminNavLinks(){
  const navIds = ['nav-all','nav-requests','nav-history','nav-stats','nav-commissions','nav-content'];
  navIds.forEach(id => {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const href = btn.getAttribute('data-href');
      if (href) location.href = href;
    });
  });
}

async function loadAssignmentHistory(){
  const tbody = document.querySelector('#assignment-history-table tbody');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Loading…</td></tr>`;

  const { data: history, error } = await sb
    .from('lead_assignments')
    .select(`lead_id, assigned_at, assigned_to_agent:assigned_to(full_name), assigned_by_agent:assigned_by(full_name)`)
    .order('assigned_at', { ascending: false });

  if (error) {
    console.error('Error loading history:', error);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Error loading history.</td></tr>`;
    return;
  }

  if (!history?.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No assignment history yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = '';

  history.forEach(entry => {
    const assignedToName = entry.assigned_to_agent?.full_name || '—';
    const assignedByName = entry.assigned_by_agent?.full_name || '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(formatDate(entry.assigned_at))}</td>
      <td style="font-family: monospace; font-size: 12px;">${escapeHtml(entry.lead_id || '—')}</td>
      <td>${escapeHtml(assignedToName)}</td>
      <td>${escapeHtml(assignedByName)}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.style.visibility = 'visible';
  if (!sb){
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  wireAdminNavLinks();
  await loadAssignmentHistory();
});
