const supabase = window.supabaseClient;

document.addEventListener("DOMContentLoaded", () => {
  if (!supabase) {
    console.error('Supabase client missing on this page');
    return;
  }
  
  const form = document.getElementById("contactForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = {
      name: form.name.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      message: form.message.value.trim()
    };

    try {
      const response = await fetch("/.netlify/functions/submitForm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      });

      // Try to parse JSON once
      let result = null;
      try { result = await response.json(); } catch(_) {}

      if (response.ok) {
        alert("Thanks! Your message was submitted.");
        form.reset();
      } else {
        const msg = (result && result.error) ? result.error : `HTTP ${response.status}`;
        alert("Oops. Something went wrong: " + msg);
      }
    } catch (err) {
      alert("Network error: " + (err?.message || err));
    }
  });
});
