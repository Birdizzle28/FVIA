// netlify/functions/runMonthlyPayThru.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[runMonthlyPayThru] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

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
    try {
      rule = JSON.parse(rule);
    } catch {
      rule = null;
    }
  }

  if (rule && Array.isArray(rule.bands)) {
    for (const band of rule.bands) {
      const start = band.start_year ?? (schedule.renewal_start_year ?? 2);
      const end   = band.end_year;
      const withinLower = renewalIndex >= start;
      const withinUpper = end == null ? true : renewalIndex <= end;
      if (withinLower && withinUpper) {
        return Number(band.rate || 0);
      }
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

function resolveCommissionableTermPremium({ item, termRow, termLengthMonths }) {
  const termLen = Number(termLengthMonths || 12);

  if (termRow) {
    const commissionableTermPremium = Number(termRow.commissionable_term_premium || 0);
    if (commissionableTermPremium > 0) return commissionableTermPremium;

    const commissionableAnnualized = Number(termRow.commissionable_annualized_premium || 0);
    if (commissionableAnnualized > 0) return commissionableAnnualized * (termLen / 12);

    const tp = Number(termRow.term_premium || 0);
    if (tp > 0) return tp;

    const ap = Number(termRow.annualized_premium || 0);
    if (ap > 0) return ap * (termLen / 12);
  }

  const cpa = Number(item.commissionable_premium_annual || 0);
  if (cpa > 0) return cpa * (termLen / 12);

  const cpm = Number(item.commissionable_premium_modal || 0);
  if (cpm > 0) return cpm * termLen;

  const pa = Number(item.premium_annual || 0);
  if (pa > 0) return pa * (termLen / 12);

  const pm = Number(item.premium_modal || 0);
  if (pm > 0) return pm * termLen;

  return 0;
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

function normalizeCommissionItemType(v) {
  const x = String(v || '').trim().toLowerCase();
  return x === 'attachment' ? 'attachment' : 'policy';
}

function getIssueYMD(issuedAt) {
  const d = new Date(issuedAt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getMatchingScheduleForItem(item, level, allSchedules, options = {}) {
  if (!item || !item.issued_at) return null;

  const issuedYMD = getIssueYMD(item.issued_at);
  const carrier = normalizeText(item.carrier_name);
  const line = normalizeText(item.product_line);
  const type = normalizePolicyType(item.policy_type);
  const lvl = normalizeText(level || 'agent');
  const itemType = normalizeCommissionItemType(options.commission_item_type || 'policy');
  const parentPolicyType = normalizePolicyType(options.parent_policy_type);

  const matches = (allSchedules || []).filter(s => {
    const sameCarrier = normalizeText(s.carrier_name) === carrier;
    const sameLine = normalizeText(s.product_line) === line;
    const sameType = normalizePolicyType(s.policy_type) === type;
    const sameLevel = normalizeText(s.agent_level || 'agent') === lvl;
    const sameItemType = normalizeCommissionItemType(s.commission_item_type) === itemType;

    const startsOk = !s.effective_from || s.effective_from <= issuedYMD;
    const endsOk = !s.effective_to || s.effective_to >= issuedYMD;

    if (!sameCarrier || !sameLine || !sameType || !sameLevel || !sameItemType || !startsOk || !endsOk) {
      return false;
    }

    if (itemType === 'attachment') {
      return normalizePolicyType(s.parent_policy_type) === parentPolicyType;
    }

    return true;
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

function agentQualifiesForItem(agent, item, itemState, allSchedules, licensesByExternalAgentId, options = {}) {
  if (!agent) return false;
  if (agent.is_active === false) return false;
  if (!item?.issued_at) return false;
  if (!itemState) return false;

  const externalAgentId = agent.agent_id;
  if (!externalAgentId) return false;

  const schedule = getMatchingScheduleForItem(item, agent.level || 'agent', allSchedules, options);
  const requiredLoasRaw = Array.isArray(schedule?.required_loas) ? schedule.required_loas : [];
  const requiredLoas = requiredLoasRaw.map(normalizeLoaText).filter(Boolean);

  if (!requiredLoas.length) return false;

  const issueYMD = getIssueYMD(item.issued_at);
  if (!issueYMD) return false;

  const licenseRows = licensesByExternalAgentId.get(externalAgentId) || [];

  return licenseRows.some(row =>
    licenseRowQualifiesForPolicy(row, itemState, requiredLoas, issueYMD)
  );
}

function findNearestEligibleUplineFromAgent(startRecruiterId, item, itemState, allSchedules, agentsById, licensesByExternalAgentId, options = {}) {
  const visited = new Set();
  let currentId = startRecruiterId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const currentAgent = agentsById.get(currentId);
    if (!currentAgent) return null;

    if (agentQualifiesForItem(currentAgent, item, itemState, allSchedules, licensesByExternalAgentId, options)) {
      return currentAgent;
    }

    currentId = currentAgent.recruiter_id || null;
  }

  return null;
}

/* ---------------------------
   DEBT REPAYMENTS
   --------------------------- */

async function applyRepayments(agent_id, chargebackRepay, leadRepay, otherRepay, payout_batch_id) {
  if (chargebackRepay > 0) {
    let remaining = chargebackRepay;

    const { data: cbRows, error: cbErr } = await supabase
      .from('policy_chargebacks')
      .select('id, amount, status')
      .eq('agent_id', agent_id)
      .in('status', ['open', 'in_repayment'])
      .order('created_at', { ascending: true });

    if (!cbErr) {
      for (const cb of cbRows || []) {
        if (remaining <= 0) break;
        const outstanding = Number(cb.amount);
        if (outstanding <= 0) continue;

        const pay = Math.min(outstanding, remaining);
        remaining -= pay;

        await supabase.from('chargeback_payments').insert({
          agent_id,
          chargeback_id: cb.id,
          amount: pay,
          payout_batch_id
        });

        if (pay === outstanding) {
          await supabase
            .from('policy_chargebacks')
            .update({ status: 'paid', amount: 0 })
            .eq('id', cb.id);
        } else {
          await supabase
            .from('policy_chargebacks')
            .update({
              status: 'in_repayment',
              amount: outstanding - pay
            })
            .eq('id', cb.id);
        }
      }
    }
  }

  if (leadRepay > 0) {
    let remaining = leadRepay;

    const { data: ldRows, error: ldErr } = await supabase
      .from('lead_debts')
      .select('id, amount, status')
      .eq('agent_id', agent_id)
      .in('status', ['open', 'in_repayment'])
      .order('created_at', { ascending: true });

    if (!ldErr) {
      for (const ld of ldRows || []) {
        if (remaining <= 0) break;

        const outstanding = Number(ld.amount);
        if (outstanding <= 0) continue;

        const pay = Math.min(outstanding, remaining);
        remaining -= pay;

        await supabase.from('lead_debt_payments').insert({
          lead_debt_id: ld.id,
          agent_id,
          amount: pay,
          payout_batch_id
        });

        if (pay === outstanding) {
          await supabase
            .from('lead_debts')
            .update({ status: 'paid', amount: 0 })
            .eq('id', ld.id);
        } else {
          await supabase
            .from('lead_debts')
            .update({
              status: 'in_repayment',
              amount: outstanding - pay
            })
            .eq('id', ld.id);
        }
      }
    }
  }

  if (otherRepay > 0) {
    let remaining = otherRepay;

    const { data: odRows, error: odErr } = await supabase
      .from('agent_other_debts')
      .select('id, amount, status')
      .eq('agent_id', agent_id)
      .in('status', ['open', 'in_repayment'])
      .order('created_at', { ascending: true });

    if (!odErr) {
      for (const od of odRows || []) {
        if (remaining <= 0) break;

        const outstanding = Number(od.amount);
        if (outstanding <= 0) continue;

        const pay = Math.min(outstanding, remaining);
        remaining -= pay;

        await supabase.from('agent_other_debt_payments').insert({
          agent_other_debt_id: od.id,
          agent_id,
          amount: pay,
          payout_batch_id
        });

        if (pay === outstanding) {
          await supabase
            .from('agent_other_debts')
            .update({ status: 'paid', amount: 0 })
            .eq('id', od.id);
        } else {
          await supabase
            .from('agent_other_debts')
            .update({
              status: 'in_repayment',
              amount: outstanding - pay
            })
            .eq('id', od.id);
        }
      }
    }
  }
}

/* ---------------------------
   MAIN HANDLER
   --------------------------- */

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDate     = getPayDate(event);
    const payDateStr  = payDate.toISOString().slice(0, 10);
    const payMonthKey = payDateStr.slice(0, 7);

    const { start: monthStart, end: monthEnd } = getMonthBounds(payDate);
    const monthStartIso = monthStart.toISOString();
    const monthEndIso   = monthEnd.toISOString();

    async function loadMonthlyTermRowMap(policyIds) {
      if (!policyIds.length) return new Map();

      const monthStartYMD = monthStartIso.slice(0, 10);
      const monthEndYMD   = monthEndIso.slice(0, 10);

      const { data, error } = await supabase
        .from('policy_terms')
        .select(
          'policy_id, policy_attachment_id, term_premium, annualized_premium, commissionable_term_premium, commissionable_annualized_premium, term_months, term_start, term_end'
        )
        .in('policy_id', policyIds)
        .lt('term_start', monthEndYMD)
        .or(`term_end.is.null,term_end.gte.${monthStartYMD}`)
        .order('term_start', { ascending: false });

      if (error) {
        console.warn('[runMonthlyPayThru] Could not load policy_terms; falling back to premiums on policy / attachment', error);
        return new Map();
      }

      const map = new Map();
      for (const row of data || []) {
        const start = row.term_start;
        const end   = row.term_end;

        const overlaps = start < monthEndYMD && (end == null || end >= monthStartYMD);
        if (!overlaps) continue;

        const key = `${row.policy_id}:${row.policy_attachment_id || 'policy'}`;
        if (!map.has(key)) map.set(key, row);
      }
      return map;
    }

    const cutoff = new Date(payDate);
    cutoff.setDate(cutoff.getDate() - 28);
    const cutoffIso = cutoff.toISOString();

    console.log(
      '[runMonthlyPayThru] pay_date =',
      payDateStr,
      'pay_month =',
      payMonthKey,
      'cutoff(issued_at) =',
      cutoffIso
    );

    const { data: existingPayThru, error: existingErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, policy_attachment_id, agent_id, meta')
      .eq('entry_type', 'paythru')
      .eq('meta->>pay_month', payMonthKey);

    if (existingErr) {
      console.error('[runMonthlyPayThru] Error loading existing paythru rows:', existingErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load existing paythru rows', details: existingErr }) };
    }

    const alreadyPaidThisMonth = new Set();
    (existingPayThru || []).forEach(row => {
      const m = row.meta || {};
      const idx = m.cycle_index != null ? Number(m.cycle_index) : (m.policy_year != null ? Number(m.policy_year) : 1);
      if (row.policy_id && row.agent_id) {
        const itemKey = row.policy_attachment_id || 'policy';
        alreadyPaidThisMonth.add(`${row.policy_id}:${itemKey}:${row.agent_id}:${idx}`);
      }
    });

    const { data: payThruPrior, error: priorErr } = await supabase
      .from('commission_ledger')
      .select('policy_id, policy_attachment_id, agent_id, meta')
      .eq('entry_type', 'paythru');

    if (priorErr) {
      console.error('[runMonthlyPayThru] Error loading prior paythru rows:', priorErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load paythru counts', details: priorErr }) };
    }

    const payThruCountMap = new Map();
    (payThruPrior || []).forEach(row => {
      const m = row.meta || {};
      const idx = m.cycle_index != null ? Number(m.cycle_index) : (m.policy_year != null ? Number(m.policy_year) : 1);
      const itemKey = row.policy_attachment_id || 'policy';
      const key = `${row.policy_id}:${itemKey}:${row.agent_id}:${idx}`;
      payThruCountMap.set(key, (payThruCountMap.get(key) || 0) + 1);
    });

    const { data: policies, error: polErr } = await supabase
      .from('policies')
      .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, premium_modal, issued_at, as_earned, status, contact_id')
      .in('status', ['issued', 'in_force', 'renewed', 'reinstated'])
      .not('issued_at', 'is', null)
      .lte('issued_at', cutoffIso);

    if (polErr) {
      console.error('[runMonthlyPayThru] Error loading policies:', polErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load policies', details: polErr }) };
    }

    const policyList = policies || [];
    if (policyList.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies eligible for monthly pay-thru (28-day wait after issued_at) this run.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
        }),
      };
    }

    const policyIds = policyList.map(p => p.id);

    const { data: attachmentRowsRaw, error: attErr } = await supabase
      .from('policy_attachments')
      .select(
        'id, policy_id, attachment_name, attachment_type, carrier_name, product_line, policy_type, status, issued_at, effective_at, terminated_at, premium_modal, premium_annual, commissionable_premium_modal, commissionable_premium_annual'
      )
      .in('policy_id', policyIds)
      .eq('status', 'active')
      .not('issued_at', 'is', null)
      .lte('issued_at', cutoffIso);

    if (attErr) {
      console.error('[runMonthlyPayThru] Error loading policy attachments:', attErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load policy attachments', details: attErr }) };
    }

    const attachmentsByPolicyId = new Map();
    for (const att of (attachmentRowsRaw || [])) {
      if (!attachmentsByPolicyId.has(att.policy_id)) attachmentsByPolicyId.set(att.policy_id, []);
      attachmentsByPolicyId.get(att.policy_id).push(att);
    }

    const termRowMap = await loadMonthlyTermRowMap(policyIds);

    // Load contact states once
    const contactIds = [...new Set(policyList.map(p => p.contact_id).filter(Boolean))];
    const contactStateMap = new Map();
    if (contactIds.length) {
      const { data: contactRows, error: contactErr } = await supabase
        .from('contacts')
        .select('id, state')
        .in('id', contactIds);

      if (contactErr) {
        console.error('[runMonthlyPayThru] Error loading contact states:', contactErr);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load contact states', details: contactErr }) };
      }

      (contactRows || []).forEach(c => {
        contactStateMap.set(c.id, normalizeState(c.state));
      });
    }

    // Load all agents once for chain walking / eligibility
    const { data: allAgentRows, error: allAgentErr } = await supabase
      .from('agents')
      .select('id, full_name, level, recruiter_id, agent_id, is_active');

    if (allAgentErr) {
      console.error('[runMonthlyPayThru] Error loading agents:', allAgentErr);
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
        console.error('[runMonthlyPayThru] Error loading licenses:', licenseErr);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load licenses', details: licenseErr }) };
      }

      for (const row of (licenseRows || [])) {
        const key = row.agent_id;
        if (!licensesByExternalAgentId.has(key)) licensesByExternalAgentId.set(key, []);
        licensesByExternalAgentId.get(key).push(row);
      }
    }

    const agentCache = new Map();
    const schedCache = new Map();
    const policyCache = new Map();
    const attachmentCache = new Map();

    async function getAgent(agentId) {
      if (!agentId) return null;
      if (agentCache.has(agentId)) return agentCache.get(agentId);

      const data = agentsById.get(agentId) || null;
      if (!data) {
        console.warn('[runMonthlyPayThru] Missing agent record for id:', agentId);
      }
      agentCache.set(agentId, data);
      return data;
    }

    async function getPolicyBasic(policyId) {
      if (!policyId) return null;
      if (policyCache.has(policyId)) return policyCache.get(policyId);

      const found = policyList.find(p => p.id === policyId);
      if (found) {
        policyCache.set(policyId, found);
        return found;
      }

      const { data, error } = await supabase
        .from('policies')
        .select('id, agent_id, carrier_name, product_line, policy_type, premium_annual, premium_modal, issued_at, as_earned, status, contact_id')
        .eq('id', policyId)
        .single();

      if (error || !data) {
        console.warn('[runMonthlyPayThru] Missing policy record for id:', policyId, error);
        policyCache.set(policyId, null);
        return null;
      }

      policyCache.set(policyId, data);
      return data;
    }

    async function getAttachmentBasic(policyAttachmentId) {
      if (!policyAttachmentId) return null;
      if (attachmentCache.has(policyAttachmentId)) return attachmentCache.get(policyAttachmentId);

      const found = (attachmentRowsRaw || []).find(a => a.id === policyAttachmentId) || null;
      if (found) {
        attachmentCache.set(policyAttachmentId, found);
        return found;
      }

      const { data, error } = await supabase
        .from('policy_attachments')
        .select(
          'id, policy_id, attachment_name, attachment_type, carrier_name, product_line, policy_type, status, issued_at, effective_at, terminated_at, premium_modal, premium_annual, commissionable_premium_modal, commissionable_premium_annual'
        )
        .eq('id', policyAttachmentId)
        .single();

      if (error || !data) {
        console.warn('[runMonthlyPayThru] Missing attachment record for id:', policyAttachmentId, error);
        attachmentCache.set(policyAttachmentId, null);
        return null;
      }

      attachmentCache.set(policyAttachmentId, data);
      return data;
    }

    async function getSchedule(item, level, options = {}) {
      const key = [
        normalizeCommissionItemType(options.commission_item_type || 'policy'),
        options.parent_policy_type || '',
        item.carrier_name || '',
        item.product_line || '',
        item.policy_type || '',
        level || 'agent',
      ].join('|');

      if (schedCache.has(key)) return schedCache.get(key);

      const baseQuery = supabase
        .from('commission_schedules')
        .select(
          'carrier_name, product_line, policy_type, agent_level, commission_item_type, parent_policy_type, effective_from, effective_to, required_loas, ' +
          'base_commission_rate, advance_rate, renewal_commission_rate, ' +
          'renewal_start_year, renewal_end_year, renewal_trail_rule, term_length_months, exclusive_months'
        )
        .eq('carrier_name', item.carrier_name)
        .eq('product_line', item.product_line)
        .eq('policy_type', item.policy_type)
        .eq('agent_level', level || 'agent')
        .eq('commission_item_type', normalizeCommissionItemType(options.commission_item_type || 'policy'));

      let q = baseQuery;
      if (normalizeCommissionItemType(options.commission_item_type || 'policy') === 'attachment') {
        q = q.eq('parent_policy_type', options.parent_policy_type || '');
      }

      const { data, error } = await q;

      if (error || !data || !data.length) {
        console.warn('[runMonthlyPayThru] No schedule for', key, error);
        schedCache.set(key, null);
        return null;
      }

      const matched = getMatchingScheduleForItem(
        { ...item, issued_at: item.issued_at },
        level || 'agent',
        data,
        options
      );

      if (!matched) {
        console.warn('[runMonthlyPayThru] No effective-dated schedule match for', key);
        schedCache.set(key, null);
        return null;
      }

      schedCache.set(key, matched);
      return matched;
    }

    async function getLedgerRowExclusiveMonths(row) {
      const metaMonths = normalizeExclusiveMonths(row?.meta?.exclusive_months);
      if (metaMonths) return metaMonths;

      if (!row?.policy_id || !row?.agent_id) return null;

      const agent = await getAgent(row.agent_id);
      const level = agent?.level || 'agent';

      const isAttachment = !!row.policy_attachment_id;

      if (isAttachment) {
        const attachment = await getAttachmentBasic(row.policy_attachment_id);
        const parentPolicy = await getPolicyBasic(row.policy_id);
        if (!attachment || !parentPolicy) return null;

        const schedule = await getSchedule(attachment, level, {
          commission_item_type: 'attachment',
          parent_policy_type: parentPolicy.policy_type,
        });
        return normalizeExclusiveMonths(schedule?.exclusive_months);
      }

      const policy = await getPolicyBasic(row.policy_id);
      if (!policy) return null;

      const schedule = await getSchedule(policy, level, {
        commission_item_type: 'policy',
        parent_policy_type: null,
      });
      return normalizeExclusiveMonths(schedule?.exclusive_months);
    }

    const newLedgerRows = [];

    for (const policy of policyList) {
      if (!policy.agent_id) continue;
      if (!policy.issued_at) continue;

      const policyAsEarned = policy.as_earned === true;
      const policyState = contactStateMap.get(policy.contact_id);
      if (!policyState) continue;

      const commissionItems = [
        {
          kind: 'policy',
          row: policy,
          parentPolicy: policy,
          policy_attachment_id: null,
        },
        ...((attachmentsByPolicyId.get(policy.id) || []).map(att => ({
          kind: 'attachment',
          row: att,
          parentPolicy: policy,
          policy_attachment_id: att.id,
        })))
      ];

      for (const commissionItem of commissionItems) {
        const item = commissionItem.row;
        const parentPolicy = commissionItem.parentPolicy;
        const isAttachment = commissionItem.kind === 'attachment';
        const itemOptions = {
          commission_item_type: isAttachment ? 'attachment' : 'policy',
          parent_policy_type: isAttachment ? parentPolicy.policy_type : null,
        };

        // Build chain (and capture writing-agent schedule first)
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
            const schedule = await getSchedule(item, level, itemOptions);
            if (!schedule) break;

            const baseRate = Number(schedule.base_commission_rate || 0);
            const advRate  = Number(schedule.advance_rate || 0);

            const t = schedule.term_length_months;
            writingTermLenMonths = (t == null ? 12 : Number(t || 12));
            if (!writingTermLenMonths || writingTermLenMonths <= 0) writingTermLenMonths = 12;

            globalAdvanceRate = policyAsEarned ? 0 : advRate;

            chain.push({
              agent: current,
              schedule,
              baseRate
            });

            if (!current.recruiter_id) break;
            current = await getAgent(current.recruiter_id);
            continue;
          }

          const eligibleAgent = findNearestEligibleUplineFromAgent(
            current.id,
            item,
            policyState,
            allAgentRows || [],
            agentsById,
            licensesByExternalAgentId,
            itemOptions
          );

          if (!eligibleAgent) break;

          if (visitedAgents.has(eligibleAgent.id)) break;
          visitedAgents.add(eligibleAgent.id);

          const level = eligibleAgent.level || 'agent';
          const schedule = await getSchedule(item, level, itemOptions);
          if (!schedule) break;

          const baseRate = Number(schedule.base_commission_rate || 0);

          chain.push({
            agent: eligibleAgent,
            schedule,
            baseRate
          });

          if (!eligibleAgent.recruiter_id) break;
          current = await getAgent(eligibleAgent.recruiter_id);
        }

        if (!chain.length || globalAdvanceRate == null) continue;

        const isTermWorld = writingTermLenMonths !== 12;

        const cycleIndex = isTermWorld
          ? getTermNumberByMonths(item.issued_at, monthStart, writingTermLenMonths)
          : getPolicyYear(item.issued_at, payDate);

        if (!cycleIndex) continue;

        const termKey = `${policy.id}:${commissionItem.policy_attachment_id || 'policy'}`;
        const termRow = termRowMap.get(termKey) || null;

        const termPremium = resolveCommissionableTermPremium({
          item,
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

          const itemKey = commissionItem.policy_attachment_id || 'policy';
          const key = `${policy.id}:${itemKey}:${node.agent.id}:${cycleIndex}`;

          if (alreadyPaidThisMonth.has(key)) continue;

          const priorCount = payThruCountMap.get(key) || 0;
          if (priorCount >= cycleMonths) continue;

          let monthsAdvanced = 0;
          if (!isTermWorld && cycleIndex === 1) {
            monthsAdvanced = policyAsEarned ? 0 : Math.floor((globalAdvanceRate || 0) * 12);

            const issuedAt = new Date(item.issued_at);
            const issuedMonth = monthIndexUTC(issuedAt);
            const payMonth = monthIndexUTC(monthStart);
            const monthsElapsed = payMonth - issuedMonth;

            if (monthsElapsed < monthsAdvanced) continue;
          }

          const cycleCommission = termPremium * effectiveRate;

          const divisorMonths = (!isTermWorld && cycleIndex === 1)
            ? Math.max(1, 12 - monthsAdvanced)
            : cycleMonths;

          const monthlyRaw = cycleCommission / divisorMonths;
          const monthly = Math.round(monthlyRaw * 100) / 100;
          if (monthly <= 0) continue;

          payThruCountMap.set(key, priorCount + 1);

          const exclusiveMonths = normalizeExclusiveMonths(node.schedule?.exclusive_months);

          newLedgerRows.push({
            agent_id: node.agent.id,
            policy_id: policy.id,
            policy_attachment_id: commissionItem.policy_attachment_id,
            amount: monthly,
            currency: 'USD',
            entry_type: 'paythru',
            description:
              phase === 'trail'
                ? `Monthly pay-thru (cycle 1) on ${item.carrier_name} ${item.product_line} (${item.policy_type}) for ${payMonthKey}`
                : `Monthly renewal pay-thru (cycle ${cycleIndex}) on ${item.carrier_name} ${item.product_line} (${item.policy_type}) for ${payMonthKey}`,
            period_start: monthStartIso,
            period_end: monthEndIso,
            is_settled: false,
            payout_batch_id: null,
            meta: {
              pay_month: payMonthKey,
              cycle_index: cycleIndex,
              phase,
              commission_item_type: itemOptions.commission_item_type,
              parent_policy_type: itemOptions.parent_policy_type,
              policy_attachment_id: commissionItem.policy_attachment_id,
              carrier_name: item.carrier_name,
              product_line: item.product_line,
              policy_type: item.policy_type,
              term_length_months: writingTermLenMonths,
              term_premium_used: termPremium,
              rate_portion: effectiveRate,
              as_earned: policyAsEarned,
              advance_rate_applied: globalAdvanceRate,
              months_advanced: monthsAdvanced,
              divisor_months: divisorMonths,
              issued_at: item.issued_at,
              exclusive_months: exclusiveMonths
            }
          });
        }
      }
    }

    if (newLedgerRows.length > 0) {
      const { error: insErr } = await supabase
        .from('commission_ledger')
        .insert(newLedgerRows);

      if (insErr) {
        console.error('[runMonthlyPayThru] Error inserting new paythru rows:', insErr);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to insert new paythru rows', details: insErr }) };
      }
    }

    const { data: unpaidTrailsRaw, error: unpaidErr } = await supabase
      .from('commission_ledger')
      .select('id, agent_id, amount, policy_id, policy_attachment_id, meta')
      .eq('entry_type', 'paythru')
      .eq('is_settled', false)
      .lte('meta->>pay_month', payMonthKey);

    if (unpaidErr) {
      console.error('[runMonthlyPayThru] Error loading unpaid paythru:', unpaidErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load unpaid paythru', details: unpaidErr }) };
    }

    const unpaidTrails = [];
    for (const row of (unpaidTrailsRaw || [])) {
      const exclusiveMonths = await getLedgerRowExclusiveMonths(row);
      if (isPayMonthAllowed(exclusiveMonths, payDate)) {
        unpaidTrails.push(row);
      }
    }

    if (!unpaidTrails || unpaidTrails.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No unpaid paythru rows to consider for $100 threshold (all caught up).',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_rows_created: newLedgerRows.length,
          agents_paid: 0,
        }),
      };
    }

    const agentTotals = {};
    const agentRowIds = {};

    for (const row of unpaidTrails) {
      const aid = row.agent_id;
      const amt = Number(row.amount || 0);
      if (!agentTotals[aid]) {
        agentTotals[aid] = 0;
        agentRowIds[aid] = [];
      }
      agentTotals[aid] += amt;
      agentRowIds[aid].push(row.id);
    }

    const threshold = 100;
    const basePayableAgents = [];

    for (const [aid, sum] of Object.entries(agentTotals)) {
      if (sum >= threshold) {
        basePayableAgents.push({ agent_id: aid, gross_monthly_trail: Number(sum.toFixed(2)) });
      }
    }

    if (basePayableAgents.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Paythru accrued, but no agent reached the $100 minimum yet.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_rows_created: newLedgerRows.length,
          agents_paid: 0,
        }),
      };
    }

    const payableAgentIds = basePayableAgents.map(a => a.agent_id);

    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, other_debt_total, total_debt')
      .in('agent_id', payableAgentIds);

    if (debtErr) {
      console.error('[runMonthlyPayThru] Error loading agent_total_debt:', debtErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agent_total_debt', details: debtErr }) };
    }

    const debtMap = new Map();
    (debtRows || []).forEach(r => {
      debtMap.set(r.agent_id, {
        lead: Number(r.lead_debt_total || 0),
        chargeback: Number(r.chargeback_total || 0),
        other: Number(r.other_debt_total || 0),
        total: Number(r.total_debt || 0),
      });
    });

    const { data: activeRows, error: activeErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .in('id', payableAgentIds);

    if (activeErr) {
      console.error('[runMonthlyPayThru] Error loading agents.is_active:', activeErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load agent active flags', details: activeErr }) };
    }

    const activeMap = new Map();
    (activeRows || []).forEach(a => activeMap.set(a.id, a.is_active !== false));

    const finalPayouts = [];
    let batchTotalGross = 0;
    let batchTotalDebits = 0;

    for (const pa of basePayableAgents) {
      const agent_id = pa.agent_id;
      const gross    = Number(pa.gross_monthly_trail.toFixed(2));
      batchTotalGross += gross;

      const debtInfo = debtMap.get(agent_id) || { lead: 0, chargeback: 0, other: 0, total: 0 };
      const totalDebt = debtInfo.total;
      const isActive  = activeMap.has(agent_id) ? activeMap.get(agent_id) : true;

      let leadRepay = 0;
      let chargebackRepay = 0;
      let otherRepay = 0;
      let net = gross;
      
      if (gross > 0 && totalDebt > 0) {
        const rate     = getRepaymentRate(totalDebt, isActive);
        const maxRepay = Number((gross * rate).toFixed(2));
        const toRepay  = Math.min(maxRepay, totalDebt);
      
        let remaining = toRepay;
      
        if (debtInfo.chargeback > 0 && remaining > 0) {
          chargebackRepay = Math.min(remaining, debtInfo.chargeback);
          remaining -= chargebackRepay;
        }
      
        if (debtInfo.lead > 0 && remaining > 0) {
          leadRepay = Math.min(remaining, debtInfo.lead);
          remaining -= leadRepay;
        }
      
        if ((debtInfo.other || 0) > 0 && remaining > 0) {
          otherRepay = Math.min(remaining, debtInfo.other);
          remaining -= otherRepay;
        }
      
        const actualRepay = chargebackRepay + leadRepay + otherRepay;
        net = Number((gross - actualRepay).toFixed(2));
        batchTotalDebits += actualRepay;
      }
      
      finalPayouts.push({
        agent_id,
        gross_monthly_trail: gross,
        net_payout: net,
        lead_repayment: Number(leadRepay.toFixed(2)),
        chargeback_repayment: Number(chargebackRepay.toFixed(2)),
        other_repayment: Number(otherRepay.toFixed(2)),
      });
    }

    batchTotalGross  = Number(batchTotalGross.toFixed(2));
    batchTotalDebits = Number(batchTotalDebits.toFixed(2));
    const batchTotalNet = Number((batchTotalGross - batchTotalDebits).toFixed(2));

    const { data: batchRows, error: batchErr } = await supabase
      .from('payout_batches')
      .insert({
        pay_date: payDateStr,
        batch_type: 'paythru',
        status: 'pending',
        total_gross: batchTotalGross,
        total_debits: batchTotalDebits,
        total_net: batchTotalNet,
        note: `Monthly pay-thru run for ${payMonthKey} (threshold $${threshold}, debt tiers 30/40/50)`,
      })
      .select('*');

    if (batchErr) {
      console.error('[runMonthlyPayThru] Error creating payout batch:', batchErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create payout batch', details: batchErr }) };
    }

    const batch = batchRows && batchRows[0];

    const idsToSettle = [];
    for (const pa of basePayableAgents) {
      const rowsForAgent = agentRowIds[pa.agent_id] || [];
      rowsForAgent.forEach(id => idsToSettle.push(id));
    }

    const { error: updErr } = await supabase
      .from('commission_ledger')
      .update({
        is_settled: true,
        payout_batch_id: batch.id,
        period_start: monthStartIso,
        period_end: monthEndIso,
      })
      .in('id', idsToSettle);

    if (updErr) {
      console.error('[runMonthlyPayThru] Error settling paythru rows:', updErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to mark paythru rows settled', details: updErr }) };
    }

    for (const fp of finalPayouts) {
      const cbRepay = fp.chargeback_repayment || 0;
      const ldRepay = fp.lead_repayment || 0;
      const odRepay = fp.other_repayment || 0;
    
      if (cbRepay > 0 || ldRepay > 0 || odRepay > 0) {
        await applyRepayments(fp.agent_id, cbRepay, ldRepay, odRepay, batch.id);
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          message: 'Monthly pay-thru run completed.',
          pay_date: payDateStr,
          pay_month: payMonthKey,
          new_rows_created: newLedgerRows.length,
          batch_id: batch.id,
          agents_paid: finalPayouts.length,
          total_gross: batchTotalGross,
          total_debits: batchTotalDebits,
          total_net: batchTotalNet,
          agent_payouts: finalPayouts,
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error('[runMonthlyPayThru] Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unexpected error', details: String(err) }) };
  }
}
