document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role");

  const title = document.getElementById("role-title");
  const questions = document.getElementById("questions");
  const form = document.querySelector("form");

  if (role === "agent") {
    title.textContent = "Life Insurance Agent Application";
    questions.innerHTML = `
      <label>Full Name:</label><br>
      <input type="text" name="name" required><br><br>

      <label>Email Address:</label><br>
      <input type="email" name="email" required><br><br>

      <label>Phone Number:</label><br>
      <input type="tel" name="phone"><br><br>

      <label>Are you currently licensed to sell life insurance?</label><br>
      <select name="licensed" required>
        <option value="">Select one</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select><br><br>

      <label>Tell us why you’d be a great fit:</label><br>
      <textarea name="why" rows="5" required></textarea><br><br>
    `;
  } else if (role === "setter") {
    title.textContent = "Appointment Setter Application";
    questions.innerHTML = `
      <label>Full Name:</label><br>
      <input type="text" name="name" required><br><br>

      <label>Email Address:</label><br>
      <input type="email" name="email" required><br><br>

      <label>Phone Number:</label><br>
      <input type="tel" name="phone"><br><br>

      <label>Do you have any experience setting appointments?</label><br>
      <select name="experience" required>
        <option value="">Select one</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select><br><br>

      <label>Tell us about your work style and availability:</label><br>
      <textarea name="availability" rows="5" required></textarea><br><br>
    `;
  } else {
    title.textContent = "Application";
    questions.innerHTML = "<p>Please select a valid role from the careers page.</p>";
    form.style.display = "none";
  }
});