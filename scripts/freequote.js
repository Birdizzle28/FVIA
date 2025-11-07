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

  // runtime state
  let DETECTED_STATE = null; // set on Step 1 via server-side geocode

  // --- helpers ---
  const norm = (s) => (s || '').toString().trim().toLowerCase();
  const digits10 = (s) => (s || '').toString().replace(/\D/g,'').slice(-10);

  const hasPhoneOverlap = (arr1 = [], arr2 = []) => {
    const set1 = new Set(arr1.map(digits10).filter(Boolean));
    for (const p of arr2.map(digits10).filter(Boolean)) if (set1.has(p)) return true;
    return false;
  };

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

      const phoneMatch = hasPhoneOverlap(ourPhones, [...candPhonesFromLead, ...candPhonesFromContact]);
      const emailMatch = emailsArr.length ? candEmails.map(norm).some(e => emailsArr.includes(e)) : false;
      const zipMatch   = zip && candZip ? String(zip).trim() === String(candZip).trim() : false;

      const oneOtherMatches = phoneMatch || emailMatch || zipMatch;
      if (oneOtherMatches) {
        if (!product_type || !c.product_type || norm(product_type) === norm(c.product_type)) return c;
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

  const wrapOf = (el) => el.closest('.fl-field') || el.parentElement;
  function markInvalid(el) { el.classList.add('is-invalid'); wrapOf(el)?.classList.add('is-invalid'); }
  function clearInvalid(el) { el.classList.remove('is-invalid'); wrapOf(el)?.classList.remove('is-invalid'); }
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');

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

  // multi-select
  function getSelections() {
    return Array.from(coverMenu.querySelectorAll('.ms-option.selected'))
      .map(lbl => (lbl.dataset.value ?? lbl.textContent).trim());
  }
  function updateCoverDisplayAndCsv() {
    const sel = getSelections();
    coverDisplay.textContent = sel.join(', ');
    coverCsv.value = sel.join(',');
    updateCoverFloat();
    if (sel.length > 0) clearInvalid(coverSelect);
  }
  function updateCoverFloat() {
    const has = getSelections().length > 0;
    coverWrap?.classList.toggle('has-value', has);
  }
  function toggleMenu(forceOpen) {
    const open = (forceOpen !== undefined) ? forceOpen : (coverMenu.style.display !== 'block');
    coverMenu.style.display = open ? 'block' : 'none';
    coverSelect.setAttribute('aria-expanded', String(open));
    coverWrap?.classList.toggle('is-open', !!open);
  }
  coverMenu.style.display = 'none';
  updateCoverDisplayAndCsv(); updateCoverFloat();

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
        updateCoverDisplayAndCsv(); updateCoverFloat();
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
        updateCoverFloat();
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

  // --- ZIP → State (server-side) ---
  async function getStateFromZip(zip5) {
    try {
      const resp = await fetch(`/.netlify/functions/zip-to-state?zip=${encodeURIComponent(zip5)}`);
      const json = await resp.json();
      return json?.state || null;
    } catch {
      return null;
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
          // Business requires BOTH Property & Casualty
          out.add('property'); out.add('casualty'); break;
        default:
          break;
      }
    }
    // default to life if somehow empty
    if (out.size === 0) out.add('life');
    return Array.from(out);
  }

  // --- Agent picker (per-line, per-state) using agents.is_available ---
  async function pickAgentForAll(requiredLines, state2) {
    // state2 must exist; otherwise ineligible by policy
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
      // every required line must include the state
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
    if (online.length) {
      return { reason: 'online', agent: byOldest(online)[0], shouldCall: true };
    }
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

    // Resolve state now (server-side)
    DETECTED_STATE = await getStateFromZip(zip.value.trim());
    if (!DETECTED_STATE) {
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
  const digitsOnly = (s) => (s||'').replace(/\D/g,'');

  function utmBundle() {
    const p = new URLSearchParams(location.search);
    const keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
    const pairs = [];
    keys.forEach(k => { if (p.get(k)) pairs.push(`${k.replace('utm_','') }=${p.get(k)}`); });
    const ref = document.referrer ? `referrer=${document.referrer}` : '';
    return (pairs.length || ref) ? `utm:${pairs.join('|')}${pairs.length && ref ? ' || ' : ''}${ref}` : '';
  }

  async function insertContactAndLeads(contactInfo, productTypes) {
    const client = window.supabase;
    if (!client) throw new Error('Supabase not loaded');

    const e164 = contactInfo.phone ? String(contactInfo.phone).trim() : null;
    const tenFromE164 = (e164 || '').replace(/\D/g, '').slice(-10);
    const emailClean = (contactInfo.email || '').trim();
    const emailArr = emailClean ? [emailClean] : [];
    if (!e164 && !tenFromE164 && emailArr.length === 0) throw new Error('Provide at least one phone or email.');

    let existing = null;
    if (e164) {
      const r1 = await client.from('contacts').select('id, phones, emails, zip, notes').contains('phones', [e164]).maybeSingle();
      if (r1.data) existing = r1.data;
    }
    if (!existing && tenFromE164) {
      const r2 = await client.from('contacts').select('id, phones, emails, zip, notes').contains('phones', [tenFromE164]).maybeSingle();
      if (r2.data) existing = r2.data;
    }
    if (!existing && emailArr.length) {
      const r3 = await client.from('contacts').select('id, phones, emails, zip, notes').contains('emails', [emailArr[0]]).maybeSingle();
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

      const { data: one, error: insErr } = await client
        .from('leads')
        .insert([{
          first_name: contactInfo.first_name,
          last_name:  contactInfo.last_name,
          zip:        contactInfo.zip || null,
          phone:      leadPhone,
          lead_type:  'Web',
          product_type: pt,
          contact_id: contactId,
          submitted_by: window.FVG_WEBSITE_SUBMITTER_ID,
          submitted_by_name: window.FVG_WEBSITE_SUBMITTER_NAME || 'Website Lead',
          notes: contactInfo.notes || null
        }])
        .select('id, product_type')
        .single();
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
    const requiredLines = linesForSelections(selections); // normalized keys
    const notesParts = [
      `cover=${selections.join(',')}`,
      selections.includes('My Business') ? `biz_employees=${employeeCount.value||''}` : null,
      selections.includes('My Business') ? `biz_name=${(businessName.value||'').trim()}` : null,
      utmBundle() || null
    ].filter(Boolean);

    const prev = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting…';

    try {
      // Hard stop if state was not resolved in Step 1
      if (!DETECTED_STATE) {
        alert('We couldn’t determine your state. Please go back and confirm your ZIP.');
        btnSubmit.disabled = false;
        btnSubmit.textContent = prev;
        return;
      }

      // Choose eligible agent BEFORE any inserts
      const choice = await pickAgentForAll(requiredLines, DETECTED_STATE);
      if (choice.reason === 'none_fit') {
        alert('We’re sorry — we don’t currently have a licensed agent for your selection in your state.');
        btnSubmit.disabled = false;
        btnSubmit.textContent = prev;
        return;
      }

      // Map normalized lines to your existing product_type labels for leads
      const lineToProductType = {
        life: 'Life Insurance',
        health: 'Health Insurance',
        property: 'Property Insurance',
        casualty: 'Casualty Insurance',
        legalshield: 'Legal Shield',
        idshield: 'ID Shield'
      };
      const pickedTypes = Array.from(new Set(requiredLines.map(l => lineToProductType[l]).filter(Boolean)));

      // Proceed with inserts
      const contactInfo = {
        first_name: firstName.value.trim(),
        last_name:  lastName.value.trim(),
        zip:        zip.value.trim(),
        phone:      e164Prospect,
        email:      email.value.trim(),
        notes:      notesParts.join(' || ')
      };
      const { contactId, leads } = await insertContactAndLeads(contactInfo, pickedTypes);
      const insertedIds = leads.map(l => ({ id: l.id, type: l.product_type }));

      // Assign to chosen agent, set ownership, bump last_assigned_at
      const nowIso = new Date().toISOString();

      await supabase.from('leads')
        .update({ assigned_to: choice.agent.id, assigned_at: nowIso })
        .in('id', insertedIds.map(x => x.id));

      await supabase.from('contacts')
        .update({ owning_agent_id: choice.agent.id })
        .eq('id', contactId);

      await supabase.from('agents')
        .update({ last_assigned_at: nowIso })
        .eq('id', choice.agent.id);

      // Optional: mark contacted_at immediately
      await supabase.from('leads')
        .update({ contacted_at: new Date().toISOString() })
        .in('id', insertedIds.map(x => x.id));

      // Only auto-dial if the chosen agent is available
      if (choice.shouldCall) {
        const rawAgentNumber = Array.isArray(choice.agent.phone) ? choice.agent.phone[0] : choice.agent.phone;
        const agentNumber    = toE164(rawAgentNumber);
        if (agentNumber && e164Prospect) {
          const leadIdForCall = insertedIds[0].id;
          const resp = await fetch('/.netlify/functions/makeCall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              agentId: choice.agent.id,
              agentNumber,
              prospectNumber: e164Prospect,
              leadId: leadIdForCall
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
      resBody.innerHTML = insertedIds.map(
        (r, i) => `Request #${i+1}: <strong>${r.type}</strong> – <span style="cursor:pointer" title="Click to copy" data-id="${r.id}">${r.id}</span>`
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
