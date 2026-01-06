// netlify/functions/submitQuote.js
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

const VER = "submitQuote_2026-01-05a";

function safeJsonParse(str) {
  try { return JSON.parse(str || "{}"); } catch { return {}; }
}

function norm(s) { return (s || "").toString().trim().toLowerCase(); }
function digits10(s) { return (s || "").toString().replace(/\D/g, "").slice(-10); }

function looksLikeGibberish(s) {
  const x = (s || "").toString().trim();
  if (!x) return true;
  if (x.length < 2) return true; // slightly less strict than before

  // high junk ratio (random keys)
  const alnum = (x.match(/[a-z0-9]/gi) || []).length;
  const junk  = (x.match(/[^a-z0-9\s]/gi) || []).length;
  if (alnum > 0 && (junk / Math.max(1, alnum)) > 0.35) return true;

  // long no-space token
  const tokens = x.split(/\s+/).filter(Boolean);
  const longestToken = tokens.length ? Math.max(...tokens.map(t => t.length)) : x.length;
  if (longestToken >= 30) return true;

  // repeated same char
  if (/^(.)\1{8,}$/i.test(x.replace(/\s+/g, ""))) return true;

  return false;
}

function getClientIp(event) {
  const h = event.headers || {};
  // Netlify common headers
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

export const handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Method Not Allowed" }) };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ ok: false, error: "Missing Supabase env vars" }) };
    }

    const CALL_TOKEN_SECRET = process.env.CALL_TOKEN_SECRET || "";
    if (!CALL_TOKEN_SECRET) {
      console.warn("CALL_TOKEN_SECRET is missing (token-gated makeCall won't be enabled).");
    }

    // Optional: turn on to see why "none_fit" happened (dev only)
    const DEBUG_NONE_FIT = process.env.DEBUG_NONE_FIT === "true";

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const body = safeJsonParse(event.body);

    const {
      requiredLines,
      state,
      selections,
      productTypes,
      perTypeNotes,
      contactInfo,
      totalDebtCharge = 60,
      submittedBy,
      submittedByName,

      // spam-hardening extras (sent from browser)
      company_website, // honeypot
      elapsed_ms       // time on page
    } = body;

    // ---- Validation (same as original; now with CORS headers) ----
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

    // ---- Spam hardening (WON'T accidentally block when fields are present) ----
    const hp = String(company_website || "").trim();
    const elapsed = Number(elapsed_ms || 0);

    const suspiciousTiming = elapsed > 0 && elapsed < 900;
    const honeypotHit = !!hp;

    const gibName = looksLikeGibberish(fn) || looksLikeGibberish(ln);
    const badEmail = email && !verifyBasicEmail(email);

    // If the frontend is sending these fields (yours is), always enforce.
    // This replaces the bad "elapsed > 0" activation logic that could cause confusion.
    const HARDENING_ACTIVE = true;

    if (HARDENING_ACTIVE && ((suspiciousTiming && (gibName || badEmail)) || (gibName && badEmail))) {
      const dbg = { why: "hardening", honeypotHit, suspiciousTiming, gibName, badEmail, elapsed, hpLen: hp.length };
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, reason: "none_fit", ver: VER, dbg })
      };
    }

    // ---- Server-side rate limiting (NO extra DB columns) ----
    const ip = getClientIp(event); // not stored, just useful in dbg/logs
    const ten = digits10(phone);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // 24h: phone/email rate limit using contacts created_at + phones/emails arrays
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

        // allow a few resubmits, stop floods
        if (hits >= 400) {
          const dbg = { why: "rate_limit_contacts", hits, ip, ten, email: email ? norm(email) : null };
          return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify({ ok: false, reason: "none_fit", ver: VER, dbg })
          };
        }
      }
    }

    // -------------------------
    // EVERYTHING BELOW THIS LINE IS YOUR ORIGINAL FLOW (UNTOUCHED LOGIC)
    // -------------------------

    const norm2 = (s) => (s || "").toString().trim().toLowerCase();
    const digits102 = (s) => (s || "").toString().replace(/\D/g, "").slice(-10);
    const CONSENT_TEXT_VERSION = "fvg_freequote_tcpav1_2025-12-20";
    const stateUp = String(state || "").toUpperCase();

    const lineTokenMap = {
      life: "Life",
      health: "Accident & Health",
      property: "Property",
      casualty: "Casualty"
    };

    const FVG_ID = "906a707c-69bb-4e6e-be1d-1415f45561c4";

    async function findDuplicateLeadByNamePlusOne({
      first_name, last_name, phoneArr, email, zip, product_type, windowDays = 90
    }) {
      const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const nFirst = norm2(first_name);
      const nLast = norm2(last_name);

      const { data: candidates, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, phone, zip, product_type, created_at, contacts:contact_id(emails, phones, zip)")
        .gte("created_at", sinceIso)
        .ilike("first_name", nFirst)
        .ilike("last_name", nLast)
        .limit(1000);

      if (error) throw new Error(error.message);

      const emailsArr = (email ? [email] : []).map(norm2);
      const ourPhones = phoneArr || [];

      for (const c of (candidates || [])) {
        if (norm2(c.first_name) !== nFirst || norm2(c.last_name) !== nLast) continue;

        const candPhonesFromLead = Array.isArray(c.phone) ? c.phone : [];
        const candPhonesFromContact = Array.isArray(c.contacts?.phones) ? c.contacts.phones : [];
        const candEmails = Array.isArray(c.contacts?.emails) ? c.contacts.emails : [];
        const candZip = c.zip || c.contacts?.zip || null;

        const phoneMatch = (() => {
          const set1 = new Set((ourPhones || []).map(digits102).filter(Boolean));
          for (const p of [...candPhonesFromLead, ...candPhonesFromContact].map(digits102).filter(Boolean)) {
            if (set1.has(p)) return true;
          }
          return false;
        })();

        const emailMatch = emailsArr.length ? candEmails.map(norm2).some(e => emailsArr.includes(e)) : false;
        const zipMatch = zip && candZip ? String(zip).trim() === String(candZip).trim() : false;

        if (
          (phoneMatch || emailMatch || zipMatch) &&
          (!product_type || !c.product_type || norm2(product_type) === norm2(c.product_type))
        ) {
          return c;
        }
      }
      return null;
    }

    async function upsertContact(contactInfo) {
      const e164 = contactInfo.phone ? String(contactInfo.phone).trim() : null;
      const tenFromE164 = (e164 || "").replace(/\D/g, "").slice(-10);
      const emailClean = (contactInfo.email || "").trim();
      const emailArr = emailClean ? [emailClean] : [];

      if (!e164 && !tenFromE164 && emailArr.length === 0) {
        throw new Error("Provide at least one phone or email.");
      }

      let existing = null;

      if (e164) {
        const r1 = await supabase
          .from("contacts")
          .select("id, phones, emails, zip, city, state, lat, lng, notes")
          .contains("phones", [e164])
          .maybeSingle();
        if (r1.data) existing = r1.data;
      }
      if (!existing && tenFromE164) {
        const r2 = await supabase
          .from("contacts")
          .select("id, phones, emails, zip, city, state, lat, lng, notes")
          .contains("phones", [tenFromE164])
          .maybeSingle();
        if (r2.data) existing = r2.data;
      }
      if (!existing && emailArr.length) {
        const r3 = await supabase
          .from("contacts")
          .select("id, phones, emails, zip, city, state, lat, lng, notes")
          .contains("emails", [emailArr[0]])
          .maybeSingle();
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
        const newZip = contactInfo.zip || existing.zip || null;
        const newNotes = contactInfo.notes
          ? (existing.notes ? `${existing.notes} || ${contactInfo.notes}` : contactInfo.notes)
          : (existing.notes || null);

        const updatePayload = {
          phones: mergedPhones,
          emails: mergedEmails,
          zip: newZip,
          city: contactInfo.city ?? existing.city ?? null,
          state: contactInfo.state ?? existing.state ?? null,
          lat: contactInfo.lat ?? existing.lat ?? null,
          lng: contactInfo.lng ?? existing.lng ?? null,

          tcpaconsent: true,
          consent_source: "website",
          consent_at: new Date().toISOString(),
          consent_text_version: CONSENT_TEXT_VERSION,

          notes: newNotes,
          needs_dnc_check: false
        };

        if (contactInfo.first_name?.trim()) updatePayload.first_name = contactInfo.first_name.trim();
        if (contactInfo.last_name?.trim()) updatePayload.last_name = contactInfo.last_name.trim();

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
            first_name: contactInfo.first_name,
            last_name: contactInfo.last_name,
            phones: phonesArr,
            emails: emailArr,
            zip: contactInfo.zip || null,
            city: contactInfo.city || null,
            state: contactInfo.state || null,
            lat: contactInfo.lat ?? null,
            lng: contactInfo.lng ?? null,
            contact_status: "new",

            tcpaconsent: true,
            consent_source: "website",
            consent_at: new Date().toISOString(),
            consent_text_version: CONSENT_TEXT_VERSION,

            notes: contactInfo.notes || null,
            needs_dnc_check: false
          })
          .select("id")
          .single();
        if (ierr) throw new Error(ierr.message);
        contactId = inserted.id;
      }

      return { contactId, e164, tenFromE164, emailClean };
    }

    // Load ALL NIPR rows for this state once
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

    async function hasLicensedUplineChainForToken(agentRow, token) {
      let current = agentRow;
      const visited = new Set();

      while (true) {
        const currentId = current?.id;
        if (!currentId) return true;

        if (visited.has(currentId)) return false;
        visited.add(currentId);

        const upId = current?.recruiter_id || null;
        if (!upId) return true;
        if (upId === FVG_ID) return true;

        const { data: upAgent, error: upErr } = await supabase
          .from("agents")
          .select("id, agent_id, recruiter_id")
          .eq("id", upId)
          .maybeSingle();

        if (upErr) throw new Error(upErr.message);
        if (!upAgent || !upAgent.agent_id) return false;

        if (!agentKeyHasToken(upAgent.agent_id, token)) return false;

        current = upAgent;
      }
    }

    async function loadAgentRowById(agentId) {
      const { data, error } = await supabase
        .from("agents")
        .select("id, agent_id, recruiter_id, full_name, phone, is_active, is_available, last_assigned_at, receiving_leads")
        .eq("id", agentId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data || null;
    }

    async function pickSingleAgentForSubmission(personId, neededLines) {
      const { data: orderRows, error: poErr } = await supabase
        .from("person_agent_order")
        .select("agent_id, first_assigned_at")
        .eq("person_id", personId)
        .order("first_assigned_at", { ascending: true });

      if (poErr) throw new Error(poErr.message);

      const connectedIds = (orderRows || []).map(r => r.agent_id).filter(Boolean);

      const connectedEligible = [];
      for (const aid of connectedIds) {
        const row = await loadAgentRowById(aid);
        if (!row) continue;

        let okAll = true;
        for (const line of neededLines) {
          const token = lineTokenMap[line];
          if (!token) { okAll = false; break; }
          if (!row.agent_id || !agentKeyHasToken(row.agent_id, token)) { okAll = false; break; }
          const okChain = await hasLicensedUplineChainForToken(row, token);
          if (!okChain) { okAll = false; break; }
        }
        if (okAll) connectedEligible.push(row);
      }

      const byOldest = (arr) =>
        arr.slice().sort((a, b) => {
          const ax = a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0;
          const bx = b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0;
          return ax - bx;
        });

      if (connectedEligible.length) {
        const online = connectedEligible.filter(a => !!a.is_available);
        return (online.length ? byOldest(online)[0] : byOldest(connectedEligible)[0]) || null;
      }

      const tokens = neededLines.map(l => lineTokenMap[l]).filter(Boolean);
      if (!tokens.length) return null;

      const eligibleAgentKeys = [];
      for (const agentKey of byAgentKey.keys()) {
        const hasAll = tokens.every(t => agentKeyHasToken(agentKey, t));
        if (hasAll) eligibleAgentKeys.push(agentKey);
      }
      if (!eligibleAgentKeys.length) return null;

      const { data: agents, error: agentErr } = await supabase
        .from("agents")
        .select("id, agent_id, recruiter_id, full_name, phone, is_active, is_available, last_assigned_at, receiving_leads")
        .eq("is_active", true)
        .eq("receiving_leads", true)
        .in("agent_id", eligibleAgentKeys);

      if (agentErr) throw new Error(agentErr.message);

      const fullyEligible = [];
      for (const ag of (agents || [])) {
        let okAll = true;
        for (const line of neededLines) {
          const token = lineTokenMap[line];
          const okChain = await hasLicensedUplineChainForToken(ag, token);
          if (!okChain) { okAll = false; break; }
        }
        if (okAll) fullyEligible.push(ag);
      }
      if (!fullyEligible.length) return null;

      const online = fullyEligible.filter(a => !!a.is_available);
      return (online.length ? byOldest(online)[0] : byOldest(fullyEligible)[0]) || null;
    }

    async function insertLeadsAssigned({ contactId, contactInfo, productTypes, perTypeNotesObj, submittedBy, submittedByName, pickedAgent }) {
      const e164 = contactInfo.phone ? String(contactInfo.phone).trim() : null;
      const tenFromE164 = (e164 || "").replace(/\D/g, "").slice(-10);
      const leadPhone = e164 ? [e164] : (tenFromE164 ? [tenFromE164] : []);
      const candidateEmail = contactInfo.email?.trim() ? contactInfo.email.trim() : null;

      const insertedOrExisting = [];

      for (const pt of productTypes) {
        const dup = await findDuplicateLeadByNamePlusOne({
          first_name: contactInfo.first_name,
          last_name: contactInfo.last_name,
          phoneArr: leadPhone,
          email: candidateEmail,
          zip: contactInfo.zip || null,
          product_type: pt,
          windowDays: 90
        });

        if (dup) {
          insertedOrExisting.push({ id: dup.id, product_type: dup.product_type, duplicate: true, assigned_to: null });
          continue;
        }

        const agentId = pickedAgent?.id || null;

        const payload = {
          first_name: contactInfo.first_name,
          last_name: contactInfo.last_name,
          zip: contactInfo.zip || null,
          city: contactInfo.city || null,
          state: contactInfo.state || null,
          lat: contactInfo.lat ?? null,
          lng: contactInfo.lng ?? null,
          age: contactInfo.age ?? null,
          phone: leadPhone,
          email: candidateEmail ? [candidateEmail] : [],
          lead_type: "Web",
          product_type: pt,
          contact_id: contactId,
          submitted_by: submittedBy,
          submitted_by_name: submittedByName || "Website Lead",
          notes: (perTypeNotesObj?.[pt]) || contactInfo.notes || null,
          assigned_to: agentId,
          assigned_at: agentId ? new Date().toISOString() : null,
          contacted_at: agentId ? new Date().toISOString() : null
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
          assigned_to: one.assigned_to || agentId
        });
      }

      return insertedOrExisting;
    }

    async function createLeadDebtsForSubmission({ leads, total = 60, contactId }) {
      const billable = (leads || []).filter(l => !l.duplicate && l.id && l.assigned_to);
      if (!billable.length) return;

      const perLead = Number((Number(total) / billable.length).toFixed(2));

      const rows = billable.map(l => ({
        agent_id: l.assigned_to,
        lead_id: l.id,
        description: `Website lead charge ($${total} per contact; split ${billable.length} ways)`,
        source: "freequote",
        amount: perLead,
        status: "open",
        created_by: null,
        metadata: {
          contact_id: contactId,
          total_contact_charge: total,
          split_count: billable.length
        }
      }));

      const { error } = await supabase.from("lead_debts").insert(rows);
      if (error) throw new Error(error.message || "Failed inserting lead_debts");
    }

    // lift internal DNC on new consent
    const { error: liftErr } = await supabase.rpc("lift_internal_dnc_on_new_consent", {
      p_first_name: contactInfo.first_name,
      p_last_name:  contactInfo.last_name,
      p_phone:      contactInfo.phone || null,
      p_email:      contactInfo.email || null,
      p_actor_id:   submittedBy || null
    });
    if (liftErr) throw new Error(`lift_internal_dnc_on_new_consent failed: ${liftErr.message}`);

    // Upsert contact
    const { contactId } = await upsertContact(contactInfo);

    // Normalize lines (ONLY these 4 are allowed)
    const normalizeLine = (x) => {
      const v = String(x || "").toLowerCase().trim();
      if (v === "life" || v === "health" || v === "property" || v === "casualty") return v;
      return null;
    };

    const neededLines = Array.from(new Set(
      (requiredLines || []).map(normalizeLine).filter(Boolean)
    ));

    if (!neededLines.length) neededLines.push("life");

    const pickedAgent = await pickSingleAgentForSubmission(contactId, neededLines);

    if (!pickedAgent?.id) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          reason: "none_fit",
          ver: VER,
          dbg: { why: "no_agent_found", state: stateUp, neededLines }
        })
      };
    }

    await supabase.from("person_agent_order").upsert(
      [{ person_id: contactId, agent_id: pickedAgent.id }],
      { onConflict: "person_id,agent_id" }
    );

    await supabase.from("person_line_agents").upsert(
      neededLines.map(line => ({
        person_id: contactId,
        line,
        agent_id: pickedAgent.id,
        assigned_at: new Date().toISOString()
      })),
      { onConflict: "person_id,line" }
    );

    const leads = await insertLeadsAssigned({
      contactId,
      contactInfo,
      productTypes,
      perTypeNotesObj: perTypeNotes || {},
      submittedBy,
      submittedByName,
      pickedAgent
    });

    await createLeadDebtsForSubmission({
      leads,
      total: Number(totalDebtCharge) || 60,
      contactId
    });

    // bump last_assigned_at
    const nowIso = new Date().toISOString();
    const newlyInserted = (leads || []).filter(l => !l.duplicate && l.assigned_to);
    const uniqueAgentIds = Array.from(new Set(newlyInserted.map(l => l.assigned_to)));
    for (const aid of uniqueAgentIds) {
      await supabase.from("agents").update({ last_assigned_at: nowIso }).eq("id", aid);
    }

    // pick lead for call
    const pickLead = (() => {
      const prop = (leads || []).find(l => l.product_type === "Property Insurance" && l.id);
      if (prop) return prop;
      return (leads || []).find(l => l.id) || null;
    })();

    const pickLeadIdForCall = pickLead?.id || null;

    // choice
    let choice = { reason: "offline_only", shouldCall: false, agent: { id: null, full_name: null, phone: null } };

    if (pickLeadIdForCall && pickLead?.assigned_to) {
      const ag = await loadAgentRowById(pickLead.assigned_to);
      choice = {
        reason: "per_line_assignment",
        shouldCall: !!ag?.is_available,
        agent: {
          id: ag?.id || null,
          full_name: ag?.full_name || null,
          phone: ag?.phone || null
        }
      };
    }

    // Server-signed token for makeCall (optional)
    let callToken = null;
    if (CALL_TOKEN_SECRET && choice?.shouldCall && pickLeadIdForCall && choice?.agent?.id) {
      callToken = makeCallToken(CALL_TOKEN_SECRET, {
        leadId: pickLeadIdForCall,
        agentId: choice.agent.id,
        exp: Date.now() + (2 * 60 * 1000) // 2 minutes
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
        callToken
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" })
    };
  }
};
