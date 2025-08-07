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
  
  const quoteHeading = document.getElementById("quote-heading");
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
    if (otherCheckbox.checked) {
      otherTextInput.style.display = "block";
    } else {
      otherTextInput.style.display = "none";
      otherTextInput.value = "";
    }
  }

  // ✅ Initial state (in case it's pre-checked)
  toggleOtherText();

  // ✅ Event: show/hide "Other" text box
  otherCheckbox.addEventListener("change", toggleOtherText);

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

  function updateReferralView() {
    const isMeChecked = meCheckbox.checked;
  
    // ✅ Fix lead_type value
    const newLeadType = isMeChecked ? originalLeadType : "Referral";
    leadTypeInput.value = newLeadType;
    updateURLParams(newLeadType, productDropdown.value);
  
    // ✅ Show/hide fields
    referralFields.style.display = isMeChecked ? "none" : "block";
  
    if (!isMeChecked && referralSlider.children.length === 0) {
      createReferralCard();
    }
  
    // ✅ Toggle visibility and required fields
    hideInReferralFields.forEach(el => {
      el.style.display = isMeChecked ? "block" : "none";
      const inputs = el.querySelectorAll("input, select, textarea");
      inputs.forEach(input => {
        if (isMeChecked) {
          input.setAttribute("required", "required");
        } else {
          input.removeAttribute("required");
        }
      });
    });
  }
  
  // Call this on load too (in case URL opens in referral mode)
  updateReferralView();
  
  // Update event
  quoteForCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", updateReferralView);
  });
  // Limiting age to numbers
  const ageInput = document.querySelector('input[name="age"]');
  ageInput.addEventListener("input", () => {
    ageInput.value = ageInput.value.replace(/\D/g, "");
  });
  
  // ✅ TEMPORARY SUBMISSION HANDLER
  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    alert("Quote submitted successfully! (Static only for now)");

    // Reset form
    quoteForm.reset();

    // Reapply product_type + lead_type
    leadTypeInput.value = originalLeadType;
    productDropdown.value = productTypeParam;
    productTypeInput.value = productTypeParam;
    meCheckbox.checked = true;
    referralFields.style.display = "none";
    // ✅ Manually update dynamic elements after reset
    toggleOtherText();
  });
  // === Referral Slider Logic ===
  const addReferralBtn = document.getElementById("add-referral-btn");
  const referralSlider = document.getElementById("referral-container");
  const referralTemplate = document.getElementById("referral-template");
  
  function createReferralCard() {
  const clone = referralTemplate.content.cloneNode(true);
  const card = clone.querySelector(".referral-card");

  // Add delete functionality
  const deleteBtn = card.querySelector(".delete-referral");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      card.remove();
    });
  }

  // Enforce numeric input for age (optional but helpful)
  const ageInput = card.querySelector('input[name="referral_age[]"]');
  if (ageInput) {
    ageInput.addEventListener("input", () => {
      ageInput.value = ageInput.value.replace(/\D/g, "");
    });
  }

  referralSlider.appendChild(card);
}
  
  addReferralBtn.addEventListener("click", createReferralCard);
  
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
});
