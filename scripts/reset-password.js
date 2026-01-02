// scripts/reset-password.js (non-module, uses global supabaseClient)
document.addEventListener('DOMContentLoaded', async () => {
  const statusEl = document.getElementById('reset-status');
  const form = document.getElementById('reset-form');
  const msg = document.getElementById('reset-message');
  const newPass = document.getElementById('new-password');
  const confirmPass = document.getElementById('confirm-password');

  if (!supabaseClient) {
    if (statusEl) {
      statusEl.textContent = 'Reset error: Supabase not available.';
      statusEl.style.color = 'red';
    }
    return;
  }

  const showReady = () => {
    if (statusEl) {
      statusEl.textContent = 'Enter a new password below.';
      statusEl.style.color = '';
    }
    if (form) form.style.display = 'block';
  };

  const showNotReady = (text) => {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.style.color = 'red';
    }
    if (form) form.style.display = 'none';
  };

  // Supabase will set a recovery session after the user clicks the email link.
  // Sometimes it’s available immediately; sometimes it arrives via auth state change.
  let ready = false;

  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      ready = true;
      showReady();
    }
  } catch (e) {}

  if (!ready) {
    // Listen for recovery event
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) {
        ready = true;
        showReady();
      }
    });

    // If they opened this page directly (no token), give a clear message
    setTimeout(() => {
      if (!ready) {
        showNotReady('This link is missing or expired. Please go back and request a new reset email.');
      }
    }, 800);
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    msg.style.color = '';

    const p1 = (newPass.value || '').trim();
    const p2 = (confirmPass.value || '').trim();

    if (p1.length < 6) {
      msg.textContent = 'Password must be at least 6 characters.';
      msg.style.color = 'red';
      return;
    }
    if (p1 !== p2) {
      msg.textContent = 'Passwords do not match.';
      msg.style.color = 'red';
      return;
    }

    msg.textContent = 'Updating password...';

    const { error } = await supabaseClient.auth.updateUser({ password: p1 });

    if (error) {
      msg.textContent = 'Failed to update password: ' + error.message;
      msg.style.color = 'red';
      return;
    }

    msg.textContent = '✅ Password updated! Redirecting to login...';
    msg.style.color = 'green';

    // optional: sign out so they can log in fresh
    await supabaseClient.auth.signOut();

    setTimeout(() => {
      window.location.href = 'login.html';
    }, 900);
  });

  // Toggle visibility on both password fields
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
