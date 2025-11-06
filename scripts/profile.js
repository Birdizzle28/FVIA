// scripts/profile.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

document.addEventListener('DOMContentLoaded', async () => {
  // Require auth
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const user = session.user;

  // Load this agent's profile row
  const { data: profile, error: profErr } = await supabase
    .from('agents')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profErr || !profile) {
    console.error('Load profile error:', profErr);
    return;
  }

  // Show/hide admin links
  document.querySelectorAll('[data-admin-link]')
    .forEach(el => el.classList.toggle('admin-hidden', !profile.is_admin));

  // Fill fields
  document.getElementById('first-name').value = profile.first_name ?? '';
  document.getElementById('last-name').value  = profile.last_name  ?? '';
  document.getElementById('profile-email').value = user.email ?? '';
  document.getElementById('profile-agent-id').value = profile.agent_id ?? '';
  document.getElementById('profile-bio').value = profile.bio ?? '';

  // Use the correct boolean column: show_on_about
  const showOnAbout = profile.show_on_about === true;
  document.getElementById('profile-public-status').value = showOnAbout ? 'true' : 'false';

  const photoEl = document.getElementById('profile-photo');
  if (profile.profile_picture_url) {
    photoEl.src = profile.profile_picture_url;
    const t = document.querySelector('.upload-text');
    if (t) t.style.display = 'none';
  }

  // Save profile changes (updates agents.show_on_about)
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('edit-profile-message');

    const updates = {
      first_name: document.getElementById('first-name').value.trim(),
      last_name:  document.getElementById('last-name').value.trim(),
      bio:        document.getElementById('profile-bio').value.trim(),
      show_on_about: document.getElementById('profile-public-status').value === 'true'
    };

    const { error: upErr } = await supabase
      .from('agents')
      .update(updates)
      .eq('id', user.id);

    if (upErr) {
      console.error('Update profile error:', upErr);
      msg.textContent = 'Failed to update profile.';
    } else {
      msg.textContent = 'Profile updated!';
    }
  });

  // Upload profile picture
  document.getElementById('profile-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
  
    // Basic client-side guardrails
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`File too large. Max ${MAX_MB} MB.`);
      return;
    }
  
    // Normalize extension/content type (iPhones sometimes give HEIC)
    const origExt = (file.name.split('.').pop() || '').toLowerCase();
    const safeExt = ['jpg','jpeg','png','webp','gif','heic','heif'].includes(origExt) ? origExt : 'jpg';
    const contentType = file.type || (safeExt === 'png' ? 'image/png' : 'image/jpeg');
  
    // User-scoped unique path: avatars/<uid>/<timestamp>.<ext>
    const path = `avatars/${user.id}/${Date.now()}.${safeExt}`;
  
    // Upload
    const { data: upData, error: uploadError } = await supabase
      .storage.from('avatars')
      .upload(path, file, {
        upsert: true,
        cacheControl: '3600',
        contentType
      });
  
    if (uploadError) {
      console.error('Upload failed:', uploadError);
      alert(`Upload failed: ${uploadError.message || 'Unknown error'}`);
      return;
    }
  
    // If bucket is PUBLIC:
    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = publicUrl.publicUrl;
  
    // Save URL to profile
    const { error: updateError } = await supabase
      .from('agents')
      .update({ profile_picture_url: avatarUrl })
      .eq('id', user.id);
  
    if (updateError) {
      console.error('Could not update profile picture URL:', updateError);
      alert(`Could not update profile picture: ${updateError.message || 'Unknown error'}`);
      return;
    }
  
    // Update UI
    document.getElementById('profile-photo').src = avatarUrl;
    const t = document.querySelector('.upload-text');
    if (t) t.style.display = 'none';
  });
  // Active page highlight (nav link only)
  const navProfileLink = document.querySelector('a#profile-tab');
  if (window.location.pathname.includes('profile')) navProfileLink?.classList.add('active-page');
});

// Logout
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  await supabase.auth.signOut();
  window.location.href = '../index.html';
});
