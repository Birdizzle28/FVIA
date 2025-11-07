// scripts/freequote.js
document.addEventListener('DOMContentLoaded', () => {
  const supabase = window.supabase;

  // Panels
  const step1 = document.getElementById('step-1');
  const step2 = document.getElementById('step-2');
  const step3 = document.getElementById('step-3');
  const resultScr = document.getElementById('result-screen');

  // Step 1 fields
  const zip = document.getElementById('zip');
  const age = document.getElementById('age');

  // Multi-select
  const coverSelect  = document.getElementById('cover-select');
  const coverMenu    = document.getElementById('cover-menu');
  const coverDisplay = document.getElementById('cover-display');
  const coverCsv     = document.getElementById('cover_csv');
  const coverWrap    = document.getElementById('cover-fl');

  // Step 2 (business)
  const employeeCount = document.getElementById('employee_count');
  const businessName  = document.getElementById('business_name');

  // Step 3 (contact)
  const firstName = document.getElementById('first_name');
  const lastName  = document.getElementById('last_name');
  const phone     = document.getElementById('phone');
  const email     = document.getElementById('email');

  // Buttons
  const btnStep1  = document.getElementById('btn-step1');
  const btnStep2  = document.getElementById('btn-step2');
  const btnSubmit = document.getElementById('btn-submit');

  // runtime state (set on Step 1)
  let DETECTED_GEO = { state: null, city: null, lat: null, lng: null };

  // --- helpers ---
  const norm = (s) => (s || '').toString().trim().toLowerCase();
  const digits10 = (s) => (s || '').toString().replace(/\D/g,'').slice(-10);
  const wrapOf = (el) => el.closest('.fl-field') || el.parentElement;
  function markInvalid(el) { el.classList.add('is-invalid'); wrapOf(el)?.classList.add('is-invalid'); }
  function clearInvalid(el) { el.classList.remove('is-invalid'); wrapOf(el)?.classList.remove('is-invalid'); }
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
  const toE164 = (v) => {
    if (!v) return null;
    const s = String(v).trim();
    if (s.startsWith('+')) return s.replace(/[^\d+]/g, '');
    const d = s.replace(/\D/g, '');
    if (!d) return null;
    if (d.length === 10) return `+1${d}`;
    if (d.length === 11 && d.startsWith('1')) return `+${d}`;
    return `+${d}`;
  };

  // --- duplicate finder (unchanged) ---
  async function findDuplicateLeadByNamePlusOne({
    first_name, last_name, phoneArr, email, zip, product_type, windowDays = 90
  }) {
    const client = window.supabase;
    if (!client) throw new Error('Supabase not loaded');

    const sinceIso = new Date(Date.now() - windowDays*24*60*60*1000).toISOString();
    const nFirst = norm(first_name);
    const nLast  = norm(last_name);

    const { data: candidates, error } = await client
      .from('leads')
      .select('id, first_name, last_name, phone, zip, product_type, created_at, contacts:contact_id(emails, phones, zip)')
      .gte('created_at', sinceIso)
      .ilike('first_name', nFirst)
      .ilike('last_name', nLast)
      .limit(1000);
    if (error) throw new Error(error.message);

    const emailsArr = (email ? [email] : []).map(norm);
    const ourPhones = phoneArr || [];

    for (const c of (candidates || [])) {
      if (norm(c.first_name) !== nFirst || norm(c.last_name) !== nLast) continue;

      const candPhonesFromLead    = Array.isArray(c.phone) ? c.phone : [];
      const candPhonesFromContact = Array.isArray(c.contacts?.phones) ? c.contacts.phones : [];
      const candEmails            = Array.isArray(c.contacts?.emails) ? c.contacts.emails : [];
      const candZip               = c.zip || c.contacts?.zip || null;

      const phoneMatch = (() => {
        const set1 = new Set((ourPhones || []).map(digits10).filter(Boolean));
        for (const p of [...candPhonesFromLead, ...candPhonesFromContact].map(digits10).filter(Boolean)) {
          if (set1.has(p)) return true;
        }
        return false;
      })();

      const emailMatch = emailsArr.length ? candEmails.map(norm).some(e => emailsArr.includes(e)) : false;
      const zipMatch   = zip && candZip ? String(zip).trim() === String(candZip).trim() : false;

      if ((phoneMatch || emailMatch || zipMatch) &&
          (!product_type || !c.product_type || norm(product_type) === norm(c.product_type))) {
        return c;
      }
    }
    return null;
  }

  function hideAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  }
  function show(panel) {
    [step1, step2, step3, resultScr].forEach(p => p.style.display = (p === panel) ? 'block' : 'none');
  }
  show(step1);

  // floating labels
  document.querySelectorAll('.fl-field input, .fl-field select').forEach(el => {
    const wrap = el.closest('.fl-field');
    const setHV = () => wrap.classList.toggle('has-value', !!el.value);
    setHV(); el.addEventListener('focus', () => wrap.classList.add('is-focused'));
    el.addEventListener('blur', () => { wrap.classList.remove('is-focused'); setHV(); });
    el.addEventListener('input', setHV); el.addEventListener('change', setHV);
  });
  [zip, age, firstName, lastName, phone, email, employeeCount, businessName].forEach(el => {
    if (!el) return; el.addEventListener('input', () => clearInvalid(el)); el.addEventListener('change', () => clearInvalid(el));
  });

  // multi-select UI
  function getSelections() {
    return Array.from(coverMenu.querySelectorAll('.ms-option.selected'))
      .map(lbl => (lbl.dataset.value ?? lbl.textContent).trim());
  }
  function updateCoverDisplayAndCsv() {
    const sel = getSelections();
    coverDisplay.textContent = sel.join(', ');
    coverCsv.value = sel.join(',');
    coverWrap?.classList.toggle('has-value', sel.length > 0);
    if (sel.length > 0) clearInvalid(coverSelect);
  }
  function toggleMenu(forceOpen) {
    const open = (forceOpen !== undefined) ? forceOpen : (coverMenu.style.display !== 'block');
    coverMenu.style.display = open ? 'block' : 'none';
    coverSelect.setAttribute('aria-expanded', String(open));
    coverWrap?.classList.toggle('is-open', !!open);
  }
  coverMenu.style.display = 'none';
  updateCoverDisplayAndCsv();

  coverSelect.addEventListener('click', () => toggleMenu());
  coverSelect.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMenu(); }
    if (e.key === 'Escape') { toggleMenu(false); }
  });

  (function initChips(){
    coverMenu.querySelectorAll('.ms-option').forEach(lbl => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      if (cb) {
        Object.assign(cb.style, { display:'none', position:'absolute', left:'-9999px', width:'0', height:'0', opacity:'0', pointerEvents:'none' });
        lbl.dataset.value = cb.value || lbl.textContent.trim();
        if (cb.checked) lbl.classList.add('selected');
      } else {
        lbl.dataset.value = lbl.dataset.value || lbl.textContent.trim();
      }
      lbl.addEventListener('click', (e) => {
        e.preventDefault();
        lbl.classList.toggle('selected');
        if (cb) cb.checked = lbl.classList.contains('selected');
        updateCoverDisplayAndCsv();
      });
      lbl.tabIndex = 0;
      lbl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); lbl.click(); }});
    });

    // preselect from ?coverage_type=...
    (function preselectFromQuery(){
      const params = new URLSearchParams(location.search);
      const ct = (params.get('coverage_type') || '').toLowerCase();
      const map = {
        identity: 'My Identity',
        life:     'Myself',
        health:   'My Health',
        home:     'My Home',
        business: 'My Business',
        legal:    'Legal Protection Plan',
        auto:     'My Car'
      };
      const wanted = map[ct];
      if (!wanted) return;
      const lbl = Array.from(coverMenu.querySelectorAll('.ms-option'))
        .find(el => (el.dataset.value || el.textContent.trim()) === wanted);
      if (lbl) {
        lbl.classList.add('selected');
        const cb = lbl.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = true;
        updateCoverDisplayAndCsv();
      }
    })();
  })();

  document.addEventListener('click', (e) => {
    if (!coverSelect.contains(e.target) && !coverMenu.contains(e.target)) toggleMenu(false);
  });

  // phone mask
  phone.addEventListener('input', () => {
    const digits = phone.value.replace(/\D/g,'').slice(0,10);
    let out = '';
    if (digits.length > 0) out = '(' + digits.slice(0,3);
    if (digits.length >= 4) out += ') ' + digits.slice(3,6);
    if (digits.length >= 7) out += '-' + digits.slice(6);
    phone.value = out;
  });

  // --- ZIP → GEO (server-side) ---
  async function getGeoFromZip(zip5) {
    try {
      const resp = await fetch(`/.netlify/functions/zip-geo?zip=${encodeURIComponent(zip5)}`);
      const json = await resp.json();
      return {
        state: json?.state || null,
        city:  json?.city  || null,
        lat:   (json?.lat ?? null),
        lng:   (json?.lng ?? null),
      };
    } catch {
      return { state: null, city: null, lat: null, lng: null };
    }
  }

  // --- Product selection → required lines (normalized keys) ---
  // normalized keys: 'life','health','property','casualty','legalshield','idshield'
  function linesForSelections(labels) {
    const out = new Set();
    for (const v of labels) {
      switch (v) {
        case 'Myself':
        case 'Someone Else':
          out.add('life'); break;
        case 'My Health':
          out.add('health'); break;
        case 'My Car':
          out.add('casualty'); break;
        case 'My Home':
          out.add('property'); break;
        case 'Legal Protection Plan':
          out.add('legalshield'); break;
        case 'My Identity':
          out.add('idshield'); break;
        case 'My Business':
          // requires BOTH Property & Casualty
          out.add('property'); out.add('casualty'); break;
        default:
          break;
      }
    }
    if (out.size === 0) out.add('life');
    return Array.from(out);
  }

  // --- Map normalized lines to your product_type strings ---
  const lineToProductType = {
    life: 'Life Insurance',
    health: 'Health Insurance',
    property: 'Property Insurance',
    casualty: 'Casualty Insurance',
    legalshield: 'Legal Shield',
    idshield: 'ID Shield'
  };

  // --- Create per-product notes honoring the Business+Home rule ---
  function buildNotesByProductType(selections, baseNotes) {
    const set = new Set(selections);
    const wantsHome = set.has('My Home');
    const wantsBiz  = set.has('My Business');

    // helper to join a notes array cleanly
    const join = (arr) => arr.filter(Boolean).join(' || ');

    // base “cover=…” stays the same for all
    const notesCommon = baseNotes.filter(n => n && !n.startsWith('biz_') && !n.startsWith('home_'));

    // flags we’ll add (not visible to users, but readable by admins & webhook)
    const homeTag = wantsHome ? 'home_selected=true' : null;
    const bizTag  = wantsBiz  ? 'business_selected=true' : null;

    const bizDetails = [
      wantsBiz ? `biz_employees=${employeeCount.value||''}` : null,
      wantsBiz ? `biz_name=${(businessName.value||'').trim()}` : null
    ].filter(Boolean);

    const byType = new Map();

    // Property:
    // - If Home + Business: include BOTH home + business context
    // - If only Home: include home only
    const propNotes = [];
    propNotes.push(...notesCommon);
    if (wantsHome) propNotes.push(homeTag);
    if (wantsBiz)  propNotes.push(bizTag, ...bizDetails);
    byType.set('Property Insurance', join(propNotes));

    // Casualty:
    // - If Business chosen: include business details only
    // - If only “My Car”: it’ll still have the common cover line
    const casNotes = [];
    casNotes.push(...notesCommon);
    if (wantsBiz) casNotes.push(bizTag, ...bizDetails);
    byType.set('Casualty Insurance', join(casNotes));

    // Others (Life, Health, LegalShield, IDShield): keep common only
    const otherNotes = join(notesCommon);
    ['Life Insurance','Health Insurance','Legal Shield','ID Shield']
      .forEach(t => byType.set(t, otherNotes));

    return byType;
  }

  // --- Use agents table; require ALL requested lines to include detected state; prefer is_available ---
  async function pickAgentForAll(requiredLines, state2) {
    if (!state2 || !/^[A-Z]{2}$/.test(state2)) {
      return { reason: 'none_fit', agent: null, shouldCall: false };
    }

    const { data: agents, error } = await supabase
      .from('agents')
      .select('id, full_name, phone, is_active, is_available, licensed_states_by_line, last_assigned_at')
      .eq('is_active', true);

    if (error) throw new Error(error.message);

    const eligible = (agents || []).filter(a => {
      const lic = a.licensed_states_by_line || {};
      return requiredLines.every(lineKey => {
        const arr = Array.isArray(lic[lineKey]) ? lic[lineKey] : [];
        return arr.includes(state2);
      });
    });

    if (!eligible.length) return { reason: 'none_fit', agent: null, shouldCall: false };

    const byOldest = (arr) =>
      arr.slice().sort((a,b) => {
        const ax = a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0;
        const bx = b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0;
        return ax - bx;
      });

    const online = eligible.filter(a => !!a.is_available);
    if (online.length) return { reason: 'online', agent: byOldest(online)[0], shouldCall: true };
    return { reason: 'offline_only', agent: byOldest(eligible)[0], shouldCall: false };
  }

  // ----- STEP NAV -----
  btnStep1.addEventListener('click', async () => {
    const zipOk  = /^\d{5}$/.test((zip.value||'').trim());
    const ageOk  = String(age.value||'').trim() !== '' && Number(age.value) >= 0;
    const picks  = getSelections();
    clearInvalid(zip); clearInvalid(age);
    let bad = false;
    if (!zipOk) { markInvalid(zip); bad = true; }
    if (!ageOk) { markInvalid(age); bad = true; }
    if (picks.length === 0) { coverSelect.classList.add('has-error'); markInvalid(coverSelect); setTimeout(()=>coverSelect.classList.remove('has-error'), 1000); bad = true; }
    if (bad) {
      const firstBad = (!zipOk ? zip : !ageOk ? age : coverSelect);
      firstBad.scrollIntoView({ behavior:'smooth', block:'center' }); firstBad.focus?.(); return;
    }

    // Resolve full geo now (server-side)
    DETECTED_GEO = await getGeoFromZip(zip.value.trim());
    if (!DETECTED_GEO?.state) {
      alert('Sorry—couldn’t determine your state from ZIP. Please check the ZIP or try again.');
      markInvalid(zip);
      return;
    }

    // Proceed to business step if chosen
    if (picks.includes('My Business')) {
      show(step2); employeeCount.focus();
    } else {
      show(step3); firstName.focus();
    }
  });

  btnStep2?.addEventListener('click', () => {
    clearInvalid(employeeCount); clearInvalid(businessName);
    let bad = false;
    if (!employeeCount.value) { markInvalid(employeeCount); bad = true; }
    if (!businessName.value.trim()) { markInvalid(businessName); bad = true; }
    if (bad) {
      const firstBad = [employeeCount, businessName].find(el => el.classList.contains('is-invalid')) || employeeCount;
      firstBad.scrollIntoView({ behavior:'smooth', block:'center' }); firstBad.focus?.(); return;
    }
    show(step3); firstName.focus();
  });

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const to = btn.getAttribute('data-back');
      if (to === '1') { show(step1); return; }
      if (to === '2') {
        const selections = getSelections();
        if (selections.includes('My Business')) { show(step2); } else { show(step1); }
      }
    });
  });

  // ---- SUBMIT ----
  function utmBundle() {
    // Keep clean UTM; REMOVE referrer entirely per your request
    const p = new URLSearchParams(location.search);
    const keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
    const pairs = [];
    keys.forEach(k => { if (p.get(k)) pairs.push(`${k.replace('utm_','') }=${p.get(k)}`); });
    return (pairs.length) ? `utm:${pairs.join('|')}` : '';
  }

  async function insertContactAndLeads(contactInfo, perTypeNotes, productTypes) {
    const client = window.supabase;
    if (!client) throw new Error('Supabase not loaded');

    const e164 = contactInfo.phone ? String(contactInfo.phone).trim() : null;
    const tenFromE164 = (e164 || '').replace(/\D/g, '').slice(-10);
    const emailClean = (contactInfo.email || '').trim();
    const emailArr = emailClean ? [emailClean] : [];
    if (!e164 && !tenFromE164 && emailArr.length === 0) throw new Error('Provide at least one phone or email.');

    // Upsert contact (merge phones/emails) WITH geo fields
    let existing = null;
    if (e164) {
      const r1 = await client.from('contacts').select('id, phones, emails, zip, city, state, lat, lng, notes').contains('phones', [e164]).maybeSingle();
      if (r1.data) existing = r1.data;
    }
    if (!existing && tenFromE164) {
      const r2 = await client.from('contacts').select('id, phones, emails, zip, city, state, lat, lng, notes').contains('phones', [tenFromE164]).maybeSingle();
      if (r2.data) existing = r2.data;
    }
    if (!existing && emailArr.length) {
      const r3 = await client.from('contacts').select('id, phones, emails, zip, city, state, lat, lng, notes').contains('emails', [emailArr[0]]).maybeSingle();
      if (r3.data) existing = r3.data;
    }

    const phonesArr = (e164 && tenFromE164 && tenFromE164 !== e164) ? [e164, tenFromE164] : (e164 ? [e164] : (tenFromE164 ? [tenFromE164] : []));
    let contactId;

    if (existing) {
      const mergedPhones = Array.from(new Set([...(existing.phones || []), ...phonesArr].filter(Boolean)));
      const mergedEmails = Array.from(new Set([...(existing.emails || []), ...emailArr].filter(Boolean)));
      const newZip   = contactInfo.zip || existing.zip || null;
      const newNotes = contactInfo.notes ? (existing.notes ? `${existing.notes} || ${contactInfo.notes}` : contactInfo.notes) : (existing.notes || null);

      const updatePayload = {
        phones: mergedPhones,
        emails: mergedEmails,
        zip: newZip,
        city: contactInfo.city ?? existing.city ?? null,
        state: contactInfo.state ?? existing.state ?? null,
        lat: contactInfo.lat ?? existing.lat ?? null,
        lng: contactInfo.lng ?? existing.lng ?? null,
        tcpaconsent: true,
        consent_source: 'website',
        consent_at: new Date().toISOString(),
        notes: newNotes
      };
      if (contactInfo.first_name?.trim()) updatePayload.first_name = contactInfo.first_name.trim();
      if (contactInfo.last_name?.trim())  updatePayload.last_name  = contactInfo.last_name.trim();

      const { data: updated, error: uerr } = await client.from('contacts').update(updatePayload).eq('id', existing.id).select('id').single();
      if (uerr) throw new Error(uerr.message);
      contactId = updated.id;
    } else {
      const { data: inserted, error: ierr } = await client
        .from('contacts')
        .insert({
          first_name: contactInfo.first_name,
          last_name:  contactInfo.last_name,
          phones: phonesArr,
          emails: emailArr,
          zip: contactInfo.zip || null,
          city: contactInfo.city || null,
          state: contactInfo.state || null,
          lat: contactInfo.lat ?? null,
          lng: contactInfo.lng ?? null,
          contact_status: 'new',
          tcpaconsent: true,
          consent_source: 'website',
          consent_at: new Date().toISOString(),
          notes: contactInfo.notes || null
        })
        .select('id')
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
        last_name:  contactInfo.last_name,
        phoneArr:   leadPhone,
        email:      candidateEmail,
        zip:        contactInfo.zip || null,
        product_type: pt,
        windowDays: 90
      });
      if (dup) { insertedOrExisting.push({ id: dup.id, product_type: dup.product_type, duplicate: true }); continue; }

      const payload = {
        first_name: contactInfo.first_name,
        last_name:  contactInfo.last_name,
        zip:        contactInfo.zip || null,
        city:       contactInfo.city || null,
        state:      contactInfo.state || null,
        lat:        contactInfo.lat ?? null,
        lng:        contactInfo.lng ?? null,
        age:        contactInfo.age ?? null,
        phone:      leadPhone,
        email:      candidateEmail ? [candidateEmail] : [],
        lead_type:  'Web',
        product_type: pt,
        contact_id: contactId,
        submitted_by: window.FVG_WEBSITE_SUBMITTER_ID,
        submitted_by_name: window.FVG_WEBSITE_SUBMITTER_NAME || 'Website Lead',
        notes: perTypeNotes.get(pt) || contactInfo.notes || null
      };

      const { data: one, error: insErr } = await client.from('leads').insert([payload]).select('id, product_type').single();
      if (insErr) throw new Error(insErr.message);
      insertedOrExisting.push({ id: one.id, product_type: one.product_type, duplicate: false });
    }

    return { contactId, leads: insertedOrExisting };
  }

  // === Submit handler ===
  btnSubmit.addEventListener('click', async () => {
    [firstName, lastName, phone, email].forEach(clearInvalid);

    let bad = false;
    if (!firstName.value.trim()) { markInvalid(firstName); bad = true; }
    if (!lastName.value.trim())  { markInvalid(lastName);  bad = true; }

    const ten = digits10(phone.value);
    const e164Prospect = toE164(ten);
    if (ten.length !== 10)     { markInvalid(phone); bad = true; }
    if (!isEmail(email.value)) { markInvalid(email); bad = true; }

    if (bad) {
      const firstBad = [firstName, lastName, phone, email].find(el => el.classList.contains('is-invalid')) || firstName;
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' }); firstBad.focus(); return;
    }

    const selections = getSelections();
    const requiredLines = linesForSelections(selections); // normalized keys (unique)
    const productTypes = Array.from(new Set(requiredLines.map(l => lineToProductType[l]).filter(Boolean))); // unique per submission

    // Base notes (no referrer)
    const baseNotes = [
      `cover=${selections.join(',')}`,
      utmBundle() || null
    ].filter(Boolean);

    // Build per-product notes with your Business/Home rule
    const perTypeNotes = buildNotesByProductType(selections, baseNotes);

    const prev = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting…';

    try {
      // Hard stop if state was not resolved in Step 1
      if (!DETECTED_GEO?.state) {
        alert('We couldn’t determine your state. Please go back and confirm your ZIP.');
        btnSubmit.disabled = false;
        btnSubmit.textContent = prev;
        return;
      }

      // Choose eligible agent BEFORE any inserts (compliance-safe)
      const choice = await pickAgentForAll(requiredLines, DETECTED_GEO.state);
      if (choice.reason === 'none_fit') {
        alert('We’re sorry — we don’t currently have a licensed agent for your selection in your state.');
        btnSubmit.disabled = false;
        btnSubmit.textContent = prev;
        return;
      }

      // Prepare contact payload including GEO + age
      const contactInfo = {
        first_name: firstName.value.trim(),
        last_name:  lastName.value.trim(),
        zip:        zip.value.trim(),
        city:       DETECTED_GEO.city,
        state:      DETECTED_GEO.state,
        lat:        DETECTED_GEO.lat,
        lng:        DETECTED_GEO.lng,
        age:        Number(age.value) || null,
        phone:      e164Prospect,
        email:      email.value.trim(),
        notes:      baseNotes.join(' || ')
      };

      // Insert/update contact + insert leads
      const { contactId, leads } = await insertContactAndLeads(contactInfo, perTypeNotes, productTypes);

      // pick the “best” lead for whisper: prefer Property if both Property & Casualty exist
      const pickLeadIdForCall = (() => {
        const prop = leads.find(l => l.product_type === 'Property Insurance');
        if (prop) return prop.id;
        return leads[0]?.id || null;
      })();

      // Assign to chosen agent, set ownership, bump last_assigned_at
      const nowIso = new Date().toISOString();

      await supabase.from('leads')
        .update({ assigned_to: choice.agent.id, assigned_at: nowIso })
        .in('id', leads.map(x => x.id));

      await supabase.from('contacts')
        .update({ owning_agent_id: choice.agent.id })
        .eq('id', contactId);

      await supabase.from('agents')
        .update({ last_assigned_at: nowIso })
        .eq('id', choice.agent.id);

      // Optional: mark contacted_at immediately
      await supabase.from('leads')
        .update({ contacted_at: new Date().toISOString() })
        .in('id', leads.map(x => x.id));

      // Only auto-dial if the chosen agent is available
      if (choice.shouldCall && pickLeadIdForCall) {
        const rawAgentNumber = Array.isArray(choice.agent.phone) ? choice.agent.phone[0] : choice.agent.phone;
        const agentNumber    = toE164(rawAgentNumber);

        if (agentNumber && e164Prospect) {
          // Build a human whisper (Telnyx will speak this). We’ll parse on the webhook too,
          // but passing it makes the intent explicit.
          const wants = selections
            .map(s => {
              if (s === 'Myself') return 'their life';
              if (s === 'Someone Else') return 'a loved one';
              if (s === 'My Car') return 'their car';
              if (s === 'My Home') return 'their home';
              if (s === 'My Business') return 'their business';
              if (s === 'My Health') return 'their health';
              if (s === 'Legal Protection Plan') return 'legal protection';
              if (s === 'My Identity') return 'identity protection';
              return s.toLowerCase();
            })
            .join(' and ');

          const resp = await fetch('/.netlify/functions/makeCall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: choice.agent.id,
              agentNumber,
              prospectNumber: e164Prospect,
              leadId: pickLeadIdForCall,
              whisper: `New lead: ${firstName.value.trim()} ${lastName.value.trim()}, wants to cover ${wants}, press 1 to connect`
            })
          });
          const rawText = await resp.text();
          console.log('makeCall status:', resp.status, 'body:', rawText);
          if (!resp.ok) {
            alert(`We couldn’t start the call automatically (code ${resp.status}). We’ll follow up ASAP.`);
          }
        }
      }

      // Thank-you screen
      const resTitle = document.getElementById('result-title');
      const resBody  = document.getElementById('result-body');
      const resActions = document.getElementById('result-actions');

      resTitle.textContent = 'Thanks! Your request was submitted. An agent will be in touch immediately!';
      resBody.innerHTML = leads.map(
        (r, i) => `Request #${i+1}: <strong>${r.product_type}</strong> – <span style="cursor:pointer" title="Click to copy" data-id="${r.id}">${r.id}</span>`
      ).join('<br>');

      resActions.innerHTML = '';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'cta';
      again.textContent = 'Start another quote';
      again.addEventListener('click', () => location.reload());
      resActions.appendChild(again);

      resBody.querySelectorAll('[data-id]').forEach(el => {
        el.addEventListener('click', async () => { try { await navigator.clipboard.writeText(el.dataset.id); } catch {} });
      });

      show(resultScr);
      hideAllModals();
    } catch (err) {
      alert(`Could not submit: ${err.message||'unknown error'}`);
      show(step3);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = prev;
    }
  });
});
