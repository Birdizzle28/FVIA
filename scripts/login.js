// scripts/login.js (non-module, uses global window.supabase / supabaseClient)
document.addEventListener('DOMContentLoaded', () => {
  if (!supabase) {
    console.error('Supabase client missing on this page');
    return;
  }

  const form = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const message = document.getElementById('login-message');

  const forgotLink = document.getElementById('forgot-password-link');
  const forgotPanel = document.getElementById('forgot-password-panel');
  const forgotEmail = document.getElementById('forgot-email');
  const sendResetBtn = document.getElementById('send-reset-email');
  const forgotMsg = document.getElementById('forgot-message');

  if (!form || !emailInput || !passwordInput || !message) {
    console.error('Login page elements not found.');
    return;
  }

  // ---------- LOGIN ----------
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

  // ---------- FORGOT PASSWORD ----------
  forgotLink?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!forgotPanel) return;

    // Prefill reset email with login email if present
    if (forgotEmail && emailInput?.value && !forgotEmail.value) {
      forgotEmail.value = emailInput.value.trim();
    }

    forgotPanel.style.display = (forgotPanel.style.display === 'none' || !forgotPanel.style.display)
      ? 'block'
      : 'none';

    if (forgotMsg) {
      forgotMsg.textContent = '';
      forgotMsg.style.color = '';
    }
  });

  sendResetBtn?.addEventListener('click', async () => {
    if (!supabaseClient) {
      if (forgotMsg) {
        forgotMsg.textContent = 'Reset error: Supabase not available.';
        forgotMsg.style.color = 'red';
      }
      return;
    }

    const email = (forgotEmail?.value || emailInput?.value || '').trim();
    if (!email) {
      if (forgotMsg) {
        forgotMsg.textContent = 'Please enter your email.';
        forgotMsg.style.color = 'red';
      }
      return;
    }

    if (forgotMsg) {
      forgotMsg.textContent = 'Sending reset email...';
      forgotMsg.style.color = '';
    }

    try {
      const redirectTo = `${window.location.origin}/reset-password.html`;

      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });

      if (error) {
        console.error('Reset email error:', error);
        if (forgotMsg) {
          forgotMsg.textContent = 'Could not send reset email: ' + error.message;
          forgotMsg.style.color = 'red';
        }
        return;
      }

      if (forgotMsg) {
        forgotMsg.textContent = '✅ Check your email for a password reset link.';
        forgotMsg.style.color = 'green';
      }
    } catch (err) {
      console.error('Unexpected reset email error:', err);
      if (forgotMsg) {
        forgotMsg.textContent = 'Unexpected error sending reset email.';
        forgotMsg.style.color = 'red';
      }
    }
  });

  // ---------- Toggle password visibility ----------
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
