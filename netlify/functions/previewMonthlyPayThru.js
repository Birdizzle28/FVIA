// netlify/functions/previewMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[previewMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/* ---------------------------
   AUTH HELPERS
   --------------------------- */

const ELIGIBLE_POLICY_STATUSES = ['issued', 'in_force', 'renewed', 'reinstated'];

function getBearerToken(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || '';
  const m = String(raw).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

/* ---------------------------
   MATCH runMonthlyPayThru
   --------------------------- */

function monthIndexUTC(d) {
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function getPayDate(event) {
  const qs = event.queryStringParameters || {};
  if (qs.pay_date) {
    const d = new Date(qs.pay_date);
    if (!isNaN(d.getTime())) return d;
  }

  const today = new Date();
  const thisMonth5 = new Date(today.getFullYear(), today.getMonth(), 5);

  if (today > thisMonth5) {
    return new Date(today.getFullYear(), today.getMonth() + 1, 5);
  }
  return thisMonth5;
}

function getMonthBounds(payDate) {
  const year  = payDate.getFullYear();
  const month = payDate.getMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end   = new Date(Date.UTC(year, month + 1, 1));
  return { start, end };
}

function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) return 1.0;
  if (totalDebt <= 0) return 0;
  if (totalDebt < 1000) return 0.30;
  if (totalDebt < 2000) return 0.40;
  return 0.50;
}

/* ---------------------------
   EXCLUSIVE MONTH HELPERS
   --------------------------- */

function normalizeExclusiveMonths(value) {
  if (value == null) return null;

  let arr = value;

  if (typeof arr === 'string') {
    try {
      arr = JSON.parse(arr);
    } catch {
      arr = String(arr)
        .replace(/[{}]/g, '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
    }
  }

  if (!Array.isArray(arr)) return null;

  const nums = Array.from(
    new Set(
      arr
        .map(v => Number(v))
        .filter(v => Number.isInteger(v) && v >= 1 && v <= 12)
    )
  ).sort((a, b) => a - b);

  return nums.length ? nums : null;
}

function isPayMonthAllowed(exclusiveMonths, payDate) {
  const months = normalizeExclusiveMonths(exclusiveMonths);
  if (!months || !months.length) return true;

  const payMonthNumber = payDate.getMonth() + 1;
  return months.includes(payMonthNumber);
}

/* ---------------------------
   TIME / TERM HELPERS
   --------------------------- */

function getPolicyYear(policyIssuedAt, asOfDate) {
  const start = new Date(policyIssuedAt);
  if (isNaN(start.getTime())) return null;

  let years = asOfDate.getFullYear() - start.getFullYear();
  const annivThisYear = new Date(
    asOfDate.getFullYear(),
    start.getMonth(),
    start.getDate()
  );

  if (asOfDate < annivThisYear) {
    years -= 1;
  }

  const policyYear = years + 1;
  return policyYear < 1 ? 1 : policyYear;
}

function getTermNumberByMonths(policyIssuedAt, payMonthStartUTC, termLengthMonths) {
  const issuedAt = new Date(policyIssuedAt);
  if (isNaN(issuedAt.getTime())) return null;

  const issuedMonth = monthIndexUTC(issuedAt);
  const payMonth    = monthIndexUTC(payMonthStartUTC);

  const monthsElapsed = payMonth - issuedMonth;
  if (monthsElapsed < 0) return 1;

  const termLen = Number(termLengthMonths || 0);
  if (termLen <= 0) return 1;

  return Math.floor(monthsElapsed / termLen) + 1;
}

/* ---------------------------
   RENEWAL/TRAIL RATE HELPERS
   --------------------------- */

function getBaseRenewalRate(schedule, renewalIndex) {
  if (!renewalIndex || renewalIndex < 1) return 0;

  let rule = schedule.renewal_trail_rule;
  if (rule && typeof rule === 'string') {
    try { rule = JSON.parse(rule); } catch { rule = null; }
  }

  if (rule && Array.isArray(rule.bands)) {
    for (const band of rule.bands) {
      const start = band.start_year ?? (schedule.renewal_start_year ?? 2);
      const end   = band.end_year;
      const withinLower = renewalIndex >= start;
      const withinUpper = end == null ? true : renewalIndex <= end;
      if (withinLower && withinUpper) return Number(band.rate || 0);
    }
    return 0;
  }

  const flatRate = Number(schedule.renewal_commission_rate || 0);
  if (!flatRate) return 0;

  const startIdx = schedule.renewal_start_year ?? 2;
  const endIdx   = schedule.renewal_end_year;
  const withinLower = renewalIndex >= startIdx;
  const withinUpper = endIdx == null ? true : renewalIndex <= endIdx;
  if (withinLower && withinUpper) return flatRate;

  return 0;
}

/* ---------------------------
   PREMIUM BASIS HELPERS
   --------------------------- */

function resolveTermPremium({ policy, termRow, termLengthMonths }) {
  const termLen = Number(termLengthMonths || 12);

  if (termRow) {
    const tp = Number(termRow.term_premium || 0);
    if (tp > 0) return tp;

    const ap = Number(termRow.annualized_premium || 0);
    if (ap > 0) return ap * (termLen / 12);
  }

  const pa = Number(policy.premium_annual || 0);
  if (pa > 0) return pa * (termLen / 12);

  const pm = Number(policy.premium_modal || 0);
  if (pm > 0) return pm * termLen;

  return 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/* ---------------------------
   LICENSE / OVERRIDE HELPERS
   --------------------------- */

function normalizeText(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizePolicyType(v) {
  return String(v || '').trim().toLowerCase();
}

function normalizeState(v) {
  return String(v || '').trim().toUpperCase();
}

function normalizeLoaText(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getIssueYMD(policyIssuedAt) {
  const d = new Date(policyIssuedAt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getMatchingScheduleForPolicy(policy, level, allSchedules) {
  if (!policy || !policy.issued_at) return null;

  const issuedYMD = getIssueYMD(policy.issued_at);
  const carrier = normalizeText(policy.carrier_name);
  const line = normalizeText(policy.product_line);
  const type = normalizePolicyType(policy.policy_type);
  const lvl = normalizeText(level || 'agent');

  const matches = (allSchedules || []).filter(s => {
    const sameCarrier = normalizeText(s.carrier_name) === carrier;
    const sameLine = normalizeText(s.product_line) === line;
    const sameType = normalizePolicyType(s.policy_type) === type;
    const sameLevel = normalizeText(s.agent_level || 'agent') === lvl;

    const startsOk = !s.effective_from || s.effective_from <= issuedYMD;
    const endsOk = !s.effective_to || s.effective_to >= issuedYMD;

    return sameCarrier && sameLine && sameType && sameLevel && startsOk && endsOk;
  });

  if (!matches.length) return null;

  matches.sort((a, b) => {
    const aDate = a.effective_from || '0000-00-00';
    const bDate = b.effective_from || '0000-00-00';
    return bDate.localeCompare(aDate);
  });

  return matches[0];
}

function licenseRowQualifiesForPolicy(licenseRow, state, requiredLoas, issueYMD) {
  if (!licenseRow) return false;
  if (licenseRow.active !== true) return false;

  const licState = normalizeState(licenseRow.state);
  if (!licState || licState !== normalizeState(state)) return false;

  if (licenseRow.date_issue_orig && issueYMD < licenseRow.date_issue_orig) return false;
  if (licenseRow.date_expire && issueYMD > licenseRow.date_expire) return false;

  if (!requiredLoas.length) return false;

  const loaNames = Array.isArray(licenseRow.loa_names) ? licenseRow.loa_names : [];
  const normalizedNames = loaNames.map(normalizeLoaText);

  return requiredLoas.every(req => {
    const target = normalizeLoaText(req);
    return normalizedNames.some(name =>
      name === target ||
      name.includes(target) ||
      target.includes(name)
    );
  });
}

function agentQualifiesForPolicy(agent, policy, policyState, allSchedules, licensesByExternalAgentId) {
  if (!agent) return false;
  if (agent.is_active === false) return false;
  if (!policy?.issued_at) return false;
  if (!policyState) return false;

  const externalAgentId = agent.agent_id;
  if (!externalAgentId) return false;

  const schedule = getMatchingScheduleForPolicy(policy, agent.level || 'agent', allSchedules);
  const requiredLoasRaw = Array.isArray(schedule?.required_loas) ? schedule.required_loas : [];
  const requiredLoas = requiredLoasRaw.map(normalizeLoaText).filter(Boolean);

  if (!requiredLoas.length) return false;

  const issueYMD = getIssueYMD(policy.issued_at);
  if (!issueYMD) return false;

  const licenseRows = licensesByExternalAgentId.get(externalAgentId) || [];

  return licenseRows.some(row =>
    licenseRowQualifiesForPolicy(row, policyState, requiredLoas, issueYMD)
  );
}

function findNearestEligibleUplineFromAgent(startRecruiterId, policy, policyState, allSchedules, agentsById, licensesByExternalAgentId) {
  const visited = new Set();
  let currentId = startRecruiterId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const currentAgent = agentsById.get(currentId);
    if (!currentAgent) return null;

    if (agentQualifiesForPolicy(currentAgent, policy, policyState, allSchedules, licensesByExternalAgentId)) {
      return currentAgent;
    }

    currentId = currentAgent.recruiter_id || null;
  }

  return null;
}

/* ---------------------------
   MAIN
   --------------------------- */

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST and optionally ?pay_date=YYYY-MM-DD&agent_id=UUID' };
  }

  try {
    const token = getBearerToken(event);
    if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Missing Authorization Bearer token' }) };

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user?.id) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session token' }) };

    const viewerId = userData.user.id;

    const { data: viewerAgentRow, error: viewerAgentErr } = await supabase
      .from('agents')
      .select('id, is_admin')
      .eq('id', viewerId)
      .single();

    if (viewerAgentErr || !viewerAgentRow) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load viewer agent row', details: viewerAgentErr }) };
    }

    const isAdmin = viewerAgentRow.is_admin === true;

    const qs = event.queryStringParameters || {};
    const requestedAgentId = qs.agent_id ? String(qs.agent_id) : null;
    const targetAgentId = (isAdmin && requestedAgentId) ? requestedAgentId : viewerId;

    if (!isAdmin && requestedAgentId && requestedAgentId !== viewerId) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Not allowed to preview other agents' }) };
    }

    const payDate     = getPayDate(event);
    const payDateStr  = payDate.toISOString().slice(0, 10);
    const payMonthKey = payDateStr.slice(0, 7);

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffIso = cutoff.toISOString();

    console.log(
      '[previewMonthlyPayThru] target_agent =',
      targetAgentId,
      'pay_date =',
      payDateStr,
      'pay_month =',
      payMonthKey,
      'cutoff(issued_at) =',
      cutoffIso
    );

    const agentCache = new Map();
    const schedCache = new Map();
    const policyCache = new Map();

    async function getAgent(agentId) {
      if (!agentId) return null;
      if (agentCache.has(agentId)) return agentCache.get(agentId);

      const { data, error } = await supabase
        .from('agents')
        .select('id, full_name, level, recruiter_id, is_active, agent_id')
        .eq('id', agentId)
        .single();

      if (error || !data) {
        console.warn('[previewMonthlyPayThru] Missing agent record for id:', agentId, error);
        agentCache.set(agentId, null);
        return null;
      }

      agentCache.set(agentId, data);
      return data;
    }

    async function getSchedule(policy, level) {
      const key = [
        policy.carrier_name || '',
        policy.product_line || '',
        policy.policy_type || '',
        level || 'agent',
        policy.issued_at || ''
      ].join('|');

      if (schedCache.has(key)) return schedCache.get(key);

      const { data, error } = await supabase
        .from('commission_schedules')
        .select(
          'carrier_name, product_line, policy_type, agent_level, effective_from, effective_to, required_loas, ' +
          'base_commission_rate, advance_rate, renewal_commission_rate, ' +
          'renewal_start_year, renewal_end_year, renewal_trail_rule, term_length_months, exclusive_months'
        )
        .eq('carrier_name', policy.carrier_name)
        .eq('product_line', policy.product_line)
        .eq('policy_type', policy.policy_type)
        .eq('agent_level', level || 'agent');

      if (error || !data || !data.length) {
        console.warn('[previewMonthlyPayThru] No schedule for', key, error);
        schedCache.set(key, null);
        return null;
      }

      const matched = getMatchingScheduleForPolicy(
        { ...policy, issued_at: policy.issued_at },
        level || 'agent',
        data
      );

      if (!matched) {
        console.warn('[previewMonthlyPayThru] No effective-dated schedule match for', key);
        schedCache.set(key, null);
        return null;
      }

      schedCache.set(key, matched);
      return matched;
    }

    async function getPolicyBasic(policyId) {
      if (!policyId) return null;
      if (policyCache.has(policyId)) return policyCache.get(policyId);

      const { data, error } = await supabase
        .from('policies')
        .select('id, carrier_name, product_line, policy_type, issued_at, contact_id')
        .eq('id', policyId)
        .single();

      if (error || !data) {
        console.warn('[previewMonthlyPayThru] Missing policy record for id:', policyId, error);
        policyCache.set(policyId, null);
        return null;
      }

      policyCache.set(policyId, data);
      return data;
    }

    async function getLedgerRowExclusiveMonths(row) {
      const metaMonths = normalizeExclusiveMonths(row?.meta?.exclusive_months);
      if (metaMonths) return metaMonths;

      if (!row?.policy_id || !row?.agent_id) return null;

      const policy = await getPolicyBasic(row.policy_id);
      if (!policy) return null;

      const agent = await getAgent(row.agent_id);
      const level = agent?.level || 'agent';

      const schedule = await getSchedule(policy, level);
      return normalizeExclusiveMonths(schedule?.exclusive_months);
    }

    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, premium_modal, issued_at, as_earned, status, contact_id')
      .eq('agent_id', targetAgentId)
      .in('status', ['issued', 'in_force', 'renewed', 'reinstated'])
      .not('issued_at', 'is', null)
      .lte('issued_at', cutoffIso);

    if (polErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load policies', details: polErr }) };
    }

    if (!policies || policies.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'No policies eligible for monthly pay-thru preview (28-day wait after issued_at).',
          target_agent_id: targetAgentId,
          pay_date: payDateStr,
          pay_month: payMonthKey,
          cutoff: cutoffIso,
          new_rows_preview: 0
        }, null, 2)
      };
    }

    async function loadMonthlyTermRowMap(policyIds) {
      if (!policyIds.length) return new Map();

      const monthStartYMD = monthStartIso.slice(0, 10);
      const monthEndYMD   = monthEndIso.slice(0, 10);

      const { data, error } = await supabase
        .from('policy_terms')
        .select('policy_id, term_premium, annualized_premium, term_months, term_start, term_end')
        .in('policy_id', policyIds)
        .lt('term_start', monthEndYMD)
        .or(`term_end.is.null,term_end.gte.${monthStartYMD}`)
        .order('term_start', { ascending: false });

      if (error) {
        console.warn('[previewMonthlyPayThru] Could not load policy_terms; falling back to policy premiums', error);
        return new Map();
      }

      const map = new Map();
      for (const row of data || []) {
        const start = row.term_start;
        const end   = row.term_end;
        const overlaps = start < monthEndYMD && (end == null || end >= monthStartYMD);
        if (!overlaps) continue;
        if (!map.has(row.policy_id)) map.set(row.policy_id, row);
      }
      return map;
    }

    const termRowMap = await loadMonthlyTermRowMap(policies.map(p => p.id));

    const contactIds = [...new Set(policies.map(p => p.contact_id).filter(Boolean))];
    const contactStateMap = new Map();
    if (contactIds.length) {
      const { data: contactRows, error: contactErr } = await supabase
        .from('contacts')
        .select('id, state')
        .in('id', contactIds);

      if (contactErr) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load contact states', details: contactErr }) };
      }

      (contactRows || []).forEach(c => {
        contactStateMap.set(c.id, normalizeState(c.state));
      });
    }

    const { data: allAgentRows, error: allAgentErr } = await supabase
      .from('agents')
      .select('id, full_name, level, recruiter_id, is_active, agent_id');

    if (allAgentErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agents', details: allAgentErr }) };
    }

    const agentsById = new Map((allAgentRows || []).map(a => [a.id, a]));
    const externalAgentIds = [...new Set((allAgentRows || []).map(a => a.agent_id).filter(Boolean))];

    const licensesByExternalAgentId = new Map();
    if (externalAgentIds.length) {
      const { data: licenseRows, error: licenseErr } = await supabase
        .from('agent_nipr_licenses')
        .select('agent_id, state, active, date_issue_orig, date_expire, loa_names')
        .eq('active', true)
        .in('agent_id', externalAgentIds);

      if (licenseErr) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load licenses', details: licenseErr }) };
      }

      for (const row of (licenseRows || [])) {
        const key = row.agent_id;
        if (!licensesByExternalAgentId.has(key)) licensesByExternalAgentId.set(key, []);
        licensesByExternalAgentId.get(key).push(row);
      }
    }

    const { data: existingPayThru, error: existingErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru')
      .eq('meta->>pay_month', payMonthKey);

    if (existingErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load existing paythru rows', details: existingErr }) };
    }

    const alreadyPaidThisMonth = new Set();
    (existingPayThru || []).forEach(row => {
      const m = row.meta || {};
      const idx = m.cycle_index != null ? Number(m.cycle_index) : (m.policy_year != null ? Number(m.policy_year) : 1);
      if (row.policy_id && row.agent_id) alreadyPaidThisMonth.add(`${row.policy_id}:${row.agent_id}:${idx}`);
    });

    const { data: payThruPrior, error: priorErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, agent_id, meta')
      .eq('entry_type', 'paythru');

    if (priorErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load paythru counts', details: priorErr }) };
    }

    const payThruCountMap = new Map();
    (payThruPrior || []).forEach(row => {
      const m = row.meta || {};
      const idx = m.cycle_index != null ? Number(m.cycle_index) : (m.policy_year != null ? Number(m.policy_year) : 1);
      const key = `${row.policy_id}:${row.agent_id}:${idx}`;
      payThruCountMap.set(key, (payThruCountMap.get(key) || 0) + 1);
    });

    const simulatedRows = [];
    let simulatedNewGross = 0;

    for (const policy of policies) {
      if (!policy.agent_id) continue;
      if (!policy.issued_at) continue;

      const policyAsEarned = policy.as_earned === true;
      const policyState = contactStateMap.get(policy.contact_id);
      if (!policyState) continue;

      const chain = [];
      let current = await getAgent(policy.agent_id);
      const visitedAgents = new Set();

      let globalAdvanceRate = null;
      let writingTermLenMonths = 12;

      for (let depth = 0; depth < 10 && current; depth++) {
        if (visitedAgents.has(current.id)) break;
        visitedAgents.add(current.id);

        if (depth === 0) {
          const level = current.level || 'agent';
          const schedule = await getSchedule(policy, level);
          if (!schedule) break;

          const baseRate = Number(schedule.base_commission_rate || 0);
          const advRate  = Number(schedule.advance_rate || 0);

          const t = schedule.term_length_months;
          writingTermLenMonths = (t == null ? 12 : Number(t || 12));
          if (!writingTermLenMonths || writingTermLenMonths <= 0) writingTermLenMonths = 12;

          globalAdvanceRate = policyAsEarned ? 0 : advRate;

          chain.push({ agent: current, schedule, baseRate });

          if (!current.recruiter_id) break;
          current = await getAgent(current.recruiter_id);
          continue;
        }

        const eligibleAgent = findNearestEligibleUplineFromAgent(
          current.id,
          policy,
          policyState,
          allAgentRows || [],
          agentsById,
          licensesByExternalAgentId
        );

        if (!eligibleAgent) break;

        if (visitedAgents.has(eligibleAgent.id)) break;
        visitedAgents.add(eligibleAgent.id);

        const level = eligibleAgent.level || 'agent';
        const schedule = await getSchedule(policy, level);
        if (!schedule) break;

        const baseRate = Number(schedule.base_commission_rate || 0);

        chain.push({ agent: eligibleAgent, schedule, baseRate });

        if (!eligibleAgent.recruiter_id) break;
        current = await getAgent(eligibleAgent.recruiter_id);
      }

      if (!chain.length || globalAdvanceRate == null) continue;

      const isTermWorld = writingTermLenMonths !== 12;

      const cycleIndex = isTermWorld
        ? getTermNumberByMonths(policy.issued_at, monthStart, writingTermLenMonths)
        : getPolicyYear(policy.issued_at, payDate);

      if (!cycleIndex) continue;

      const termRow = termRowMap.get(policy.id) || null;
      const termPremium = resolveTermPremium({
        policy,
        termRow,
        termLengthMonths: writingTermLenMonths
      });
      if (termPremium <= 0) continue;

      const cycleMonths = isTermWorld ? writingTermLenMonths : 12;

      let prevBaseRate = 0;
      let prevBaseRenewalRate = 0;

      for (const node of chain) {
        let effectiveRate = 0;
        let phase = 'trail';

        if (cycleIndex === 1) {
          const levelBaseRate = node.baseRate;
          effectiveRate = levelBaseRate - prevBaseRate;
          prevBaseRate = levelBaseRate;
          phase = 'trail';
        } else {
          const baseRenewalRate = getBaseRenewalRate(node.schedule, cycleIndex);
          if (!baseRenewalRate || baseRenewalRate <= 0) continue;
          effectiveRate = baseRenewalRate - prevBaseRenewalRate;
          prevBaseRenewalRate = baseRenewalRate;
          phase = 'renewal';
        }

        if (effectiveRate <= 0) continue;

        const key = `${policy.id}:${node.agent.id}:${cycleIndex}`;

        if (alreadyPaidThisMonth.has(key)) continue;

        const priorCount = payThruCountMap.get(key) || 0;

        if (priorCount >= cycleMonths) continue;

        let monthsAdvanced = 0;
        if (!isTermWorld && cycleIndex === 1) {
          monthsAdvanced = policyAsEarned ? 0 : Math.floor((globalAdvanceRate || 0) * 12);

          const issuedAt = new Date(policy.issued_at);
          const issuedMonth = monthIndexUTC(issuedAt);
          const payMonth = monthIndexUTC(monthStart);
          const monthsElapsed = payMonth - issuedMonth;

          if (monthsElapsed < monthsAdvanced) continue;
        }

        const cycleCommission = termPremium * effectiveRate;

        const divisorMonths = (!isTermWorld && cycleIndex === 1)
          ? Math.max(1, 12 - monthsAdvanced)
          : cycleMonths;

        const monthly = round2(cycleCommission / divisorMonths);
        if (monthly <= 0) continue;

        payThruCountMap.set(key, priorCount + 1);

        const exclusiveMonths = normalizeExclusiveMonths(node.schedule?.exclusive_months);

        const row = {
          agent_id: node.agent.id,
          policy_id: policy.id,
          amount: monthly,
          entry_type: 'paythru',
          phase,
          meta: {
            pay_month: payMonthKey,
            cycle_index: cycleIndex,
            phase,
            carrier_name: policy.carrier_name,
            product_line: policy.product_line,
            policy_type: policy.policy_type,
            term_length_months: writingTermLenMonths,
            term_premium_used: termPremium,
            rate_portion: effectiveRate,
            as_earned: policyAsEarned,
            advance_rate_applied: globalAdvanceRate,
            months_advanced: monthsAdvanced,
            divisor_months: divisorMonths,
            issued_at: policy.issued_at,
            exclusive_months: exclusiveMonths
          }
        };

        if (row.agent_id === targetAgentId) {
          simulatedRows.push(row);
          simulatedNewGross += monthly;
        }
      }
    }

    simulatedNewGross = round2(simulatedNewGross);

    const payableSimulatedRows = simulatedRows.filter(row =>
      isPayMonthAllowed(normalizeExclusiveMonths(row?.meta?.exclusive_months), payDate)
    );

    const { data: unpaidExistingRaw, error: unpaidErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, policy_id, meta')
      .eq('entry_type', 'paythru')
      .eq('is_settled', false)
      .eq('agent_id', targetAgentId)
      .lte('meta->>pay_month', payMonthKey);

    if (unpaidErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load unpaid paythru rows', details: unpaidErr }) };
    }

    const unpaidExistingAll = unpaidExistingRaw || [];

    const unpaidPolicyIds = Array.from(
      new Set(unpaidExistingAll.map(r => r.policy_id).filter(Boolean))
    );

    let eligiblePolicyIdSet = new Set();

    if (unpaidPolicyIds.length > 0) {
      const { data: polStatusRows, error: polStatusErr } = await supabase
        .from('policies')
        .select('id, status')
        .in('id', unpaidPolicyIds);

      if (polStatusErr) {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to load policy statuses for unpaid paythru rows', details: polStatusErr })
        };
      }

      for (const p of (polStatusRows || [])) {
        if (ELIGIBLE_POLICY_STATUSES.includes(p.status)) {
          eligiblePolicyIdSet.add(p.id);
        }
      }
    }

    const unpaidExistingEligibleStatus = unpaidExistingAll.filter(r => {
      if (!r.policy_id) return false;
      return eligiblePolicyIdSet.has(r.policy_id);
    });

    const unpaidExisting = [];
    for (const row of unpaidExistingEligibleStatus) {
      const exclusiveMonths = await getLedgerRowExclusiveMonths(row);
      if (isPayMonthAllowed(exclusiveMonths, payDate)) {
        unpaidExisting.push(row);
      }
    }

    const filteredOutUnpaidCount = unpaidExistingAll.length - unpaidExisting.length;

    let grossTowardThreshold = 0;
    for (const row of unpaidExisting) grossTowardThreshold += Number(row.amount || 0);
    for (const row of payableSimulatedRows) grossTowardThreshold += Number(row.amount || 0);
    grossTowardThreshold = round2(grossTowardThreshold);

    const threshold = 100;

    if (grossTowardThreshold < threshold) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Paythru accrued (including simulated new rows), but target agent did not reach the $100 minimum yet.',
          target_agent_id: targetAgentId,
          pay_date: payDateStr,
          pay_month: payMonthKey,
          cutoff: cutoffIso,
          threshold,
          existing_unpaid_rows_count: unpaidExisting.length,
          simulated_new_rows_count: simulatedRows.length,
          total_new_paythru_gross_preview: simulatedNewGross,
          gross_accrued_toward_threshold_preview: grossTowardThreshold,
          filtered_out_unpaid_count: filteredOutUnpaidCount,
          agents_paid_preview: 0
        }, null, 2)
      };
    }

    const { data: debtRow, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .eq('agent_id', targetAgentId)
      .maybeSingle();

    if (debtErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agent_total_debt', details: debtErr }) };
    }

    const { data: targetAgentRow, error: targetAgentErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .eq('id', targetAgentId)
      .single();

    if (targetAgentErr) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agents.is_active', details: targetAgentErr }) };
    }

    const totalDebt = Number(debtRow?.total_debt || 0);
    const cbOutstanding = Number(debtRow?.chargeback_total || 0);
    const leadOutstanding = Number(debtRow?.lead_debt_total || 0);
    const isActive = targetAgentRow?.is_active !== false;

    let leadRepay = 0;
    let chargebackRepay = 0;
    let net = grossTowardThreshold;

    if (grossTowardThreshold > 0 && totalDebt > 0) {
      const rate = getRepaymentRate(totalDebt, isActive);
      const maxRepay = round2(grossTowardThreshold * rate);
      const toRepay = Math.min(maxRepay, totalDebt);

      let remaining = toRepay;

      if (cbOutstanding > 0 && remaining > 0) {
        chargebackRepay = Math.min(remaining, cbOutstanding);
        remaining -= chargebackRepay;
      }
      if (leadOutstanding > 0 && remaining > 0) {
        leadRepay = Math.min(remaining, leadOutstanding);
        remaining -= leadRepay;
      }

      net = round2(grossTowardThreshold - (chargebackRepay + leadRepay));
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Monthly pay-thru PREVIEW (math matches runMonthlyPayThru; no DB writes).',
        target_agent_id: targetAgentId,
        pay_date: payDateStr,
        pay_month: payMonthKey,
        cutoff: cutoffIso,
        threshold,
        existing_unpaid_rows_count: unpaidExisting.length,
        simulated_new_rows_count: simulatedRows.length,
        total_new_paythru_gross_preview: simulatedNewGross,
        gross_accrued_toward_threshold_preview: grossTowardThreshold,
        gross_monthly_trail_preview: grossTowardThreshold,
        net_payout_preview: net,
        lead_repayment_preview: round2(leadRepay),
        chargeback_repayment_preview: round2(chargebackRepay),
        filtered_out_unpaid_count: filteredOutUnpaidCount,
        details_preview: {
          simulated_new_rows: simulatedRows
        }
      }, null, 2)
    };

  } catch (err) {
    console.error('[previewMonthlyPayThru] Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected error', details: String(err) }) };
  }
}
