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

  let originalLeadType = leadTypeParam;
  leadTypeInput.value = leadTypeParam;
  productTypeInput.value = productTypeParam;
  productDropdown.value = productTypeParam;

  // Toggle "Other" textbox
  otherCheckbox.addEventListener("change", () => {
    otherTextInput.style.display = otherCheckbox.checked ? "block" : "none";
  });

  // Change product_type when dropdown changes
  productDropdown.addEventListener("change", () => {
    productTypeInput.value = productDropdown.value;
  });

  // Adjust lead_type when "Me" is unchecked
  meCheckbox.addEventListener("change", () => {
    leadTypeInput.value = meCheckbox.checked ? originalLeadType : "Referral";
  });

  // Form submission
  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();

    // TEMP handling
    alert("Quote submitted successfully! (Static only for now)");

    // Reset form
    quoteForm.reset();

    // Restore logic-sensitive values
    leadTypeInput.value = originalLeadType;
    productTypeInput.value = productTypeParam;
    productDropdown.value = productTypeParam;
    otherTextInput.style.display = "none";

    // Re-check "Me" after reset
    meCheckbox.checked = true;
  });
});
