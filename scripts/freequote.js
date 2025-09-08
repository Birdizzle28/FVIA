document.addEventListener("DOMContentLoaded", () => {
  const urlParams = new URLSearchParams(window.location.search);
  const leadTypeParam = urlParams.get("lead_type") || "Other";
  const productTypeParam = urlParams.get("product_type") || "life";

  const quoteForm = document.getElementById("quote-form");
  const productDropdown = document.getElementById("product-type-dropdown");
  const leadTypeInput = document.getElementById("lead_type");
  const productTypeInput = document.getElementById("product_type");
  const otherCheckbox = document.getElementById("otherCheckbox");
  const otherTextInput = document.getElementById("otherTextInput");

  const referralFields = document.getElementById("referral-fields");
  const contactDropdownWrapper = document.getElementById("contactDropdownWrapper");
  const contactPreference = document.getElementById("contactPreference");
  const lovedOneFields = document.getElementById("lovedOneFields");
  const addReferralBtn = document.getElementById("add-referral-btn");
  const referralSlider = document.getElementById("referral-container");
  const referralTemplate = document.getElementById("referral-template");
  const formFields = document.getElementById("form-fields");

  const quoteHeading = document.getElementById("quote-heading");
  const panelChooser  = document.getElementById("panel-chooser");
  const panelPersonal = document.getElementById("panel-personal");
  const panelReferral = document.getElementById("referral-fields");
  const summaryScreen = document.getElementById("summary-screen");

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
  // helper to show one panel
  function showPanel(panel) {
    [panelChooser, panelPersonal, panelReferral].filter(Boolean).forEach(p => p.style.display = "none");
    summaryScreen.style.display = "none";
    if (panel) panel.style.display = "block";
  }
  // start on chooser
  showPanel(panelChooser);

  let currentPanel = panelChooser;

  function slideTransition(current, next, direction) {
    const container = document.getElementById("free-quote-form");
    container.style.height = current.offsetHeight + "px";
    if (formFields.style.display === "none") {
      formFields.style.display = "block";
    }
    current.style.position = "absolute";
    next.style.position = "absolute";
    next.style.display = "block";
    if (direction === "forward") {
      current.style.transform = "translateX(0)";
      next.style.transform = "translateX(100%)";
    } else {
      current.style.transform = "translateX(0)";
      next.style.transform = "translateX(-100%)";
    }
    requestAnimationFrame(() => {
      current.style.transition = "transform 0.4s ease";
      next.style.transition = "transform 0.4s ease";
      if (direction === "forward") {
        current.style.transform = "translateX(-100%)";
        next.style.transform = "translateX(0)";
      } else {
        current.style.transform = "translateX(100%)";
        next.style.transform = "translateX(0)";
      }
    });
    next.addEventListener("transitionend", function handler() {
      next.removeEventListener("transitionend", handler);
      current.style.display = "none";
      current.style.transition = "";
      next.style.transition = "";
      current.style.transform = "";
      next.style.transform = "";
      next.style.position = "";
      if (next === summaryScreen) {
        formFields.style.display = "none";
      }
      container.style.height = "";
      currentPanel = next;
    });
  }

  // react to chooser inputs toggling (so "contactPreference" shows/hides etc)
  contactPreference.addEventListener("change", () => {
    updateContactPreferences();
    clearReferralsIfNotNeeded(determinePath());
  });

  // Next from chooser
  document.getElementById("next-from-chooser").addEventListener("click", () => {
    const path = determinePath();
    clearReferralsIfNotNeeded(path);
    const refInfo = document.getElementById("referrer-info");
    if (path === "A") {
      // Me only -> Personal
      lovedOneFields.style.display = "none";
      slideTransition(panelChooser, panelPersonal, "forward");
    } else if (path === "B") {
      // Me + You -> Personal (with loved-one subfields)
      lovedOneFields.style.display = "block";
      slideTransition(panelChooser, panelPersonal, "forward");
    } else if (path === "C") {
      // Me + Referral -> Personal first, referral later; hide "Your Info" in referral panel
      if (refInfo) refInfo.style.display = "none";
      lovedOneFields.style.display = "none";
      slideTransition(panelChooser, panelPersonal, "forward");
    } else if (path === "D") {
      // Someone Else + You -> Personal (with loved-ones), no referrer panel later
      lovedOneFields.style.display = "block";
      slideTransition(panelChooser, panelPersonal, "forward");
    } else if (path === "E") {
      // Referral only -> Referral (with "Your Info")
      if (refInfo) refInfo.style.display = "block";
      slideTransition(panelChooser, panelReferral, "forward");
    }
  });

  // Back buttons
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener("click", () => {
      slideTransition(currentPanel, panelChooser, "backward");
    });
  });

  // Next from personal
  document.getElementById("next-from-personal").addEventListener("click", () => {
    // validate only VISIBLE fields inside the personal panel
    const inputs = Array.from(panelPersonal.querySelectorAll("input, select, textarea"))
      .filter(el => el.offsetParent !== null && !el.disabled);
    for (const el of inputs) {
      if (!el.checkValidity()) {
        el.reportValidity();
        return;
      }
    }
    const path = determinePath();
    console.log("[next-from-personal] path =", path);
    if (path === "C") {
      // Me + Referral -> go to referral panel, hide "Your Info"
      const refInfo = document.getElementById("referrer-info");
      if (refInfo) refInfo.style.display = "none";
      if (referralSlider && referralSlider.children.length === 0) {
        createReferralCard();
      }
      slideTransition(panelPersonal, panelReferral, "forward");
      return;
    }
    generateSummaryScreen();
    slideTransition(panelPersonal, summaryScreen, "forward");
  });

  // Next from referral -> summary
  document.getElementById("next-from-referral").addEventListener("click", () => {
    // (optional) add any referral-only validation here
    generateSummaryScreen();
    slideTransition(panelReferral, summaryScreen, "forward");
  });

  // path detector (A/B/C/D/E)
  function determinePath() {
    const me = (document.getElementById('quoteForInput').value === "Me");
    const se = (document.getElementById('quoteForInput').value === "Someone Else");
    const contact = contactPreference?.value || "You";
    if (me && !se) return "A";                          // Me only
    if (me && se && contact === "You") return "B";      // Me + You
    if (me && se && contact === "Referral") return "C"; // Me + Referral
    if (!me && se && contact === "You") return "D";     // Someone Else + You
    if (!me && se && contact === "Referral") return "E";// Referral only
    return "A";
  }
  function clearReferralsIfNotNeeded(path) {
    if (path === "A" || path === "B" || path === "D") {
      // Clear array and DOM so no stale data shows up
      referralCards.length = 0;
      if (referralSlider) referralSlider.innerHTML = "";
    }
  }

  // ---- ADD: phone mask helpers ----
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
      // keep caret by counting digits before caret, then restoring
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
  // Bind mask to existing fields on load
  bindPhoneMask(document.querySelector('input[name="phone"]'));
  bindPhoneMask(document.querySelector('#referrer_phone'));
  document.querySelectorAll('input[name="referral_phone[]"]').forEach(bindPhoneMask);

  quoteHeading.textContent = productTypeParam === "legalshield"
    ? "LegalShield/IDShield Quote"
    : "Life Insurance Quote";

  function updateURLParams(leadType, productType) {
    const newParams = new URLSearchParams(window.location.search);
    newParams.set("lead_type", leadType);
    newParams.set("product_type", productType);
    const newUrl = `${window.location.pathname}?${newParams.toString()}`;
    history.replaceState({}, "", newUrl);
  }

  // Save original source (Facebook, Google, etc.)
  let originalLeadType = leadTypeParam;
  leadTypeInput.value = leadTypeParam;
  productTypeInput.value = productTypeParam;
  productDropdown.value = productTypeParam;

  // ✅ Helper: toggle "Other" input field visibility
  function toggleOtherText() {
    if (!otherCheckbox || !otherTextInput) return;
    if (otherCheckbox.checked) {
      otherTextInput.style.display = "block";
    } else {
      otherTextInput.style.display = "none";
      otherTextInput.value = "";
    }
  }
  function updateContactPreferences() {
    const isSomeoneElseChecked = (document.getElementById('quoteForInput').value === "Someone Else");
    const contactValue = contactPreference?.value || "You";
    const referrerInfoSection = document.getElementById("referrer-info");
    const isMeChecked = (document.getElementById('quoteForInput').value === "Me");
    // Toggle the “who do we contact?” dropdown
    contactDropdownWrapper.style.display = isSomeoneElseChecked ? "block" : "none";
    if (!isSomeoneElseChecked) {
      // Fully reset when "Someone Else" is OFF
      lovedOneFields.style.display = "none";
      referrerInfoSection.style.display = "block";
      return;
    }
    // Someone Else is ON → switch by contactPreference
    if (contactValue === "You") {
      lovedOneFields.style.display = "block";
    } else { // "Referral"
      lovedOneFields.style.display = "none";
      if (referralSlider && referralSlider.children.length === 0) {
        createReferralCard();
      }
    }
    // Show/Hide "Your Info" within referral mode
    const hideReferrerInfo = isMeChecked && isSomeoneElseChecked && contactValue === "Referral";
    referrerInfoSection.style.display = hideReferrerInfo ? "none" : "block";
  }

  // Handle lead_type: only set to "Referral" if *just* Referral mode
  const isOnlyReferral = !document.getElementById('quoteForInput').value === "Me" && document.getElementById('quoteForInput').value !== "Someone Else";
  // Final lead_type determination
  let leadTypeValue = originalLeadType;
  if (document.getElementById('quoteForInput').value === "Someone Else" && contactPreference.value === "Referral") {
    // Only Referral selected
    leadTypeValue = "Referral";
  } else if (document.getElementById('quoteForInput').value === "Someone Else" && contactPreference.value === "You") {
    // Just a Loved One you're covering
    leadTypeValue = originalLeadType;
  }
  leadTypeInput.value = leadTypeValue;
  updateURLParams(leadTypeValue, productDropdown.value);
  updateURLParams(leadTypeInput.value, productDropdown.value);

  // ✅ Initial state (in case it's pre-checked)
  if (otherCheckbox) {
    toggleOtherText();
  }

  // ✅ Event: show/hide "Other" text box
  if (otherCheckbox) {
    otherCheckbox.addEventListener("change", toggleOtherText);
  }

  // ✅ Event: Update product_type when dropdown changes
  productDropdown.addEventListener("change", () => {
    const selectedProduct = productDropdown.value;
    productTypeInput.value = selectedProduct;
    // ✅ Update heading
    quoteHeading.textContent = selectedProduct === "legalshield"
      ? "LegalShield/IDShield Quote"
      : "Life Insurance Quote";
    // ✅ Update URL
    updateURLParams(leadTypeInput.value, selectedProduct);
  });

  // Hide Fields in Referral mode
  const hideInReferralFields = document.querySelectorAll(".hide-in-referral");
  // Track originally required fields
  const originalRequiredMap = new Map();
  hideInReferralFields.forEach(el => {
    // Show personal fields if "Me" is selected
    const shouldShowPersonalFields = document.getElementById('quoteForInput').value === "Me";
    el.style.display = shouldShowPersonalFields ? "block" : "none";
    const inputs = el.querySelectorAll("input, select, textarea");
    inputs.forEach(input => {
      if (!originalRequiredMap.has(input)) {
        originalRequiredMap.set(input, input.hasAttribute("required"));
      }
      const wasOriginallyRequired = originalRequiredMap.get(input);
      if (shouldShowPersonalFields) {
        if (wasOriginallyRequired) input.setAttribute("required", "required");
      } else {
        input.removeAttribute("required");
      }
    });
  });
  function updateReferralView() {
    const isMeChecked = document.getElementById('quoteForInput').value === "Me";
    // ✅ Fix lead_type value
    const newLeadType = isMeChecked ? originalLeadType : "Referral";
    // Final lead_type determination
    let leadTypeValue = originalLeadType;
    if (document.getElementById('quoteForInput').value === "Someone Else" && contactPreference.value === "Referral") {
      // Only Referral selected
      leadTypeValue = "Referral";
    } else if (document.getElementById('quoteForInput').value === "Someone Else" && contactPreference.value === "You") {
      // Just a Loved One you're covering
      leadTypeValue = originalLeadType;
    }
    leadTypeInput.value = leadTypeValue;
    updateURLParams(leadTypeValue, productDropdown.value);
    updateURLParams(newLeadType, productDropdown.value);
    // ✅ Show/hide fields
    if (contactPreference.value === "Referral") {
      if (referralSlider.children.length === 0) createReferralCard();
    } else {
      // no action needed for "You"
    }
    // ✅ Toggle visibility and required fields
    hideInReferralFields.forEach(el => {
      el.style.display = isMeChecked ? "block" : "none";
      const inputs = el.querySelectorAll("input, select, textarea");
      inputs.forEach(input => {
        if (!originalRequiredMap.has(input)) {
          originalRequiredMap.set(input, input.hasAttribute("required"));
        }
        const wasOriginallyRequired = originalRequiredMap.get(input);
        if (isMeChecked) {
          if (wasOriginallyRequired) input.setAttribute("required", "required");
        } else {
          input.removeAttribute("required");
        }
      });
    });
  }
  // Call this on load too (in case URL opens in referral mode)
  updateReferralView();
  updateContactPreferences();

  // Update event
  // (Checkbox change events removed since selection is now via .quote-option click)

  // Limiting age to numbers
  const ageInput = document.querySelector('input[name="age"]');
  ageInput.addEventListener("input", () => {
    ageInput.value = ageInput.value.replace(/\D/g, "");
  });

  // ✅ TEMPORARY SUBMISSION HANDLER
  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!quoteForm.reportValidity()) return;
    generateSummaryScreen();
    showPanel(panelReferral);
  });

  // Referral slider
  let currentReferralIndex = 0;
  const referralCards = [];

  // Create navigation elements
  const navContainer = document.createElement("div");
  navContainer.id = "referral-nav";
  const prevBtn = document.createElement("button");
  prevBtn.id = "prev-referral";
  prevBtn.textContent = "←";
  const nextBtn = document.createElement("button");
  nextBtn.id = "next-referral";
  nextBtn.textContent = "→";
  const indexDisplay = document.createElement("div");
  indexDisplay.id = "referral-index";
  navContainer.append(prevBtn, indexDisplay, nextBtn);
  referralSlider.after(navContainer);

  function updateReferralVisibility() {
    referralCards.forEach((card, index) => {
      card.style.display = index === currentReferralIndex ? "block" : "none";
    });
    if (referralCards.length > 0) {
      indexDisplay.textContent = `Referral ${currentReferralIndex + 1} of ${referralCards.length}`;
      prevBtn.disabled = currentReferralIndex === 0;
      nextBtn.disabled = currentReferralIndex === referralCards.length - 1;
    } else {
      indexDisplay.textContent = "No referrals yet.";
      prevBtn.disabled = true;
      nextBtn.disabled = true;
    }
  }

  prevBtn.addEventListener("click", () => {
    if (currentReferralIndex > 0) {
      currentReferralIndex--;
      updateReferralVisibility();
    }
  });
  nextBtn.addEventListener("click", () => {
    if (currentReferralIndex < referralCards.length - 1) {
      currentReferralIndex++;
      updateReferralVisibility();
    }
  });

  // Modified addReferral logic to integrate with slider
  function createReferralCard() {
    const clone = referralTemplate.content.cloneNode(true);
    const card = clone.querySelector(".referral-card");
    // Bind mask for this new card's phone input
    bindPhoneMask(card.querySelector('input[name="referral_phone[]"]'));
    // Delete button logic
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
    // Enforce numeric age input
    const ageInput = card.querySelector('input[name="referral_age[]"]');
    ageInput?.addEventListener("input", () => {
      ageInput.value = ageInput.value.replace(/\D/g, "");
    });
    referralCards.push(card);
    referralSlider.appendChild(card);
    currentReferralIndex = referralCards.length - 1;
    updateReferralVisibility();
  }

  // Replace original event bind
  addReferralBtn.removeEventListener("click", createReferralCard);
  addReferralBtn.addEventListener("click", createReferralCard);
  // Call update if any default referrals exist (future-proof)
  updateReferralVisibility();

  // Generate Referral Summary
  function generateSummaryScreen() {
    const summaryScreen   = document.getElementById("summary-screen");
    const summaryList     = document.getElementById("summary-list");
    const personalSummary = document.getElementById("personal-summary");
    const referralTitle   = document.getElementById("referral-summary-title");
    const path            = determinePath(); // A/B/C/D/E

    // Clear previous summaries
    summaryList.innerHTML = "";
    personalSummary.innerHTML = "";

    // --- PERSONAL INFO SECTION ---
    if (document.getElementById('quoteForInput').value === "Me") {
      const firstName = document.querySelector('input[name="first-name"]')?.value || "";
      const lastName  = document.querySelector('input[name="last-name"]')?.value || "";
      const fullName  = `${firstName} ${lastName}`.trim();
      const age     = document.querySelector('input[name="age"]')?.value || "";
      const phone   = document.querySelector('input[name="phone"]')?.value || "";
      const email   = document.querySelector('input[name="email"]')?.value || "";
      const address = document.querySelector('input[name="address"]')?.value || "";
      const city    = document.querySelector('input[name="city"]')?.value || "";
      const state   = document.querySelector('input[name="state"]')?.value || "";
      // Build summary with a ZIP placeholder span
      personalSummary.innerHTML = `
        <h3>Your Info<button type="button" id="edit-personal-btn">Edit</button></h3>
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
      // Fill the ZIP span when we have it
      const fullAddress = [address, city && state ? `${city}, ${state}` : (city || state)]
        .filter(Boolean)
        .join(", ");
      if (fullAddress) {
        geocodeAddressGoogle(fullAddress).then(({ zip, lat, lng }) => {
          // 1) Update on-screen ZIP cleanly
          const zipSpan = document.getElementById("zip-span");
          if (zipSpan && zip) {
            zipSpan.textContent = ` ${zip}`;
          }
          // 2) Store for later submit
          const zipEl = document.getElementById("zip");
          const latEl = document.getElementById("lat");
          const lngEl = document.getElementById("lng");
          if (zipEl) zipEl.value = zip || "";
          if (latEl) latEl.value = lat ?? "";
          if (lngEl) lngEl.value = lng ?? "";
        }).catch(() => {
          /* ignore lookup errors for preview */
        });
      }
    }

    // --- REFERRAL INFO SECTION ---
    // Only show referrals for E (Referral only)
    if (path === "E") {
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
      // If in E but there are no referral cards, hide the title too
      if (referralCards.length === 0 && referralTitle) {
        referralTitle.style.display = "none";
      }
    } else {
      // Not E → hide referral section UI
      referralTitle && (referralTitle.style.display = "none");
    }
    // Show summary (formFields hidden via slideTransition)
  }

  document.getElementById("summary-screen").addEventListener("click", () => {}, { once: false });

  document.getElementById("summary-screen").addEventListener("click", (e) => {
    // Edit personal (Your Info)
    if (e.target && e.target.id === "edit-personal-btn") {
      const path = determinePath();
      formFields.style.display = "block";
      lovedOneFields.style.display = (path === "B" || path === "D") ? "block" : "none";
      slideTransition(currentPanel, panelPersonal, "backward");
    }
    // Edit referrals
    if (e.target && e.target.id === "edit-referrals-btn") {
      const path = determinePath();
      formFields.style.display = "block";
      const refInfo = document.getElementById("referrer-info");
      if (refInfo) refInfo.style.display = (path === "E") ? "block" : "none";
      if (referralSlider && referralSlider.children.length === 0) {
        createReferralCard();
      }
      slideTransition(currentPanel, panelReferral, "backward");
    }
  });

  // Handle Edit, Delete, Final Submit
  document.getElementById("summary-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-referral")) {
      const index = parseInt(e.target.dataset.index);
      currentReferralIndex = index;
      updateReferralVisibility();
      const path = determinePath();
      const refInfo = document.getElementById("referrer-info");
      if (refInfo) refInfo.style.display = (path === "E") ? "block" : "none";
      formFields.style.display = "block";
      slideTransition(currentPanel, panelReferral, "backward");
    }
    if (e.target.classList.contains("delete-referral")) {
      const index = parseInt(e.target.dataset.index);
      referralCards[index].remove();
      referralCards.splice(index, 1);
      updateReferralVisibility();
      generateSummaryScreen(); // refresh summary
    }
  });

  const options = document.querySelectorAll('.quote-option');
  const hiddenInput = document.getElementById('quoteForInput');
  const dropdown = document.getElementById('contactDropdownWrapper');

  options.forEach(option => {
    option.addEventListener('click', () => {
      // Remove selected class from all
      options.forEach(o => o.classList.remove('selected'));
      // Add selected class to clicked
      option.classList.add('selected');
      // Update hidden input value
      const value = option.getAttribute('data-value');
      hiddenInput.value = value;
      // Show/hide dropdown
      if (value === 'Someone Else') {
        dropdown.style.display = 'block';
      } else {
        dropdown.style.display = 'none';
      }
      updateContactPreferences();
      clearReferralsIfNotNeeded(determinePath());
    });
  });

  // Set default selection
  document.querySelector('.quote-option[data-value="Me"]').classList.add('selected');
  hiddenInput.value = "Me";
});
