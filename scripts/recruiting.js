// scripts/recruiting.js
window.supabase = supabase;

// --------- helpers ---------
const $  = (id)   => document.getElementById(id);
const $$ = (sel)  => Array.from(document.querySelectorAll(sel));

function prettyStage(stage) {
  if (!stage) return '—';
  const s = String(stage).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString();
  } catch {
    return '—';
  }
}

// BFS: all downline agent ids for a given root
function getDownlineAgentIds(rootId, agents) {
  const downline = [];
  const seen = new Set([rootId]);
  const queue = [rootId];

  while (queue.length) {
    const current = queue.shift();
    for (const a of agents) {
      if (a.recruiter_id === current && !seen.has(a.id)) {
        seen.add(a.id);
        downline.push(a.id);
        queue.push(a.id);
      }
    }
  }
  return downline;
}

function buildChildrenMap(agents) {
  const map = new Map();
  agents.forEach(a => {
    const key = a.recruiter_id || 'root';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(a);
  });
  return map;
}

// levels: array of arrays [ [directs], [grandkids], ... ]
function buildTreeLevels(rootId, agents) {
  const childrenMap = buildChildrenMap(agents);
  const levels = [];
  let current = childrenMap.get(rootId) || [];

  const used = new Set();
  while (current.length) {
    const thisLevel = current.filter(a => !used.has(a.id));
    if (!thisLevel.length) break;
    levels.push(thisLevel);
    thisLevel.forEach(a => used.add(a.id));
    current = thisLevel.flatMap(a => childrenMap.get(a.id) || []);
  }

  return levels;
}

function getAgentById(agents, id) {
  return agents.find(a => a.id === id) || null;
}

// --------- main init ---------
document.addEventListener('DOMContentLoaded', () => {
  initRecruitingPage().catch(err => {
    console.error('Recruiting page init error:', err);
  });
});

async function initRecruitingPage() {
  // 1) auth
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) {
    console.warn('No session on recruiting page; redirecting to login');
    window.location.href = 'login.html';
    return;
  }
  const userId = user.id;

  // 2) load agents (for team + recruiter names)
  const agentsRes = await supabase
    .from('agents')
    .select('id, recruiter_id, full_name, is_active, created_at, email, phone, agent_id')
    .order('created_at', { ascending: true });

  if (agentsRes.error) {
    console.error('Error loading agents:', agentsRes.error);
    return;
  }

  const agents = agentsRes.data || [];
  const me = getAgentById(agents, userId);

  // 3) downline + recruiter scope for recruits
  const downlineIds = getDownlineAgentIds(userId, agents);
  const recruiterTreeIds = [userId, ...downlineIds];

  // 4) recruits
  const recRes = await supabase
    .from('recruits')
    .select('id, first_name, last_name, stage, recruiter_id, notes, stage_updated_at, created_at')
    .in('recruiter_id', recruiterTreeIds)
    .order('stage_updated_at', { ascending: false })
    .limit(500);

  let recruits = [];
  if (!recRes.error && recRes.data) {
    recruits = recRes.data;
  } else if (recRes.error) {
    console.warn('Error loading recruits:', recRes.error);
  }

  const ctx = {
    user,
    userId,
    me,
    agents,
    downlineIds,
    recruiterTreeIds,
    recruits
  };

  // wire up UI once, using this context
  setupTabs();
  setupAddRecruitForm(ctx);

  renderAll(ctx);
}

// Re-render everything that depends on ctx.recruits, ctx.agents
function renderAll(ctx) {
  renderTopMetrics(ctx);
  renderTree(ctx);
  renderSelectedAgent(ctx, ctx.me?.id || ctx.userId);
  renderBottomPanels(ctx);
}

// --------- metrics (top 4) ---------
function renderTopMetrics(ctx) {
  const { agents, downlineIds, recruits } = ctx;

  // team size: all agents in your downline
  const teamSize = downlineIds.length;

  // active: agents in downline with is_active true
  const activeCount = agents.filter(
    a => downlineIds.includes(a.id) && a.is_active === true
  ).length;

  // pipeline: recruits that are NOT in excluded stages
  const excludedStages = new Set(['dropped', 'contracting', 'active']);
  const pipelineCount = recruits.filter(r => {
    const s = (r.stage || '').toLowerCase();
    return !excludedStages.has(s);
  }).length;

  // interviews: stage == interview within last 30 days (by stage_updated_at)
  const cutoff30 = new Date(Date.now() - 30 * 864e5);
  const interviews30 = recruits.filter(r => {
    const s = (r.stage || '').toLowerCase();
    if (s !== 'interview') return false;
    if (!r.stage_updated_at) return false;
    return new Date(r.stage_updated_at) >= cutoff30;
  }).length;

  if ($('rec-team'))       $('rec-team').textContent = String(teamSize);
  if ($('rec-active'))     $('rec-active').textContent = String(activeCount);
  if ($('rec-pipeline'))   $('rec-pipeline').textContent = String(pipelineCount);
  if ($('rec-interviews')) $('rec-interviews').textContent = String(interviews30);
}

// --------- tree rendering ---------
function renderTree(ctx) {
  const { me, agents, userId, downlineIds } = ctx;
  const treeEl = $('downline-tree');
  const rootNameEl   = $('tree-root-name');
  const rootAgentIdEl = $('tree-root-agent-id');
  const rootDirectEl = $('tree-root-direct');
  const rootTeamEl   = $('tree-root-team');
  const rootActiveEl = $('tree-root-active');

  if (!treeEl || !me) return;

  // root card text
  if (rootNameEl) rootNameEl.textContent = me.full_name || 'You';
  if (rootAgentIdEl) rootAgentIdEl.textContent = me.agent_id || '—';

  // stats
  const directs = agents.filter(a => a.recruiter_id === me.id);
  const teamCount = downlineIds.length;
  const activeInTeam = agents.filter(
    a => downlineIds.includes(a.id) && a.is_active
  ).length;

  if (rootDirectEl) rootDirectEl.textContent = String(directs.length);
  if (rootTeamEl)   rootTeamEl.textContent   = String(teamCount);
  if (rootActiveEl) rootActiveEl.textContent = String(activeInTeam);

  // tree levels
  const levels = buildTreeLevels(userId, agents);
  treeEl.innerHTML = '';

  if (!levels.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No downline agents yet. Your first recruit will appear here.';
    empty.style.color = 'var(--muted)';
    empty.style.fontSize = '0.9rem';
    treeEl.appendChild(empty);
    return;
  }

  levels.forEach((lvl) => {
    const row = document.createElement('div');
    row.className = 'tree-level';
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.marginBottom = '8px';
    row.style.justifyContent = 'center';
    row.style.flexWrap = 'wrap';

    lvl.forEach(a => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'downline-node';
      if (a.recruiter_id === userId) node.classList.add('direct');
      if (a.is_active) node.classList.add('active');
      node.dataset.agentId = a.id;

      const name = a.full_name || 'Agent';
      node.innerHTML = `
        <span class="downline-node-name">${name}</span>
        <span class="downline-node-meta">
          ${a.is_active ? 'Active' : 'Inactive'}
        </span>
      `;

      node.addEventListener('click', () => {
        renderSelectedAgent(ctx, a.id);
      });

      row.appendChild(node);
    });

    treeEl.appendChild(row);
  });
}

// --------- selected agent (right-side panel) ---------
function renderSelectedAgent(ctx, agentId) {
  const { agents, recruits } = ctx;
  const agent = getAgentById(agents, agentId) || ctx.me;
  if (!agent) return;

  const nameEl        = $('sel-agent-name');
  const idEl          = $('sel-agent-id');
  const rolePillEl    = $('sel-agent-role-pill');
  const activePillEl  = $('sel-agent-active-pill');
  const directsEl     = $('sel-direct-count');
  const teamEl        = $('sel-team-count');
  const activeCountEl = $('sel-active-count');
  const uplineEl      = $('sel-upline');
  const miniList      = $('sel-agent-activity');

  if (nameEl) nameEl.textContent = agent.full_name || 'Agent';
  if (idEl)   idEl.textContent   = agent.agent_id || '—';

  if (rolePillEl) {
    rolePillEl.textContent = agent.id === ctx.userId ? 'You' : 'Downline';
  }

  if (activePillEl) {
    const activeText = agent.is_active ? 'Status: Active' : 'Status: Inactive';
    activePillEl.textContent = activeText;
    activePillEl.classList.toggle('is-active', !!agent.is_active);
  }

  const directs = agents.filter(a => a.recruiter_id === agent.id);
  const teamIds = getDownlineAgentIds(agent.id, agents);
  const teamActive = agents.filter(
    a => teamIds.includes(a.id) && a.is_active
  ).length;
  const agentRecruits = recruits.filter(r => r.recruiter_id === agent.id);

  if (directsEl)     directsEl.textContent     = String(directs.length);
  if (teamEl)        teamEl.textContent        = String(teamIds.length);
  if (activeCountEl) activeCountEl.textContent = String(teamActive);

  // Upline
  if (uplineEl) {
    if (!agent.recruiter_id) {
      uplineEl.textContent = 'No upline recorded.';
    } else {
      const up = getAgentById(agents, agent.recruiter_id);
      uplineEl.textContent = up?.full_name || 'Unknown upline';
    }
  }

  // mini recent activity (last 5 for this agent)
  if (miniList) {
    miniList.innerHTML = '';
    if (!agentRecruits.length) {
      miniList.innerHTML = `<li>No recruiting activity for this agent yet.</li>`;
    } else {
      agentRecruits
        .slice(0, 5)
        .forEach(r => {
          const li = document.createElement('li');
          const nm = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Recruit';
          li.textContent = `${nm} • ${prettyStage(r.stage)} • ${fmtDate(r.stage_updated_at || r.created_at)}`;
          miniList.appendChild(li);
        });
    }
  }

  // Focus button: for now just scroll tree into view
  const focusBtn = $('sel-focus-btn');
  if (focusBtn) {
    focusBtn.onclick = () => {
      const tree = $('downline-tree');
      if (tree) tree.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }
}

// --------- bottom panels (tabs) ---------
function setupTabs() {
  const tabs   = $$('.rec-tab');
  const panels = $$('.rec-panel');

  function activate(key) {
    tabs.forEach(t => {
      const active = t.dataset.tab === key;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    panels.forEach(p => {
      const active = p.dataset.tabPanel === key;
      p.classList.toggle('is-active', active);
      p.hidden = !active;
    });
  }

  tabs.forEach(t => {
    t.addEventListener('click', () => {
      const key = t.dataset.tab;
      if (!key) return;
      activate(key);
    });
  });

  // header "Add Recruit" button should switch to Add tab
  const addBtn = $('add-recruit-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      activate('add');
      const addPanel = document.querySelector('[data-tab-panel="add"]');
      if (addPanel) {
        addPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  // default
  activate('pipeline');
}

function renderBottomPanels(ctx) {
  renderPipelinePanel(ctx);
  renderInterviewsPanel(ctx);
  renderActivityPanel(ctx);
}

// pipeline: recruits in scope not excluded
function renderPipelinePanel(ctx) {
  const tbody = $('pipeline-tbody');
  if (!tbody) return;

  const excludedStages = new Set(['dropped', 'contracting', 'active']);
  const recruits = ctx.recruits.filter(r => {
    const s = (r.stage || '').toLowerCase();
    return !excludedStages.has(s);
  });

  const idToName = new Map(ctx.agents.map(a => [a.id, a.full_name || '—']));

  if (!recruits.length) {
    tbody.innerHTML = `<tr><td colspan="5">No recruits in your pipeline yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = recruits.map(r => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
    const recName = idToName.get(r.recruiter_id) || '—';
    return `
      <tr>
        <td>${name}</td>
        <td>${prettyStage(r.stage)}</td>
        <td>${recName}</td>
        <td>${fmtDate(r.stage_updated_at || r.created_at)}</td>
        <td>${(r.notes || '').slice(0,80)}</td>
      </tr>
    `;
  }).join('');
}

// interviews: stage == interview, last 30d
function renderInterviewsPanel(ctx) {
  const tbody = $('interviews-tbody');
  if (!tbody) return;

  const cutoff30 = new Date(Date.now() - 30 * 864e5);
  const recruits = ctx.recruits.filter(r => {
    const s = (r.stage || '').toLowerCase();
    if (s !== 'interview') return false;
    if (!r.stage_updated_at) return false;
    return new Date(r.stage_updated_at) >= cutoff30;
  });

  const idToName = new Map(ctx.agents.map(a => [a.id, a.full_name || '—']));

  if (!recruits.length) {
    tbody.innerHTML = `<tr><td colspan="4">No interviews in the last 30 days.</td></tr>`;
    return;
  }

  tbody.innerHTML = recruits.map(r => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
    const recName = idToName.get(r.recruiter_id) || '—';
    return `
      <tr>
        <td>${name}</td>
        <td>${prettyStage(r.stage)}</td>
        <td>${recName}</td>
        <td>${fmtDate(r.stage_updated_at || r.created_at)}</td>
      </tr>
    `;
  }).join('');
}

// activity: last 6 in entire tree
function renderActivityPanel(ctx) {
  const tbody = $('rec-recent-activity');
  if (!tbody) return;

  const idToName = new Map(ctx.agents.map(a => [a.id, a.full_name || '—']));
  const recent = (ctx.recruits || []).slice(0, 6);

  if (!recent.length) {
    tbody.innerHTML = `<tr><td colspan="4">No recruiting activity yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = recent.map(r => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
    const recruiterName = idToName.get(r.recruiter_id) || '—';
    return `
      <tr>
        <td>${name}</td>
        <td>${prettyStage(r.stage)}</td>
        <td>${recruiterName}</td>
        <td>${fmtDate(r.stage_updated_at || r.created_at)}</td>
      </tr>
    `;
  }).join('');
}

// --------- add recruit form ---------
function setupAddRecruitForm(ctx) {
  const form      = $('add-recruit-form');
  const first     = $('recruit-first-name');
  const last      = $('recruit-last-name');
  const stageSel  = $('recruit-stage');
  const notesIn   = $('recruit-notes');
  const keepCB    = $('recruit-add-another');
  const msgEl     = $('recruit-form-message');
  const recruiterSel = $('recruit-recruiter');

  if (!form) return;

  // Populate recruiter dropdown: you + your downline
  if (recruiterSel) {
    recruiterSel.innerHTML = '';
    const scopeAgents = ctx.agents.filter(
      a => a.id === ctx.userId || ctx.downlineIds.includes(a.id)
    );
    scopeAgents.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.full_name || 'Agent';
      recruiterSel.appendChild(opt);
    });
    recruiterSel.value = ctx.userId;
  }

  const setMsg = (txt, ok = false) => {
    if (!msgEl) return;
    msgEl.textContent = txt || '';
    msgEl.style.color = ok ? '#2a8f6d' : '#b22424';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setMsg('');

    const fName = (first?.value || '').trim();
    const lName = (last?.value || '').trim();
    const stg   = (stageSel?.value || '').trim();
    const nts   = (notesIn?.value || '').trim();
    const recruiterId = (recruiterSel?.value || '').trim() || ctx.userId;

    if (!fName || !stg) {
      setMsg('First name and stage are required.', false);
      return;
    }

    const payload = {
      first_name: fName,
      last_name: lName || null,
      stage: stg,
      recruiter_id: recruiterId,
      notes: nts || null,
      stage_updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('recruits')
      .insert([payload])
      .select('*')
      .single();

    if (error) {
      console.error('Add recruit error:', error);
      setMsg(error.message || 'Could not save recruit.', false);
      return;
    }

    // update context + re-render
    ctx.recruits.unshift(data);
    renderAll(ctx);

    setMsg('Recruit added to your pipeline.', true);

    if (keepCB?.checked) {
      // keep stage + recruiter, clear names/notes
      if (first) first.value = '';
      if (last)  last.value  = '';
      if (notesIn) notesIn.value = '';
      first?.focus();
    } else {
      form.reset();
      // restore default recruiter = you
      if (recruiterSel) recruiterSel.value = ctx.userId;
      first?.focus();
    }
  });
}
