// scripts/admin-assignment-history.js
const sb = window.supabaseClient || window.supabase;

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

function showTopMsg(msg){
  let el = document.getElementById('hist-debug');
  if (!el){
    el = document.createElement('p');
    el.id = 'hist-debug';
    el.style.cssText = "padding:10px; background:#fff; border:1px solid #ccc; margin:10px 0;";
    const main = document.querySelector('main.auth-container');
    if (main) main.prepend(el);
  }
  el.textContent = msg;
}

function wireAdminNavLinks(){
  const navIds = ['nav-all','nav-requests','nav-history','nav-stats','nav-commissions','nav-content'];
  navIds.forEach(id => {
    const btn = document.getElementById(id);
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
  if (!tbody){
    showTopMsg("JS loaded ✅ but table tbody not found.");
    return;
  }

  tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Loading…</td></tr>`;

  // IMPORTANT: use your real columns here
  // If your table uses created_at instead of assigned_at, swap it below.
  const { data, error } = await sb
    .from('lead_assignments')
    .select('lead_id, assigned_at, assigned_to, assigned_by')
    .order('assigned_at', { ascending: false });

  if (error){
    console.error('Assignment history query error:', error);
    showTopMsg(`Supabase error ❌ ${error.message || 'See console'}`);
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">Error loading history.</td></tr>`;
    return;
  }

  if (!data || !data.length){
    showTopMsg("Loaded ✅ (0 rows).");
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;">No assignment history yet.</td></tr>`;
    return;
  }

  showTopMsg(`Loaded ✅ (${data.length} rows)`);
  tbody.innerHTML = '';

  data.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(formatDate(r.assigned_at))}</td>
      <td style="font-family: monospace; font-size: 12px;">${escapeHtml(r.lead_id || '—')}</td>
      <td style="font-family: monospace; font-size: 12px;">${escapeHtml(r.assigned_to || '—')}</td>
      <td style="font-family: monospace; font-size: 12px;">${escapeHtml(r.assigned_by || '—')}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  document.documentElement.style.visibility = 'visible';

  wireAdminNavLinks();

  if (!sb){
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    showTopMsg("Supabase client missing ❌ (supabase-client.js not loading?)");
    return;
  }

  showTopMsg("JS loaded ✅ (starting query...)");
  await loadAssignmentHistory();
});
