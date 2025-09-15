// scripts/freequote.js
document.addEventListener("DOMContentLoaded", () => {
  /******************
   * Cached elements
   ******************/
  const urlParams = new URLSearchParams(window.location.search);
  const leadTypeParam = urlParams.get("lead_type") || "Other";
  const productTypeParam = urlParams.get("product_type") || "life";

  const quoteForm = document.getElementById("quote-form");
  const productDropdown = document.getElementById("product-type-dropdown");
  const leadTypeInput = document.getElementById("lead_type");
  const productTypeInput = document.getElementById("product_type");

  const quoteForCheckboxes = document.querySelectorAll('input[name="quote-for"]');
  const meCheckbox = document.querySelector('input[name="quote-for"][value="Me"]');
  const someoneElseCheckbox = document.getElementById("someoneElseCheckbox");
  const contactDropdownWrapper = document.getElementById("contactDropdownWrapper");
  const contactPreference = document.getElementById("contactPreference");

  const addReferralBtn = document.getElementById("add-referral-btn");
  const referralSlider = document.getElementById("referral-container");
  const referralTemplate = document.getElementById("referral-template");
  const refNav  = document.getElementById("referral-nav");
  const refPrev = document.getElementById("ref-prev");
  const refNext = document.getElementById("ref-next");
  const refPage = document.getElementById("ref-page");

  const quoteHeading = document.getElementById("quote-heading");
  const panelChooser  = document.getElementById("panel-chooser");
  const panelPersonal = document.getElementById("panel-personal");
  const panelReferral = document.getElementById("referral-fields");
  const summaryScreen = document.getElementById("summary-screen");
  const formFields    = document.getElementById("form-fields");

  const nextFromChooserBtn  = document.getElementById("next-from-chooser");
  const nextFromPersonalBtn = document.getElementById("next-from-personal");
  const nextFromReferralBtn = document.getElementById("next-from-referral");

  // Optional
  const otherCheckbox  = document.getElementById("otherCheckbox");
  const otherTextInput = document.getElementById("otherTextInput");

  /******************
   * Globals
   ******************/
  let currentPath = "A";
  let currentReferralIndex = 0;
  const referralCards = [];
  const originalRequired = new WeakMap();
  let refAnimating = false; // guard for rapid clicks

  // NEW: track re-entry from summary to avoid stale animation state
  let cameFromSummary = false;

  // NEW-SAFETY: debounce for rapid Add clicks
  let addClickLocked = false;

  // small helpers
  const getRow = (inputEl) => inputEl?.closest("label, div") || inputEl;
  const rememberRequired = (inputEl) => {
    if (inputEl && !originalRequired.has(inputEl)) {
      originalRequired.set(inputEl, inputEl.hasAttribute("required"));
    }
  };
  const setVisibleAndRequired = (inputEl, show) => {
    if (!inputEl) return;
    const row = getRow(inputEl);
    row.style.display = show ? "" : "none";
    if (show) {
      if (originalRequired.get(inputEl)) inputEl.setAttribute("required", "required");
    } else {
      inputEl.removeAttribute("required");
    }
  };

  // NEW: helper to know if a field is currently "in use" (i.e., its row is shown)
  const fieldInUse = (el) => {
    if (!el) return false;
    const row = getRow(el);
    return row && row.style.display !== "none";
  };

  // ENSURE-VISIBLE: guarantees at least one card is visible
  function ensureOneCardVisible(targetIdx = null) {
    if (!referralCards.length) return;
    const idx = targetIdx != null
      ? Math.max(0, Math.min(targetIdx, referralCards.length - 1))
      : Math.max(0, Math.min(currentReferralIndex, referralCards.length - 1));

    const anyVisible = referralCards.some(c => c && c.style.display !== "none");
    if (!anyVisible) {
      referralCards.forEach((c, i) => setCardVisible(c, i === idx));
      currentReferralIndex = idx;
      refAnimating = false;
      updateReferralNav();
    }
  }

  function updateReferralNav() {
    const total = referralCards.length;
    refNav.style.display = total > 0 ? "flex" : "none";
    if (refPage) {
      const page = total === 0 ? 0 : (currentReferralIndex + 1);
      refPage.textContent = `${page} of ${total}`;
    }
    if (refPrev) refPrev.disabled = currentReferralIndex <= 0;
    if (refNext) refNext.disabled = currentReferralIndex >= total - 1;
  }

  function wireRelationship(card) {
    const relSelect = card.querySelector('.relationship-group .rel-select');
    const relInput  = card.querySelector('input[name="referral_relationship[]"]');
    if (!relSelect || !relInput) return;

    const sync = () => {
      const isOther = relSelect.value === 'Other';
      // show/hide the text input; manage required flags
      relInput.style.display = isOther ? '' : 'none';
      relInput.required = isOther;
      relSelect.required = !isOther;

      // keep the canonical named input up-to-date for submit
      if (!isOther) relInput.value = relSelect.value || '';
    };

    relSelect.addEventListener('change', sync);
    // initialize on create
    sync();
  }

  // Flatpickr
  if (window.flatpickr) {
    flatpickr("#contact-date", {
      dateFormat: "m/d/Y",
      altInput: true,
      altFormat: "F j, Y",
      allowInput: true
    });
  }

  /******************
   * Phone mask
   ******************/
  function formatPhoneNumber(value) {
    const cleaned = value.replace(/\D/g, "").slice(0, 10);
    const len = cleaned.length;
    if (len === 0) return "";
    if (len < 4) return `(${cleaned}`;
    if (len < 7) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  function bindPhoneMask(input) {
    if (!input) return;
    input.addEventListener("input", () => {
      const start = input.selectionStart ?? input.value.length;
      const digitsBefore = (input.value.slice(0, start).match(/\d/g) || []).length;
      const formatted = formatPhoneNumber(input.value);
      input.value = formatted;
      let pos = 0, seen = 0;
      while (pos < formatted.length && seen < digitsBefore) {
        if (/\d/.test(formatted[pos])) seen++;
        pos++;
      }
      input.setSelectionRange(pos, pos);
    });
  }
  bindPhoneMask(document.querySelector('input[name="phone"]'));
  document.querySelectorAll('input[name="referral_phone[]"]').forEach(bindPhoneMask);

  /******************
   * Panels show/hide
   ******************/
  function showPanel(panelToShow) {
    const panels = [panelChooser, panelPersonal, panelReferral, summaryScreen];
    panels.forEach(panel => {
      if (!panel) return;
      if (panel === panelToShow) {
        panel.classList.add("slide-in");
        panel.classList.remove("slide-out");
        panel.style.display = "block";
      } else {
        if (panel.style.display === "block") {
          panel.classList.add("slide-out");
          panel.classList.remove("slide-in");
          panel.addEventListener("animationend", () => {
            panel.style.display = "none";
          }, { once: true });
        }
      }
    });
  }
  function forceShow(panelToShow) {
    const panels = [panelChooser, panelPersonal, panelReferral, summaryScreen];
    panels.forEach(p => {
      if (!p) return;
      p.style.display = (p === panelToShow) ? "block" : "none";
      p.classList.remove("slide-in", "slide-out");
    });
  }

  // Start on chooser
  showPanel(panelChooser);

  /******************
   * URL + heading setup
   ******************/
  leadTypeInput.value = leadTypeParam;
  productTypeInput.value = productTypeParam;
  productDropdown.value = productTypeParam;
  quoteHeading.textContent = productTypeParam === "legalshield" ? "Legal/Identity Protection" : "Life Insurance";

  function updateURLParams(leadType, productType) {
    const newParams = new URLSearchParams(window.location.search);
    newParams.set("lead_type", leadType);
    newParams.set("product_type", productType);
    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    history.replaceState({}, "", newUrl);
  }

  productDropdown.addEventListener("change", () => {
    const selectedProduct = productDropdown.value;
    productTypeInput.value = selectedProduct;
    quoteHeading.textContent = selectedProduct === "legalshield"
      ? "Legal/Identity Protection"
      : "Life Insurance";
    updateURLParams(leadTypeInput.value, selectedProduct);
  });

  // Optional "Other" toggle
  function toggleOtherText() {
    if (!otherCheckbox || !otherTextInput) return;
    otherTextInput.style.display = otherCheckbox.checked ? "block" : "none";
    if (!otherCheckbox.checked) otherTextInput.value = "";
  }
  if (otherCheckbox) {
    toggleOtherText();
    otherCheckbox.addEventListener("change", toggleOtherText);
  }

  /******************
   * Path detection
   ******************/
  function determinePath() {
    const me = !!meCheckbox?.checked;
    const se = !!someoneElseCheckbox?.checked;
    const contact = contactPreference?.value || "You";
    if (me && !se) return "A";
    if (!me && se && contact === "Referral") return "B";
    if (me && se && contact === "You") return "C";
    if (me && se && contact === "Referral") return "D";
    if (!me && se && contact === "You") return "E";
    return "A";
  }

  /******************
   * Field visibility per panel
   ******************/
  // PERSONAL fields
  const p_first   = panelPersonal.querySelector('input[name="first-name"]');
  const p_last    = panelPersonal.querySelector('input[name="last-name"]');
  const p_age     = panelPersonal.querySelector('input[name="age"]');
  const p_phone   = panelPersonal.querySelector('input[name="phone"]');
  const p_email   = panelPersonal.querySelector('input[name="email"]');
  const p_address = panelPersonal.querySelector('input[name="address"]');
  const p_city    = panelPersonal.querySelector('input[name="city"]');
  const p_state   = panelPersonal.querySelector('select[name="state"]');
  const p_cdate   = panelPersonal.querySelector('input[name="contact-date"]');
  const lbl_first = p_first?.closest('label');
  const lbl_last  = p_last?.closest('label');
  const lbl_phone = p_phone?.closest('label');

  function cacheBaseLabel(labelEl) {
    if (!labelEl || labelEl.dataset.baseLabel) return;
    const raw = (labelEl.textContent || "").trim();
    const base = (raw.match(/^[^:]+/)?.[0] || raw).trim();
    labelEl.dataset.baseLabel = base;
  }
  function setLabelPrefix(labelEl, prefix) {
    if (!labelEl) return;
    cacheBaseLabel(labelEl);
    const base = labelEl.dataset.baseLabel || "";
    const finalText = `${prefix ? prefix + ' ' : ''}${base}: `;
    let textNode = null;
    for (const n of labelEl.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) { textNode = n; break; }
    }
    if (textNode) textNode.nodeValue = finalText;
    else labelEl.insertBefore(document.createTextNode(finalText), labelEl.firstChild);
  }
  function updatePersonalLabelsForPath(path) {
    const prefix = (path === "B" || path === "E") ? "Your" : "";
    setLabelPrefix(lbl_first, prefix);
    setLabelPrefix(lbl_last,  prefix);
    setLabelPrefix(lbl_phone, prefix);
  }
  [p_first,p_last,p_age,p_phone,p_email,p_address,p_city,p_state,p_cdate].forEach(rememberRequired);

  function togglePersonalMode(mode) { // 'full' | 'liteContact'
    const showSet = mode === "full"
      ? {first:1,last:1,age:1,phone:1,email:1,address:1,city:1,state:1,}
      : {first:1,last:1,phone:1};
    setVisibleAndRequired(p_first,   !!showSet.first);
    setVisibleAndRequired(p_last,    !!showSet.last);
    setVisibleAndRequired(p_age,     !!showSet.age);
    setVisibleAndRequired(p_phone,   !!showSet.phone);
    setVisibleAndRequired(p_email,   !!showSet.email);
    setVisibleAndRequired(p_address, !!showSet.address);
    setVisibleAndRequired(p_city,    !!showSet.city);
    setVisibleAndRequired(p_state,   !!showSet.state);
    setVisibleAndRequired(p_cdate,   false);
  }

  // REFERRAL fields
  function rememberCardRequired(card) {
    [
      card.querySelector('input[name="referral_first_name[]"]'),
      card.querySelector('input[name="referral_last_name[]"]'),
      card.querySelector('input[name="referral_age[]"]'),
      card.querySelector('input[name="referral_phone[]"]'),
      card.querySelector('.relationship-group .rel-select'),
      card.querySelector('input[name="referral_relationship[]"]'),
    ].forEach(rememberRequired);
  }
  function applyReferralModeToCard(card, mode) { // 'full' | 'liteAge'
    const r_first = card.querySelector('input[name="referral_first_name[]"]');
    const r_last  = card.querySelector('input[name="referral_last_name[]"]');
    const r_age   = card.querySelector('input[name="referral_age[]"]');
    const r_phone = card.querySelector('input[name="referral_phone[]"]');

    const relGroup  = card.querySelector('.relationship-group');
    const relSelect = card.querySelector('.relationship-group .rel-select');
    const relInput  = card.querySelector('input[name="referral_relationship[]"]');

    const showSet = mode === "full"
      ? {first:1,last:1,age:1,phone:1,rel:1}
      : {first:1,last:1,age:1}; // liteAge = no phone, no relationship

    setVisibleAndRequired(r_first, !!showSet.first);
    setVisibleAndRequired(r_last,  !!showSet.last);
    setVisibleAndRequired(r_age,   !!showSet.age);
    setVisibleAndRequired(r_phone, !!showSet.phone);

    if (relGroup) relGroup.style.display = showSet.rel ? "" : "none";
    if (!showSet.rel) {
      if (relSelect) relSelect.required = false;
      if (relInput)  relInput.required  = false;
    } else {
      // when visible, the select is required unless "Other"
      if (relSelect) relSelect.required = relSelect.value !== 'Other';
      if (relInput)  relInput.required  = relSelect && relSelect.value === 'Other';
    }
  }
  function referralModeForPath(path) {
    if (path === "B" || path === "D") return "full";
    if (path === "C" || path === "E") return "liteAge";
    return "none";
  }
  function personalModeForPath(path) {
    if (path === "B" || path === "E") return "liteContact";
    return "full";
  }

  /******************
   * Chooser UI
   ******************/
  function updateChooserUI() {
    const isSE = !!someoneElseCheckbox?.checked;
    contactDropdownWrapper.style.display = isSE ? "block" : "none";
  }

  /******************
   * === Slider helpers (referral cards) ===
   ******************/
  function setCardVisible(card, visible) {
    if (!card) return;
    if (visible) {
      card.classList.add("active");
      card.style.display = "block";
      card.style.opacity = "1";
    } else {
      card.classList.remove("active");
      card.style.display = "none";
      card.style.opacity = "0";
      // Clean animation classes
      card.classList.remove("ref-card--enter-right","ref-card--enter-left","ref-card--exit-left","ref-card--exit-right");
    }
  }

  // NEW: hard reset of referral panel when re-entering from summary
  function resetReferralPanelState() {
    currentReferralIndex = Math.max(0, Math.min(currentReferralIndex, referralCards.length - 1));
    referralCards.forEach(c => {
      if (!c) return;
      c.classList.remove(
        "ref-card--enter-right","ref-card--enter-left",
        "ref-card--exit-left","ref-card--exit-right"
      );
    });
    referralCards.forEach((c,i) => setCardVisible(c, i === currentReferralIndex));
    refAnimating = false;
    updateReferralNav();
  }

  function animateSwap(oldIdx, newIdx, direction /* 'next' | 'prev' */) {
    if (refAnimating || oldIdx === newIdx) return;
    refAnimating = true;

    const oldCard = referralCards[oldIdx];
    const newCard = referralCards[newIdx];
    if (!newCard) { refAnimating = false; return; }

    // Make sure the incoming card is visible before animating
    setCardVisible(newCard, true);

    const enterClass = (direction === "next") ? "ref-card--enter-right" : "ref-card--enter-left";
    const exitClass  = (direction === "next") ? "ref-card--exit-left"  : "ref-card--exit-right";

    // If user prefers reduced motion, just swap without animating
    const prefersReduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) {
      if (oldCard) setCardVisible(oldCard, false);
      currentReferralIndex = newIdx;
      updateReferralNav();
      refAnimating = false;
      return;
    }

    // Kick off animations (in next frame to guarantee start)
    requestAnimationFrame(() => {
      newCard.classList.add(enterClass);
      if (oldCard) oldCard.classList.add(exitClass);
    });

    let cleaned = false;
    const onDone = () => {
      if (cleaned) return;
      cleaned = true;

      if (oldCard) setCardVisible(oldCard, false);
      newCard.classList.remove(enterClass);

      currentReferralIndex = newIdx;
      updateReferralNav();
      refAnimating = false;

      // ENSURE-VISIBLE: in case animationend/fallback sequencing hid both
      setTimeout(() => ensureOneCardVisible(currentReferralIndex), 0);
    };

    // Fallback in case animationend doesn't fire
    const fallback = setTimeout(onDone, 500);

    const handler = () => { clearTimeout(fallback); onDone(); };
    if (oldCard) {
      oldCard.addEventListener("animationend", handler, { once: true });
    } else {
      newCard.addEventListener("animationend", handler, { once: true });
    }
  }

  function showInitialCard(index) {
    referralCards.forEach((c,i) => setCardVisible(c, i === index));
    currentReferralIndex = index;
    updateReferralNav();
  }

  /******************
   * Create + manage referral cards
   ******************/
  function updateReferralVisibility() {
    // Fallback non-animated refresh (used after deletes)
    referralCards.forEach((card, index) => {
      setCardVisible(card, index === currentReferralIndex);
    });
    updateReferralNav();
  }

  function createReferralCard({animateFrom = "right"} = {}) {
    // NEW-SAFETY: soft debounce to avoid back-to-back collisions
    if (addClickLocked) return;
    addClickLocked = true;
    setTimeout(() => { addClickLocked = false; }, 250);

    const clone = referralTemplate.content.cloneNode(true);
    const card = clone.querySelector(".referral-card");

    rememberCardRequired(card);

    bindPhoneMask(card.querySelector('input[name="referral_phone[]"]'));
    const ageInput = card.querySelector('input[name="referral_age[]"]');
    ageInput?.addEventListener("input", () => {
      ageInput.value = ageInput.value.replace(/\D/g, "");
    });
    wireRelationship(card);
    const deleteBtn = card.querySelector(".delete-referral");
    deleteBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (refAnimating) return;

      const idx = referralCards.indexOf(card);
      if (idx === -1) return;

      // Remove the card from DOM + array
      card.remove();
      referralCards.splice(idx, 1);

      // If nothing left, auto-create a fresh blank card so the panel isn't "empty"
      if (referralCards.length === 0) {
        createReferralCard({ animateFrom: "right" });
        currentReferralIndex = 0;
        updateReferralVisibility();
        return;
      }

      // Otherwise, show the neighbor (prefer the next card, else previous)
      const targetIdx = Math.min(idx, referralCards.length - 1);
      currentReferralIndex = targetIdx;
      updateReferralVisibility(); // quick, stable refresh (no complex exit/enter chaining)
    });

    referralCards.push(card);
    referralSlider.appendChild(card);

    const rMode = referralModeForPath(currentPath);
    if (rMode !== "none") applyReferralModeToCard(card, rMode);

    const newIdx = referralCards.length - 1;

    // If an animation is running, just force-show the new card (stabilize)
    if (refAnimating) {
      referralCards.forEach((c,i) => setCardVisible(c, i === newIdx));
      currentReferralIndex = newIdx;
      updateReferralNav();
      refAnimating = false;
      ensureOneCardVisible(currentReferralIndex);
      return;
    }

    // If we just returned from summary, first add shows directly (no animation)
    if (cameFromSummary) {
      referralCards.forEach((c,i) => setCardVisible(c, i === newIdx));
      currentReferralIndex = newIdx;
      updateReferralNav();
      cameFromSummary = false;
      ensureOneCardVisible(currentReferralIndex);
      return;
    }

    // CHANGE: show new card immediately on add (avoid animation race on Chrome/iOS)
    referralCards.forEach((c,i) => setCardVisible(c, i === newIdx));
    currentReferralIndex = newIdx;
    updateReferralNav();
    ensureOneCardVisible(currentReferralIndex);
  }

  // NEW-SAFETY: ignore Add clicks while animating + temp disable the button
  addReferralBtn.addEventListener("click", () => {
    if (refAnimating) return;
    addReferralBtn.disabled = true;
    setTimeout(() => { addReferralBtn.disabled = false; }, 260);
    createReferralCard({ animateFrom: "right" });
  });

  /******************
   * Panel 2 + Panel 3 application
   ******************/
  function applyPanel2ForPath(path) {
    panelPersonal.style.display = "block";
    const mode = personalModeForPath(path);
    togglePersonalMode(mode);
    updatePersonalLabelsForPath(path);
  }

  function goToPanel3ForPath(path) {
    const rMode = referralModeForPath(path);
    if (rMode === "none") {
      generateSummaryScreen();
      showPanel(summaryScreen);
      return;
    }
    if (referralSlider && referralSlider.children.length === 0) {
      createReferralCard();
    }
    referralCards.forEach(card => applyReferralModeToCard(card, rMode));
    showPanel(panelReferral);
    panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /******************
   * Navigation flows
   ******************/
  function updateNextButtonState() {
    const isAnySelected = !!meCheckbox?.checked || !!someoneElseCheckbox?.checked;
    nextFromChooserBtn.disabled = !isAnySelected;
    nextFromChooserBtn.classList.toggle("disabled", nextFromChooserBtn.disabled);
  }

  // Fake selectable boxes
  document.querySelectorAll('.quote-option').forEach(box => {
    box.addEventListener('click', () => {
      const target = box.getAttribute('data-checkbox');
      if (target === 'bothOption') {
        const bothSelected = meCheckbox.checked && someoneElseCheckbox.checked;
        meCheckbox.checked = !bothSelected;
        someoneElseCheckbox.checked = !bothSelected;
        meCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        someoneElseCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const checkbox = document.getElementById(target);
        if (!checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      updateChooserUI();
      updateNextButtonState();
    });
  });

  const bothOption = document.getElementById("bothOption");
  function syncBothOption() {
    if (!bothOption) return;
    const bothOn = !!meCheckbox.checked && !!someoneElseCheckbox.checked;
    bothOption.classList.toggle("selected", bothOn);
  }
  function updateFakeBoxSelection() {
    const meBox = document.querySelector('.quote-option[data-checkbox="meCheckbox"]');
    const seBox = document.querySelector('.quote-option[data-checkbox="someoneElseCheckbox"]');
    if (meBox) meBox.classList.toggle('selected', !!meCheckbox.checked);
    if (seBox) seBox.classList.toggle('selected', !!someoneElseCheckbox.checked);
    syncBothOption();
  }
  meCheckbox.addEventListener("change", updateFakeBoxSelection);
  someoneElseCheckbox.addEventListener("change", updateFakeBoxSelection);
  updateFakeBoxSelection();

  quoteForCheckboxes.forEach(cb => {
    cb.addEventListener("change", () => {
      updateChooserUI();
      updateNextButtonState();
      updateFakeBoxSelection();
    });
  });
  contactPreference.addEventListener("change", () => {
    updateChooserUI();
    updateNextButtonState();
  });

  nextFromChooserBtn.addEventListener("click", () => {
    currentPath = determinePath();
    togglePersonalMode(personalModeForPath(currentPath));
    updatePersonalLabelsForPath(currentPath);
    showPanel(panelPersonal);
  });

  // REPLACE the old [data-back] handler with this:
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      const parent = e.currentTarget.closest('.panel');
  
      // make sure the form area is visible (summary hidden)
      formFields.style.display = "block";
      summaryScreen.style.display = "none";
  
      if (parent === panelPersonal) {
        // panel 2 -> back to panel 1 (chooser)
        showPanel(panelChooser);
      } else if (parent === panelReferral) {
        // panel 3 -> back to panel 2 (personal)
        applyPanel2ForPath(currentPath);
        showPanel(panelPersonal);
      } else {
        // fallback
        showPanel(panelChooser);
      }
    });
  });

  nextFromPersonalBtn.addEventListener("click", () => {
    // validate only visible fields
    const inputs = Array.from(panelPersonal.querySelectorAll("input, select, textarea"))
      .filter(el => el.offsetParent !== null && !el.disabled);
    for (const el of inputs) {
      if (!el.checkValidity()) {
        el.reportValidity();
        return;
      }
    }

    // keep shell visible unless we intentionally go to summary
    formFields.style.display = "block";
    summaryScreen.style.display = "none";

    // IMPORTANT: recompute path in case user changed choices
    currentPath = determinePath();
    const rMode = referralModeForPath(currentPath);

    if (rMode === "none") {
      // straight to summary (this will hide formFields inside)
      generateSummaryScreen();
      // no showPanel race—summaryScreen is not animated
      return;
    }

    // going to referrals
    if (referralSlider && referralSlider.children.length === 0) {
      createReferralCard();
    }
    referralCards.forEach(card => applyReferralModeToCard(card, rMode));

    // hard-switch to the referrals panel (avoids both being hidden mid-animation)
    forceShow(panelReferral);
    panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  nextFromReferralBtn.addEventListener("click", () => {
    // validate every referral card (not just the visible one)
    for (let i = 0; i < referralCards.length; i++) {
      const card = referralCards[i];
  
      // ensure canonical relationship input mirrors the select when not "Other"
      const relSelect = card.querySelector('.relationship-group .rel-select');
      const relInput  = card.querySelector('input[name="referral_relationship[]"]');
      if (relSelect && relInput && relSelect.value !== 'Other') {
        relInput.value = relSelect.value || '';
      }
  
      // check required inputs/selects in this card
      const inputs = Array.from(card.querySelectorAll('input, select, textarea'))
        .filter(el => !el.disabled && el.required);
  
      const firstInvalid = inputs.find(el => !el.checkValidity());
      if (firstInvalid) {
        // bring the offending card into view and show the message
        if (i !== currentReferralIndex) {
          animateSwap(currentReferralIndex, i, i > currentReferralIndex ? 'next' : 'prev');
        }
        firstInvalid.reportValidity();
        return; // stop; user needs to fix this card
      }
    }
  
    // --- NEW: cancel any lingering slide classes/animations before leaving ---
    refAnimating = false;
    referralCards.forEach(c => c && c.classList.remove(
      "ref-card--enter-right","ref-card--enter-left",
      "ref-card--exit-left","ref-card--exit-right"
    ));
  
    // Go to summary (this function already hides formFields & shows summary)
    generateSummaryScreen();
    // IMPORTANT: do NOT call showPanel(summaryScreen) here (avoids race/blank)
  });

  const ageInputMain = document.querySelector('input[name="age"]');
  ageInputMain?.addEventListener("input", () => {
    ageInputMain.value = ageInputMain.value.replace(/\D/g, "");
  });
  function buildPayload() {
    // pull product & path
    const product = productTypeInput?.value || "life";
    const leadType = leadTypeInput?.value || "Other";
    const contactPref = contactPreference?.value || "You";
  
    // personal (only include if field shown)
    const personal = {};
    const addIf = (key, el) => {
      if (el && el.closest("label,div")?.style.display !== "none" && el.value?.trim()) {
        personal[key] = el.value.trim();
      }
    };
    addIf("first_name", p_first);
    addIf("last_name",  p_last);
    addIf("age",        p_age);
    addIf("phone",      p_phone);
    addIf("email",      p_email);
    addIf("address",    p_address);
    addIf("city",       p_city);
    addIf("state",      p_state);
  
    // hidden geocode fields (only if present)
    const zip = document.getElementById("zip")?.value || "";
    const lat = document.getElementById("lat")?.value || "";
    const lng = document.getElementById("lng")?.value || "";
    if (zip) personal.zip = zip;
    if (lat) personal.lat = lat;
    if (lng) personal.lng = lng;
  
    // referrals (respect visibility on each card)
    const referrals = referralCards.map(card => {
      const pick = sel => card.querySelector(sel);
      const inUse = el => el && (el.closest("label,div")?.style.display !== "none");
      const r = {};
      const f = pick('input[name="referral_first_name[]"]');
      const l = pick('input[name="referral_last_name[]"]');
      const a = pick('input[name="referral_age[]"]');
      const ph= pick('input[name="referral_phone[]"]');
      const relIn = pick('input[name="referral_relationship[]"]');
      if (inUse(f)  && f.value.trim())  r.first_name   = f.value.trim();
      if (inUse(l)  && l.value.trim())  r.last_name    = l.value.trim();
      if (inUse(a)  && a.value.trim())  r.age          = a.value.trim();
      if (inUse(ph) && ph.value.trim()) r.phone        = ph.value.trim();
      // relationship group uses container display
      const relGroup = card.querySelector('.relationship-group');
      if (relGroup && relGroup.style.display !== "none" && relIn?.value.trim()) {
        r.relationship = relIn.value.trim();
      }
      return r;
    }).filter(obj => Object.keys(obj).length > 0);
  
    return {
      product_type: product,
      lead_type: leadType,
      path: currentPath,
      contact_preference: contactPref,
      personal,
      referrals
    };
  }
  
  // Wire to your backend (Supabase via Netlify function placeholder)
  async function submitLead(payload) {
    const res = await fetch("/.netlify/functions/submit-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      let msg = "Network error";
      try { const j = await res.json(); msg = j?.error || msg; } catch {}
      const err = new Error(msg);
      err.hard = res.status === 400 || res.status === 422; // treat 4xx validation as hard failure
      throw err;
    }
    // Expect { id: "...", reference?: "..." }
    const data = await res.json();
    return { id: data.id, reference: data.reference || data.id };
  }
  
  function showResultScreenSuccess({ reference, product, contactPref, refCount }) {
    const resTitle = document.getElementById("result-title");
    const resBody  = document.getElementById("result-body");
    const actions  = document.getElementById("result-actions");
  
    resTitle.textContent = "Thanks! Your request was submitted.";
    const who = (refCount > 0 && contactPref === "Referral")
      ? "We’ll reach out to your referral(s) directly."
      : "We’ll contact you first.";
    resBody.innerHTML =
      `Product: <strong>${product === "legalshield" ? "Legal/Identity Protection" : "Life Insurance"}</strong><br>` +
      (refCount ? `Referrals submitted: <strong>${refCount}</strong><br>` : "") +
      `${who}<br>` +
      (reference ? `Confirmation #: <strong id="conf-code" style="cursor:pointer" title="Click to copy">${reference}</strong>` : "");
  
    // actions
    actions.innerHTML = "";
    const btnAgain = document.createElement("button");
    btnAgain.type = "button";
    btnAgain.textContent = "Start another quote";
    const btnView = document.createElement("button");
    btnView.type = "button";
    btnView.textContent = "View summary";
    actions.appendChild(btnAgain);
    actions.appendChild(btnView);
  
    // handlers
    btnAgain.addEventListener("click", () => {
      // reset form + UI back to panel 1
      quoteForm.reset();
      referralCards.splice(0, referralCards.length);
      referralSlider.innerHTML = "";
      currentReferralIndex = 0;
      updateChooserUI();
      updateNextButtonState();
      showPanel(panelChooser);
      document.getElementById("result-screen").style.display = "none";
      document.getElementById("summary-screen").style.display = "none";
      formFields.style.display = "block";
    });
    btnView.addEventListener("click", () => {
      document.getElementById("result-screen").style.display = "none";
      formFields.style.display = "none";
      document.getElementById("summary-screen").style.display = "block";
    });
  
    // copy confirmation
    const conf = document.getElementById("conf-code");
    conf?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(reference); } catch {}
    });
  
    // show
    formFields.style.display = "none";
    document.getElementById("summary-screen").style.display = "none";
    document.getElementById("result-screen").style.display = "block";
  }
  
  function showResultScreenSoftFail(message) {
    const resTitle = document.getElementById("result-title");
    const resBody  = document.getElementById("result-body");
    const actions  = document.getElementById("result-actions");
  
    resTitle.textContent = "Hmm, that didn’t go through.";
    resBody.textContent  = message || "We couldn’t submit your request right now. Your information is still on this page.";
    actions.innerHTML = "";
  
    const btnRetry = document.createElement("button");
    btnRetry.type = "button";
    btnRetry.textContent = "Try again";
    const btnDownload = document.createElement("button");
    btnDownload.type = "button";
    btnDownload.textContent = "Download summary";
    actions.appendChild(btnRetry);
    actions.appendChild(btnDownload);
  
    btnRetry.addEventListener("click", () => {
      document.getElementById("result-screen").style.display = "none";
      // go back to summary so they can hit submit again
      formFields.style.display = "none";
      document.getElementById("summary-screen").style.display = "block";
    });
    btnDownload.addEventListener("click", () => window.print());
  
    formFields.style.display = "none";
    document.getElementById("summary-screen").style.display = "none";
    document.getElementById("result-screen").style.display = "block";
  }
  
  function showResultScreenHardFail(message) {
    const resTitle = document.getElementById("result-title");
    const resBody  = document.getElementById("result-body");
    const actions  = document.getElementById("result-actions");
  
    resTitle.textContent = "Please fix a few things and try again.";
    resBody.textContent  = message || "There were validation issues on the server.";
    actions.innerHTML = "";
  
    const btnEdit = document.createElement("button");
    btnEdit.type = "button";
    btnEdit.textContent = "Go back and edit";
    const btnCancel = document.createElement("button");
    btnCancel.type = "button";
    btnCancel.textContent = "Cancel";
    actions.appendChild(btnEdit);
    actions.appendChild(btnCancel);
  
    btnEdit.addEventListener("click", () => {
      // return to the right panel (if referrals exist, go there; else personal)
      document.getElementById("result-screen").style.display = "none";
      if (referralCards.length) {
        forceShow(panelReferral);
      } else {
        forceShow(panelPersonal);
      }
    });
    btnCancel.addEventListener("click", () => {
      document.getElementById("result-screen").style.display = "none";
      formFields.style.display = "none";
      document.getElementById("summary-screen").style.display = "block";
    });
  
    formFields.style.display = "none";
    document.getElementById("summary-screen").style.display = "none";
    document.getElementById("result-screen").style.display = "block";
  }
  
  // Print link on result screen
  document.addEventListener("click", (e) => {
    const a = e.target.closest("#print-summary-link");
    if (a) {
      e.preventDefault();
      window.print();
    }
  });
  
  quoteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
  
    // re-validate summary state (form was already validated when reaching summary)
    if (!quoteForm.reportValidity()) return;
  
    const submitBtn = document.getElementById("submit-final");
    const prev = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
  
    try {
      const payload = buildPayload();
      const result  = await submitLead(payload);
      const product = productTypeInput?.value || "life";
      const contactPref = contactPreference?.value || "You";
      const refCount = (payload.referrals || []).length;
  
      showResultScreenSuccess({
        reference: result.reference,
        product,
        contactPref,
        refCount
      });
    } catch (err) {
      if (err.hard) {
        showResultScreenHardFail(err.message);
      } else {
        showResultScreenSoftFail(err.message);
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prev;
    }
  });

  updateChooserUI();
  updateNextButtonState();

  /******************
   * Prev/Next for referral slider
   ******************/
  refPrev?.addEventListener("click", () => {
    if (refAnimating) return;
    if (currentReferralIndex > 0) {
      animateSwap(currentReferralIndex, currentReferralIndex - 1, "prev");
    }
  });
  refNext?.addEventListener("click", () => {
    if (refAnimating) return;
    if (currentReferralIndex < referralCards.length - 1) {
      animateSwap(currentReferralIndex, currentReferralIndex + 1, "next");
    }
  });

  /******************
   * Summary (updated to respect "in use" + geocode gate)
   ******************/
  async function geocodeAddressGoogle(fullAddress) {
    if (!fullAddress) return { zip: "", lat: "", lng: "" };
    const endpoint = "/.netlify/functions/geocode";
    try {
      const r = await fetch(`${endpoint}?address=${encodeURIComponent(fullAddress)}`, {
        headers: { "Accept": "application/json" }
      });
      if (!r.ok) return { zip: "", lat: "", lng: "" };
      const data = await r.json();
      return { zip: data.zip || "", lat: data.lat ?? "", lng: data.lng ?? "" };
    } catch {
      return { zip: "", lat: "", lng: "" };
    }
  }

  function generateSummaryScreen() {
    const summaryList     = document.getElementById("summary-list");
    const personalSummary = document.getElementById("personal-summary");
    const referralTitle   = document.getElementById("referral-summary-title");
    const path            = currentPath;
    summaryList.innerHTML = "";
    personalSummary.innerHTML = "";

    // PERSONAL (only show fields that are in use)
    if (meCheckbox.checked || ["A","C","D","B","E"].includes(path)) {
      const firstInUse = fieldInUse(p_first);
      const lastInUse  = fieldInUse(p_last);
      const ageInUse   = fieldInUse(p_age);
      const phoneInUse = fieldInUse(p_phone);
      const emailInUse = fieldInUse(p_email);
      const addrInUse  = fieldInUse(p_address);
      const cityInUse  = fieldInUse(p_city);
      const stateInUse = fieldInUse(p_state);
      const cdateInUse = fieldInUse(p_cdate);

      const firstName = (firstInUse ? (p_first?.value || "") : "");
      const lastName  = (lastInUse  ? (p_last?.value  || "") : "");
      const fullName  = `${firstName} ${lastName}`.trim();

      const age       = (ageInUse   ? (p_age?.value   || "") : "");
      const phone     = (phoneInUse ? (p_phone?.value || "") : "");
      const email     = (emailInUse ? (p_email?.value || "") : "");
      const address   = (addrInUse  ? (p_address?.value || "") : "");
      const city      = (cityInUse  ? (p_city?.value    || "") : "");
      const state     = (stateInUse ? (p_state?.value   || "") : "");
      const cdate     = (cdateInUse ? (p_cdate?.value   || "") : "");

      let personalHTML = `
        <h3>Your Information
           <button type="button" class="icon-btn" data-action="edit-personal" aria-label="Edit your info">
             <i class="fa-regular fa-pen-to-square"></i>
           </button>
         </h3>
      `;

      if (fullName) personalHTML += `<strong>${fullName}</strong><br/>`;
      if (age)       personalHTML += `Age: ${age}<br/>`;
      if (phone)     personalHTML += `Phone: ${phone}<br/>`;
      if (email)     personalHTML += `Email: ${email}<br/>`;
      if (cdate)     personalHTML += `Best time to contact: ${cdate}<br/>`;

      // Address block only if any of the address fields are in use and have values
      if ((addrInUse || cityInUse || stateInUse) && (address || city || state)) {
        personalHTML += `Address: ${address ? `${address}<br/>` : ""}`;
        if (city || state) {
          personalHTML += `${city}${city && state ? ", " : ""}${state} <span id="zip-span"></span><br/>`;
        }
      }

      // finish section if anything was printed
      personalHTML += `<hr/>`;
      personalSummary.innerHTML = personalHTML;

      // Geocode ONLY if the Address input itself is in use and we have something to geocode
      const fullAddress = [address, (city && state) ? `${city}, ${state}` : (city || state)]
        .filter(Boolean).join(", ");
      if (addrInUse && fullAddress) {
        geocodeAddressGoogle(fullAddress).then(({ zip, lat, lng }) => {
          const zipSpan = document.getElementById("zip-span");
          if (zipSpan && zip) zipSpan.textContent = ` ${zip}`;
          const zipEl = document.getElementById("zip");
          const latEl = document.getElementById("lat");
          const lngEl = document.getElementById("lng");
          if (zipEl) zipEl.value = zip || "";
          if (latEl) latEl.value = lat ?? "";
          if (lngEl) lngEl.value = lng ?? "";
        }).catch(() => {});
      }
    }

    // REFERRALS (only include fields that are in use for each card)
    if (["B","C","D","E"].includes(path)) {
      referralTitle && (referralTitle.style.display = "block");
      referralCards.forEach((card, index) => {
        const r_first = card.querySelector('input[name="referral_first_name[]"]');
        const r_last  = card.querySelector('input[name="referral_last_name[]"]');
        const r_age   = card.querySelector('input[name="referral_age[]"]');
        const r_phone = card.querySelector('input[name="referral_phone[]"]');
        const relGrp  = card.querySelector('.relationship-group');
        const relInpt = card.querySelector('input[name="referral_relationship[]"]');

        const firstName = fieldInUse(r_first) ? (r_first?.value || "") : "";
        const lastName  = fieldInUse(r_last)  ? (r_last?.value  || "") : "";
        const age       = fieldInUse(r_age)   ? (r_age?.value   || "") : "";

        const phoneInUse = fieldInUse(r_phone);
        const phone      = phoneInUse ? (r_phone?.value || "") : "";

        const relInUse   = relGrp && relGrp.style.display !== "none";
        const relationship = relInUse ? (relInpt?.value || "") : "";

        const item = document.createElement("div");
        item.classList.add("summary-item");
        item.innerHTML = `
          <strong>${[firstName, lastName].filter(Boolean).join(" ")}</strong><button type="button" class="edit-referral icon-btn" data-index="${index}"><i class="fa-regular fa-pen-to-square"></i></button><br/>
          ${age ? `Age: ${age} <br/>` : ""}
          ${phone ? `Phone: ${phone} <br/>` : ""}
          ${relationship ? `Relationship: ${relationship} <br/>` : ""}
          <hr/>
        `;
        summaryList.appendChild(item);
      });

      if (referralCards.length === 0 && referralTitle) {
        referralTitle.style.display = "none";
      }
    } else {
      referralTitle && (referralTitle.style.display = "none");
    }

    formFields.style.display = "none";
    summaryScreen.style.display = "block";
  }

  document.getElementById("summary-screen").addEventListener("click", (e) => {
    const hitPersonal  = e.target.closest('[data-action="edit-personal"], #edit-personal-btn');
    const hitReferrals = e.target.closest('[data-action="edit-referrals"], #edit-referrals-btn');

    if (hitPersonal) {
      // show only panel 2; hide everything else
      formFields.style.display = "block";
      summaryScreen.style.display = "none";

      // ensure other panels are hidden
      panelChooser.style.display  = "none";
      panelReferral.style.display = "none";

      // re-apply the right subset + labels for current path
      applyPanel2ForPath(currentPath);

      // show panel 2 without animation to avoid race conditions
      forceShow(panelPersonal);
      panelPersonal.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (hitReferrals) {
      summaryScreen.style.display = "none";
      formFields.style.display = "block";
      const rMode = referralModeForPath(currentPath);
      if (rMode !== "none" && referralSlider.children.length === 0) createReferralCard();
      currentReferralIndex = Math.min(currentReferralIndex, referralCards.length - 1);
      if (currentReferralIndex < 0) currentReferralIndex = 0;
      referralCards.forEach(card => applyReferralModeToCard(card, rMode));

      // NEW: mark we came from summary and hard reset panel state
      cameFromSummary = true;
      resetReferralPanelState();

      forceShow(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  });

  document.getElementById("summary-list").addEventListener("click", (e) => {
    const editBtn = e.target.closest(".edit-referral");
    const delBtn  = e.target.closest(".delete-referral");

    if (editBtn) {
      const index = parseInt(editBtn.dataset.index, 10);
      currentReferralIndex = Number.isFinite(index) ? index : 0;

      // make the form area visible again
      summaryScreen.style.display = "none";
      formFields.style.display = "block";

      // ensure there's at least one card
      if (referralSlider.children.length === 0) createReferralCard();

      // re-apply mode to cards
      const rMode = referralModeForPath(currentPath);
      referralCards.forEach(card => applyReferralModeToCard(card, rMode));

      // NEW: mark we came from summary and hard reset panel state
      cameFromSummary = true;
      resetReferralPanelState();

      // show the panel
      forceShow(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (delBtn) {
      const index = parseInt(delBtn.dataset.index, 10);
      if (referralCards[index]) {
        referralCards[index].remove();
        referralCards.splice(index, 1);
        currentReferralIndex = Math.min(currentReferralIndex, referralCards.length - 1);
        if (currentReferralIndex < 0) currentReferralIndex = 0;

        // If list becomes empty, reflect that and avoid weird nav states
        if (referralCards.length === 0) {
          const referralTitle = document.getElementById("referral-summary-title");
          if (referralTitle) referralTitle.style.display = "none";
        }

        updateReferralVisibility();
        generateSummaryScreen();
      }
    }
  });
  // Add a Back button to the summary (panel 4) and center with Submit
  (function setupSummaryNav(){
    const submit = document.getElementById("submit-final");
    if (!submit) return;
  
    // Avoid duplicating the nav if this runs again
    if (submit.parentElement && submit.parentElement.classList.contains("panel-nav")) return;
  
    const nav = document.createElement("div");
    nav.className = "panel-nav";
  
    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.id = "back-from-summary";
    backBtn.textContent = "Back";
  
    // Move existing Submit into the new centered nav row
    nav.appendChild(backBtn);
    nav.appendChild(submit);
  
    const summary = document.getElementById("summary-screen");
    summary.appendChild(nav);
  
    // Back from summary: go to referrals when they exist, otherwise to personal
    backBtn.addEventListener("click", () => {
      formFields.style.display = "block";
      summaryScreen.style.display = "none";
  
      const rMode = referralModeForPath(currentPath);
      if (rMode === "none") {
        // No referrals in this path -> back to Panel 2
        applyPanel2ForPath(currentPath);
        showPanel(panelPersonal);
        return;
      }
  
      // Has referrals -> back to Panel 3
      if (referralSlider.children.length === 0) createReferralCard();
      referralCards.forEach(card => applyReferralModeToCard(card, rMode));
      cameFromSummary = true;            // reuse your existing flag
      resetReferralPanelState();         // reuse your existing hard reset
      showPanel(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  })();
});
