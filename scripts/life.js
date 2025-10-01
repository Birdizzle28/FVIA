// scripts/life.js
document.addEventListener('DOMContentLoaded', () => {
  // ===== Elements
  const form        = document.getElementById('life-form');
  const panelShort  = document.getElementById('panel-short');
  const panelQual   = document.getElementById('panel-qualify');
  const resultScr   = document.getElementById('result-screen');

  const btnNext     = document.getElementById('btn-next');
  const btnSubmit   = document.getElementById('btn-submit');
  const btnsBack    = document.querySelectorAll('[data-back]');

  const inpFirst    = form.querySelector('input[name="first_name"]');
  const inpLast     = form.querySelector('input[name="last_name"]');
  const inpPhone    = form.querySelector('input[name="phone"]');
  const inpEmail    = form.querySelector('input[name="email"]');
  const inpZip      = form.querySelector('input[name="zip"]');
  const tcpa        = document.getElementById('tcpa');

  const confirmPhone= document.getElementById('confirm_phone');
  const callTiming  = document.getElementById('call_timing');
  const smokerRadios= form.querySelectorAll('input[name="smoker"]');

  const resTitle    = document.getElementById('result-title');
  const resBody     = document.getElementById('result-body');
  const resActions  = document.getElementById('result-actions');

  const refWrap     = document.getElementById('referrals');
  const refList     = document.getElementById('ref-list');
  const refAddBtn   = document.getElementById('ref-add');
  const refSubmit   = document.getElementById('ref-submit');
  const refMsg      = document.getElementById('ref-msg');

  // ===== Helpers
  const digitsOnly = (s) => (s || '').replace(/\D/g, '');
  const isEmail    = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
  const fiveZip    = (s) => /^\d{5}$/.test(s || '');

  // ---- Inline error helpers ----
  const errEls = {
    first_name: form.querySelector('[data-err="first_name"]'),
    last_name:  form.querySelector('[data-err="last_name"]'),
    phone:      form.querySelector('[data-err="phone"]'),
    email:      form.querySelector('[data-err="email"]'),
    zip:        form.querySelector('[data-err="zip"]'),
    tcpa:       null // no per-field message; we’ll highlight the label
  };
  // Chip-style selection state for smoker radios
  const smokerFieldset = form.querySelector('.smoker-group');
  const smokerLabels = smokerFieldset ? smokerFieldset.querySelectorAll('label') : [];
  
  function updateSmokerStyles(){
    smokerLabels.forEach(l => {
      const input = l.querySelector('input[type="radio"]');
      l.classList.toggle('is-checked', !!(input && input.checked));
    });
  }
  smokerRadios.forEach(r => r.addEventListener('change', updateSmokerStyles));
  updateSmokerStyles();
  // --- Inline "Pick a time" CTA beside the select ---
  const scheduleCta = document.createElement('button');
  scheduleCta.type = 'button';
  scheduleCta.id = 'btn-open-scheduler';
  scheduleCta.textContent = 'Pick a time';
  scheduleCta.style.marginLeft = '8px';
  scheduleCta.style.display = 'none';
  
  // place button right after the select, inside the same label
  const timingLabel = callTiming.closest('label');
  if (timingLabel) timingLabel.appendChild(scheduleCta);
  
  function updateScheduleCta(){
    if (callTiming.value === 'book' && schedulerAvailable()) {
      scheduleCta.style.display = 'inline-flex';
    } else {
      scheduleCta.style.display = 'none';
    }
  }
  callTiming.addEventListener('change', updateScheduleCta);
  scheduleCta.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('fvScheduleRequested', { detail: { product: 'life' } }));
    openScheduler(); // uses your existing helper
  });
  updateScheduleCta(); // init
  function setError(inputEl, key, msg) {
    const label = inputEl.closest('label') || inputEl.parentElement;
    if (!label) return;
    if (msg) {
      label.classList.add('has-error');
      if (errEls[key]) errEls[key].textContent = msg;
    } else {
      label.classList.remove('has-error');
      if (errEls[key]) errEls[key].textContent = '';
    }
  }
  
  function validateField(key) {
    switch (key) {
      case 'first_name': {
        const ok = !!inpFirst.value.trim();
        setError(inpFirst, 'first_name', ok ? '' : 'First name is required.');
        return ok;
      }
      case 'last_name': {
        const ok = !!inpLast.value.trim();
        setError(inpLast, 'last_name', ok ? '' : 'Last name is required.');
        return ok;
      }
      case 'phone': {
        const ok = /^\D?(\d\D*){10}$/.test(inpPhone.value);
        setError(inpPhone, 'phone', ok ? '' : 'Enter a valid 10-digit mobile number.');
        return ok;
      }
      case 'email': {
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inpEmail.value);
        setError(inpEmail, 'email', ok ? '' : 'Enter a valid email address.');
        return ok;
      }
      case 'zip': {
        const ok = /^\d{5}$/.test(inpZip.value);
        setError(inpZip, 'zip', ok ? '' : 'ZIP must be 5 digits.');
        return ok;
      }
      case 'tcpa': {
        const ok = tcpa.checked;
        const wrap = tcpa.closest('.tcpa-inline');
        if (wrap) wrap.classList.toggle('has-error', !ok);
        return ok;
      }
      default: return true;
    }
  }
  
  function validateAll() {
    const order = ['first_name','last_name','phone','email','zip','tcpa'];
    let firstInvalidEl = null;
    let allOk = true;
    order.forEach(k => {
      const ok = validateField(k);
      if (!ok) {
        allOk = false;
        if (!firstInvalidEl) {
          firstInvalidEl = (k === 'tcpa') ? tcpa : (
            k === 'first_name' ? inpFirst :
            k === 'last_name'  ? inpLast  :
            k === 'phone'      ? inpPhone :
            k === 'email'      ? inpEmail : inpZip
          );
        }
      }
    });
    if (!allOk && firstInvalidEl) {
      firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      firstInvalidEl.focus?.();
    }
    return allOk;
  }

  // --- Visual-only disabling for Next (keeps button clickable for scrolling) ---
  function setNextVisualDisabled(disabled) {
    btnNext.classList.toggle('is-disabled', disabled);
    // inline styles so it looks disabled even if there’s no CSS rule
    btnNext.style.opacity = disabled ? '0.45' : '';
    btnNext.style.filter  = disabled ? 'grayscale(100%)' : '';
    btnNext.style.cursor  = disabled ? 'not-allowed' : '';
  }

  function enableNextCheck() {
    const ok =
      inpFirst.value.trim() &&
      inpLast.value.trim() &&
      digitsOnly(inpPhone.value).length === 10 &&
      isEmail(inpEmail.value) &&
      fiveZip(inpZip.value) &&
      tcpa.checked;
    // visual state only (do NOT use the real disabled attr)
    setNextVisualDisabled(!ok);
  }

  // Make sure any accidental disabled attribute is cleared so clicks work
  btnNext.removeAttribute('disabled');

  [inpFirst, inpLast, inpPhone, inpEmail, inpZip, tcpa].forEach(el => {
    el.addEventListener('input', () => {
      enableNextCheck();
      // soften errors as they type
      const keyMap = {
        [inpFirst.name]: 'first_name',
        [inpLast.name]:  'last_name',
        [inpPhone.name]: 'phone',
        [inpEmail.name]: 'email',
        [inpZip.name]:   'zip'
      };
      const km = keyMap[el.name];
      if (km) validateField(km);
    });
    el.addEventListener('change', enableNextCheck);
  });
  enableNextCheck();

  // Phone mask (simple)
  function formatPhoneNumber(value) {
    const cleaned = digitsOnly(value).slice(0, 10);
    const len = cleaned.length;
    if (len === 0) return '';
    if (len < 4) return `(${cleaned}`;
    if (len < 7) return `(${cleaned.slice(0,3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0,3)}) ${cleaned.slice(3,6)}-${cleaned.slice(6)}`;
  }
  [inpPhone, confirmPhone].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
      const start = el.selectionStart ?? el.value.length;
      const digitsBefore = (el.value.slice(0, start).match(/\d/g) || []).length;
      const formatted = formatPhoneNumber(el.value);
      el.value = formatted;
      let pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsBefore) {
        if (/\d/.test(formatted[pos])) seen++;
        pos++;
      }
      el.setSelectionRange(pos, pos);
      enableNextCheck();
    });
  });

  function show(el) { el.style.display = 'block'; }
  function hide(el) { el.style.display = 'none'; }

  btnsBack.forEach(b => b.addEventListener('click', () => {
    hide(panelQual);
    show(panelShort);
  }));

  btnNext.addEventListener('click', () => {
    const ok = validateAll();
    if (!ok) {
      // show inline errors + smooth scroll (button is still clickable)
      return;
    }
    // proceed to Qualify
    confirmPhone.value = inpPhone.value;
    panelShort.style.display = 'none';
    panelQual.style.display = 'block';
  });

  refAddBtn?.addEventListener('click', () => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    row.style.margin = '.35rem 0';
    row.innerHTML = `
      <input type="text" placeholder="First name" class="ref-fn" style="flex:1; padding:.5rem; border:1px solid #ccc; border-radius:8px;" />
      <input type="text" placeholder="Last name"  class="ref-ln" style="flex:1; padding:.5rem; border:1px solid #ccc; border-radius:8px;" />
      <input type="tel"  placeholder="Mobile"     class="ref-ph" style="flex:1; padding:.5rem; border:1px solid #ccc; border-radius:8px;" />
      <button type="button" class="icon-btn ref-del" title="Remove"><i class="fa-solid fa-trash"></i></button>
    `;
    refList.appendChild(row);
    refWrap.style.display = 'block';

    const refPhone = row.querySelector('.ref-ph');
    refPhone.addEventListener('input', () => {
      const start = refPhone.selectionStart ?? refPhone.value.length;
      const digitsBefore = (refPhone.value.slice(0, start).match(/\d/g) || []).length;
      const formatted = formatPhoneNumber(refPhone.value);
      refPhone.value = formatted;
      let pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsBefore) {
        if (/\d/.test(formatted[pos])) seen++;
        pos++;
      }
      refPhone.setSelectionRange(pos, pos);
    });

    row.querySelector('.ref-del').addEventListener('click', () => {
      row.remove();
      if (!refList.children.length) refWrap.style.display = 'none';
    });
  });

  function selectedSmoker() {
    for (const r of smokerRadios) if (r.checked) return r.value;
    return 'no';
  }

  function utmBundle() {
    const p = new URLSearchParams(location.search);
    const keys = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
    const pairs = [];
    keys.forEach(k => { if (p.get(k)) pairs.push(`${k.replace('utm_','') }=${p.get(k)}`); });
    const ref = document.referrer ? `referrer=${document.referrer}` : '';
    return { text: `utm:${pairs.join('|')} ${pairs.length && ref ? '|| ' : ''}${ref}`.trim(), hasAny: !!(pairs.length || ref) };
  }

  async function supabaseInsert(row) {
    if (!window.supabase) {
      const e = new Error('Supabase client not found'); e.hard = true; throw e;
    }
    const client = supabase.createClient(window.FVG_SUPABASE_URL, window.FVG_SUPABASE_ANON);
    const { data, error } = await client.from('leads').insert(row).select('id').single();
    if (error) {
      const e = new Error(error.message || 'Insert failed');
      e.hard = true;
      throw e;
    }
    return data?.id;
  }

  async function supabaseInsertMany(rows) {
    const client = supabase.createClient(window.FVG_SUPABASE_URL, window.FVG_SUPABASE_ANON);
    const { data, error } = await client.from('leads').insert(rows).select('id');
    if (error) {
      const e = new Error(error.message || 'Insert failed');
      e.hard = true;
      throw e;
    }
    return data?.map(r => r.id) || [];
  }

  function buildNotes({ call, smoker, utmText, referralsCount }) {
    const parts = [];
    if (utmText) parts.push(utmText);
    parts.push(`qual:call=${call}|life=smoker_${smoker}`);
    parts.push(`referrals=${referralsCount}`);
    return parts.join(' || ');
  }

  function buildRow() {
    const phoneDigits = digitsOnly(inpPhone.value);
    const confirmDigits = digitsOnly(confirmPhone.value || '');
    const finalPhone = (confirmDigits.length === 10) ? confirmDigits : phoneDigits;

    const { text: utmText } = utmBundle();

    // NOTE: At primary submit time, referrals list is empty (count = 0). Referrals are submitted later.
    const referralsCount = 0;

    const call = callTiming.value || 'now';
    const smoker = selectedSmoker(); // 'yes'|'no'

    return {
      first_name: inpFirst.value.trim(),
      last_name:  inpLast.value.trim(),
      age:        null,
      city:       null,
      zip:        inpZip.value.trim(),
      lead_type:  'Web',
      notes:      buildNotes({ call, smoker, utmText, referralsCount }),
      submitted_by:      window.FVG_WEBSITE_SUBMITTER_ID,
      submitted_by_name: window.FVG_WEBSITE_SUBMITTER_NAME || 'Website Lead',
      assigned_to: null,
      assigned_at: null,
      phone:      finalPhone ? [finalPhone] : [],
      address:    null,
      state:      null,
      lat:        null,
      lng:        null,
      product_type: 'life'
    };
  }

  function schedulerAvailable(){
    return !!(window.FVG_SCHEDULER_URL || window.FVG_SCHEDULER_OPEN);
  }
  function openScheduler(){
    if (window.FVG_SCHEDULER_OPEN) return window.FVG_SCHEDULER_OPEN();
    if (window.FVG_SCHEDULER_URL)  return window.open(window.FVG_SCHEDULER_URL,'_blank');
  }

  function showSuccess(id) {
    const call = (document.getElementById('call_timing')?.value || 'now');
    const humanCall =
      call === 'now' ? 'We’ll call you in the next few minutes.' :
      call === '15m' ? 'We’ll call you in about 15 minutes.' :
      'We’ll reach out to schedule a time.';

    resTitle.textContent = "Thanks! Your request was submitted.";
    resBody.innerHTML = `
      Product: <strong>Life Insurance</strong><br>
      ${humanCall}<br>
      Confirmation #: <strong id="conf-code" style="cursor:pointer" title="Click to copy">${id || '—'}</strong>
    `;

    resActions.innerHTML = "";

    if (schedulerAvailable()) {
      const btnBook = document.createElement('button');
      btnBook.type = 'button';
      btnBook.textContent = 'Book a Call';
      btnBook.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('fvScheduleRequested', { detail: { product: 'life' } }));
        openScheduler();
      });
      resActions.appendChild(btnBook);
    }

    const btnAgain = document.createElement('button');
    btnAgain.type = 'button';
    btnAgain.textContent = 'Start another quote';
    btnAgain.addEventListener('click', () => location.reload());
    resActions.appendChild(btnAgain);

    refWrap.style.display = 'block';

    const conf = document.getElementById('conf-code');
    conf?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(id); } catch {} });

    hide(panelShort); hide(panelQual); show(resultScr);

    // stash parent lead id for referrals
    form.dataset.parentLeadId = id || '';
    form.dataset.referrerName = `${inpFirst.value.trim()} ${inpLast.value.trim()}`.trim();
  }

  function showError(message, hard = true) {
    resTitle.textContent = hard
      ? "Please fix a few things and try again."
      : "Hmm, that didn’t go through.";
    resBody.textContent = message || (hard ? "There were validation issues." : "Network or temporary error.");
    resActions.innerHTML = "";

    const btnBack = document.createElement('button');
    btnBack.type = 'button';
    btnBack.textContent = hard ? 'Go back and edit' : 'Try again';
    btnBack.addEventListener('click', () => {
      hide(resultScr);
      if (hard) { hide(panelQual); show(panelShort); }
      else { hide(resultScr); show(panelQual); }
    });
    resActions.appendChild(btnBack);

    hide(panelShort); hide(panelQual); show(resultScr);
  }

  btnSubmit.addEventListener('click', async () => {
    // Stage 2 validation
    if (digitsOnly(confirmPhone.value).length !== 10) { confirmPhone.reportValidity(); return; }
    if (!callTiming.value) { callTiming.reportValidity(); return; }

    // Insert primary lead
    const row = buildRow();

    btnSubmit.disabled = true;
    const prev = btnSubmit.textContent;
    btnSubmit.textContent = "Submitting…";

    try {
      const id = await supabaseInsert(row);
      showSuccess(id);
    } catch (err) {
      showError(err?.message || 'Insert failed', true);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = prev;
    }
  });

  // ===== Referrals submission =====
  refSubmit?.addEventListener('click', async () => {
    refMsg.textContent = "";
    const parentId = form.dataset.parentLeadId || "";
    const referrer  = form.dataset.referrerName || "";

    // Collect rows
    const fns = Array.from(refList.querySelectorAll('.ref-fn'));
    const lns = Array.from(refList.querySelectorAll('.ref-ln'));
    const phs = Array.from(refList.querySelectorAll('.ref-ph'));

    const rows = [];
    for (let i=0; i<phs.length; i++){
      const fn = fns[i]?.value?.trim() || "";
      const ln = lns[i]?.value?.trim() || "";
      const ph = digitsOnly(phs[i]?.value || "");
      if (!ph || ph.length !== 10) continue;     // require a valid 10-digit phone
      if (!fn && !ln) continue;                  // require at least a name piece

      rows.push({
        first_name: fn || "Friend",
        last_name:  ln || "",
        age:        null,
        city:       null,
        zip:        null,
        lead_type:  'Referral',
        notes:      `referred_by=${parentId}${referrer ? `|referrer=${referrer}` : ''}`,
        submitted_by:      window.FVG_WEBSITE_SUBMITTER_ID,
        submitted_by_name: window.FVG_WEBSITE_SUBMITTER_NAME || 'Website Lead',
        assigned_to: null,
        assigned_at: null,
        phone:      [ph],
        address:    null,
        state:      null,
        lat:        null,
        lng:        null,
        product_type: 'life'
      });
    }

    if (!rows.length){
      refMsg.textContent = "Please add at least one valid referral (name + 10-digit mobile).";
      return;
    }

    // Insert referrals
    refSubmit.disabled = true;
    const prev = refSubmit.innerHTML;
    refSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting…';

    try {
      await supabaseInsertMany(rows);
      refMsg.textContent = `Thanks! Submitted ${rows.length} referral${rows.length>1?'s':''}.`;
      Array.from(refList.querySelectorAll('input')).forEach(i => i.disabled = true);
    } catch (err) {
      refMsg.textContent = `Could not submit referrals: ${err?.message || 'unknown error'}.`;
    } finally {
      refSubmit.disabled = false;
      refSubmit.innerHTML = prev;
    }
  });
});
