document.addEventListener("DOMContentLoaded", () => {
  const otherCheckbox = document.getElementById("otherCheckbox");
  const otherTextInput = document.getElementById("otherTextInput");

  otherCheckbox.addEventListener("change", () => {
    otherTextInput.style.display = otherCheckbox.checked ? "block" : "none";
  });

  const quoteForm = document.getElementById("quote-form");
  quoteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    alert("Quote submitted successfully! (Static only for now)");
    quoteForm.reset();
    otherTextInput.style.display = "none";
  });
});
