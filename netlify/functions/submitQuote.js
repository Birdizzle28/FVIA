// netlify/functions/submitQuote.js
import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, error: "Missing Supabase env vars" })
      };
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const body = JSON.parse(event.body || "{}");

    const {
      requiredLines,
      state,
      selections,
      productTypes,
      perTypeNotes,
      contactInfo,
      totalDebtCharge = 60,
      submittedBy,
      submittedByName
    } = body;

    // ---- validation ----
    if (!state || !/^[A-Za-z]{2}$/.test(String(state))) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing/invalid state" }) };
    }
    if (!Array.isArray(requiredLines) || requiredLines.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing requiredLines" }) };
    }
    if (!Array.isArray(productTypes) || productTypes.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing productTypes" }) };
    }
    if (!contactInfo || !contactInfo.first_name || !contactInfo.last_name) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing contactInfo.name" }) };
    }
    if (!submittedBy) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing submittedBy" }) };
    }

    // --- helpers ---
    const norm = (s) => (s || "").toString().trim().toLowerCase();
    const digits10 = (s) => (s || "").toString().replace(/\D/g, "").slice(-10);
    const CONSENT_TEXT_VERSION = "fvg_freequote_tcpav1_2025-12-20";

    const stateUp = String(state || "").toUpperCase();

    // Product Type -> line (person_line_agents only supports these 4)
    const productTypeToLine = {
      "Life Insurance": "life",
      "Health Insurance": "health",
      "Property Insurance": "property",
      "Casualty Insurance": "casualty",
      "Legal Shield": "life",
      "ID Shield": "life"
    };

    // line -> NIPR token match (same logic you used)
    const lineTokenMap = {
      life: "Life",
      health: "Accident & Health",
      property: "Property",
      casualty: "Casualty"
    };

    const FVG_ID = "906a707c-69bb-4e6e-be1d-1415f45561c4";

    // ========= (1) findDuplicateLeadByNamePlusOne =========
    async function findDuplicateLeadByNamePlusOne({
      first_name, last_name, phoneArr, email, zip, product_type, windowDays = 90
    }) {
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

    // ========= (2) upsert contact =========
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

    // ========= (3) eligibility + picking helpers =========

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

    async function pickFreshAgentForLine(line, state2) {
      const token = lineTokenMap[line];
      if (!token) return { reason: "none_fit", agent: null, shouldCall: false };

      // Which agent_keys (agent_id) have the token?
      const eligibleAgentKeys = [];
      for (const agentKey of byAgentKey.keys()) {
        if (agentKeyHasToken(agentKey, token)) eligibleAgentKeys.push(agentKey);
      }
      if (!eligibleAgentKeys.length) return { reason: "none_fit", agent: null, shouldCall: false };

      const { data: agents, error: agentErr } = await supabase
        .from("agents")
        .select("id, agent_id, recruiter_id, full_name, phone, is_active, is_available, last_assigned_at, receiving_leads")
        .eq("is_active", true)
        .eq("receiving_leads", true)
        .in("agent_id", eligibleAgentKeys);

      if (agentErr) throw new Error(agentErr.message);

      const baseEligible = (agents || []);
      if (!baseEligible.length) return { reason: "none_fit", agent: null, shouldCall: false };

      const fullyEligible = [];
      for (const ag of baseEligible) {
        const okChain = await hasLicensedUplineChainForToken(ag, token);
        if (okChain) fullyEligible.push(ag);
      }
      if (!fullyEligible.length) return { reason: "none_fit", agent: null, shouldCall: false };

      const byOldest = (arr) =>
        arr.slice().sort((a, b) => {
          const ax = a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0;
          const bx = b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0;
          return ax - bx;
        });

      const online = fullyEligible.filter(a => !!a.is_available);
      if (online.length) return { reason: "online", agent: byOldest(online)[0], shouldCall: true };

      return { reason: "offline_only", agent: byOldest(fullyEligible)[0], shouldCall: false };
    }

    async function isAgentEligibleForLine(agentRow, line) {
      if (!agentRow) return false;
      if (!agentRow.is_active) return false;
      if (!agentRow.receiving_leads) return false;
      const token = lineTokenMap[line];
      if (!token) return false;
      if (!agentRow.agent_id) return false;
      if (!agentKeyHasToken(agentRow.agent_id, token)) return false;
      const okChain = await hasLicensedUplineChainForToken(agentRow, token);
      return !!okChain;
    }

    // ========= (4) per-line routing using person_line_agents + person_agent_order =========
    async function resolveAgentsPerLine(personId, neededLines) {
      // existing line agents
      const { data: existingLineRows, error: plErr } = await supabase
        .from("person_line_agents")
        .select("person_id, line, agent_id")
        .eq("person_id", personId);

      if (plErr) throw new Error(plErr.message);

      const existingByLine = new Map();
      for (const r of (existingLineRows || [])) existingByLine.set(r.line, r.agent_id);

      // order list (oldest first)
      const { data: orderRows, error: poErr } = await supabase
        .from("person_agent_order")
        .select("person_id, agent_id, first_assigned_at")
        .eq("person_id", personId)
        .order("first_assigned_at", { ascending: true });

      if (poErr) throw new Error(poErr.message);

      const preferredAgentIds = (orderRows || []).map(r => r.agent_id).filter(Boolean);

      const results = {}; // line -> { agentId, reason, shouldCall }
      const toUpsertLine = [];
      const toUpsertOrder = [];

      for (const line of neededLines) {
        // 1) keep existing line agent if eligible
        const existingAgentId = existingByLine.get(line) || null;
        if (existingAgentId) {
          const row = await loadAgentRowById(existingAgentId);
          if (await isAgentEligibleForLine(row, line)) {
            results[line] = {
              agentId: existingAgentId,
              reason: "kept_existing_line_agent",
              shouldCall: !!row.is_available
            };
            continue;
          }
        }

        // 2) try preferred agents (order list)
        let picked = null;
        for (const aid of preferredAgentIds) {
          const row = await loadAgentRowById(aid);
          if (await isAgentEligibleForLine(row, line)) {
            picked = { agent: row, reason: "used_person_agent_order" };
            break;
          }
        }

        // 3) else pick fresh
        if (!picked) {
          const fresh = await pickFreshAgentForLine(line, stateUp);
          if (!fresh?.agent?.id) {
            results[line] = { agentId: null, reason: "none_fit", shouldCall: false };
            continue;
          }
          picked = { agent: fresh.agent, reason: fresh.reason };
        }

        results[line] = {
          agentId: picked.agent.id,
          reason: picked.reason,
          shouldCall: !!picked.agent.is_available
        };

        // ensure mappings exist / updated
        toUpsertLine.push({
          person_id: personId,
          line,
          agent_id: picked.agent.id,
          assigned_at: new Date().toISOString()
        });

        toUpsertOrder.push({
          person_id: personId,
          agent_id: picked.agent.id
        });
      }

      // write person_line_agents
      if (toUpsertLine.length) {
        const { error } = await supabase
          .from("person_line_agents")
          .upsert(toUpsertLine, { onConflict: "person_id,line" });
        if (error) throw new Error(error.message);
      }

      // write person_agent_order (keep earliest; upsert does nothing to timestamp if row exists)
      if (toUpsertOrder.length) {
        const { error } = await supabase
          .from("person_agent_order")
          .upsert(toUpsertOrder, { onConflict: "person_id,agent_id" });
        if (error) throw new Error(error.message);
      }

      return results;
    }

    // ========= (5) create leads per productType, assigned to per-line agent =========
    async function insertLeadsAssigned({ contactId, contactInfo, productTypes, perTypeNotesObj, submittedBy, submittedByName, agentByLine }) {
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
          insertedOrExisting.push({
            id: dup.id,
            product_type: dup.product_type,
            duplicate: true,
            assigned_to: null
          });
          continue;
        }

        const line = productTypeToLine[pt] || null;
        const agentId = line ? (agentByLine?.[line]?.agentId || null) : null;

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

    // ========= (6) debts split across newly inserted leads, charged to whoever received each lead =========
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

    // ---------------- MAIN FLOW ----------------

    // lift internal DNC on new consent (keep your RPC)
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

    // Determine which "lines" are needed (ONLY the 4 we track; legal/id go to life)
    const neededLinesSet = new Set();
    for (const pt of productTypes) {
      const line = productTypeToLine[pt];
      if (line) neededLinesSet.add(line);
    }
    // fallback
    if (neededLinesSet.size === 0) neededLinesSet.add("life");
    const neededLines = Array.from(neededLinesSet);

    // Resolve per-line agent assignments using contactId as person_id
    const agentByLine = await resolveAgentsPerLine(contactId, neededLines);

    // If ANY needed line is none_fit -> you can choose your preferred behavior.
    // Here: if all needed lines are none_fit, return none_fit.
    const anyAssigned = neededLines.some(l => agentByLine?.[l]?.agentId);
    if (!anyAssigned) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "none_fit" }) };
    }

    // Insert leads assigned per line
    const leads = await insertLeadsAssigned({
      contactId,
      contactInfo,
      productTypes,
      perTypeNotesObj: perTypeNotes || {},
      submittedBy,
      submittedByName,
      agentByLine
    });

    // Debts for newly inserted leads, charged to receiving agents
    await createLeadDebtsForSubmission({
      leads,
      total: Number(totalDebtCharge) || 60,
      contactId
    });

    // Bump last_assigned_at for any agent who received at least one NEW lead
    const nowIso = new Date().toISOString();
    const newlyInserted = (leads || []).filter(l => !l.duplicate && l.assigned_to);
    const uniqueAgentIds = Array.from(new Set(newlyInserted.map(l => l.assigned_to)));

    for (const aid of uniqueAgentIds) {
      await supabase.from("agents").update({ last_assigned_at: nowIso }).eq("id", aid);
    }

    // Pick “best lead” for call: prefer Property Insurance, else first lead
    const pickLead = (() => {
      const prop = (leads || []).find(l => l.product_type === "Property Insurance" && l.id);
      if (prop) return prop;
      return (leads || []).find(l => l.id) || null;
    })();

    const pickLeadIdForCall = pickLead?.id || null;

    // choice for the auto-dial: the agent who owns the picked lead's line
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        choice,
        contactId,
        leads,
        pickLeadIdForCall,
        agentByLine // helpful for debugging; safe to remove later
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" })
    };
  }
};
