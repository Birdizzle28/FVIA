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

  let originalLeadType = leadTypeParam;
  leadTypeInput.value = leadTypeParam;
  productTypeInput.value = productTypeParam;
  productDropdown.value = productTypeParam;

  // Toggle other textbox visibility
  otherCheckbox.addEventListener("change", () => {
    otherTextInput.style.display = otherCheckbox.checked ? "block" : "none";
  });

  // Update product_type on dropdown change
  productDropdown.addEventListener("change", () => {
    productTypeInput.value = productDropdown.value;
  });

  // Handle lead_type override based on "Me" checkbox
  quoteForCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const isMeChecked = Array.from(quoteForCheckboxes).some(cb => cb.value === "Me" && cb.checked);
      if (!isMeChecked) {
        leadTypeInput.value = "Referral";
      } else {
        leadTypeInput.value = originalLeadType;
      }
    });
  });

  // TEMPORARY: Handle static form submission
  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    alert("Quote submitted successfully! (Static only for now)");
    quoteForm.reset();
    otherTextInput.style.display = "none";
    leadTypeInput.value = originalLeadType; // reset lead_type
    productTypeInput.value = productDropdown.value;
    productDropdown.value = productTypeParam;
  });
});
