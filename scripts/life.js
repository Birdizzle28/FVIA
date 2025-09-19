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

  // ===== Helpers
  const digitsOnly = (s) => (s || '').replace(/\D/g, '');
  const isEmail    = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || '');
  const fiveZip    = (s) => /^\d{5}$/.test(s || '');

  function enableNextCheck() {
    const ok =
      inpFirst.value.trim() &&
      inpLast.value.trim() &&
      digitsOnly(inpPhone.value).length === 10 &&
      isEmail(inpEmail.value) &&
      fiveZip(inpZip.value) &&
      tcpa.checked;
    btnNext.disabled = !ok;
  }
  // after: const callTiming = document.getElementById('call_timing');
  if (!schedulerAvailable()) {
    const opt = callTiming.querySelector('option[value="book"]');
    if (opt) opt.remove();
  }
  function schedulerAvailable(){
    return !!(window.FVG_SCHEDULER_URL || window.FVG_SCHEDULER_OPEN);
  }
  function openScheduler(){
    if (window.FVG_SCHEDULER_OPEN) return window.FVG_SCHEDULER_OPEN();
    if (window.FVG_SCHEDULER_URL)  return window.open(window.FVG_SCHEDULER_URL,'_blank');
  }
  [inpFirst, inpLast, inpPhone, inpEmail, inpZip, tcpa].forEach(el => {
    el.addEventListener('input', enableNextCheck);
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
    // Stage 1 validation
    if (!isEmail(inpEmail.value)) { inpEmail.reportValidity(); return; }
    if (digitsOnly(inpPhone.value).length !== 10) { inpPhone.reportValidity(); return; }
    if (!fiveZip(inpZip.value)) { inpZip.reportValidity(); return; }
    if (!tcpa.checked) { tcpa.reportValidity(); return; }

    // Prefill confirm phone
    confirmPhone.value = inpPhone.value;

    hide(panelShort);
    show(panelQual);
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
    // guard if user changed confirm to different valid num; prefer confirm
    const finalPhone = (confirmDigits.length === 10) ? confirmDigits : phoneDigits;

    const { text: utmText } = utmBundle();

    // referrals mini
    const referralsCount = Array.from(refList.querySelectorAll('.ref-fn'))
      .map((_, i) => {
        const fn = refList.querySelectorAll('.ref-fn')[i]?.value?.trim();
        const ln = refList.querySelectorAll('.ref-ln')[i]?.value?.trim();
        const ph = digitsOnly(refList.querySelectorAll('.ref-ph')[i]?.value || '');
        return (fn || ln || ph) ? 1 : 0;
      })
      .reduce((a,b) => a+b, 0);

    const call = callTiming.value || 'now';
    const smoker = selectedSmoker(); // 'yes'|'no'

    return {
      first_name: inpFirst.value.trim(),
      last_name:  inpLast.value.trim(),
      age:        null,                  // not used on life short form
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

  function buildSMSLink(numDigits) {
    if (!numDigits || numDigits.length !== 10) return null;
    return `sms:+1${numDigits}?&body=YES`;
  }

  function showSuccess(id, finalPhoneDigits) {
    const smsLink = buildSMSLink(finalPhoneDigits);

    resTitle.textContent = "Thanks! Your request was submitted.";
    resBody.innerHTML = `
      Product: <strong>Life Insurance</strong><br>
      ${smsLink ? `Confirm your number: <a href="${smsLink}">Text YES</a><br>` : ""}
      Confirmation #: <strong id="conf-code" style="cursor:pointer" title="Click to copy">${id || '—'}</strong>
    `;

    resActions.innerHTML = "";

    // Book a call (optional)
    if (schedulerAvailable()) {
      const btnBook = document.createElement('button');
      btnBook.type = 'button';
      btnBook.textContent = 'Book a Call';
      btnBook.addEventListener('click', () => {
        // optional event for future automations
        window.dispatchEvent(new CustomEvent('fvScheduleRequested', { detail: { product: 'life' } }));
        openScheduler();
      });
      resActions.appendChild(btnBook);
    }

    // Start another
    const btnAgain = document.createElement('button');
    btnAgain.type = 'button';
    btnAgain.textContent = 'Start another quote';
    btnAgain.addEventListener('click', () => location.reload());
    resActions.appendChild(btnAgain);

    // Enable referrals UI
    refWrap.style.display = 'block';

    // copy confirmation
    const conf = document.getElementById('conf-code');
    conf?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(id); } catch {}
    });

    hide(panelShort); hide(panelQual); show(resultScr);
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

    // Insert into Supabase
    const row = buildRow();

    // Disable while submitting
    btnSubmit.disabled = true;
    const prev = btnSubmit.textContent;
    btnSubmit.textContent = "Submitting…";

    try {
      const id = await supabaseInsert(row);
      const finalDigits = (row.phone && row.phone[0]) ? row.phone[0] : digitsOnly(confirmPhone.value);
      showSuccess(id, finalDigits);
    } catch (err) {
      showError(err?.message || 'Insert failed', true);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = prev;
    }
  });
});
