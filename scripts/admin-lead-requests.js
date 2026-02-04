// scripts/admin-lead-requests.js
const sb = window.supabaseClient || window.supabase;

// If your table is NOT named "lead_requests", change this constant:
const REQUESTS_TABLE = 'lead_requests';

let me = null;

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

function setMsg(text){
  const el = $('req-msg');
  if (el) el.textContent = text || '';
}

function wireAdminNavLinks(){
  const navIds = ['nav-all','nav-requests','nav-history','nav-stats','nav-commissions','nav-content','nav-dnc'];
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

async function loadMe(){
  const { data: { session } = {} } = await sb.auth.getSession();
  me = session?.user || null;
}

function getReqFilters(){
  return {
    status: $('req-status-filter')?.value || '',
    order: $('req-order')?.value || 'desc'
  };
}

/**
 * APPROVE FLOW:
 * - Fetch request
 * - Find matching UNASSIGNED leads
 * - Assign them to requested_by (agent_id)
 * - Insert assignment history rows into `assignments` (target_type='lead')
 * - Mark request fulfilled
 *
 * This expects lead_requests columns like:
 * id, created_at, status,
 * requested_by (uuid),
 * requested_by_name (text optional),
 * quantity (int),
 * state/city/zip (optional),
 * lead_type/product_type (optional),
 * notes (optional)
 *
 * If your column names differ, tell me and I’ll map them 1:1.
 */
async function approveRequest(req){
  const agentId = req.requested_by || req.agent_id || req.user_id;
  const qty = Number(req.quantity ?? req.qty ?? 0) || 0;

  if (!agentId){
    alert('This request is missing requested_by (agent id).');
    return;
  }
  if (qty <= 0){
    alert('This request has no quantity.');
    return;
  }

  setMsg('Approving…');

  // Build leads query: only unassigned and not archived
  let leadsQ = sb
    .from('leads')
    .select('id')
    .is('assigned_to', null)
    .eq('archived', false)
    .order('created_at', { ascending: true })
    .limit(qty);

  // Optional matching fields (only if present on the request)
  const reqState = req.state || req.request_state;
  const reqCity  = req.city || req.request_city;
  const reqZip   = req.zip  || req.request_zip;
  const reqLeadType = req.lead_type || req.leadType;
  const reqProduct  = req.product_type || req.productType;

  if (reqState) leadsQ = leadsQ.eq('state', reqState);
  if (reqCity)  leadsQ = leadsQ.ilike('city', `%${reqCity}%`);
  if (reqZip)   leadsQ = leadsQ.ilike('zip', `%${reqZip}%`);
  if (reqLeadType) leadsQ = leadsQ.eq('lead_type', reqLeadType);
  if (reqProduct)  leadsQ = leadsQ.eq('product_type', reqProduct);

  const { data: leadRows, error: leadErr } = await leadsQ;

  if (leadErr){
    console.warn('approveRequest lead search error:', leadErr);
    alert('Could not find matching leads for this request.');
    setMsg('');
    return;
  }

  const leadIds = (leadRows || []).map(r => r.id).filter(Boolean);

  if (!leadIds.length){
    alert('No matching unassigned leads found for this request.');
    setMsg('');
    return;
  }

  // Assign leads
  const { error: upErr } = await sb
    .from('leads')
    .update({
      assigned_to: agentId,
      assigned_at: new Date().toISOString()
    })
    .in('id', leadIds);

  if (upErr){
    console.warn('approveRequest lead update error:', upErr);
    alert('Assign failed (leads update).');
    setMsg('');
    return;
  }

  // Insert assignment history into assignments table (your new history table)
  if (me?.id){
    const reason = `Lead request ${req.id || ''}`.trim();
    const rows = leadIds.map(lead_id => ({
      target_type: 'lead',
      lead_id,
      assigned_to: agentId,
      assigned_by: me.id,
      reason
    }));

    const { error: histErr } = await sb
      .from('assignments')
      .insert(rows);

    if (histErr){
      console.warn('approveRequest assignments insert error (non-blocking):', histErr);
    }
  }

  // Mark request fulfilled/approved (best-effort: tries common status fields)
  const patch = {};
  if ('status' in req) patch.status = 'fulfilled';
  if ('fulfilled_at' in req) patch.fulfilled_at = new Date().toISOString();
  if ('fulfilled_count' in req) patch.fulfilled_count = leadIds.length;
  if (!Object.keys(patch).length) {
    // still try a status update on "status" if it exists in table even if not in row object
    patch.status = 'fulfilled';
  }

  const reqId = req.id;
  if (reqId){
    const { error: reqUpErr } = await sb
      .from(REQUESTS_TABLE)
      .update(patch)
      .eq('id', reqId);

    if (reqUpErr){
      console.warn('approveRequest request update error (non-blocking):', reqUpErr);
    }
  }

  setMsg(`Approved • Assigned ${leadIds.length} lead(s).`);
  await loadRequests();
}

async function denyRequest(req){
  if (!req?.id) return;

  setMsg('Denying…');

  const patch = { status: 'denied' };
  if ('denied_at' in req) patch.denied_at = new Date().toISOString();

  const { error } = await sb
    .from(REQUESTS_TABLE)
    .update(patch)
    .eq('id', req.id);

  if (error){
    console.warn('denyRequest error:', error);
    alert('Could not deny request.');
    setMsg('');
    return;
  }

  setMsg('Denied.');
  await loadRequests();
}

function renderRequestCard(req){
  const id = req.id || '';
  const created = formatDate(req.created_at);
  const status = (req.status || 'pending');

  const agentName =
    req.requested_by_name ||
    req.agent_name ||
    req.full_name ||
    '—';

  const qty = req.quantity ?? req.qty ?? '—';
  const state = req.state || '—';
  const city  = req.city || '—';
  const zip   = req.zip || '—';

  const leadType = req.lead_type || '—';
  const productType = req.product_type || '—';
  const notes = req.notes || '';

  const disabled = (status !== 'pending');

  const wrap = document.createElement('div');
  wrap.className = 'lead-request-box';

  wrap.innerHTML = `
    <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap;">
      <div style="font-weight:800; color: var(--indigo);">
        ${escapeHtml(agentName)} <span style="font-weight:600; color:#666;">requested</span> ${escapeHtml(qty)}
      </div>
      <div style="font-size:12px; color:#666;">
        ${escapeHtml(created)} • <strong>${escapeHtml(status)}</strong>
      </div>
    </div>

    <div style="margin-top:8px; font-size:13px; color:#333; line-height:1.4;">
      <div><strong>Product:</strong> ${escapeHtml(productType)} &nbsp; <strong>Type:</strong> ${escapeHtml(leadType)}</div>
      <div><strong>Area:</strong> ${escapeHtml(city)}, ${escapeHtml(state)} ${escapeHtml(zip)}</div>
      ${notes ? `<div style="margin-top:6px;"><strong>Notes:</strong> ${escapeHtml(notes)}</div>` : ``}
    </div>

    <div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">
      <button class="req-approve" ${disabled ? 'disabled' : ''} style="border:0; border-radius:0; padding:8px 12px; font-weight:800; cursor:pointer; background: var(--pink); color: var(--indigo);">
        Approve
      </button>
      <button class="req-deny" ${disabled ? 'disabled' : ''} style="border:1px solid #e5e6ef; border-radius:0; padding:8px 12px; font-weight:800; cursor:pointer; background:#fff; color: var(--indigo);">
        Deny
      </button>
      <small style="margin-left:auto; color:#666;">ID: ${escapeHtml(id)}</small>
    </div>
  `;

  const approveBtn = wrap.querySelector('.req-approve');
  const denyBtn = wrap.querySelector('.req-deny');

  approveBtn?.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm('Approve this request and auto-assign leads?')) return;
    await approveRequest(req);
  });

  denyBtn?.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!confirm('Deny this request?')) return;
    await denyRequest(req);
  });

  return wrap;
}

async function loadRequests(){
  const container = $('requested-leads-container');
  if (!container) return;

  container.innerHTML = `<div style="text-align:center; padding:10px; color:#666;">Loading…</div>`;
  setMsg('');

  const f = getReqFilters();

  let q = sb
    .from(REQUESTS_TABLE)
    .select('*')
    .order('created_at', { ascending: f.order === 'asc' });

  if (f.status) q = q.eq('status', f.status);

  const { data, error } = await q;

  if (error){
    console.warn('loadRequests error:', error);
    container.innerHTML = `
      <div style="padding:12px; color:#b00020;">
        Could not load requests. Check the console.
        <div style="margin-top:6px; font-size:12px; color:#666;">
          If your table is not named <strong>${REQUESTS_TABLE}</strong>, update REQUESTS_TABLE in scripts/admin-lead-requests.js
        </div>
      </div>
    `;
    return;
  }

  const rows = data || [];
  if (!rows.length){
    container.innerHTML = `<div style="text-align:center; padding:10px; color:#666;">No requests found.</div>`;
    return;
  }

  container.innerHTML = '';
  rows.forEach(req => container.appendChild(renderRequestCard(req)));
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!sb){
    console.warn('Supabase client missing (window.supabaseClient/window.supabase).');
    return;
  }

  wireAdminNavLinks();

  // Show only this section
  const section = $('admin-requests-section');
  if (section) section.style.display = 'block';

  await loadMe();

  $('refresh-requests')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await loadRequests();
  });

  $('req-status-filter')?.addEventListener('change', loadRequests);
  $('req-order')?.addEventListener('change', loadRequests);

  await loadRequests();
});
