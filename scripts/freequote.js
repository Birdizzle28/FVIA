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
      ? {first:1,last:1,age:1,phone:1,email:1,address:1,city:1,state:1,cdate:1}
      : {first:1,last:1,phone:1};
    setVisibleAndRequired(p_first,   !!showSet.first);
    setVisibleAndRequired(p_last,    !!showSet.last);
    setVisibleAndRequired(p_age,     !!showSet.age);
    setVisibleAndRequired(p_phone,   !!showSet.phone);
    setVisibleAndRequired(p_email,   !!showSet.email);
    setVisibleAndRequired(p_address, !!showSet.address);
    setVisibleAndRequired(p_city,    !!showSet.city);
    setVisibleAndRequired(p_state,   !!showSet.state);
    setVisibleAndRequired(p_cdate,   !!showSet.cdate);
  }

  // REFERRAL fields
  function rememberCardRequired(card) {
    [
      card.querySelector('input[name="referral_first_name[]"]'),
      card.querySelector('input[name="referral_last_name[]"]'),
      card.querySelector('input[name="referral_age[]"]'),
      card.querySelector('input[name="referral_phone[]"]'),
      card.querySelector('input[name="referral_relationship[]"]'),
    ].forEach(rememberRequired);
  }
  function applyReferralModeToCard(card, mode) { // 'full' | 'liteAge'
    const r_first = card.querySelector('input[name="referral_first_name[]"]');
    const r_last  = card.querySelector('input[name="referral_last_name[]"]');
    const r_age   = card.querySelector('input[name="referral_age[]"]');
    const r_phone = card.querySelector('input[name="referral_phone[]"]');
    const r_rel   = card.querySelector('input[name="referral_relationship[]"]');
    const showSet = mode === "full"
      ? {first:1,last:1,age:1,phone:1,rel:1}
      : {first:1,last:1,age:1};
    setVisibleAndRequired(r_first, !!showSet.first);
    setVisibleAndRequired(r_last,  !!showSet.last);
    setVisibleAndRequired(r_age,   !!showSet.age);
    setVisibleAndRequired(r_phone, !!showSet.phone);
    setVisibleAndRequired(r_rel,   !!showSet.rel);
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

  function animateSwap(oldIdx, newIdx, direction /* 'next' | 'prev' */) {
    if (refAnimating || oldIdx === newIdx) return;
    refAnimating = true;

    const oldCard = referralCards[oldIdx];
    const newCard = referralCards[newIdx];
    if (!newCard) { refAnimating = false; return; }

    // Prepare new card
    setCardVisible(newCard, true);

    // Assign animation directions
    const enterClass = (direction === "next") ? "ref-card--enter-right" : "ref-card--enter-left";
    const exitClass  = (direction === "next") ? "ref-card--exit-left"  : "ref-card--exit-right";

    // Kick off
    newCard.classList.add(enterClass);
    if (oldCard) oldCard.classList.add(exitClass);

    const onDone = () => {
      // Clean up old
      if (oldCard) {
        setCardVisible(oldCard, false);
        oldCard.removeEventListener("animationend", onDone);
      }
      // Clean enter class on new
      newCard.classList.remove(enterClass);
      currentReferralIndex = newIdx;
      updateReferralNav();
      refAnimating = false;
    };

    // When either animation finishes last, we'll clean once (listen on exit if present, else on enter)
    if (oldCard) {
      oldCard.addEventListener("animationend", onDone, { once: true });
    } else {
      newCard.addEventListener("animationend", onDone, { once: true });
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
    const clone = referralTemplate.content.cloneNode(true);
    const card = clone.querySelector(".referral-card");

    rememberCardRequired(card);

    bindPhoneMask(card.querySelector('input[name="referral_phone[]"]'));
    const ageInput = card.querySelector('input[name="referral_age[]"]');
    ageInput?.addEventListener("input", () => {
      ageInput.value = ageInput.value.replace(/\D/g, "");
    });

    const deleteBtn = card.querySelector(".delete-referral");
    deleteBtn?.addEventListener("click", () => {
      // Animate current card out, then remove
      if (refAnimating) return;
      const idx = referralCards.indexOf(card);
      if (idx === -1) return;

      // Choose the card that will become visible next
      const targetIdx = Math.min(idx, referralCards.length - 2); // previous if last, else stays at same index (which becomes next card)
      const direction = (targetIdx < idx) ? "prev" : "next";

      // Temporarily set the target card visible so animation can play right after removal
      const onExitDone = () => {
        // Remove from DOM & array
        card.remove();
        referralCards.splice(idx, 1);

        if (referralCards.length === 0) {
          currentReferralIndex = 0;
          updateReferralNav();
          refAnimating = false;
          return;
        }

        const safeTarget = Math.max(0, Math.min(targetIdx, referralCards.length - 1));
        animateSwap(-1, safeTarget, direction); // -1 = no oldCard; we already animated the exit
      };

      // Animate this card out now
      if (!refAnimating) {
        refAnimating = true;
        card.classList.add(direction === "next" ? "ref-card--exit-left" : "ref-card--exit-right");
        card.addEventListener("animationend", onExitDone, { once: true });
      }
    });

    referralCards.push(card);
    referralSlider.appendChild(card);

    const rMode = referralModeForPath(currentPath);
    if (rMode !== "none") applyReferralModeToCard(card, rMode);

    if (referralCards.length === 1) {
      // First card—no animation
      showInitialCard(0);
    } else {
      // Animate from right when adding
      const oldIdx = currentReferralIndex;
      const newIdx = referralCards.length - 1;
      animateSwap(oldIdx, newIdx, animateFrom === "left" ? "prev" : "next");
    }
  }

  addReferralBtn.addEventListener("click", () => createReferralCard({ animateFrom: "right" }));

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

  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener("click", () => showPanel(panelChooser));
  });

  nextFromPersonalBtn.addEventListener("click", () => {
    const inputs = Array.from(panelPersonal.querySelectorAll("input, select, textarea"))
      .filter(el => el.offsetParent !== null && !el.disabled);
    for (const el of inputs) {
      if (!el.checkValidity()) {
        el.reportValidity();
        return;
      }
    }
    const rMode = referralModeForPath(currentPath);
    if (rMode === "none") {
      generateSummaryScreen();
      showPanel(summaryScreen);
    } else {
      if (referralSlider && referralSlider.children.length === 0) createReferralCard();
      Array.from(referralSlider.children).forEach(card => applyReferralModeToCard(card, rMode));
      showPanel(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  nextFromReferralBtn.addEventListener("click", () => {
    generateSummaryScreen();
    showPanel(summaryScreen);
  });

  const ageInputMain = document.querySelector('input[name="age"]');
  ageInputMain?.addEventListener("input", () => {
    ageInputMain.value = ageInputMain.value.replace(/\D/g, "");
  });

  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!quoteForm.reportValidity()) return;
    generateSummaryScreen();
    showPanel(summaryScreen);
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
   * Summary (unchanged except small guards)
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

    // PERSONAL
    if (meCheckbox.checked || ["A","C","D","B","E"].includes(path)) {
      const firstName = document.querySelector('input[name="first-name"]')?.value || "";
      const lastName  = document.querySelector('input[name="last-name"]')?.value || "";
      const fullName  = `${firstName} ${lastName}`.trim();

      const age     = document.querySelector('input[name="age"]')?.value || "";
      const phone   = document.querySelector('input[name="phone"]')?.value || "";
      const email   = document.querySelector('input[name="email"]')?.value || "";
      const address = document.querySelector('input[name="address"]')?.value || "";
      const city    = document.querySelector('input[name="city"]')?.value || "";
      const state   = document.querySelector('select[name="state"]')?.value || "";

      personalSummary.innerHTML = `
        <h3>Your Info
           <button type="button" class="icon-btn" data-action="edit-personal" aria-label="Edit your info">
             <i class="fa-regular fa-pen-to-square"></i>
           </button>
         </h3>
        <strong>${fullName}</strong><br/>
        ${age ? `Age: ${age}<br/>` : ""}
        ${phone ? `Phone: ${phone}<br/>` : ""}
        ${email ? `Email: ${email}<br/>` : ""}
        ${
          (address || city || state)
            ? `Address: ${
                address ? `${address}<br/>` : ""
              }${
                (city || state)
                  ? `${city}${city && state ? ", " : ""}${state} <span id="zip-span"></span><br/>`
                  : ""
              }`
            : ""
        }
        <hr/>
      `;

      const fullAddress = [address, city && state ? `${city}, ${state}` : (city || state)]
        .filter(Boolean).join(", ");

      if (fullAddress) {
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

    // REFERRALS
    if (["B","C","D","E"].includes(path)) {
      referralTitle && (referralTitle.style.display = "block");
      referralCards.forEach((card, index) => {
        const firstName    = card.querySelector('input[name="referral_first_name[]"]')?.value || "";
        const lastName     = card.querySelector('input[name="referral_last_name[]"]')?.value || "";
        const age          = card.querySelector('input[name="referral_age[]"]')?.value || "";
        const phone        = card.querySelector('input[name="referral_phone[]"]')?.value || "";
        const relationship = card.querySelector('input[name="referral_relationship[]"]')?.value || "";

        const item = document.createElement("div");
        item.classList.add("summary-item");
        item.innerHTML = `
          <strong>${firstName} ${lastName}</strong><br/>
          ${age ? `Age: ${age} <br/>` : ""}
          ${phone ? `Phone: ${phone} <br/>` : ""}
          ${relationship ? `Relationship: ${relationship} <br/>` : ""}
          <button type="button" class="edit-referral icon-btn" data-index="${index}"><i class="fa-regular fa-pen-to-square"></i></button>
          <button type="button" class="delete-referral" data-index="${index}"><i class="fa-solid fa-trash"></i></button>
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
      summaryScreen.style.display = "none";
      formFields.style.display = "block";
      applyPanel2ForPath(currentPath);
      const shell = panelPersonal.querySelector('.hide-in-referral');
      if (shell) shell.style.display = "";
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
      updateReferralVisibility();
      referralCards.forEach(card => applyReferralModeToCard(card, rMode));
      forceShow(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  });

  document.getElementById("summary-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-referral")) {
      const index = parseInt(e.target.dataset.index, 10);
      currentReferralIndex = Number.isFinite(index) ? index : 0;
      summaryScreen.style.display = "none";
      formFields.style.display = "";
      if (referralSlider.children.length === 0) createReferralCard();
      updateReferralVisibility();
      forceShow(panelReferral);
      return;
    }
    if (e.target.classList.contains("delete-referral")) {
      const index = parseInt(e.target.dataset.index, 10);
      if (referralCards[index]) {
        referralCards[index].remove();
        referralCards.splice(index, 1);
        currentReferralIndex = Math.min(currentReferralIndex, referralCards.length - 1);
        if (currentReferralIndex < 0) currentReferralIndex = 0;
        updateReferralVisibility();
        generateSummaryScreen();
      }
    }
  });
});
