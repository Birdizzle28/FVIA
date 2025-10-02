// scripts/life.js
document.addEventListener('DOMContentLoaded', () => {
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

  function show(panel) {
    [step1, step2, step3, resultScr].forEach(p => p.style.display = (p === panel) ? 'block' : 'none');
  }
  show(step1);

  // ---------- Multi-select behavior ----------
  function getSelections() {
    const checks = Array.from(coverMenu.querySelectorAll('input[type="checkbox"]:checked'));
    return checks.map(c => c.value);
  }
  function updateCoverDisplay() {
    const sel = getSelections();
    coverDisplay.textContent = sel.length ? sel.join(', ') : 'Select one or more';
    coverCsv.value = sel.join(',');
  }
  // NEW: keep the "selected" class on the label in sync with the hidden checkbox
  function syncSelectedClasses() {
    coverMenu.querySelectorAll('.ms-option').forEach(lbl => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      lbl.classList.toggle('selected', !!cb?.checked);
    });
  }
  // ensure menu starts closed + text is in sync  ⬇️
  coverMenu.style.display = 'none';
  updateCoverDisplay();
  syncSelectedClasses();
  
  function toggleMenu(forceOpen) {
    const open = (forceOpen !== undefined) ? forceOpen : (coverMenu.style.display !== 'block');
    coverMenu.style.display = open ? 'block' : 'none';
    coverSelect.setAttribute('aria-expanded', String(open));
  }
  
  coverSelect.addEventListener('click', () => toggleMenu());              // mouse
  coverSelect.addEventListener('keydown', (e) => {                        // keyboard
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleMenu(); }
    if (e.key === 'Escape')            { toggleMenu(false); }
  });
  
  // update display + chip styles when a choice changes
  coverMenu.addEventListener('change', () => {
    updateCoverDisplay();
    syncSelectedClasses();
  });
  // ---- PATCH: make labels act like the control and hard-hide any native boxes ----
  (function initFakeCheckboxes(){
    // absolutely hide via inline style as a last resort (beats any stylesheet order)
    coverMenu.querySelectorAll('.ms-option input[type="checkbox"]').forEach(cb => {
      cb.style.display = 'none';
      cb.style.position = 'absolute';
      cb.style.left = '-9999px';
      cb.style.width = '0';
      cb.style.height = '0';
      cb.style.opacity = '0';
      cb.style.pointerEvents = 'none';
    });
  
    // clicking the label toggles selected state + underlying checkbox value
    coverMenu.querySelectorAll('.ms-option').forEach(lbl => {
      lbl.addEventListener('click', (e) => {
        // ignore direct clicks on inputs (shouldn’t happen since we hid them)
        if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === 'input') return;
        const cb = lbl.querySelector('input[type="checkbox"]');
        if (!cb) return;
        cb.checked = !cb.checked;
        lbl.classList.toggle('selected', cb.checked);
        // update visible text + hidden CSV
        coverDisplay.textContent = getSelections().join(', ') || 'Select one or more';
        coverCsv.value = getSelections().join(',');
      });
    });
  
    // ensure initial .selected state matches any prechecked boxes
    coverMenu.querySelectorAll('.ms-option').forEach(lbl => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      lbl.classList.toggle('selected', !!cb?.checked);
    });
  })();
  // OPTIONAL: allow keyboard toggling directly on each label (space/enter)
  coverMenu.querySelectorAll('.ms-option').forEach(lbl => {
    lbl.tabIndex = 0; // make focusable
    lbl.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        const cb = lbl.querySelector('input[type="checkbox"]');
        if (cb) {
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  });
  
  document.addEventListener('click', (e) => {
    if (!coverSelect.contains(e.target) && !coverMenu.contains(e.target)) {
      toggleMenu(false);
    }
  });

  // Phone mask
  phone.addEventListener('input', () => {
    const digits = phone.value.replace(/\D/g,'').slice(0,10);
    let out = '';
    if (digits.length > 0) out = '(' + digits.slice(0,3);
    if (digits.length >= 4) out += ') ' + digits.slice(3,6);
    if (digits.length >= 7) out += '-' + digits.slice(6);
    phone.value = out;
  });

  // ---------- Step 1 -> Step 2/3 ----------
  btnStep1.addEventListener('click', () => {
    const zipOk  = /^\d{5}$/.test((zip.value||'').trim());
    const ageOk  = String(age.value||'').trim() !== '' && Number(age.value) >= 0;
    const picks  = getSelections();
    if (!zipOk || !ageOk || picks.length === 0) {
      // simple inline validity
      if (!zipOk) zip.reportValidity?.();
      if (!ageOk) age.reportValidity?.();
      if (picks.length === 0) {
        coverSelect.classList.add('has-error');
        setTimeout(()=>coverSelect.classList.remove('has-error'), 1000);
      }
      return;
    }

    // If “My Business” selected, show Step 2, otherwise skip to Step 3
    if (picks.includes('My Business')) {
      show(step2);
      employeeCount.focus();
    } else {
      show(step3);
      firstName.focus();
    }
  });

  // ---------- Step 2 -> Step 3 ----------
  btnStep2?.addEventListener('click', () => {
    if (!employeeCount.value) { employeeCount.reportValidity(); return; }
    if (!businessName.value.trim()) { businessName.reportValidity(); return; }
    show(step3);
    firstName.focus();
  });

  // “< Go Back” links
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const to = e.currentTarget.getAttribute('data-back');
      if (to === '1') show(step1);
      if (to === '2') show(step2);
      if (to === '0') show(step1);
    });
  });

  // ---------- Submit -> Supabase ----------
  function digitsOnly(s){ return (s||'').replace(/\D/g,''); }

  function productTypeFromSelections(selections) {
    // One product_type column → choose best-fit or "multi"
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

  async function insertLead(row){
    const client = supabase.createClient(window.FVG_SUPABASE_URL, window.FVG_SUPABASE_ANON);
    const { data, error } = await client.from('leads').insert(row).select('id').single();
    if (error) throw new Error(error.message || 'Insert failed');
    return data?.id;
  }

  btnSubmit.addEventListener('click', async () => {
    // Validate step 3 fields
    if (!firstName.value.trim()) { firstName.reportValidity(); return; }
    if (!lastName.value.trim())  { lastName.reportValidity(); return; }
    const ten = digitsOnly(phone.value);
    if (ten.length !== 10)       { phone.setCustomValidity('Enter a valid 10-digit number.'); phone.reportValidity(); phone.setCustomValidity(''); return; }
    if (!email.checkValidity())  { email.reportValidity(); return; }

    // Build row for your schema
    const selections = getSelections();
    const row = {
      first_name: firstName.value.trim(),
      last_name:  lastName.value.trim(),
      age:        age.value ? Number(age.value) : null,
      city:       null,
      zip:        zip.value.trim(),
      lead_type:  'Web',
      notes: [
        `cover=${selections.join(',')}`,
        selections.includes('My Business') ? `biz_employees=${employeeCount.value||''}` : null,
        selections.includes('My Business') ? `biz_name=${(businessName.value||'').trim()}` : null
      ].filter(Boolean).join(' || '),
      submitted_by:      window.FVG_WEBSITE_SUBMITTER_ID,
      submitted_by_name: window.FVG_WEBSITE_SUBMITTER_NAME || 'Website Lead',
      assigned_to: null,
      assigned_at: null,
      phone:      [ten],
      address:    null,
      state:      null,
      lat:        null,
      lng:        null,
      product_type: productTypeFromSelections(selections)
    };

    // UI state
    const prev = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting…';

    try {
      const id = await insertLead(row);
      // Thank-you screen
      const resTitle = document.getElementById('result-title');
      const resBody  = document.getElementById('result-body');
      const resActions = document.getElementById('result-actions');

      resTitle.textContent = 'Thanks! Your request was submitted.';
      resBody.innerHTML = `
        Product: <strong>${row.product_type}</strong><br>
        Selections: <strong>${selections.join(', ')}</strong><br>
        Confirmation #: <strong id="conf-code" style="cursor:pointer" title="Click to copy">${id}</strong>
      `;
      resActions.innerHTML = '';
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'cta';
      again.textContent = 'Start another quote';
      again.addEventListener('click', () => location.reload());
      resActions.appendChild(again);

      document.getElementById('conf-code')?.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(id); } catch {}
      });

      show(resultScr);
    } catch (err) {
      alert(`Could not submit: ${err.message||'unknown error'}`);
      show(step3);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = prev;
    }
  });
});
