// netlify/functions/submitAgentQuote.js
// Agent-page version of submitQuote:
// - ALWAYS routes to forcedAgentId (agent UUID from slug page)
// - NO hierarchy checks
// - Still enforces "licensed for this state" based on agent_nipr_licenses
// - Keeps your spam hardening + contact upsert + lead insert + lead_debts split

import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

const VER = "submitAgentQuote_2026-03-04a";

function safeJsonParse(str) {
  try { return JSON.parse(str || "{}"); } catch { return {}; }
}
function norm(s) { return (s || "").toString().trim().toLowerCase(); }
function digits10(s) { return (s || "").toString().replace(/\D/g, "").slice(-10); }

function looksLikeGibberish(s) {
  const x = (s || "").toString().trim();
  if (!x) return true;
  if (x.length < 2) return true;

  const alnum = (x.match(/[a-z0-9]/gi) || []).length;
  const junk  = (x.match(/[^a-z0-9\s]/gi) || []).length;
  if (alnum > 0 && (junk / Math.max(1, alnum)) > 0.35) return true;

  const tokens = x.split(/\s+/).filter(Boolean);
  const longestToken = tokens.length ? Math.max(...tokens.map(t => t.length)) : x.length;
  if (longestToken >= 30) return true;

  if (/^(.)\1{8,}$/i.test(x.replace(/\s+/g, ""))) return true;

  return false;
}

function getClientIp(event) {
  const h = event.headers || {};
  const ip =
    h["x-nf-client-connection-ip"] ||
    h["x-forwarded-for"] ||
    h["client-ip"] ||
    "";
  return String(ip).split(",")[0].trim().slice(0, 64) || "unknown";
}

function makeCallToken(secret, payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyBasicEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

function noneFit(headers, dbg) {
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: false, reason: "none_fit", ver: VER, dbg }),
  };
}

async function createTaskForNewLead({ supabase, contactId, leadId, agentId, contactInfo, productType, sourceSlug }) {
  const now = new Date();
  const due = new Date(now.getTime() + 10 * 60 * 1000); // due in 10 minutes

  const title =
    `New Agent Page Lead: ${productType || "Lead"} — ${String(contactInfo?.first_name || "").trim()} ${String(contactInfo?.last_name || "").trim()}`.trim();

  const payload = {
    contact_id: contactId,
    lead_id: leadId,
    assigned_to: agentId,
    title,
    scheduled_at: now.toISOString(),
    due_at: due.toISOString(),
    status: "open",
    channel: "call",
    metadata: {
      source: "agent_page",
      agent_slug: sourceSlug || null,
      product_type: productType || null,
      phone: contactInfo?.phone || null,
      email: contactInfo?.email || null,
      zip: contactInfo?.zip || null,
      city: contactInfo?.city || null,
      state: contactInfo?.state || null,
    },
    push_sent: false,
  };

  const { data: task, error } = await supabase
    .from("tasks")
    .insert(payload)
    .select("id, assigned_to")
    .single();

  if (error) throw new Error(error.message || "Failed to create task");
  return task;
}

// Calls another Netlify function that actually sends push
async function triggerPushForTask({ taskId, userId }) {
  try {
    const base =
      process.env.DEPLOY_PRIME_URL ||
      process.env.URL ||
      "http://localhost:8888";

    const resp = await fetch(`${base}/.netlify/functions/pushTask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, userId }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Method Not Allowed" }),
      };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing Supabase env vars" }),
      };
    }

    const CALL_TOKEN_SECRET = process.env.CALL_TOKEN_SECRET || "";
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = safeJsonParse(event.body);

    const {
      requiredLines,
      state,
      selections,
      productTypes,
      perTypeNotes,
      contactInfo,
      submittedBy,
      submittedByName,

      // agent page routing
      forcedAgentId, // ✅ REQUIRED: UUID of the agent to assign to

      // spam-hardening extras
      company_website,
      elapsed_ms,
    } = body;

    const totalDebtCharge = 0; // ✅ agent page should be free leads by default
    // --- Required forced agent ---
    if (!forcedAgentId) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing forcedAgentId" }) };
    }

    // --- Basic validation ---
    if (!state || !/^[A-Za-z]{2}$/.test(String(state))) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing/invalid state" }) };
    }
    if (!Array.isArray(requiredLines) || requiredLines.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing requiredLines" }) };
    }
    if (!Array.isArray(productTypes) || productTypes.length === 0) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing productTypes" }) };
    }

    const fn = String(contactInfo?.first_name || "").trim();
    const ln = String(contactInfo?.last_name || "").trim();
    const email = String(contactInfo?.email || "").trim();
    const phone = String(contactInfo?.phone || "").trim();

    if (!contactInfo || !fn || !ln) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing contactInfo.name" }) };
    }
    if (!submittedBy) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing submittedBy" }) };
    }

    // --- Spam hardening ---
    const hp = String(company_website || "").trim();
    const elapsed = Number(elapsed_ms || 0);

    const suspiciousTiming = elapsed > 0 && elapsed < 900;
    const honeypotHit = !!hp;

    const gibName = looksLikeGibberish(fn) || looksLikeGibberish(ln);
    const badEmail = email && !verifyBasicEmail(email);

    const HARDENING_ACTIVE = true;

    if (HARDENING_ACTIVE && ((suspiciousTiming && (gibName || badEmail)) || (gibName && badEmail))) {
      const dbg = { why: "hardening", honeypotHit, suspiciousTiming, gibName, badEmail, elapsed, hpLen: hp.length };
      return noneFit(corsHeaders, dbg);
    }

    // --- Rate limiting (same vibe as your original) ---
    const ip = getClientIp(event);
    const ten = digits10(phone);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    if (ten || email) {
      const { data: recentContacts, error } = await supabase
        .from("contacts")
        .select("id, created_at, phones, emails")
        .gte("created_at", since24h)
        .limit(300);

      if (!error && Array.isArray(recentContacts)) {
        const hits = recentContacts.filter(c => {
          const ph = Array.isArray(c.phones) ? c.phones : [];
          const em = Array.isArray(c.emails) ? c.emails : [];
          const phoneHit = ten ? ph.map(digits10).includes(ten) : false;
          const emailHit = email ? em.map(norm).includes(norm(email)) : false;
          return phoneHit || emailHit;
        }).length;

        // allow normal resubmits; stop obvious floods
        if (hits >= 400) {
          const dbg = { why: "rate_limit_contacts", hits, ip, ten, email: email ? norm(email) : null };
          return noneFit(corsHeaders, dbg);
        }
      }
    }

    // -------------------------
    // Core shared helpers (copied from your submitQuote logic)
    // -------------------------
    const CONSENT_TEXT_VERSION = "fvg_freequote_tcpav1_2025-12-20";
    const stateUp = String(state || "").toUpperCase();

    const lineTokenMap = {
      life: "Life",
      health: "Accident & Health",
      property: "Property",
      casualty: "Casualty",
    };

    // Normalize lines (ONLY these 4)
    const normalizeLine = (x) => {
      const v = String(x || "").toLowerCase().trim();
      if (v === "life" || v === "health" || v === "property" || v === "casualty") return v;
      return null;
    };

    const neededLines = Array.from(new Set((requiredLines || []).map(normalizeLine).filter(Boolean)));
    if (!neededLines.length) neededLines.push("life");

    async function upsertContact(ci) {
      const e164 = ci.phone ? String(ci.phone).trim() : null;
      const tenFromE164 = (e164 || "").replace(/\D/g, "").slice(-10);
      const emailClean = (ci.email || "").trim();
      const emailArr = emailClean ? [emailClean] : [];

      if (!e164 && !tenFromE164 && emailArr.length === 0) {
        throw new Error("Provide at least one phone or email.");
      }

      let existing = null;

      if (e164) {
        const r1 = await supabase.from("contacts")
          .select("id, phones, emails, zip, city, state, lat, lng, notes")
          .contains("phones", [e164]).maybeSingle();
        if (r1.data) existing = r1.data;
      }
      if (!existing && tenFromE164) {
        const r2 = await supabase.from("contacts")
          .select("id, phones, emails, zip, city, state, lat, lng, notes")
          .contains("phones", [tenFromE164]).maybeSingle();
        if (r2.data) existing = r2.data;
      }
      if (!existing && emailArr.length) {
        const r3 = await supabase.from("contacts")
          .select("id, phones, emails, zip, city, state, lat, lng, notes")
          .contains("emails", [emailArr[0]]).maybeSingle();
        if (r3.data) existing = r3.data;
      }

      const phonesArr =
        (e164 && tenFromE164 && tenFromE164 !== e164)
          ? [e164, tenFromE164]
          : (e164 ? [e164] : (tenFromE164 ? [tenFromE164] : []));

      let contactId;

      if (existing) {
        const mergedPhones = Array.from(new Set([...(existing.phones || []), ...phonesArr].filter(Boolean)));
        const mergedEmails = Array.from(new Set([...(existing.emails || []), ...emailArr].filter(Boolean)));
        const newZip = ci.zip || existing.zip || null;
        const newNotes = ci.notes
          ? (existing.notes ? `${existing.notes} || ${ci.notes}` : ci.notes)
          : (existing.notes || null);

        const updatePayload = {
          phones: mergedPhones,
          emails: mergedEmails,
          zip: newZip,
          city: ci.city ?? existing.city ?? null,
          state: ci.state ?? existing.state ?? null,
          lat: ci.lat ?? existing.lat ?? null,
          lng: ci.lng ?? existing.lng ?? null,

          tcpaconsent: true,
          consent_source: "agent_page",
          consent_at: new Date().toISOString(),
          consent_text_version: CONSENT_TEXT_VERSION,

          notes: newNotes,
          needs_dnc_check: false,
        };

        if (ci.first_name?.trim()) updatePayload.first_name = ci.first_name.trim();
        if (ci.last_name?.trim()) updatePayload.last_name = ci.last_name.trim();

        const { data: updated, error: uerr } = await supabase
          .from("contacts")
          .update(updatePayload)
          .eq("id", existing.id)
          .select("id")
          .single();
        if (uerr) throw new Error(uerr.message);
        contactId = updated.id;
      } else {
        const { data: inserted, error: ierr } = await supabase
          .from("contacts")
          .insert({
            first_name: ci.first_name,
            last_name: ci.last_name,
            phones: phonesArr,
            emails: emailArr,
            zip: ci.zip || null,
            city: ci.city || null,
            state: ci.state || null,
            lat: ci.lat ?? null,
            lng: ci.lng ?? null,
            contact_status: "new",

            tcpaconsent: true,
            consent_source: "agent_page",
            consent_at: new Date().toISOString(),
            consent_text_version: CONSENT_TEXT_VERSION,

            notes: ci.notes || null,
            needs_dnc_check: false,
          })
          .select("id")
          .single();
        if (ierr) throw new Error(ierr.message);
        contactId = inserted.id;
      }

      return { contactId };
    }

    async function findDuplicateLeadByNamePlusOne({ first_name, last_name, phoneArr, email, zip, product_type, windowDays = 90 }) {
      const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const nFirst = norm(first_name);
      const nLast = norm(last_name);

      const { data: candidates, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, zip, product_type, created_at, contacts:contact_id(emails, phones, zip)")
        .gte("created_at", sinceIso)
        .ilike("first_name", nFirst)
        .ilike("last_name", nLast)
        .limit(1000);

      if (error) throw new Error(error.message);

      const emailsArr = (email ? [email] : []).map(norm);
      const ourPhones = phoneArr || [];

      for (const c of (candidates || [])) {
        if (norm(c.first_name) !== nFirst || norm(c.last_name) !== nLast) continue;

        const candPhonesFromLead = Array.isArray(c.phone) ? c.phone : [];
        const candPhonesFromContact = Array.isArray(c.contacts?.phones) ? c.contacts.phones : [];
        const candEmails = Array.isArray(c.contacts?.emails) ? c.contacts.emails : [];
        const candZip = c.zip || c.contacts?.zip || null;

        const phoneMatch = (() => {
          const set1 = new Set((ourPhones || []).map(digits10).filter(Boolean));
          for (const p of [...candPhonesFromLead, ...candPhonesFromContact].map(digits10).filter(Boolean)) {
            if (set1.has(p)) return true;
          }
          return false;
        })();

        const emailMatch = emailsArr.length ? candEmails.map(norm).some(e => emailsArr.includes(e)) : false;
        const zipMatch = zip && candZip ? String(zip).trim() === String(candZip).trim() : false;

        if (
          (phoneMatch || emailMatch || zipMatch) &&
          (!product_type || !c.product_type || norm(product_type) === norm(c.product_type))
        ) {
          return c;
        }
      }
      return null;
    }

    async function insertLeadsAssigned({ contactId, ci, productTypesArr, perTypeNotesObj, submittedBy, submittedByName, pickedAgent }) {
      const e164 = ci.phone ? String(ci.phone).trim() : null;
      const tenFromE164 = (e164 || "").replace(/\D/g, "").slice(-10);
      const leadPhone = e164 ? [e164] : (tenFromE164 ? [tenFromE164] : []);
      const candidateEmail = ci.email?.trim() ? ci.email.trim() : null;

      const insertedOrExisting = [];

      for (const pt of productTypesArr) {
        const payload = {
          first_name: ci.first_name,
          last_name: ci.last_name,
          zip: ci.zip || null,
          city: ci.city || null,
          state: ci.state || null,
          lat: ci.lat ?? null,
          lng: ci.lng ?? null,
          age: ci.age ?? null,
          phone: leadPhone,
          email: candidateEmail ? [candidateEmail] : [],
          lead_type: "Agent Page",
          product_type: pt,
          contact_id: contactId,
          submitted_by: submittedBy,
          submitted_by_name: submittedByName || "Agent Page Lead",
          notes: (perTypeNotesObj?.[pt]) || ci.notes || null,
          assigned_to: pickedAgent.id,
          assigned_at: new Date().toISOString(),
          contacted_at: new Date().toISOString(),
        };

        const { data: one, error: insErr } = await supabase
          .from("leads")
          .insert([payload])
          .select("id, product_type, assigned_to")
          .single();
        if (insErr) throw new Error(insErr.message);

        insertedOrExisting.push({
          id: one.id,
          product_type: one.product_type,
          duplicate: false,
          assigned_to: one.assigned_to || pickedAgent.id,
        });
      }

      return insertedOrExisting;
    }

    async function createLeadDebtsForSubmission({ leads, total = 0, contactId, agentId }) {
      const t = Number(total) || 0;
      if (t <= 0) return; // ✅ free by default

      const billable = (leads || []).filter(l => !l.duplicate && l.id && l.assigned_to);
      if (!billable.length) return;

      const perLead = Number((t / billable.length).toFixed(2));

      const rows = billable.map(l => ({
        agent_id: l.assigned_to,
        lead_id: l.id,
        description: `Agent-page lead charge ($${t} per contact; split ${billable.length} ways)`,
        source: "agent_page",
        amount: perLead,
        status: "open",
        created_by: null,
        metadata: {
          contact_id: contactId,
          total_contact_charge: t,
          split_count: billable.length,
          forced_agent_id: agentId,
        },
      }));

      const { error } = await supabase.from("lead_debts").insert(rows);
      if (error) throw new Error(error.message || "Failed inserting lead_debts");
    }

    // -------------------------
    // 1) Verify forced agent is valid + receiving leads
    // -------------------------
    const { data: pickedAgent, error: aErr } = await supabase
      .from("agents")
      .select("id, agent_id, full_name, phone, is_active, is_available, receiving_leads")
      .eq("id", forcedAgentId)
      .maybeSingle();

    if (aErr || !pickedAgent?.id) {
      return noneFit(corsHeaders, { why: "forced_agent_not_found", forcedAgentId });
    }
    if (!pickedAgent.is_active || !pickedAgent.receiving_leads) {
      return noneFit(corsHeaders, { why: "forced_agent_not_receiving", forcedAgentId, is_active: !!pickedAgent.is_active, receiving_leads: !!pickedAgent.receiving_leads });
    }

    // -------------------------
    // 2) Enforce licensing for this state (NO hierarchy)
    // -------------------------
    const { data: niprRows, error: niprErr } = await supabase
      .from("agent_nipr_licenses")
      .select("agent_id, state, active, loa_names")
      .eq("state", stateUp);

    if (niprErr) throw new Error(niprErr.message);

    const byAgentKey = new Map();
    for (const row of (niprRows || [])) {
      if (!row?.active) continue;
      const key = row.agent_id;
      if (!key) continue;
      if (!byAgentKey.has(key)) byAgentKey.set(key, []);
      byAgentKey.get(key).push(row);
    }

    function rowMatchesToken(row, token) {
      if (!Array.isArray(row.loa_names)) return false;
      const lowerToken = token.toLowerCase();
      return row.loa_names.some(name => (name || "").toString().toLowerCase().includes(lowerToken));
    }

    function agentKeyHasToken(agentKey, token) {
      const rows = byAgentKey.get(agentKey) || [];
      if (!rows.length) return false;
      return rows.some(r => rowMatchesToken(r, token));
    }

    const tokens = neededLines.map(l => lineTokenMap[l]).filter(Boolean);
    const agentKey = pickedAgent.agent_id;

    if (!agentKey) {
      return noneFit(corsHeaders, { why: "forced_agent_missing_agent_key", forcedAgentId });
    }

    const licensedOk = tokens.every(t => agentKeyHasToken(agentKey, t));
    if (!licensedOk) {
      return noneFit(corsHeaders, { why: "forced_agent_not_licensed", forcedAgentId, state: stateUp, neededLines, tokens });
    }

    // -------------------------
    // 3) Lift internal DNC on new consent
    // -------------------------
    const { error: liftErr } = await supabase.rpc("lift_internal_dnc_on_new_consent", {
      p_first_name: contactInfo.first_name,
      p_last_name:  contactInfo.last_name,
      p_phone:      contactInfo.phone || null,
      p_email:      contactInfo.email || null,
      p_actor_id:   submittedBy || null,
    });
    if (liftErr) throw new Error(`lift_internal_dnc_on_new_consent failed: ${liftErr.message}`);

    // -------------------------
    // 4) Upsert contact + assign owning agent
    // -------------------------
    const { contactId } = await upsertContact(contactInfo);

    await supabase.from("contacts").update({ owning_agent_id: pickedAgent.id }).eq("id", contactId);

    await supabase.from("person_agent_order").upsert(
      [{ person_id: contactId, agent_id: pickedAgent.id }],
      { onConflict: "person_id,agent_id" }
    );

    await supabase.from("person_line_agents").upsert(
      neededLines.map(line => ({
        person_id: contactId,
        line,
        agent_id: pickedAgent.id,
        assigned_at: new Date().toISOString(),
      })),
      { onConflict: "person_id,line" }
    );

    // -------------------------
    // 5) Insert leads (always assigned to forced agent)
    // -------------------------
    const leads = await insertLeadsAssigned({
      contactId,
      ci: contactInfo,
      productTypesArr: productTypes,
      perTypeNotesObj: perTypeNotes || {},
      submittedBy,
      submittedByName,
      pickedAgent,
    });

    // -------------------------
    // 6) Create a task + push notif for each created lead
    // -------------------------
    const createdLeads = (leads || []).filter(l => l?.id && !l.duplicate);
    
    const sourceSlug = String(body?.agent_slug || body?.sourceSlug || "").trim() || null; 
    // ^ optional; if you don't send it from client, it'll just be null.
    
    for (const l of createdLeads) {
      const task = await createTaskForNewLead({
        supabase,
        contactId,
        leadId: l.id,
        agentId: pickedAgent.id,
        contactInfo,
        productType: l.product_type,
        sourceSlug
      });
    
      // fire push immediately (best-effort)
      await triggerPushForTask({ taskId: task.id, userId: pickedAgent.id });
    }
    
    await createLeadDebtsForSubmission({
      leads,
      total: Number(totalDebtCharge) || 0,
      contactId,
      agentId: pickedAgent.id,
    });

    // bump last_assigned_at
    const nowIso = new Date().toISOString();
    await supabase.from("agents").update({ last_assigned_at: nowIso }).eq("id", pickedAgent.id);

    // pick lead for call (same approach, but always this agent)
    const pickLead = (() => {
      const prop = (leads || []).find(l => l.product_type === "Property Insurance" && l.id);
      if (prop) return prop;
      return (leads || []).find(l => l.id) || null;
    })();

    const pickLeadIdForCall = pickLead?.id || null;

    const choice = {
      reason: "forced_agent",
      shouldCall: !!pickedAgent.is_available,
      agent: {
        id: pickedAgent.id,
        full_name: pickedAgent.full_name || null,
        phone: pickedAgent.phone || null,
      },
    };

    let callToken = null;
    if (CALL_TOKEN_SECRET && choice.shouldCall && pickLeadIdForCall && choice.agent.id) {
      callToken = makeCallToken(CALL_TOKEN_SECRET, {
        leadId: pickLeadIdForCall,
        agentId: choice.agent.id,
        exp: Date.now() + (2 * 60 * 1000),
      });
    }

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        choice,
        contactId,
        leads,
        pickLeadIdForCall,
        pickedAgentId: pickedAgent.id,
        callToken,
        ver: VER,
      }),
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: e?.message || "Unknown error", ver: VER }),
    };
  }
};
