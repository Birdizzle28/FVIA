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

  const quoteForCheckboxes = document.querySelectorAll('input[name="quote-for"]');
  const meCheckbox = document.querySelector('input[name="quote-for"][value="Me"]');
  const referralFields = document.getElementById("referral-fields");
  const someoneElseCheckbox = document.getElementById("someoneElseCheckbox");
  const contactDropdownWrapper = document.getElementById("contactDropdownWrapper");
  const contactPreference = document.getElementById("contactPreference");
  const addReferralBtn = document.getElementById("add-referral-btn");
  const referralSlider = document.getElementById("referral-container");
  const referralTemplate = document.getElementById("referral-template");
  const formFields = document.getElementById("form-fields");
  
  const quoteHeading = document.getElementById("quote-heading");
  const panelChooser  = document.getElementById("panel-chooser");
  const panelPersonal = document.getElementById("panel-personal");
  const panelReferral = document.getElementById("referral-fields");
  const summaryScreen = document.getElementById("summary-screen");
  const indexDisplay = document.createElement("div");
  const prevBtn = document.createElement("button");
  const nextBtn = document.createElement("button");
  // Referral slider
  let currentReferralIndex = 0;
  const referralCards = [];
  const nextFromChooserBtn = document.getElementById("next-from-chooser");
  
  // --- Google Geocoding (ZIP + lat/lng) ---
  async function geocodeAddressGoogle(fullAddress) {
    if (!fullAddress) return { zip: "", lat: "", lng: "" };
    
      // Netlify functions endpoint
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
  function showPanel(panelToShow) {
    const panels = [panelChooser, panelPersonal, panelReferral, summaryScreen];
  
    panels.forEach(panel => {
      if (panel) {
        if (panel === panelToShow) {
          panel.classList.add("slide-in");
          panel.classList.remove("slide-out");
          panel.style.display = "block";
        } else {
          if (panel.style.display === "block") {
            panel.classList.add("slide-out");
            panel.classList.remove("slide-in");
  
            // Hide the panel after animation ends
            panel.addEventListener("animationend", () => {
              panel.style.display = "none";
            }, { once: true });
          }
        }
      }
    });
  }
  // start on chooser
  showPanel(panelChooser);
  
  // react to chooser inputs toggling (so "contactPreference" shows/hides etc)
  quoteForCheckboxes.forEach((cb) => {
    cb.addEventListener("change", () => {
      updateContactPreferences();
      clearReferralsIfNotNeeded(determinePath()); // <-- add
    });
  });
  contactPreference.addEventListener("change", () => {
    updateContactPreferences();
    clearReferralsIfNotNeeded(determinePath()); // <-- add
  });
  
  // Next from chooser
  document.getElementById("next-from-chooser").addEventListener("click", () => {
    const path = determinePath();
    clearReferralsIfNotNeeded(path); // <-- add this line
  
    // show/hide referrer-info based on path
  
    if (path === "A") {
      // Me only -> Personal
      showPanel(panelPersonal);
    } else if (path === "B") {
      // Me + You -> Personal (with loved-one subfields)
      showPanel(panelPersonal);
    } else if (path === "C") {
      // Me + Referral -> Personal first, referral later; hide "Your Info" in referral panel
      showPanel(panelPersonal);
    } else if (path === "D") {
      // Someone Else + You -> Personal (with loved-ones), no referrer panel later
      showPanel(panelPersonal);
    } else if (path === "E") {
      // Referral only -> Referral (with "Your Info")
      showPanel(panelReferral);
    }
  });
  
  // Back buttons
  document.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener("click", () => showPanel(panelChooser));
  });
  
  // Next from personal
  document.getElementById("next-from-personal").addEventListener("click", () => {
    // validate only VISIBLE fields inside the personal panel
    const inputs = Array.from(panelPersonal.querySelectorAll("input, select, textarea"))
      .filter(el => el.offsetParent !== null && !el.disabled); // visible & enabled
  
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
  
      if (referralSlider && referralSlider.children.length === 0) {
        createReferralCard();
      }
  
      showPanel(panelReferral);
      panelReferral.style.display = "block"; // belt & suspenders
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
  
    // A, B, D -> straight to summary
    generateSummaryScreen();
    showPanel(null);
    summaryScreen.style.display = "block";
  });
  
  // Next from referral -> summary
  document.getElementById("next-from-referral").addEventListener("click", () => {
    // (optional) add any referral-only validation here
    generateSummaryScreen();
    showPanel(null);
    summaryScreen.style.display = "block";
  });
  
  // path detector (A/B/C/D/E)
  function determinePath() {
    const me = !!meCheckbox?.checked;
    const se = !!someoneElseCheckbox?.checked;
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
    const cleaned = value.replace(/\D/g, "").slice(0, 10); // only digits, max 10
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
  bindPhoneMask(document.querySelector('input[name="phone"]'));          // main phone
  bindPhoneMask(document.querySelector('#referrer_phone'));              // "Your Phone" in referral section
  document.querySelectorAll('input[name="referral_phone[]"]').forEach(bindPhoneMask); // any pre-rendered referrals
  
  quoteHeading.textContent = productTypeParam === "legalshield"
  ? "Legal/Identity Protection"
  : "Life Insurance";

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
    if (!otherCheckbox || !otherTextInput) return; // ✅ Safe check
  
    if (otherCheckbox.checked) {
      otherTextInput.style.display = "block";
    } else {
      otherTextInput.style.display = "none";
      otherTextInput.value = "";
    }
  }
  function updateContactPreferences() {
    const isSomeoneElseChecked = !!someoneElseCheckbox?.checked;
    const contactValue = contactPreference?.value || "You";
    const referrerInfoSection = document.getElementById("referrer-info");
    const isMeChecked = !!meCheckbox?.checked;
  
    // Toggle the “who do we contact?” dropdown
    contactDropdownWrapper.style.display = isSomeoneElseChecked ? "block" : "none";
  
    if (!isSomeoneElseChecked) {
      // Fully reset when "Someone Else" is OFF
      referrerInfoSection.style.display = "block";
      return;
    }
  
    // Someone Else is ON → switch by contactPreference
    if (contactValue === "You") {
    } else { // "Referral"
      if (typeof referralSlider !== "undefined" && referralSlider && referralSlider.children.length === 0) {
        createReferralCard();
      }
    }
  
    // Show/Hide "Your Info" within referral mode
    const hideReferrerInfo = isMeChecked && isSomeoneElseChecked && contactValue === "Referral";
    referrerInfoSection.style.display = hideReferrerInfo ? "none" : "block";
  }
  
    // Handle lead_type: only set to "Referral" if *just* Referral mode
    const isOnlyReferral = !meCheckbox.checked && (!someoneElseCheckbox || !someoneElseCheckbox.checked);
    // Final lead_type determination
    let leadTypeValue = originalLeadType;
    
    if (!meCheckbox.checked && someoneElseCheckbox.checked && contactPreference.value === "Referral") {
      // Only Referral selected
      leadTypeValue = "Referral";
    } else if (meCheckbox.checked && someoneElseCheckbox.checked && contactPreference.value === "Referral") {
      // Both selected, treat as dual lead
      leadTypeValue = originalLeadType; // Me is primary, Referral extracted separately
    } else if (!meCheckbox.checked && someoneElseCheckbox.checked && contactPreference.value === "You") {
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
      ? "Legal/Identity Protection"
      : "Life Insurance";
  
    // ✅ Update URL
    updateURLParams(leadTypeInput.value, selectedProduct);
  });

  // Hide Fields in Referral mode
  const hideInReferralFields = document.querySelectorAll(".hide-in-referral");
  
  // Track originally required fields
  const originalRequiredMap = new Map();
  hideInReferralFields.forEach(el => {
    // Show personal fields if:
    // 1. "Me" is selected, OR
    // 2. "Me + Referral" is selected
    const shouldShowPersonalFields =
      meCheckbox.checked || (meCheckbox.checked && someoneElseCheckbox.checked && contactPreference.value === "Referral");
  
    el.style.display = shouldShowPersonalFields ? "block" : "none";
  
    const inputs = el.querySelectorAll("input, select, textarea");
    inputs.forEach(input => {
      // remember original required once
      if (!originalRequiredMap.has(input)) {
        originalRequiredMap.set(input, input.hasAttribute("required"));
      }
      const wasOriginallyRequired = originalRequiredMap.get(input);
    
      if (shouldShowPersonalFields) {
        // restore if it used to be required
        if (wasOriginallyRequired) input.setAttribute("required", "required");
      } else {
        // hide path -> not required
        input.removeAttribute("required");
      }
    });
  });
  function updateReferralView() {
    const isMeChecked = meCheckbox.checked;
  
    // ✅ Fix lead_type value
    const newLeadType = isMeChecked ? originalLeadType : "Referral";
    // Final lead_type determination
    let leadTypeValue = originalLeadType;
    
    if (!meCheckbox.checked && someoneElseCheckbox.checked && contactPreference.value === "Referral") {
      // Only Referral selected
      leadTypeValue = "Referral";
    } else if (meCheckbox.checked && someoneElseCheckbox.checked && contactPreference.value === "Referral") {
      // Both selected, treat as dual lead
      leadTypeValue = originalLeadType; // Me is primary, Referral extracted separately
    } else if (!meCheckbox.checked && someoneElseCheckbox.checked && contactPreference.value === "You") {
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
    }
  
    if (!isMeChecked && referralSlider.children.length === 0) {
      createReferralCard();
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
  quoteForCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      updateReferralView();
      updateContactPreferences(); // ensure referrer-info toggles correctly
    });
  });
  
  if (someoneElseCheckbox) {
    someoneElseCheckbox.addEventListener("change", () => {
      updateContactPreferences();
      updateReferralView(); // keep both views in sync
    });
  
    contactPreference.addEventListener("change", () => {
      updateContactPreferences();
      updateReferralView(); // keep both views in sync
    });
  }
  // Limiting age to numbers
  const ageInput = document.querySelector('input[name="age"]');
  ageInput.addEventListener("input", () => {
    ageInput.value = ageInput.value.replace(/\D/g, "");
  });
  
  // ✅ TEMPORARY SUBMISSION HANDLER
  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();                 // keep it from actually posting yet
    if (!quoteForm.reportValidity()) return;  // run native validation
  
    generateSummaryScreen();
    showPanel(panelReferral);
  });
  
  // Create navigation elements
  const navContainer = document.createElement("div");
  navContainer.id = "referral-nav";
  
  prevBtn.id = "prev-referral";
  prevBtn.textContent = "←";
  
  nextBtn.id = "next-referral";
  nextBtn.textContent = "→";
  
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
  addReferralBtn.removeEventListener("click", createReferralCard); // Just in case
  addReferralBtn.addEventListener("click", createReferralCard);
  
  // Call update if any default referrals exist (future-proof)
  updateReferralVisibility();

  //Generate Referral Summary
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
    if (meCheckbox.checked) {
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
    // Only show referrals for C (Me + Referral) or E (Referral only)
    if (path === "C" || path === "E") {
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
    
      // If in C/E but there are no referral cards, hide the title too
      if (referralCards.length === 0 && referralTitle) {
        referralTitle.style.display = "none";
      }
    } else {
      // Not C/E → hide referral section UI
      referralTitle && (referralTitle.style.display = "none");
    }
  
    // Show summary
    formFields.style.display = "none";
    summaryScreen.style.display = "block";
  }
  document.getElementById("summary-screen").addEventListener("click", () => {}, { once: false });

  document.getElementById("summary-screen").addEventListener("click", (e) => {
    // Edit personal (Your Info)
    if (e.target && e.target.id === "edit-personal-btn") {
      const path = determinePath(); // A/B/C/D/E
      summaryScreen.style.display = "none";
      formFields.style.display = "block";
  
      // Show the personal panel; toggle Loved Ones if B/D
      showPanel(panelPersonal);
      panelPersonal.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  
    // Edit referrals
    if (e.target && e.target.id === "edit-referrals-btn") {
      const path = determinePath(); // A/B/C/D/E
      summaryScreen.style.display = "none";
      formFields.style.display = "block";
  
      // C = Me+Referral (hide "Your Info"), E = Referral only (show "Your Info")
      if (refInfo) refInfo.style.display = (path === "E") ? "block" : "none";
  
      // make sure a card exists
      if (referralSlider && referralSlider.children.length === 0) {
        createReferralCard();
      }
  
      showPanel(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  //Handle Edit, Delete, Final Submit
  document.getElementById("summary-list").addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-referral")) {
      const index = parseInt(e.target.dataset.index);
      currentReferralIndex = index;
      updateReferralVisibility();
      document.getElementById("summary-screen").style.display = "none";
      document.getElementById("referral-fields").style.display = "block";
    }
  
    if (e.target.classList.contains("delete-referral")) {
      const index = parseInt(e.target.dataset.index);
      referralCards[index].remove();
      referralCards.splice(index, 1);
      updateReferralVisibility();
      generateSummaryScreen(); // refresh summary
    }
  });
    document.querySelectorAll('.quote-option').forEach(box => {
    box.addEventListener('click', () => {
      const checkboxId = box.getAttribute('data-checkbox');
      const checkbox = document.getElementById(checkboxId);
      if (!checkbox) return;
  
      checkbox.checked = !checkbox.checked;
      box.classList.toggle('selected', checkbox.checked); // optional visual feedback
  
      checkbox.dispatchEvent(new Event('change')); // triggers any existing JS logic tied to checkbox changes
      updateNextButtonState();
    });
  });
  function updateNextButtonState() {
    const meSelected = meCheckbox?.checked;
    const someoneSelected = someoneElseCheckbox?.checked;
  
    const isAnySelected = meSelected || someoneSelected;
    nextFromChooserBtn.disabled = !isAnySelected;
  
    if (nextFromChooserBtn.disabled) {
      nextFromChooserBtn.classList.add("disabled"); // optional: add greyed-out class
    } else {
      nextFromChooserBtn.classList.remove("disabled");
    }
  }
  const bothOption = document.getElementById("bothOption");
  
  if (bothOption && meCheckbox && someoneElseCheckbox) {
    // Clicking "Me and Someone Else"
    bothOption.addEventListener("click", () => {
      const bothSelected = meCheckbox.checked && someoneElseCheckbox.checked;
  
      meCheckbox.checked = !bothSelected;
      someoneElseCheckbox.checked = !bothSelected;
  
      // Toggle visual state
      document.querySelectorAll('.quote-option').forEach(opt => {
        const id = opt.getAttribute("data-checkbox");
        if (id === "meCheckbox" || id === "someoneElseCheckbox") {
          opt.classList.toggle("selected", !bothSelected);
        }
      });
  
      bothOption.classList.toggle("selected", !bothSelected);
  
      // Trigger change logic
      meCheckbox.dispatchEvent(new Event('change'));
      someoneElseCheckbox.dispatchEvent(new Event('change'));
      updateNextButtonState();
    });
  
    // Keep third box synced visually
    const syncBothOption = () => {
      const bothOn = meCheckbox.checked && someoneElseCheckbox.checked;
      bothOption.classList.toggle("selected", bothOn);
    };
  
    meCheckbox.addEventListener("change", syncBothOption);
    someoneElseCheckbox.addEventListener("change", syncBothOption);
  }
  updateNextButtonState();
});
