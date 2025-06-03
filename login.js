import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

// Supabase credentials
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// Login form logic
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const message = document.getElementById('login-message');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.textContent = 'Logging in...';
    message.style.color = '';

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      message.textContent = 'Login failed: ' + error.message;
      message.style.color = 'red';
      return;
    }

    if (!data.session) {
      message.textContent = 'No session returned. Login unsuccessful.';
      message.style.color = 'red';
      return;
    }

    message.textContent = 'Login successful! Redirecting...';
    message.style.color = 'green';

    // Redirect
    setTimeout(() => {
      window.location.href = 'dashboard.html';
    }, 1000);
  });

  // Toggle password visibility
  document.querySelectorAll('.toggle-password').forEach(icon => {
    icon.addEventListener('click', () => {
      const input = document.querySelector(icon.getAttribute('toggle'));
      const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
      input.setAttribute('type', type);
      icon.classList.toggle('fa-eye-slash');
    });
  });
});
