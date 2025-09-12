document.addEventListener("DOMContentLoaded", () => {
  // Get URL parameters (if any) for lead type and product type
  const urlParams = new URLSearchParams(window.location.search);
  const leadTypeParam = urlParams.get("lead_type") || "Other";
  const productTypeParam = urlParams.get("product_type") || "life";

  // Form and input element references
  const quoteForm        = document.getElementById("quote-form");
  const productDropdown  = document.getElementById("product-type-dropdown");
  const leadTypeInput    = document.getElementById("lead_type");
  const productTypeInput = document.getElementById("product_type");
  const quoteHeading     = document.getElementById("quote-heading");

  // Panel sections
  const panelChooser  = document.getElementById("panel-chooser");
  const panelPersonal = document.getElementById("panel-personal");
  const panelReferral = document.getElementById("referral-fields");
  const summaryScreen = document.getElementById("summary-screen");

  // Chooser (Panel 1) elements
  const meCheckbox           = document.querySelector('input[name="quote-for"][value="Me"]');
  const someoneElseCheckbox  = document.getElementById("someoneElseCheckbox");
  const contactDropdownWrap  = document.getElementById("contactDropdownWrapper");
  const contactPreference    = document.getElementById("contactPreference");
  const nextFromChooserBtn   = document.getElementById("next-from-chooser");

  // Personal (Panel 2) elements
  const personalFormFields   = panelPersonal.querySelectorAll("input, select");
  const backButtons          = document.querySelectorAll("[data-back]");
  const nextFromPersonalBtn  = document.getElementById("next-from-personal");

  // Referral (Panel 3) elements
  const referrerInfoSection  = document.getElementById("referrer-info");
  const referralContainer    = document.getElementById("referral-container");
  const addReferralBtn       = document.getElementById("add-referral-btn");
  const referralTemplate     = document.getElementById("referral-template");
  const nextFromReferralBtn  = document.getElementById("next-from-referral");

  // Summary (Panel 4) elements
  const personalSummary      = document.getElementById("personal-summary");
  const referralSummaryTitle = document.getElementById("referral-summary-title");
  const summaryList          = document.getElementById("summary-list");
  const editPersonalBtn      = document.getElementById("edit-personal-btn");
  const editReferralsBtn     = document.getElementById("edit-referrals-btn");

  // Internal state for referrals
  let referralCards = [];
  let currentReferralIndex = 0;

  // Helper to show only the specified panel (hides others and summary)
  function showPanel(panel) {
    panelChooser.style.display  = "none";
    panelPersonal.style.display = "none";
    panelReferral.style.display = "none";
    summaryScreen.style.display = "none";
    if (panel) panel.style.display = "block";
  }

  // Initialize: start on chooser panel
  showPanel(panelChooser);

  // Ensure referrer info section in referral panel is not used (we collect referrer info in Personal panel instead)
  referrerInfoSection.style.display = "none";
  // Disable its input fields to avoid validation issues
  const refNameInput = document.getElementById("referrer_name");
  const refPhoneInput = document.getElementById("referrer_phone");
  if (refNameInput)  refNameInput.disabled = true;
  if (refPhoneInput) refPhoneInput.disabled = true;

  // Utility: Determine current quote path based on selections.
  // Paths: A = Me only; B = Someone Else only; C = Both (contact You); D = Both (contact Referral)
  function determinePath() {
    const me = meCheckbox.checked;
    const se = someoneElseCheckbox.checked;
    const contactPref = contactPreference.value || "You";  // "You" or "Referral"

    if (me && !se) return "A";
    if (!me && se) return "B";
    if (me && se && contactPref === "You") return "C";
    if (me && se && contactPref === "Referral") return "D";
    return "A";  // default (should not happen if inputs are properly managed)
  }

  // Utility: Hide or show specific Personal fields based on path.
  function configurePersonalFieldsForPath(path) {
    // Define personal fields to hide for limited info (path B)
    const limitedFields = ["age", "email", "address", "city", "state", "contact-date"];
    limitedFields.forEach(name => {
      const input = panelPersonal.querySelector(`input[name="${name}"]`);
      if (!input) return;
      const fieldLabel = input.parentElement;
      if (path === "B") {
        // Hide and disable these fields (keep only Name and Phone visible)
        fieldLabel.style.display = "none";
        input.disabled = true;
      } else {
        // Show and enable full personal info fields
        fieldLabel.style.display = "";
        input.disabled = false;
      }
    });
  }

  // Utility: Hide or show phone & relationship fields in referral cards based on path.
  function configureReferralFieldsForPath(path) {
    referralCards.forEach(card => {
      const phoneDiv = card.querySelector('input[name="referral_phone[]"]')?.parentElement;
      const relDiv   = card.querySelector('input[name="referral_relationship[]"]')?.parentElement;
      if (phoneDiv && relDiv) {
        if (path === "C") {
          // Hide phone & relationship for limited referral info
          phoneDiv.style.display = "none";
          relDiv.style.display   = "none";
          // Disable inputs to avoid validation
          phoneDiv.querySelector('input')?.setAttribute("disabled", "disabled");
          relDiv.querySelector('input')?.setAttribute("disabled", "disabled");
        } else {
          // Show phone & relationship for full referral info
          phoneDiv.style.display = "";
          relDiv.style.display   = "";
          // Enable inputs
          phoneDiv.querySelector('input')?.removeAttribute("disabled");
          relDiv.querySelector('input')?.removeAttribute("disabled");
        }
      }
    });
  }

  // Utility: Clear all referral cards if referrals are not needed (path A).
  function clearReferralsIfNotNeeded(path) {
    if (path === "A") {
      // Remove any existing referral entries
      referralCards = [];
      referralContainer.innerHTML = "";
      currentReferralIndex = 0;
    }
  }

  // Phone masking utility functions (format (XXX) XXX-XXXX as user types)
  function formatPhoneNumber(value) {
    const cleaned = value.replace(/\D/g, "").slice(0, 10);  // allow only 10 digits max
    const len = cleaned.length;
    if (len < 4) return cleaned ? `(${cleaned}` : "";
    if (len < 7) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  function bindPhoneMask(input) {
    if (!input) return;
    input.addEventListener("input", () => {
      const startPos = input.selectionStart ?? input.value.length;
      const digitsBefore = (input.value.slice(0, startPos).match(/\d/g) || []).length;
      input.value = formatPhoneNumber(input.value);
      // Restore cursor position after formatting
      let pos = 0, count = 0;
      while (pos < input.value.length && count < digitsBefore) {
        if (/\d/.test(input.value.charAt(pos))) count++;
        pos++;
      }
      input.setSelectionRange(pos, pos);
    });
  }

  // Create a new referral entry card (Panel 3) and display it.
  function createReferralCard() {
    const clone = referralTemplate.content.cloneNode(true);
    const card = clone.querySelector(".referral-card");
    if (!card) return;
    // Bind phone mask for the referral phone input
    bindPhoneMask(card.querySelector('input[name="referral_phone[]"]'));
    // Delete (remove) referral card button logic
    const deleteBtn = card.querySelector(".delete-referral");
    deleteBtn?.addEventListener("click", () => {
      const idx = referralCards.indexOf(card);
      if (idx > -1) {
        referralCards.splice(idx, 1);
        card.remove();
        // Adjust currentReferralIndex if last card was removed
        if (currentReferralIndex >= referralCards.length) {
          currentReferralIndex = Math.max(0, referralCards.length - 1);
        }
        updateReferralVisibility();
      }
    });
    // Ensure age input is numeric only
    const ageInput = card.querySelector('input[name="referral_age[]"]');
    ageInput?.addEventListener("input", () => {
      ageInput.value = ageInput.value.replace(/\D/g, "");
    });
    // Add to list and DOM
    referralCards.push(card);
    referralContainer.appendChild(card);
    // Set this new card as the current visible one
    currentReferralIndex = referralCards.length - 1;
    // If path C (limited referrals), hide phone & relationship on this new card
    if (determinePath() === "C") {
      const phoneDiv = card.querySelector('input[name="referral_phone[]"]')?.parentElement;
      const relDiv   = card.querySelector('input[name="referral_relationship[]"]')?.parentElement;
      if (phoneDiv && relDiv) {
        phoneDiv.style.display = "none";
        relDiv.style.display   = "none";
        phoneDiv.querySelector('input')?.setAttribute("disabled", "disabled");
        relDiv.querySelector('input')?.setAttribute("disabled", "disabled");
      }
    }
    updateReferralVisibility();
  }

  // Show only the current referral card (hide others) to simplify the form UI
  function updateReferralVisibility() {
    referralCards.forEach((card, index) => {
      card.style.display = (index === currentReferralIndex ? "block" : "none");
    });
  }

  // Generate the Summary screen content based on inputs and selected path
  function generateSummaryScreen() {
    const path = determinePath();
    // Clear existing summary content
    personalSummary.innerHTML = "";
    summaryList.innerHTML = "";

    // PERSONAL INFO SUMMARY (if "Me" was selected)
    if (meCheckbox.checked) {
      const firstName = panelPersonal.querySelector('input[name="first-name"]')?.value || "";
      const lastName  = panelPersonal.querySelector('input[name="last-name"]')?.value || "";
      const fullName  = `${firstName} ${lastName}`.trim();
      const age       = panelPersonal.querySelector('input[name="age"]')?.value || "";
      const phone     = panelPersonal.querySelector('input[name="phone"]')?.value || "";
      const email     = panelPersonal.querySelector('input[name="email"]')?.value || "";
      const address   = panelPersonal.querySelector('input[name="address"]')?.value || "";
      const city      = panelPersonal.querySelector('input[name="city"]')?.value || "";
      const state     = panelPersonal.querySelector('input[name="state"]')?.value || "";

      // Build personal summary HTML
      personalSummary.innerHTML = `
        <h3>Your Info <button type="button" id="edit-personal-btn">Edit</button></h3>
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
      // If address is provided, lookup ZIP code and coordinates (using Google Geocoding via Netlify function, if available)
      const fullAddress = [address, city && state ? `${city}, ${state}` : (city || state)].filter(Boolean).join(", ");
      if (fullAddress) {
        geocodeAddressGoogle(fullAddress).then(({ zip, lat, lng }) => {
          const zipSpan = document.getElementById("zip-span");
          if (zipSpan && zip) {
            zipSpan.textContent = ` ${zip}`;
          }
          // Store ZIP/lat/lng in hidden inputs for form submission
          const zipInput = document.getElementById("zip");
          const latInput = document.getElementById("lat");
          const lngInput = document.getElementById("lng");
          if (zipInput) zipInput.value = zip || "";
          if (latInput) latInput.value = lat ?? "";
          if (lngInput) lngInput.value = lng ?? "";
        }).catch(() => {
          /* ignore lookup errors */
        });
      }
    }

    // REFERRAL INFO SUMMARY (if any referrals were entered)
    if (referralCards.length > 0) {
      referralSummaryTitle.style.display = "block";
      referralCards.forEach((card, index) => {
        const firstName    = card.querySelector('input[name="referral_first_name[]"]')?.value || "";
        const lastName     = card.querySelector('input[name="referral_last_name[]"]')?.value || "";
        const age          = card.querySelector('input[name="referral_age[]"]')?.value || "";
        const phone        = card.querySelector('input[name="referral_phone[]"]')?.value || "";
        const relationship = card.querySelector('input[name="referral_relationship[]"]')?.value || "";
        const fullName     = `${firstName} ${lastName}`.trim();

        const itemDiv = document.createElement("div");
        itemDiv.classList.add("summary-item");
        itemDiv.innerHTML = `
          <strong>${fullName}</strong><br/>
          ${age ? `Age: ${age}<br/>` : ""}
          ${phone ? `Phone: ${phone}<br/>` : ""}
          ${relationship ? `Relationship: ${relationship}<br/>` : ""}
          <button type="button" class="edit-referral" data-index="${index}">Edit</button>
          <button type="button" class="delete-referral" data-index="${index}">Delete</button>
          <hr/>
        `;
        summaryList.appendChild(itemDiv);
      });
      // If there are no referral cards (edge case), hide the section title
      if (referralCards.length === 0) {
        referralSummaryTitle.style.display = "none";
      }
    } else {
      // No referrals to show
      referralSummaryTitle.style.display = "none";
    }

    // Update lead_type hidden input based on path (treat pure referrals differently)
    let leadTypeValue = originalLeadType;
    if (path === "B") {
      // If quote is only for someone else (referral only), mark lead type as "Referral"
      leadTypeValue = "Referral";
    }
    leadTypeInput.value = leadTypeValue;
    // Optionally update URL parameters (so lead_type and product_type reflect final selection in URL)
    updateURLParams(leadTypeValue, productDropdown.value);

    // Show the summary screen
    quoteForm.querySelector("#form-fields").style.display = "none";
    summaryScreen.style.display = "block";
  }

  // Event Handlers:

  // Handle changes on "Who is this quote for?" checkboxes
  function onChooserOptionChanged() {
    // Enable/disable Next button based on whether at least one option is selected
    nextFromChooserBtn.disabled = !(meCheckbox.checked || someoneElseCheckbox.checked);
    // Show contact preference dropdown only if both "Me" and "Someone Else" are selected
    if (meCheckbox.checked && someoneElseCheckbox.checked) {
      contactDropdownWrap.style.display = "block";
    } else {
      contactDropdownWrap.style.display = "none";
      // If only one option selected, decide contactPreference automatically
      if (!meCheckbox.checked && someoneElseCheckbox.checked) {
        // Someone Else only: set contact preference to "Referral" (contact the referred person)
        contactPreference.value = "Referral";
      } else {
        // Me only (or none selected): default contact preference to "You"
        contactPreference.value = "You";
      }
    }
  }
  meCheckbox.addEventListener("change", onChooserOptionChanged);
  someoneElseCheckbox.addEventListener("change", onChooserOptionChanged);
  // Handle changes on contact preference dropdown (only visible when both options are selected)
  contactPreference.addEventListener("change", () => {
    // (No additional UI changes needed here beyond what happens when showing referral panel)
    // But we can ensure the internal path logic is updated or any dependent fields if necessary.
  });

  // Next button on Panel 1 (Chooser) - proceed to Panel 2 (Personal)
  nextFromChooserBtn.addEventListener("click", () => {
    const path = determinePath();
    // Clear any existing referrals if they are not needed for this path
    clearReferralsIfNotNeeded(path);
    // Configure personal panel fields for this path (hide/show fields)
    configurePersonalFieldsForPath(path);
    // Show Personal Info panel
    showPanel(panelPersonal);
    panelPersonal.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // Back buttons (from Personal or Referral panels) - return to Chooser panel
  backButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      // If user goes back to chooser, allow changing initial selections
      showPanel(panelChooser);
    });
  });

  // Next button on Panel 2 (Personal) - proceed to either Summary or Panel 3 (Referral)
  nextFromPersonalBtn.addEventListener("click", () => {
    // Validate only visible (not hidden/disabled) fields in the personal panel
    const visiblePersonalInputs = Array.from(panelPersonal.querySelectorAll("input, select")).filter(el => {
      return el.offsetParent !== null && !el.disabled;
    });
    for (const input of visiblePersonalInputs) {
      if (!input.checkValidity()) {
        // If any visible required field is invalid, show the native validation message and abort
        input.reportValidity();
        return;
      }
    }
    const path = determinePath();
    if (path === "A") {
      // Path A: Me only, no referral panel needed -> go straight to Summary
      generateSummaryScreen();
      showPanel(null);
      summaryScreen.style.display = "block";
    } else {
      // Path B, C, D: one or more referrals to collect -> show Referral panel
      // Ensure referral fields visibility matches the path (hide/show phone & relationship in cards)
      configureReferralFieldsForPath(path);
      // If no referral card exists yet, create at least one for user to fill
      if (referralCards.length === 0) {
        createReferralCard();
      }
      // Referrer info section is not used (always hidden)
      referrerInfoSection.style.display = "none";
      // Show Referral panel
      showPanel(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // Next button on Panel 3 (Referral) - proceed to Summary
  nextFromReferralBtn.addEventListener("click", () => {
    // (Optional: add validation for referral fields here if needed, e.g., ensure at least one referral name is filled)
    generateSummaryScreen();
    showPanel(null);
    summaryScreen.style.display = "block";
  });

  // Summary screen: Edit Personal Info button
  summaryScreen.addEventListener("click", (e) => {
    if (e.target && e.target.id === "edit-personal-btn") {
      const path = determinePath();  // current path
      // Hide summary and show form fields again
      summaryScreen.style.display = "none";
      quoteForm.querySelector("#form-fields").style.display = "block";
      // Ensure personal panel fields are configured for this path (e.g., limited fields visible if path B)
      configurePersonalFieldsForPath(path);
      // Show Personal panel for editing
      showPanel(panelPersonal);
      panelPersonal.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    if (e.target && e.target.id === "edit-referrals-btn") {
      const path = determinePath();  // current path
      // Hide summary and show form fields again
      summaryScreen.style.display = "none";
      quoteForm.querySelector("#form-fields").style.display = "block";
      // Ensure at least one referral card exists to edit
      if (referralCards.length === 0) {
        createReferralCard();
      }
      // Configure referral fields visibility for current path (in case contact preference changed)
      configureReferralFieldsForPath(path);
      // Show Referral panel for editing referrals
      showPanel(panelReferral);
      panelReferral.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });

  // Summary list: Edit or Delete individual referral actions
  summaryList.addEventListener("click", (e) => {
    if (e.target.classList.contains("edit-referral")) {
      // When "Edit" is clicked for a specific referral, show that referral card on the Referral panel
      const index = parseInt(e.target.getAttribute("data-index"));
      if (!isNaN(index)) {
        currentReferralIndex = index;
        updateReferralVisibility();
        // Hide summary and show referral panel for editing
        summaryScreen.style.display = "none";
        quoteForm.querySelector("#form-fields").style.display = "block";
        showPanel(panelReferral);
      }
    }
    if (e.target.classList.contains("delete-referral")) {
      // When "Delete" is clicked for a referral, remove it and regenerate summary
      const index = parseInt(e.target.getAttribute("data-index"));
      if (!isNaN(index)) {
        // Remove referral card from DOM and array
        referralCards[index].remove();
        referralCards.splice(index, 1);
        // Adjust current index if needed and update visibility of remaining cards
        if (currentReferralIndex >= referralCards.length) {
          currentReferralIndex = Math.max(0, referralCards.length - 1);
        }
        updateReferralVisibility();
        // Refresh summary screen content after deletion
        generateSummaryScreen();
      }
    }
  });

  // Add Referral button in Referral panel (to add another referral entry)
  addReferralBtn.addEventListener("click", createReferralCard);

  // Bind phone mask formatting to initial phone fields
  bindPhoneMask(panelPersonal.querySelector('input[name="phone"]'));       // Personal Phone Number
  bindPhoneMask(document.getElementById("referrer_phone"));                // Referrer Phone (in referral panel, though hidden)
  // If any referral cards existed in HTML (unlikely initially), bind their phone masks
  referralContainer.querySelectorAll('input[name="referral_phone[]"]').forEach(bindPhoneMask);

  // Set initial form values from URL params (if any)
  let originalLeadType = leadTypeParam;
  leadTypeInput.value = leadTypeParam;
  productTypeInput.value = productTypeParam;
  productDropdown.value = productTypeParam;
  // Update heading based on initial product type
  quoteHeading.textContent = (productTypeParam === "legalshield")
    ? "LegalShield/IDShield Quote"
    : "Life Insurance Quote";

  // Update URL params helper (to keep URL in sync with selections, optional)
  function updateURLParams(leadTypeValue, productTypeValue) {
    const newParams = new URLSearchParams(window.location.search);
    newParams.set("lead_type", leadTypeValue);
    newParams.set("product_type", productTypeValue);
    const newURL = `${window.location.pathname}?${newParams.toString()}`;
    history.replaceState({}, "", newURL);
  }

  // Handle changes in product type dropdown (update hidden input, heading, and URL)
  productDropdown.addEventListener("change", () => {
    const selectedProduct = productDropdown.value;
    productTypeInput.value = selectedProduct;
    quoteHeading.textContent = (selectedProduct === "legalshield")
      ? "LegalShield/IDShield Quote"
      : "Life Insurance Quote";
    updateURLParams(leadTypeInput.value, selectedProduct);
  });

  // (Optional) If there are "Other" checkbox/text inputs in form (not shown in snippet), handle their toggle
  const otherCheckbox = document.getElementById("otherCheckbox");
  const otherTextInput = document.getElementById("otherTextInput");
  function toggleOtherText() {
    if (!otherCheckbox || !otherTextInput) return;
    otherTextInput.style.display = otherCheckbox.checked ? "block" : "none";
    if (!otherCheckbox.checked) {
      otherTextInput.value = "";
    }
  }
  if (otherCheckbox) {
    // Set initial state
    toggleOtherText();
    // Toggle "Other" text field on change
    otherCheckbox.addEventListener("change", toggleOtherText);
  }
});
