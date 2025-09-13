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

  const quoteHeading = document.getElementById("quote-heading");
  const panelChooser  = document.getElementById("panel-chooser");
  const panelPersonal = document.getElementById("panel-personal");
  const panelReferral = document.getElementById("referral-fields");
  const summaryScreen = document.getElementById("summary-screen");
  const formFields    = document.getElementById("form-fields");

  const nextFromChooserBtn  = document.getElementById("next-from-chooser");
  const nextFromPersonalBtn = document.getElementById("next-from-personal");
  const nextFromReferralBtn = document.getElementById("next-from-referral");

  // Optional elements that might not exist (safe-guarded)
  const otherCheckbox  = document.getElementById("otherCheckbox");
  const otherTextInput = document.getElementById("otherTextInput");

  /******************
   * Globals
   ******************/
  let currentPath = "A";
  let currentReferralIndex = 0;
  const referralCards = [];
  const originalRequired = new WeakMap(); // remembers each input's *initial* required state

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

  // Flatpickr for contact date
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
  // Start on chooser
  showPanel(panelChooser);

  /******************
   * URL + heading setup
   ******************/
  let originalLeadType = leadTypeParam;
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

  // Optional "Other" toggle (safe if not present)
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
   * Path detection (YOUR mapping)
   * A: me && !se
   * B: !me && se && contact === "Referral"
   * C: me && se && contact === "You"
   * D: me && se && contact === "Referral"
   * E: !me && se && contact === "You"
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

  // remember original required for personal inputs once
  [p_first,p_last,p_age,p_phone,p_email,p_address,p_city,p_state,p_cdate].forEach(rememberRequired);

  function togglePersonalMode(mode /* 'full' | 'liteContact' */) {
    const showSet = mode === "full"
      ? {first:1,last:1,age:1,phone:1,email:1,address:1,city:1,state:1,cdate:1}
      : {first:1,last:1,phone:1}; // liteContact

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

  // REFERRAL fields (apply to every card)
  function rememberCardRequired(card) {
    [
      card.querySelector('input[name="referral_first_name[]"]'),
      card.querySelector('input[name="referral_last_name[]"]'),
      card.querySelector('input[name="referral_age[]"]'),
      card.querySelector('input[name="referral_phone[]"]'),
      card.querySelector('input[name="referral_relationship[]"]'),
    ].forEach(rememberRequired);
  }

  function applyReferralModeToCard(card, mode /* 'full' | 'liteAge' */) {
    const r_first = card.querySelector('input[name="referral_first_name[]"]');
    const r_last  = card.querySelector('input[name="referral_last_name[]"]');
    const r_age   = card.querySelector('input[name="referral_age[]"]');
    const r_phone = card.querySelector('input[name="referral_phone[]"]');
    const r_rel   = card.querySelector('input[name="referral_relationship[]"]');

    const showSet = mode === "full"
      ? {first:1,last:1,age:1,phone:1,rel:1}
      : {first:1,last:1,age:1}; // liteAge (no phone, no relationship)

    setVisibleAndRequired(r_first, !!showSet.first);
    setVisibleAndRequired(r_last,  !!showSet.last);
    setVisibleAndRequired(r_age,   !!showSet.age);
    setVisibleAndRequired(r_phone, !!showSet.phone);
    setVisibleAndRequired(r_rel,   !!showSet.rel);
  }

  function referralModeForPath(path) {
    // Panel 3 expectations:
    // A -> NONE, B -> FULL, C -> LITE (first,last,age), D -> FULL, E -> LITE
    if (path === "B" || path === "D") return "full";
    if (path === "C" || path === "E") return "liteAge";
    return "none";
  }
  function personalModeForPath(path) {
    // Panel 2 expectations:
    // A -> FULL, B -> LITE (first,last,phone), C -> FULL, D -> FULL, E -> LITE
    if (path === "B" || path === "E") return "liteContact";
    return "full";
  }

  /******************
   * Chooser UI: contact pref dropdown only when "Someone Else" is checked
   ******************/
  function updateChooserUI() {
    const isSE = !!someoneElseCheckbox?.checked;
    contactDropdownWrapper.style.display = isSE ? "block" : "none";
  }

  /******************
   * Create + manage referral cards
   ******************/
  function updateReferralVisibility() {
    referralCards.forEach((card, index) => {
      card.style.display = index === currentReferralIndex ? "block" : "none";
    });
  }

  function createReferralCard() {
    const clone = referralTemplate.content.cloneNode(true);
    const card = clone.querySelector(".referral-card");

    // remember required flags for inputs inside this card
    rememberCardRequired(card);

    // Mask + numeric
    bindPhoneMask(card.querySelector('input[name="referral_phone[]"]'));
    const ageInput = card.querySelector('input[name="referral_age[]"]');
    ageInput?.addEventListener("input", () => {
      ageInput.value = ageInput.value.replace(/\D/g, "");
    });

    // delete btn
    const deleteBtn = card.querySelector(".delete-referral");
    deleteBtn?.addEventListener("click", () => {
      const idx = referralCards.indexOf(card);
      if (idx > -1) {
        referralCards.splice(idx, 1);
        card.remove();
        if (currentReferralIndex >= referralCards.length) {
          currentReferralIndex = Math.max(0, referralCards.length - 1);
        }
        updateReferralVisibility();
      }
    });

    referralCards.push(card);
    referralSlider.appendChild(card);
    currentReferralIndex = referralCards.length - 1;
    updateReferralVisibility();

    // Ensure the right subset is visible for the current path
    const rMode = referralModeForPath(currentPath);
    if (rMode !== "none") applyReferralModeToCard(card, rMode);
  }

  addReferralBtn.addEventListener("click", createReferralCard);

  /******************
   * Path application helpers
   ******************/
  function applyPanel2ForPath(path) {
    // Ensure the personal container is visible; we will show/hide specific fields inside it
    panelPersonal.style.display = "block";
    const mode = personalModeForPath(path);
    togglePersonalMode(mode);
  }

  function goToPanel3ForPath(path) {
    const rMode = referralModeForPath(path);
    if (rMode === "none") {
      // Skip referral → go straight to summary
      generateSummaryScreen();
      showPanel(summaryScreen);
      return;
    }
    // Need referral panel; ensure at least one card exists
    if (referralSlider && referralSlider.children.length === 0) {
      createReferralCard();
    }
    // Apply mode to all existing cards (in case user flipped paths)
    referralCards.forEach(card => applyReferralModeToCard(card, rMode));
    showPanel(panelReferral);
    panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /******************
   * Navigation flows
   ******************/
  // enable/disable "Next" on chooser
  function updateNextButtonState() {
    const isAnySelected = !!meCheckbox?.checked || !!someoneElseCheckbox?.checked;
    nextFromChooserBtn.disabled = !isAnySelected;
    nextFromChooserBtn.classList.toggle("disabled", nextFromChooserBtn.disabled);
  }

  // Fake selectable boxes sync
  document.querySelectorAll('.quote-option').forEach(box => {
  box.addEventListener('click', () => {
    const target = box.getAttribute('data-checkbox');

    if (target === 'bothOption') {
      // Toggle both real checkboxes
      const bothSelected = meCheckbox.checked && someoneElseCheckbox.checked;
      meCheckbox.checked = !bothSelected;
      someoneElseCheckbox.checked = !bothSelected;

      // Fire change so listeners run (VERY important)
      meCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
      someoneElseCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      // Toggle just one
      const checkbox = document.getElementById(target);
      if (!checkbox) return;

      checkbox.checked = !checkbox.checked;

      // Fire change so listeners run (VERY important)
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Keep the rest of the UI in sync
    updateChooserUI();
    updateNextButtonState();
  });
});
  
// --- Keep all three boxes synced visually ---
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

// set initial state on load
updateFakeBoxSelection();

  // Also respond to raw checkbox changes (if any)
  quoteForCheckboxes.forEach(cb => {
    cb.addEventListener("change", () => {
      updateChooserUI();
      updateNextButtonState();
      updateFakeBoxSelection(); // keep visuals synced
    });
  });
  contactPreference.addEventListener("change", () => {
    updateChooserUI();
    updateNextButtonState();
  });

  // Next from chooser → always go to Panel 2 (personal), with subset based on path
  nextFromChooserBtn.addEventListener("click", () => {
    currentPath = determinePath();
    togglePersonalMode(personalModeForPath(currentPath))
    showPanel(panelPersonal);
  });

  // Back buttons just return to chooser
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener("click", () => showPanel(panelChooser));
  });

  // Next from personal → either referral (Panel 3) or summary (Panel 4) depending on path
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
    
    const rMode = referralModeForPath(currentPath);
    
    if (rMode === "none") {
      // A: no referral → summary
      generateSummaryScreen();
      showPanel(summaryScreen);
    } else {
      // B/C/D/E: referral step
      if (referralSlider && referralSlider.children.length === 0) createReferralCard();
      // apply subset to all existing cards (in case user changed path)
      Array.from(referralSlider.children).forEach(card => applyReferralModeToCard(card, rMode));
      showPanel(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // Next from referral → summary
  nextFromReferralBtn.addEventListener("click", () => {
    generateSummaryScreen();
    showPanel(summaryScreen);
  });

  // Age input (main personal): numeric only
  const ageInputMain = document.querySelector('input[name="age"]');
  ageInputMain?.addEventListener("input", () => {
    ageInputMain.value = ageInputMain.value.replace(/\D/g, "");
  });

  // Final submit → keep on summary (don't jump to referral)
  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!quoteForm.reportValidity()) return;
    generateSummaryScreen();
    showPanel(summaryScreen);
    // TODO: replace with real submit later
  });

  // Initial chooser UI
  updateChooserUI();
  updateNextButtonState();

  /******************
   * Summary (kept from your code, minor hardening)
   ******************/
  // --- Google Geocoding (ZIP + lat/lng) ---
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
    if (meCheckbox.checked || ["A","C","D"].includes(path) || ["B","E"].includes(path)) {
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

    // REFERRALS in summary:
    // Show only for B, C, D, E. (A = none)
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
          <button type="button" class="edit-referral" data-index="${index}">Edit</button>
          <button type="button" class="delete-referral" data-index="${index}">Delete</button>
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

    // show summary + hide form fields
    formFields.style.display = "none";
    summaryScreen.style.display = "block";
  }

  // Edit buttons inside summary
  document.getElementById("summary-screen").addEventListener("click", (e) => {
  const hitPersonal  = e.target.closest('[data-action="edit-personal"], #edit-personal-btn');
  const hitReferrals = e.target.closest('[data-action="edit-referrals"], #edit-referrals-btn');

  if (hitPersonal) {
    // Hide summary, show form and personal panel
    summaryScreen.style.display = "none";
    formFields.style.display = ""; // reset to CSS default (safer than "block")

    // Re-apply visibility for personal fields based on path
    applyPanel2ForPath(currentPath);

    // Defensive: ensure the personal shell isn’t hidden
    const shell = panelPersonal.querySelector('.hide-in-referral');
    if (shell) shell.style.display = "";

    showPanel(panelPersonal);
    panelPersonal.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  if (hitReferrals) {
    // Hide summary, show form and referral panel
    summaryScreen.style.display = "none";
    formFields.style.display = "";

    // Ensure at least one card exists if referrals are required
    const rMode = referralModeForPath(currentPath);
    if (rMode !== "none" && referralSlider.children.length === 0) {
      createReferralCard();
    }

    // Make sure a card is actually visible
    currentReferralIndex = Math.min(currentReferralIndex, referralCards.length - 1);
    if (currentReferralIndex < 0) currentReferralIndex = 0;
    updateReferralVisibility();

    // Re-apply the correct field subset to all cards
    referralCards.forEach(card => applyReferralModeToCard(card, rMode));

    showPanel(panelReferral);
    panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
});

  // Edit/delete per referral within summary list
  document.getElementById("summary-list").addEventListener("click", (e) => {
  if (e.target.classList.contains("edit-referral")) {
    const index = parseInt(e.target.dataset.index, 10);
    currentReferralIndex = Number.isFinite(index) ? index : 0;

    // Show form + referrals panel
    summaryScreen.style.display = "none";
    formFields.style.display = "";

    // Ensure cards/modes/visibility are correct
    const rMode = referralModeForPath(currentPath);
    if (referralSlider.children.length === 0) createReferralCard();
    updateReferralVisibility();
    referralCards.forEach(card => applyReferralModeToCard(card, rMode));

    showPanel(panelReferral);
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
