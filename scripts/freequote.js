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
    productTypeInput.value = productDropdown.value;
  });

  // ✅ Event: Switch to Referral if "Me" is unchecked
  quoteForCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const isMeChecked = meCheckbox.checked;
      leadTypeInput.value = isMeChecked ? originalLeadType : "Referral";
    });
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

    // ✅ Manually update dynamic elements after reset
    toggleOtherText();
  });
});
