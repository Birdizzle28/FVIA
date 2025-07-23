document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("contactForm");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = {
      name: form.name.value,
      email: form.email.value,
      phone: form.phone.value,
      message: form.message.value
    };

    try {
      const response = await fetch("/.netlify/functions/submitForm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });

      const result = await response.json();

      if (response.ok) {
        alert("Thanks! Your message was submitted.");
        form.reset();
      } else {
        alert("Oops. Something went wrong: " + result.error);
      }
    } catch (err) {
      alert("Error: " + err.message);
      alert("Details: " + JSON.stringify(err));
    }
  });
});
