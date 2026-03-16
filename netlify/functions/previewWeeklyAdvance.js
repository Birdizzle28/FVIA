// netlify/functions/previewWeeklyAdvance.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.warn('[previewWeeklyAdvance] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
}

const supabase = createClient(supabaseUrl, serviceKey);

/* ================================
   MATCH runWeeklyAdvance WINDOW LOGIC
   America/Chicago (DST-safe enough)
   ================================ */
const PAY_TZ = 'America/Chicago';

/**
 * Helper: return YYYY-MM-DD in America/Chicago
 */
function getNextFridayYMD(fromYMD) {
  let cur = fromYMD;
  for (let i = 1; i <= 14; i++) {
    cur = addDaysYMD(cur, 1);
    const dow = getLocalDOW(new Date(`${cur}T12:00:00Z`), PAY_TZ);
    if (dow === 5) return cur;
  }
  return addDaysYMD(fromYMD, 7);
}

/**
 * MUST MATCH runWeeklyAdvance EXACTLY
 */
function computePayFridayForIssuedYMD(issuedYMD) {
  const dow = getLocalDOW(new Date(`${issuedYMD}T12:00:00Z`), PAY_TZ);

  const thisFriday = (dow === 5) ? issuedYMD : getNextFridayYMD(issuedYMD);

  if (dow <= 2) return addDaysYMD(thisFriday, 7);

  return addDaysYMD(thisFriday, 14);
}

function getLocalYMD(date = new Date(), tz = PAY_TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const y = parts.find(p => p.type === 'year')?.value;
  const m = parts.find(p => p.type === 'month')?.value;
  const d = parts.find(p => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/**
 * Helper: day-of-week number in America/Chicago (0=Sun .. 6=Sat)
 */
function getLocalDOW(date = new Date(), tz = PAY_TZ) {
  const dowStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  }).format(date);

  const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dowStr] ?? date.getDay();
}

/**
 * Add days to a YYYY-MM-DD string and return YYYY-MM-DD
 */
function addDaysYMD(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Get numeric offset like "-06:00" or "-05:00" for a given date
 */
function getOffsetForYMD(ymd, tz = PAY_TZ) {
  const probe = new Date(`${ymd}T12:00:00Z`);
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'shortOffset',
  }).format(probe);

  const match = s.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
  if (!match) return '-06:00';

  const signHours = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;

  const sign = signHours < 0 ? '-' : '+';
  const absH = String(Math.abs(signHours)).padStart(2, '0');
  const absM = String(Math.abs(mins)).padStart(2, '0');
  return `${sign}${absH}:${absM}`;
}

/**
 * Convert a local America/Chicago midnight into a UTC ISO string
 */
function localMidnightToUtcIso(ymd, tz = PAY_TZ) {
  const offset = getOffsetForYMD(ymd, tz);
  const local = new Date(`${ymd}T00:00:00${offset}`);
  return local.toISOString();
}

/**
 * Helper: get pay_date (Friday) as YYYY-MM-DD.
 */
function getPayDateStr(event) {
  const qs = event.queryStringParameters || {};
  if (qs.pay_date) {
    const d = new Date(`${qs.pay_date}T12:00:00Z`);
    if (!isNaN(d.getTime())) return qs.pay_date;
  }

  const now = new Date();
  const todayYMD = getLocalYMD(now, PAY_TZ);
  const dow = getLocalDOW(now, PAY_TZ);

  let diff = (5 - dow + 7) % 7;
  if (diff === 0) diff = 7;

  return addDaysYMD(todayYMD, diff);
}

/**
 * Repayment rate based on:
 * - totalDebt (lead + chargeback)
 * - isActive (agents.is_active)
 */
function getRepaymentRate(totalDebt, isActive) {
  if (!isActive) return 1.0;
  if (totalDebt <= 0) return 0;
  if (totalDebt < 1000) return 0.30;
  if (totalDebt < 2000) return 0.40;
  return 0.50;
}

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

function computePayFridayForIssuedYMDWithLag(issuedYMD, lagWeeks = 0) {
  const basePay = computePayFridayForIssuedYMD(issuedYMD);
  return addDaysYMD(basePay, lagWeeks * 7);
}

/**
 * Generic schedule matcher for either a base policy or an attachment.
 * Attachment matching also requires parent_policy_type.
 */
function getMatchingScheduleForItem(item, scheduleRows, options = {}) {
  if (!item || !item.issued_at) return null;

  const issuedYMD = getLocalYMD(new Date(item.issued_at), PAY_TZ);
  const carrier = normalizeText(item.carrier_name);
  const line = normalizeText(item.product_line);
  const type = normalizePolicyType(item.policy_type);
  const itemType = normalizeCommissionItemType(options.commission_item_type || 'policy');
  const parentPolicyType = normalizePolicyType(options.parent_policy_type);

  const matches = (scheduleRows || []).filter(s => {
    const sameItemType = normalizeCommissionItemType(s.commission_item_type) === itemType;
    const sameCarrier = normalizeText(s.carrier_name) === carrier;
    const sameLine = normalizeText(s.product_line) === line;
    const sameType = normalizePolicyType(s.policy_type) === type;

    const startsOk = !s.effective_from || s.effective_from <= issuedYMD;
    const endsOk = !s.effective_to || s.effective_to >= issuedYMD;

    if (!sameItemType || !sameCarrier || !sameLine || !sameType || !startsOk || !endsOk) {
      return false;
    }

    if (itemType === 'attachment') {
      const schedParentType = normalizePolicyType(s.parent_policy_type);
      return schedParentType === parentPolicyType;
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

function getLagWeeksForItem(item, scheduleRows, options = {}) {
  const sched = getMatchingScheduleForItem(item, scheduleRows, options);
  if (!sched) return 0;

  const lag = Number(sched.lag_time_weeks || 0);
  return Number.isFinite(lag) && lag > 0 ? lag : 0;
}

/**
 * Does this license row satisfy required LOAs at issue time?
 */
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

/**
 * Determine whether an agent is eligible for override on this item.
 */
function agentQualifiesForItem(agent, item, itemState, scheduleRows, licensesByExternalAgentId, options = {}) {
  if (!agent) return false;
  if (agent.is_active === false) return false;
  if (!item?.issued_at) return false;
  if (!itemState) return false;

  const externalAgentId = agent.agent_id;
  if (!externalAgentId) return false;

  const schedule = getMatchingScheduleForItem(item, scheduleRows, options);
  const requiredLoasRaw = Array.isArray(schedule?.required_loas) ? schedule.required_loas : [];
  const requiredLoas = requiredLoasRaw
    .map(normalizeLoaText)
    .filter(Boolean);

  if (!requiredLoas.length) return false;

  const issueYMD = getLocalYMD(new Date(item.issued_at), PAY_TZ);
  const licenseRows = licensesByExternalAgentId.get(externalAgentId) || [];

  return licenseRows.some(row =>
    licenseRowQualifiesForPolicy(row, itemState, requiredLoas, issueYMD)
  );
}

/**
 * Walk up the chain starting from the CURRENT override recipient.
 */
function findNearestEligibleUplineFromAgent(startAgentId, item, itemState, scheduleRows, agentsById, licensesByExternalAgentId, options = {}) {
  const visited = new Set();
  let currentId = startAgentId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const currentAgent = agentsById.get(currentId);
    if (!currentAgent) return null;

    if (agentQualifiesForItem(currentAgent, item, itemState, scheduleRows, licensesByExternalAgentId, options)) {
      return currentAgent.id;
    }

    currentId = currentAgent.recruiter_id || null;
  }

  return null;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Use POST and optionally ?pay_date=YYYY-MM-DD',
    };
  }

  try {
    const payDateStr = getPayDateStr(event);

    const startYMD = addDaysYMD(payDateStr, -21);
    const endYMD   = addDaysYMD(payDateStr, 1);

    const startIso = localMidnightToUtcIso(startYMD, PAY_TZ);
    const endIso   = localMidnightToUtcIso(endYMD, PAY_TZ);

    console.log(
      '[previewWeeklyAdvance] pay_date =',
      payDateStr,
      'ISSUED window =',
      startYMD,
      'to',
      endYMD,
      '(end exclusive)'
    );

    // Find parent policies in window
    const { data: policyRows, error: polErr } = await supabase
      .from('policies')
      .select('id, as_earned, issued_at, carrier_name, product_line, policy_type, agent_id, contact_id')
      .in('status', ['issued', 'in_force'])
      .gte('issued_at', startIso)
      .lt('issued_at', endIso);

    if (polErr) {
      console.error('[previewWeeklyAdvance] Error loading eligible policies:', polErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load eligible policies', details: polErr }),
      };
    }

    // Find active attachments in same issue window
    const { data: attachmentRowsRaw, error: attErr } = await supabase
      .from('policy_attachments')
      .select('id, policy_id, carrier_name, product_line, policy_type, issued_at, status')
      .eq('status', 'active')
      .gte('issued_at', startIso)
      .lt('issued_at', endIso);

    if (attErr) {
      console.error('[previewWeeklyAdvance] Error loading eligible attachments:', attErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load eligible attachments', details: attErr }),
      };
    }

    const policyRowsSafe = policyRows || [];
    const attachmentRows = attachmentRowsRaw || [];

    const carrierNames = [
      ...new Set([
        ...policyRowsSafe.map(p => p.carrier_name).filter(Boolean),
        ...attachmentRows.map(a => a.carrier_name).filter(Boolean),
      ]),
    ];

    let scheduleRows = [];
    if (carrierNames.length) {
      const { data: schedData, error: schedErr } = await supabase
        .from('commission_schedules')
        .select(
          'carrier_name, product_line, policy_type, commission_item_type, parent_policy_type, effective_from, effective_to, lag_time_weeks, required_loas'
        )
        .in('carrier_name', carrierNames);

      if (schedErr) {
        console.error('[previewWeeklyAdvance] Error loading commission schedules for lag lookup:', schedErr);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to load commission schedules', details: schedErr }),
        };
      }

      scheduleRows = schedData || [];
    }

    const allPolicyIds = policyRowsSafe.map(p => p.id);

    if (allPolicyIds.length === 0 && attachmentRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No policies or attachments eligible for weekly advance preview in this issued_at window.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: 0,
          eligible_attachment_count: 0,
          excluded_as_earned_policies: 0,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    const asEarnedCount = policyRowsSafe.filter(p => p.as_earned === true).length;

    const duePolicyRows = policyRowsSafe
      .filter(p => p.as_earned !== true)
      .filter(p => {
        if (!p.issued_at) return false;

        const issuedYMD = getLocalYMD(new Date(p.issued_at), PAY_TZ);
        const lagWeeks = getLagWeeksForItem(p, scheduleRows, {
          commission_item_type: 'policy',
          parent_policy_type: null,
        });
        const computedPay = computePayFridayForIssuedYMDWithLag(issuedYMD, lagWeeks);
        return computedPay === payDateStr;
      });

    // Need parent policy type for attachment schedule matching
    const parentPolicyIdsForAttachments = [...new Set(attachmentRows.map(a => a.policy_id).filter(Boolean))];
    const missingParentPolicyIds = parentPolicyIdsForAttachments.filter(id => !policyRowsSafe.some(p => p.id === id));

    let parentPoliciesOutsideWindow = [];
    if (missingParentPolicyIds.length) {
      const { data: parentData, error: parentErr } = await supabase
        .from('policies')
        .select('id, as_earned, issued_at, carrier_name, product_line, policy_type, agent_id, contact_id')
        .in('id', missingParentPolicyIds);

      if (parentErr) {
        console.error('[previewWeeklyAdvance] Error loading parent policies for attachments:', parentErr);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to load parent policies for attachments', details: parentErr }),
        };
      }

      parentPoliciesOutsideWindow = parentData || [];
    }

    const allKnownPolicies = [...policyRowsSafe, ...parentPoliciesOutsideWindow];
    const policyMapAll = new Map(allKnownPolicies.map(p => [p.id, p]));

    const dueAttachmentRows = attachmentRows.filter(att => {
      if (!att.issued_at) return false;

      const parentPolicy = policyMapAll.get(att.policy_id);
      if (!parentPolicy?.policy_type) return false;

      const issuedYMD = getLocalYMD(new Date(att.issued_at), PAY_TZ);
      const lagWeeks = getLagWeeksForItem(att, scheduleRows, {
        commission_item_type: 'attachment',
        parent_policy_type: parentPolicy.policy_type,
      });
      const computedPay = computePayFridayForIssuedYMDWithLag(issuedYMD, lagWeeks);

      return computedPay === payDateStr;
    });

    const eligiblePolicyIds = duePolicyRows.map(p => p.id);
    const eligibleAttachmentIds = dueAttachmentRows.map(a => a.id);

    console.log(
      '[previewWeeklyAdvance] scanned policies in window =',
      policyRowsSafe.length,
      'scanned attachments in window =',
      attachmentRows.length,
      'as-earned excluded =',
      asEarnedCount,
      'due policies this pay_date =',
      eligiblePolicyIds.length,
      'due attachments this pay_date =',
      eligibleAttachmentIds.length,
      'schedules loaded =',
      scheduleRows.length
    );

    if (eligiblePolicyIds.length === 0 && eligibleAttachmentIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No non-as-earned policies or active attachments are due to be paid on this pay_date based on the Sun–Tue / Wed–Sat rule.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          excluded_as_earned_policies: asEarnedCount,
          due_policies_for_pay_date: 0,
          due_attachments_for_pay_date: 0,
          scanned_policies_in_window: policyRowsSafe.length,
          scanned_attachments_in_window: attachmentRows.length,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    // Load ledger rows for due base policies only
    let policyLedgerRows = [];
    if (eligiblePolicyIds.length) {
      const { data, error } = await supabase
        .from('commission_ledger')
        .select('id, policy_id, policy_attachment_id, agent_id, amount, entry_type, is_settled')
        .in('entry_type', ['advance', 'override'])
        .or('is_settled.is.null,is_settled.eq.false')
        .in('policy_id', eligiblePolicyIds)
        .is('policy_attachment_id', null);

      if (error) {
        console.error('[previewWeeklyAdvance] Error loading policy ledger rows:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to load policy ledger rows', details: error }),
        };
      }

      policyLedgerRows = data || [];
    }

    // Load ledger rows for due attachments
    let attachmentLedgerRows = [];
    if (eligibleAttachmentIds.length) {
      const { data, error } = await supabase
        .from('commission_ledger')
        .select('id, policy_id, policy_attachment_id, agent_id, amount, entry_type, is_settled')
        .in('entry_type', ['advance', 'override'])
        .or('is_settled.is.null,is_settled.eq.false')
        .in('policy_attachment_id', eligibleAttachmentIds);

      if (error) {
        console.error('[previewWeeklyAdvance] Error loading attachment ledger rows:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: 'Failed to load attachment ledger rows', details: error }),
        };
      }

      attachmentLedgerRows = data || [];
    }

    let ledgerRows = [...policyLedgerRows, ...attachmentLedgerRows];

    console.log(
      '[previewWeeklyAdvance] eligible ledger rows =',
      ledgerRows.length,
      'policy rows =',
      policyLedgerRows.length,
      'attachment rows =',
      attachmentLedgerRows.length
    );

    if (ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No eligible commission_ledger rows to preview for this advance run (issued_at-based).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: eligiblePolicyIds.length,
          eligible_attachment_count: eligibleAttachmentIds.length,
          excluded_as_earned_policies: asEarnedCount,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    // =========================
    // Override license / state / active validation (preview only)
    // =========================

    const duePolicyMap = new Map(duePolicyRows.map(p => [p.id, p]));
    const dueAttachmentMap = new Map(dueAttachmentRows.map(a => [a.id, a]));

    const contactIds = [...new Set(
      allKnownPolicies.map(p => p.contact_id).filter(Boolean)
    )];

    let contactStateMap = new Map();

    if (contactIds.length) {
      const { data: contactRows, error: contactErr } = await supabase
        .from('contacts')
        .select('id, state')
        .in('id', contactIds);

      if (contactErr) {
        console.error('[previewWeeklyAdvance] Error loading contact states for override validation:', contactErr);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: 'Failed to load contact states for override validation',
            details: contactErr
          }),
        };
      }

      contactStateMap = new Map((contactRows || []).map(c => [c.id, normalizeState(c.state)]));
    }

    const { data: allAgentRows, error: allAgentErr } = await supabase
      .from('agents')
      .select('id, agent_id, recruiter_id, is_active');

    if (allAgentErr) {
      console.error('[previewWeeklyAdvance] Error loading agents for override validation:', allAgentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Failed to load agents for override validation',
          details: allAgentErr
        }),
      };
    }

    const agentsById = new Map((allAgentRows || []).map(a => [a.id, a]));
    const externalAgentIds = [...new Set((allAgentRows || []).map(a => a.agent_id).filter(Boolean))];

    let licensesByExternalAgentId = new Map();
    if (externalAgentIds.length) {
      const { data: licenseRows, error: licenseErr } = await supabase
        .from('agent_nipr_licenses')
        .select('agent_id, state, active, date_issue_orig, date_expire, loa_names')
        .eq('active', true)
        .in('agent_id', externalAgentIds);

      if (licenseErr) {
        console.error('[previewWeeklyAdvance] Error loading licenses for override validation:', licenseErr);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: 'Failed to load licenses for override validation',
            details: licenseErr
          }),
        };
      }

      licensesByExternalAgentId = new Map();
      for (const row of (licenseRows || [])) {
        const key = row.agent_id;
        if (!licensesByExternalAgentId.has(key)) licensesByExternalAgentId.set(key, []);
        licensesByExternalAgentId.get(key).push(row);
      }
    }

    const payableLedgerRows = [];
    const skippedOverrideRows = [];
    const reroutedOverrideRows = [];

    for (const row of ledgerRows) {
      if (row.entry_type !== 'override') {
        payableLedgerRows.push(row);
        continue;
      }

      const isAttachment = !!row.policy_attachment_id;

      let item = null;
      let itemOptions = { commission_item_type: 'policy', parent_policy_type: null };
      let parentPolicy = null;

      if (isAttachment) {
        const attachment = dueAttachmentMap.get(row.policy_attachment_id);
        if (!attachment) {
          skippedOverrideRows.push({
            ledger_id: row.id,
            policy_id: row.policy_id,
            policy_attachment_id: row.policy_attachment_id,
            reason: 'missing_attachment_context'
          });
          continue;
        }

        parentPolicy = policyMapAll.get(attachment.policy_id);
        if (!parentPolicy) {
          skippedOverrideRows.push({
            ledger_id: row.id,
            policy_id: row.policy_id,
            policy_attachment_id: row.policy_attachment_id,
            reason: 'missing_parent_policy_context'
          });
          continue;
        }

        item = attachment;
        itemOptions = {
          commission_item_type: 'attachment',
          parent_policy_type: parentPolicy.policy_type,
        };
      } else {
        const policy = duePolicyMap.get(row.policy_id);
        if (!policy) {
          skippedOverrideRows.push({
            ledger_id: row.id,
            policy_id: row.policy_id,
            reason: 'missing_policy_context'
          });
          continue;
        }

        parentPolicy = policy;
        item = policy;
        itemOptions = {
          commission_item_type: 'policy',
          parent_policy_type: null,
        };
      }

      const matchingSchedule = getMatchingScheduleForItem(item, scheduleRows, itemOptions);
      const requiredLoas = Array.isArray(matchingSchedule?.required_loas)
        ? matchingSchedule.required_loas.filter(Boolean)
        : [];

      if (!matchingSchedule || !requiredLoas.length) {
        skippedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          policy_attachment_id: row.policy_attachment_id || null,
          original_agent_id: row.agent_id,
          commission_item_type: itemOptions.commission_item_type,
          parent_policy_type: itemOptions.parent_policy_type,
          reason: 'missing_schedule_or_required_loas'
        });
        continue;
      }

      const itemState = contactStateMap.get(parentPolicy.contact_id);
      if (!itemState) {
        skippedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          policy_attachment_id: row.policy_attachment_id || null,
          commission_item_type: itemOptions.commission_item_type,
          reason: 'missing_policy_state'
        });
        continue;
      }

      const resolvedAgentId = findNearestEligibleUplineFromAgent(
        row.agent_id,
        item,
        itemState,
        scheduleRows,
        agentsById,
        licensesByExternalAgentId,
        itemOptions
      );

      if (!resolvedAgentId) {
        skippedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          policy_attachment_id: row.policy_attachment_id || null,
          original_agent_id: row.agent_id,
          required_loas: requiredLoas,
          commission_item_type: itemOptions.commission_item_type,
          parent_policy_type: itemOptions.parent_policy_type,
          reason: 'no_eligible_upline_found'
        });
        continue;
      }

      if (resolvedAgentId !== row.agent_id) {
        reroutedOverrideRows.push({
          ledger_id: row.id,
          policy_id: row.policy_id,
          policy_attachment_id: row.policy_attachment_id || null,
          from_agent_id: row.agent_id,
          to_agent_id: resolvedAgentId,
          required_loas: requiredLoas,
          commission_item_type: itemOptions.commission_item_type,
          parent_policy_type: itemOptions.parent_policy_type
        });

        row.agent_id = resolvedAgentId;
      }

      payableLedgerRows.push(row);
    }

    ledgerRows = payableLedgerRows;

    console.log(
      '[previewWeeklyAdvance] override validation complete:',
      'rerouted =', reroutedOverrideRows.length,
      'skipped =', skippedOverrideRows.length,
      'payable rows =', ledgerRows.length
    );

    if (ledgerRows.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No payable commission_ledger rows remained after override license validation.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: eligiblePolicyIds.length,
          eligible_attachment_count: eligibleAttachmentIds.length,
          excluded_as_earned_policies: asEarnedCount,
          skipped_override_rows: skippedOverrideRows,
          rerouted_override_rows: reroutedOverrideRows,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: 0,
        }),
      };
    }

    // Group by agent_id → gross per agent
    const agentTotals = {};

    for (const row of ledgerRows) {
      const aid = row.agent_id;
      if (!agentTotals[aid]) agentTotals[aid] = { advance: 0, override: 0, gross: 0 };

      const amt = Number(row.amount || 0);
      if (row.entry_type === 'advance') agentTotals[aid].advance += amt;
      else if (row.entry_type === 'override') agentTotals[aid].override += amt;

      agentTotals[aid].gross += amt;
    }

    const agentIds = Object.keys(agentTotals);
    if (agentIds.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'No agents with eligible rows for this advance preview (after grouping).',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          eligible_policy_count: eligiblePolicyIds.length,
          eligible_attachment_count: eligibleAttachmentIds.length,
          excluded_as_earned_policies: asEarnedCount,
          agent_payouts: [],
          total_gross: 0,
          total_debits: 0,
          total_net: 0,
          ledger_row_count: ledgerRows.length,
          skipped_override_rows: skippedOverrideRows,
          rerouted_override_rows: reroutedOverrideRows,
        }),
      };
    }

    // Load each agent's current debt (lead + chargeback)
    const { data: debtRows, error: debtErr } = await supabase
      .from('agent_total_debt')
      .select('agent_id, lead_debt_total, chargeback_total, total_debt')
      .in('agent_id', agentIds);

    if (debtErr) {
      console.error('[previewWeeklyAdvance] Error loading agent_total_debt:', debtErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent_total_debt', details: debtErr }),
      };
    }

    const debtMap = new Map();
    (debtRows || []).forEach(r => {
      debtMap.set(r.agent_id, {
        lead: Number(r.lead_debt_total || 0),
        chargeback: Number(r.chargeback_total || 0),
        total: Number(r.total_debt || 0),
      });
    });

    // Load agent is_active flags
    const { data: agentRows, error: agentErr } = await supabase
      .from('agents')
      .select('id, is_active')
      .in('id', agentIds);

    if (agentErr) {
      console.error('[previewWeeklyAdvance] Error loading agents.is_active:', agentErr);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to load agent active flags', details: agentErr }),
      };
    }

    const activeMap = new Map();
    (agentRows || []).forEach(a => {
      activeMap.set(a.id, a.is_active !== false);
    });

    // Build payout summary with tiered repayment
    const payoutSummary = [];
    let totalGross = 0;
    let totalDebits = 0;

    for (const [agent_id, t] of Object.entries(agentTotals)) {
      const gross = Number(t.gross.toFixed(2));
      totalGross += gross;

      const debtInfo = debtMap.get(agent_id) || { lead: 0, chargeback: 0, total: 0 };
      const totalDebt = debtInfo.total;
      const isActive = activeMap.has(agent_id) ? activeMap.get(agent_id) : true;

      let leadRepay = 0;
      let chargebackRepay = 0;
      let net = gross;

      if (gross > 0 && totalDebt > 0) {
        const rate = getRepaymentRate(totalDebt, isActive);
        const maxRepay = Number((gross * rate).toFixed(2));
        const toRepay = Math.min(maxRepay, totalDebt);

        let remaining = toRepay;

        if (debtInfo.chargeback > 0 && remaining > 0) {
          chargebackRepay = Math.min(remaining, debtInfo.chargeback);
          remaining -= chargebackRepay;
        }

        if (debtInfo.lead > 0 && remaining > 0) {
          leadRepay = Math.min(remaining, debtInfo.lead);
          remaining -= leadRepay;
        }

        const actualRepay = chargebackRepay + leadRepay;
        net = Number((gross - actualRepay).toFixed(2));
        totalDebits += actualRepay;
      }

      payoutSummary.push({
        agent_id,
        advance_gross: Number(t.advance.toFixed(2)),
        override_gross: Number(t.override.toFixed(2)),
        gross_payout: gross,
        net_payout: net,
        lead_repayment: Number(leadRepay.toFixed(2)),
        chargeback_repayment: Number(chargebackRepay.toFixed(2)),
      });
    }

    totalGross = Number(totalGross.toFixed(2));
    totalDebits = Number(totalDebits.toFixed(2));
    const totalNet = Number((totalGross - totalDebits).toFixed(2));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          message: 'Weekly advance PREVIEW (issued_at-window; no DB changes performed) with policy + attachment support.',
          pay_date: payDateStr,
          window_start: startIso,
          window_end_exclusive: endIso,
          total_gross: totalGross,
          total_debits: totalDebits,
          total_net: totalNet,
          agent_payouts: payoutSummary,
          ledger_row_count: ledgerRows.length,
          eligible_policy_count: eligiblePolicyIds.length,
          eligible_attachment_count: eligibleAttachmentIds.length,
          excluded_as_earned_policies: asEarnedCount,
          skipped_override_rows: skippedOverrideRows,
          rerouted_override_rows: reroutedOverrideRows,
        },
        null,
        2
      ),
    };
  } catch (err) {
    console.error('[previewWeeklyAdvance] Unexpected error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Unexpected error', details: String(err) }),
    };
  }
}
