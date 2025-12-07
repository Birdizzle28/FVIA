// scripts/login.js (non-module, uses global window.supabase)

const SUPABASE_URL = 'https://ddlbgkolnayqrxslzsxn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho';

// Safety check in case Supabase script fails to load
if (!window.supabase) {
  console.error('Supabase JS failed to load on this page.');
}

const supabaseClient = window.supabase
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
  : null;

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const message = document.getElementById('login-message');

  if (!form || !emailInput || !passwordInput || !message) {
    console.error('Login page elements not found.');
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!supabaseClient) {
      message.textContent = 'Login error: Supabase not available.';
      message.style.color = 'red';
      return;
    }

    message.textContent = 'Logging in...';
    message.style.color = '';

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (error) {
        console.error('Login error:', error);
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

      setTimeout(() => {
        window.location.href = 'profile.html';
      }, 500);
    } catch (err) {
      console.error('Unexpected login error:', err);
      message.textContent = 'Unexpected error during login.';
      message.style.color = 'red';
    }
  });

  // Toggle password visibility
  document.querySelectorAll('.toggle-password').forEach((icon) => {
    icon.addEventListener('click', () => {
      const selector = icon.getAttribute('toggle');
      const input = document.querySelector(selector);
      if (!input) return;

      const type = input.getAttribute('type') === 'password' ? 'text' : 'password';
      input.setAttribute('type', type);
      icon.classList.toggle('fa-eye-slash');
    });
  });
});
