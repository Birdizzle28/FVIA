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
      // from client
      requiredLines,
      state,
      selections,
      productTypes,
      perTypeNotes,     // object map: { "Life Insurance": "...", ... }
      contactInfo,      // {first_name,last_name,zip,city,state,lat,lng,age,phone,email,notes}
      totalDebtCharge = 60,
      submittedBy,
      submittedByName
    } = body;

    // ---- validation (matches your front-end assumptions) ----
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

    // --- helpers (server-side copies) ---
    const norm = (s) => (s || "").toString().trim().toLowerCase();
    const digits10 = (s) => (s || "").toString().replace(/\D/g, "").slice(-10);

    // ========= (1) findDuplicateLeadByNamePlusOne (server) =========
    async function findDuplicateLeadByNamePlusOne({
      first_name, last_name, phoneArr, email, zip, product_type, windowDays = 90
    }) {
      const sinceIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const nFirst = norm(first_name);
      const nLast = norm(last_name);

      // NOTE: ilike expects a pattern; we’ll do exact-ish match via normalized compare after fetch
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

    // ========= (2) pickAgentForAll (server) =========
    async function pickAgentForAll(requiredLines, state2) {
      const stateUp = (state2 || "").toUpperCase();
      const FVG_ID = "906a707c-69bb-4e6e-be1d-1415f45561c4";

      if (!stateUp || !/^[A-Z]{2}$/.test(stateUp)) {
        return { reason: "none_fit", agent: null, shouldCall: false };
      }

      const lineTokenMap = {
        life: "Life",
        health: "Accident & Health", // keep exactly as your client expects
        property: "Property",
        casualty: "Casualty",
        legalshield: "Life",
        idshield: "Life"
      };

      const neededTokens = Array.from(
        new Set((requiredLines || []).map(k => lineTokenMap[k]).filter(Boolean))
      );

      if (!neededTokens.length) {
        return { reason: "none_fit", agent: null, shouldCall: false };
      }

      // 1) Pull all NIPR license rows for this state
      const { data: niprRows, error: niprErr } = await supabase
        .from("agent_nipr_licenses")
        .select("agent_id, state, active, loa_names")
        .eq("state", stateUp);

      if (niprErr) throw new Error(niprErr.message);
      if (!niprRows || !niprRows.length) return { reason: "none_fit", agent: null, shouldCall: false };

      function rowMatchesToken(row, token) {
        if (!Array.isArray(row.loa_names)) return false;
        const lowerToken = token.toLowerCase();
        return row.loa_names.some(name => (name || "").toString().toLowerCase().includes(lowerToken));
      }

      const byAgentKey = new Map();
      for (const row of niprRows) {
        if (!row.active) continue;
        const key = row.agent_id;
        if (!key) continue;
        if (!byAgentKey.has(key)) byAgentKey.set(key, []);
        byAgentKey.get(key).push(row);
      }

      function hasAllTokensForKey(agentKey) {
        const rows = byAgentKey.get(agentKey) || [];
        if (!rows.length) return false;
        return neededTokens.every(token => rows.some(r => rowMatchesToken(r, token)));
      }

      const eligibleAgentKeys = [];
      for (const [agentKey, rows] of byAgentKey.entries()) {
        if (!rows.length) continue;
        if (hasAllTokensForKey(agentKey)) eligibleAgentKeys.push(agentKey);
      }

      if (!eligibleAgentKeys.length) return { reason: "none_fit", agent: null, shouldCall: false };

      // 2) Load agents (active + receiving_leads)
      const { data: agents, error: agentErr } = await supabase
        .from("agents")
        .select("id, agent_id, recruiter_id, full_name, phone, is_active, is_available, last_assigned_at, receiving_leads")
        .eq("is_active", true)
        .eq("receiving_leads", true)
        .in("agent_id", eligibleAgentKeys);

      if (agentErr) throw new Error(agentErr.message);

      const baseEligibleAgents = (agents || []);
      if (!baseEligibleAgents.length) return { reason: "none_fit", agent: null, shouldCall: false };

      // --- upline chain check ---
      async function hasLicensedUplineChain(agentRow) {
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

          if (!hasAllTokensForKey(upAgent.agent_id)) return false;

          current = upAgent;
        }
      }

      const fullyEligible = [];
      for (const ag of baseEligibleAgents) {
        const okChain = await hasLicensedUplineChain(ag);
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

    // ========= (3) insertContactAndLeads (server) =========
    async function insertContactAndLeads(contactInfo, perTypeNotesObj, productTypes) {
      const e164 = contactInfo.phone ? String(contactInfo.phone).trim() : null;
      const tenFromE164 = (e164 || "").replace(/\D/g, "").slice(-10);
      const emailClean = (contactInfo.email || "").trim();
      const emailArr = emailClean ? [emailClean] : [];

      if (!e164 && !tenFromE164 && emailArr.length === 0) {
        throw new Error("Provide at least one phone or email.");
      }

      // Upsert contact (merge phones/emails) WITH geo fields
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
            notes: contactInfo.notes || null,
            needs_dnc_check: false
          })
          .select("id")
          .single();
        if (ierr) throw new Error(ierr.message);
        contactId = inserted.id;
      }

      // Insert leads (unique product types), WITH geo + age
      const leadPhone = e164 ? [e164] : (tenFromE164 ? [tenFromE164] : []);
      const insertedOrExisting = [];
      const candidateEmail = contactInfo.email?.trim() ? contactInfo.email.trim() : null;

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
          insertedOrExisting.push({ id: dup.id, product_type: dup.product_type, duplicate: true });
          continue;
        }

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
          notes: (perTypeNotesObj?.[pt]) || contactInfo.notes || null
        };

        const { data: one, error: insErr } = await supabase
          .from("leads")
          .insert([payload])
          .select("id, product_type")
          .single();
        if (insErr) throw new Error(insErr.message);

        insertedOrExisting.push({ id: one.id, product_type: one.product_type, duplicate: false });
      }

      return { contactId, leads: insertedOrExisting };
    }

    // ========= (4) createLeadDebtsForSubmission (server) =========
    async function createLeadDebtsForSubmission({ agentId, createdBy, contactId, leads, total = 60 }) {
      const billable = (leads || []).filter(l => !l.duplicate && l.id);
      if (!billable.length) return;

      const perLead = Number((Number(total) / billable.length).toFixed(2));

      const rows = billable.map(l => ({
        agent_id: agentId,
        lead_id: l.id,
        description: `Website lead charge ($${total} per contact; split ${billable.length} ways)`,
        source: "freequote",
        amount: perLead,
        status: "open",
        created_by: createdBy || null,
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

    // Pick agent FIRST (compliance-safe)
    const choice = await pickAgentForAll(requiredLines, state);
    if (choice.reason === "none_fit" || !choice.agent?.id) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, reason: "none_fit" }) };
    }

    // Insert/update contact + insert leads
    const { contactId, leads } = await insertContactAndLeads(
      contactInfo,
      perTypeNotes || {},
      productTypes
    );

    // Debts (only for newly inserted)
    await createLeadDebtsForSubmission({
      agentId: choice.agent.id,
      createdBy: submittedBy,
      contactId,
      leads,
      total: Number(totalDebtCharge) || 60
    });

    // pick the “best” lead for whisper: prefer Property if exists
    const pickLeadIdForCall = (() => {
      const prop = (leads || []).find(l => l.product_type === "Property Insurance");
      if (prop?.id) return prop.id;
      return leads?.[0]?.id || null;
    })();

    // Assign to chosen agent, set ownership, bump last_assigned_at
    const nowIso = new Date().toISOString();
    const leadIdsAll = (leads || []).map(x => x.id).filter(Boolean);

    if (leadIdsAll.length) {
      const { error: u1 } = await supabase
        .from("leads")
        .update({ assigned_to: choice.agent.id, assigned_at: nowIso })
        .in("id", leadIdsAll);
      if (u1) throw new Error(u1.message);

      const { error: u4 } = await supabase
        .from("leads")
        .update({ contacted_at: nowIso })
        .in("id", leadIdsAll);
      if (u4) throw new Error(u4.message);
    }

    const { error: u2 } = await supabase
      .from("contacts")
      .update({ owning_agent_id: choice.agent.id })
      .eq("id", contactId);
    if (u2) throw new Error(u2.message);

    const { error: u3 } = await supabase
      .from("agents")
      .update({ last_assigned_at: nowIso })
      .eq("id", choice.agent.id);
    if (u3) throw new Error(u3.message);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        choice: {
          reason: choice.reason,
          shouldCall: !!choice.shouldCall,
          agent: {
            id: choice.agent.id,
            full_name: choice.agent.full_name || null,
            phone: choice.agent.phone || null
          }
        },
        contactId,
        leads,
        pickLeadIdForCall
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" })
    };
  }
};
