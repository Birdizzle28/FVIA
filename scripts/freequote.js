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

  // ✅ Event: Switch to Referral if "Me" is unchecked
  quoteForCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const isMeChecked = meCheckbox.checked;
      const newLeadType = isMeChecked ? originalLeadType : "Referral";
  
      leadTypeInput.value = newLeadType;
      referralFields.style.display = isMeChecked ? "none" : "block";
      if (!isMeChecked && referralSlider.children.length === 0) {
        createReferralCard(); // ⬅️ Only adds one card the first time
      }
  
      updateReferralView(); // keep hiding/showing fields
      updateURLParams(newLeadType, productDropdown.value); // ✅ Update URL
    });
  });

  // Hide Fields in Referral mode
  const hideInReferralFields = document.querySelectorAll(".hide-in-referral");

  function updateReferralView() {
    const isMeChecked = meCheckbox.checked;
    leadTypeInput.value = isMeChecked ? originalLeadType : "Referral";
  
    hideInReferralFields.forEach(el => {
      el.style.display = isMeChecked ? "block" : "none";
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
  const addReferralBtn = document.getElementById("add-referral-button");
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
});
