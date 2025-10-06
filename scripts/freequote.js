// scripts/life.js
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
  const btnStep1 = document.getElementById('btn-step1');
  const btnStep2 = document.getElementById('btn-step2');
  const btnSubmit= document.getElementById('btn-submit');

  // Add once near the other helpers
  const toE164 = (v) => {
    if (!v) return null;
    const d = String(v).replace(/\D/g, '');
    if (!d) return null;
    // If it already had a +, trust it; otherwise assume US 10-digit
    return v.startsWith('+') ? v : (d.length === 10 ? `+1${d}` : `+${d}`);
  };

  function hideAllModals() {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
  }
  function show(panel) {
    [step1, step2, step3, resultScr].forEach(p => p.style.display = (p === panel) ? 'block' : 'none');
  }
  show(step1);
    // --- inline error helpers (red outline + red label) ---
  const wrapOf = (el) => el.closest('.fl-field') || el.parentElement;

  function markInvalid(el) {
    el.classList.add('is-invalid');
    const w = wrapOf(el);
    if (w) w.classList.add('is-invalid');
  }
  function clearInvalid(el) {
    el.classList.remove('is-invalid');
    const w = wrapOf(el);
    if (w) w.classList.remove('is-invalid');
  }
  const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');

  /* ---------------------------
     Floating labels (inputs/selects)
  ---------------------------- */
  document.querySelectorAll('.fl-field input, .fl-field select').forEach(el => {
    const wrap = el.closest('.fl-field');
    const setHV = () => wrap.classList.toggle('has-value', !!el.value);
    setHV(); // initial (handles autofill)
    el.addEventListener('focus', () => wrap.classList.add('is-focused'));
    el.addEventListener('blur',  () => { wrap.classList.remove('is-focused'); setHV(); });
    el.addEventListener('input', setHV);
    el.addEventListener('change', setHV);
  });
    // remove error styling once they edit
  [zip, age, firstName, lastName, phone, email, employeeCount, businessName].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => clearInvalid(el));
    el.addEventListener('change', () => clearInvalid(el));
  });

  /* ---------------------------
     Multi-select (chip UI, multi)
  ---------------------------- */
  function getSelections() {
    return Array.from(coverMenu.querySelectorAll('.ms-option.selected'))
      .map(lbl => (lbl.dataset.value ?? lbl.textContent).trim());
  }

  function updateCoverDisplayAndCsv() {
    const sel = getSelections();
    coverDisplay.textContent = sel.join(', ');
    coverCsv.value = sel.join(',');
    updateCoverFloat();
    if (sel.length > 0) clearInvalid(coverSelect); // remove red state once valid
  }

  function updateCoverFloat() {
    const has = getSelections().length > 0;
    coverWrap?.classList.toggle('has-value', has);
  }

  // Open/close menu (single definition)
  function toggleMenu(forceOpen) {
    const open = (forceOpen !== undefined) ? forceOpen : (coverMenu.style.display !== 'block');
    coverMenu.style.display = open ? 'block' : 'none';
    coverSelect.setAttribute('aria-expanded', String(open));
    coverWrap?.classList.toggle('is-open', !!open);
  }

  // Start closed + synced
  coverMenu.style.display = 'none';
  updateCoverDisplayAndCsv();
  updateCoverFloat();

  coverSelect.addEventListener('click', () => toggleMenu());
  coverSelect.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMenu(); }
    if (e.key === 'Escape') { toggleMenu(false); }
  });

  // Initialize chips
  (function initChips(){
    coverMenu.querySelectorAll('.ms-option').forEach(lbl => {
      const cb = lbl.querySelector('input[type="checkbox"]');

      // Hard-hide native input & cache value on label
      if (cb) {
        Object.assign(cb.style, {
          display: 'none', position: 'absolute', left: '-9999px',
          width: '0', height: '0', opacity: '0', pointerEvents: 'none'
        });
        lbl.dataset.value = cb.value || lbl.textContent.trim();
        if (cb.checked) lbl.classList.add('selected'); // mirror pre-checked
      } else {
        lbl.dataset.value = lbl.dataset.value || lbl.textContent.trim();
      }

      // Click toggles selection
      lbl.addEventListener('click', (e) => {
        e.preventDefault();
        lbl.classList.toggle('selected');
        if (cb) cb.checked = lbl.classList.contains('selected'); // keep DOM consistent
        updateCoverDisplayAndCsv();
        updateCoverFloat();
      });

      // Keyboard toggle on chip
      lbl.tabIndex = 0;
      lbl.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          lbl.click();
        }
      });
    });
  })();

  // Click outside closes the menu
  document.addEventListener('click', (e) => {
    if (!coverSelect.contains(e.target) && !coverMenu.contains(e.target)) toggleMenu(false);
  });

  /* ---------------------------
     Phone mask
  ---------------------------- */
  phone.addEventListener('input', () => {
    const digits = phone.value.replace(/\D/g,'').slice(0,10);
    let out = '';
    if (digits.length > 0) out = '(' + digits.slice(0,3);
    if (digits.length >= 4) out += ') ' + digits.slice(3,6);
    if (digits.length >= 7) out += '-' + digits.slice(6);
    phone.value = out;
  });

  /* ---------------------------
     Step navigation
  ---------------------------- */
  btnStep1.addEventListener('click', () => {
    const zipOk  = /^\d{5}$/.test((zip.value||'').trim());
    const ageOk  = String(age.value||'').trim() !== '' && Number(age.value) >= 0;
    const picks  = getSelections();

    // clear previous
    clearInvalid(zip);
    clearInvalid(age);

    let bad = false;
    if (!zipOk) { markInvalid(zip); bad = true; }
    if (!ageOk) { markInvalid(age); bad = true; }
    if (picks.length === 0) {
      coverSelect.classList.add('has-error');      // red border on the fake input
      markInvalid(coverSelect);                     // make the floating label turn red
      setTimeout(()=>coverSelect.classList.remove('has-error'), 1000);
      bad = true;
    }
    if (bad) {
      // scroll to first invalid
      const firstBad = (!zipOk ? zip : !ageOk ? age : coverSelect);
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (firstBad.focus) firstBad.focus();
      return;
    }

    if (picks.includes('My Business')) {
      show(step2); employeeCount.focus();
    } else {
      show(step3); firstName.focus();
    }
  });
  btnStep2?.addEventListener('click', () => {
    // clear previous error styling
    clearInvalid(employeeCount);
    clearInvalid(businessName);
  
    let bad = false;
  
    if (!employeeCount.value) {
      markInvalid(employeeCount);
      bad = true;
    }
    if (!businessName.value.trim()) {
      markInvalid(businessName);
      bad = true;
    }
  
    if (bad) {
      const firstBad = [employeeCount, businessName]
        .find(el => el.classList.contains('is-invalid')) || employeeCount;
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstBad.focus?.();
      return;
    }
  
    show(step3);
    firstName.focus();
  });

  // Back links (conditional: Step 3 goes to Step 2 only if "My Business" was picked)
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => {
      const to = btn.getAttribute('data-back');
  
      // Step 2 back → Step 1
      if (to === '1') { 
        show(step1); 
        return; 
      }
  
      // Step 3 back → Step 2 only if "My Business" was selected; otherwise Step 1
      if (to === '2') {
        const selections = getSelections(); // uses the chip menu state
        if (selections.includes('My Business')) {
          show(step2);
        } else {
          show(step1);
        }
      }
    });
  });

  /* ---------------------------
     Submit -> Supabase
  ---------------------------- */
  const digitsOnly = (s) => (s||'').replace(/\D/g,'');

  function productTypeFromSelections(selections) {
    const map = new Map([
      ['My Car','auto'],
      ['My Home','home'],
      ['My Business','commercial'],
      ['My Identity','identity'],
      ['Legal Protection Plan','legalshield'],
      ['Me','life'],
      ['Someone Else','life'],
    ]);
    const picked = selections.map(v => map.get(v)).filter(Boolean);
    if (picked.length === 0) return 'life';
    const unique = Array.from(new Set(picked));
    return unique.length === 1 ? unique[0] : 'multi';
  }

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
    
      // 1) Try by phone
      let { data: existing, error: exErr } = await client
        .from('contacts')
        .select('id, phones, emails')
        .contains('phones', [contactInfo.phone])
        .maybeSingle();
    
      // 2) Try by email if not found
      if (!existing && contactInfo.email) {
        const r = await client
          .from('contacts')
          .select('id, phones, emails')
          .contains('emails', [contactInfo.email])
          .maybeSingle();
        existing = r.data;
      }
    
      let contactId;
      if (existing) {
        contactId = existing.id;
      } else {
        const { data: contact, error: contactError } = await client
          .from('contacts')
          .insert({
            first_name: contactInfo.first_name,
            last_name: contactInfo.last_name,
            phones: [contactInfo.phone],
            emails: [contactInfo.email],
            zip: contactInfo.zip,
            contact_status: 'new',
            tcpaconsent: true,
            consent_source: 'website',
            consent_at: new Date().toISOString(),
            notes: contactInfo.notes || null
          })
          .select('id')
          .single();
        if (contactError) throw new Error(contactError.message);
        contactId = contact.id;
      }
    
      const leadRows = productTypes.map(pt => ({
        first_name: contactInfo.first_name,
        last_name: contactInfo.last_name,
        zip: contactInfo.zip,
        phone: [contactInfo.phone],   // leads table keeps array
        lead_type: 'Web',
        product_type: pt,
        contact_id: contactId,
        submitted_by: window.FVG_WEBSITE_SUBMITTER_ID,
        submitted_by_name: window.FVG_WEBSITE_SUBMITTER_NAME || 'Website Lead'
      }));
    
      const { data: leads, error: leadsError } = await client
        .from('leads')
        .insert(leadRows)
        .select('id, product_type');
    
      if (leadsError) throw new Error(leadsError.message);
      return { contactId, leads };
    }

  btnSubmit.addEventListener('click', async () => {
    [firstName, lastName, phone, email].forEach(clearInvalid);
  
    let bad = false;
    if (!firstName.value.trim()) { markInvalid(firstName); bad = true; }
    if (!lastName.value.trim())  { markInvalid(lastName);  bad = true; }
  
    const ten = digitsOnly(phone.value);
    if (ten.length !== 10)       { markInvalid(phone);      bad = true; }
  
    if (!isEmail(email.value))   { markInvalid(email);      bad = true; }
  
    if (bad) {
      const firstBad = [firstName, lastName, phone, email]
        .find(el => el.classList.contains('is-invalid')) || firstName;
      firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstBad.focus();
      return;
    }
  
    const selections = getSelections();
    const notesParts = [
      `cover=${selections.join(',')}`,
      selections.includes('My Business') ? `biz_employees=${employeeCount.value||''}` : null,
      selections.includes('My Business') ? `biz_name=${(businessName.value||'').trim()}` : null,
      utmBundle() || null
    ].filter(Boolean);
  
    const baseRow = {
      first_name: firstName.value.trim(),
      last_name:  lastName.value.trim(),
      age:        age.value ? Number(age.value) : null,
      city:       null,
      zip:        zip.value.trim(),
      lead_type:  'Web',
      notes:      notesParts.join(' || '),
      submitted_by:      window.FVG_WEBSITE_SUBMITTER_ID,
      submitted_by_name: window.FVG_WEBSITE_SUBMITTER_NAME || 'Website Lead',
      assigned_to: null,
      assigned_at: null,
      phone:      [ten],
      address:    null,
      state:      null,
      lat:        null,
      lng:        null
    };
  
    const prev = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting…';
  
    try {
      // --- Determine specific product types from selections ---
      const map = new Map([
        ['My Car','Casualty Insurance'],
        ['My Home','Property Insurance'],
        ['My Business','Casualty Insurance'],
        ['My Identity','ID Shield'],
        ['Legal Protection Plan','Legal Shield'],
        ['Me','Life Insurance'],
        ['Someone Else','Life Insurance'],
        ['My Health','Health Insurance'],
      ]);
  
      const pickedTypes = Array.from(
        new Set(selections.map(v => map.get(v)).filter(Boolean))
      );
  
      if (pickedTypes.length === 0) pickedTypes.push('Life Insurance');
  
      // --- Create or fetch contact + insert one lead per product type ---
      const contactInfo = {
        first_name: firstName.value.trim(),
        last_name:  lastName.value.trim(),
        zip:        zip.value.trim(),
        phone:      ten,                         // <-- string, not array
        email:      email.value.trim(),          // <-- include email
        notes:      notesParts.join(' || ')
      };
      const { contactId, leads } = await insertContactAndLeads(contactInfo, pickedTypes);
      const insertedIds = leads.map(l => ({ id: l.id, type: l.product_type }));
      // --- Auto-assignment + Call/Schedule modal ---
      const callModal = document.getElementById('call-or-schedule');
      const btnCallNow = document.getElementById('btn-call-now');
      const btnSchedule = document.getElementById('btn-schedule');
      
      async function assignLeadToAgent(leadId, productType) {
        const { data: agents, error } = await supabase
          .from('agents')
          .select('id, full_name, product_types, phone')
          .eq('is_active', true);
      
        if (error || !agents?.length) throw new Error('No active agents found.');
      
        const eligible = agents.filter(a =>
          Array.isArray(a.product_types) &&
          a.product_types.some(pt => pt.toLowerCase() === productType.toLowerCase())
        );
      
        if (!eligible.length) throw new Error('No eligible agent for this product type.');
      
        // pick first available
        const chosen = eligible[0];
        const now = new Date().toISOString();
      
        await supabase.from('leads')
          .update({ assigned_to: chosen.id, assigned_at: now })
          .eq('id', leadId);
      
        // also update owning_agent_id on contact
        await supabase.from('contacts')
          .update({ owning_agent_id: chosen.id })
          .eq('id', contactId);
      
        return chosen;
      }
      
      callModal.style.display = 'flex';
      
      // === Call Now ===
      btnCallNow.onclick = async (e) => {
        e.preventDefault();
        btnCallNow.disabled = true;
      
        try {
          const updates = insertedIds.map(async (lead) => {
            const chosen = await assignLeadToAgent(lead.id, lead.type);
            await supabase.from('leads')
              .update({ contacted_at: new Date().toISOString() })
              .eq('id', lead.id);
      
            // << INSERT THIS BLOCK >>
            const rawNumber = Array.isArray(chosen.phone) ? chosen.phone[0] : chosen.phone;
            const toNumber = toE164(rawNumber);
            if (toNumber) {
              const response = await fetch("/.netlify/functions/makeCall", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ toNumber })
              });
              const result = await response.json();
              console.log("Telnyx result:", result);
            } else {
              console.warn("No dialable agent number for", chosen.full_name, chosen.phone);
            }
            // << END INSERT >>
      
            return chosen;
          });
      
          const results = await Promise.all(updates);
          alert(`✅ Connected leads to agents: ${results.map(a => a.full_name).join(', ')}`);
          hideAllModals();
          callModal.style.display = 'none';
        } catch (err) {
          alert('Call initiation failed: ' + err.message);
        } finally {
          btnCallNow.disabled = false;
        }
      };
      
      // === Schedule for Later ===
      btnSchedule.onclick = (e) => {
        e.preventDefault();
        callModal.style.display = 'none';
        const scheduleModal = document.getElementById('schedule-modal');
        scheduleModal.style.display = 'flex';
      };
      
      document.getElementById('confirm-schedule-btn').onclick = async (e) => {
        e.preventDefault();
        const dateInput = document.getElementById('schedule-datetime');
        const selectedDate = dateInput.value;
        if (!selectedDate) return alert('Please select a date and time.');
      
        try {
          for (const lead of insertedIds) {
            const chosen = await assignLeadToAgent(lead.id, lead.type);
            await supabase.from('tasks').insert({
              contact_id: contactId,
              lead_id: lead.id,
              assigned_to: chosen.id,
              title: 'Scheduled Client Call',
              scheduled_at: new Date(selectedDate).toISOString(),
              status: 'open',
              channel: 'call'
            });
          }
      
          alert(`📅 Scheduled follow-ups for ${insertedIds.length} lead(s)`);
          document.getElementById('schedule-modal').style.display = 'none';
        } catch (err) {
          alert('Scheduling failed: ' + err.message);
        }
      };
  
      // --- Build the thank-you screen ---
      const resTitle = document.getElementById('result-title');
      const resBody  = document.getElementById('result-body');
      const resActions = document.getElementById('result-actions');
  
      resTitle.textContent = 'Thanks! Your request was submitted.';
      resBody.innerHTML = insertedIds.map(
        (r, i) => `Lead #${i+1}: <strong>${r.type}</strong> – <span style="cursor:pointer" title="Click to copy" data-id="${r.id}">${r.id}</span>`
      ).join('<br>');
  
      resActions.innerHTML = '';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'cta';
      again.textContent = 'Start another quote';
      again.addEventListener('click', () => location.reload());
      resActions.appendChild(again);
  
      resBody.querySelectorAll('[data-id]').forEach(el => {
        el.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(el.dataset.id); } catch {}
        });
      });
  
      show(resultScr);
      // you can keep the call/schedule modal logic here if you like,
      // but for clarity you can move it inside this loop later per lead type
    } catch (err) {
      alert(`Could not submit: ${err.message||'unknown error'}`);
      show(step3);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = prev;
    }
  });
  });
});
