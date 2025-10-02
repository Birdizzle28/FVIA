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

  function show(panel) {
    [step1, step2, step3, resultScr].forEach(p => p.style.display = (p === panel) ? 'block' : 'none');
  }
  show(step1);

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

  /* ---------------------------
     Multi-select (chip UI, multi)
  ---------------------------- */
  function getSelections() {
    return Array.from(coverMenu.querySelectorAll('.ms-option.selected'))
      .map(lbl => (lbl.dataset.value ?? lbl.textContent).trim());
  }

  function updateCoverDisplayAndCsv() {
    const sel = getSelections();
    coverDisplay.textContent = sel.join(', '); // no default text when empty
    coverCsv.value = sel.join(',');
    updateCoverFloat(); // keep the label floated when there are picks
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
    if (!zipOk || !ageOk || picks.length === 0) {
      if (!zipOk) zip.reportValidity?.();
      if (!ageOk) age.reportValidity?.();
      if (picks.length === 0) {
        coverSelect.classList.add('has-error');
        setTimeout(()=>coverSelect.classList.remove('has-error'), 1000);
      }
      return;
    }
    if (picks.includes('My Business')) {
      show(step2); employeeCount.focus();
    } else {
      show(step3); firstName.focus();
    }
  });

  btnStep2?.addEventListener('click', () => {
    if (!employeeCount.value) { employeeCount.reportValidity(); return; }
    if (!businessName.value.trim()) { businessName.reportValidity(); return; }
    show(step3); firstName.focus();
  });

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const to = e.currentTarget.getAttribute('data-back');
      if (to === '1') show(step1);
      if (to === '2') show(step2);
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

  async function insertLead(row){
    if (!window.supabase) throw new Error('Supabase not loaded');
    const client = supabase.createClient(window.FVG_SUPABASE_URL, window.FVG_SUPABASE_ANON);
    const { data, error } = await client.from('leads').insert(row).select('id').single();
    if (error) throw new Error(error.message || 'Insert failed');
    return data?.id;
  }

  btnSubmit.addEventListener('click', async () => {
    if (!firstName.value.trim()) { firstName.reportValidity(); return; }
    if (!lastName.value.trim())  { lastName.reportValidity();  return; }
    const ten = digitsOnly(phone.value);
    if (ten.length !== 10)       { phone.setCustomValidity('Enter a valid 10-digit number.'); phone.reportValidity(); phone.setCustomValidity(''); return; }
    if (!email.checkValidity())  { email.reportValidity();     return; }

    const selections = getSelections();
    const notesParts = [
      `cover=${selections.join(',')}`,
      selections.includes('My Business') ? `biz_employees=${employeeCount.value||''}` : null,
      selections.includes('My Business') ? `biz_name=${(businessName.value||'').trim()}` : null,
      utmBundle() || null
    ].filter(Boolean);

    const row = {
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
      lng:        null,
      product_type: productTypeFromSelections(selections)
    };

    const prev = btnSubmit.textContent;
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting…';

    try {
      const id = await insertLead(row);
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
