// scripts/profile.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const user = session.user;

  // Load profile from AGENTS (not "profiles")
  const { data: profile, error: profErr } = await supabase
    .from('agents')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profErr) {
    console.error('Load profile error:', profErr);
    alert('Could not load profile.');
    return;
  }

  // Unhide admin links if admin
  if (profile?.is_admin) {
    document.querySelectorAll('[data-admin-link]').forEach(el => el.classList.remove('admin-hidden'));
  } else {
    document.querySelectorAll('[data-admin-link]').forEach(el => el.classList.add('admin-hidden'));
  }

  // Populate fields
  document.getElementById('first-name').value = profile.first_name || '';
  document.getElementById('last-name').value  = profile.last_name  || '';
  document.getElementById('profile-email').value = user.email || '';
  document.getElementById('profile-agent-id').value = profile.agent_id || '';
  document.getElementById('profile-bio').value = profile.bio || '';
  // prefer a boolean column like is_public; fall back to false
  const isPublic = (profile.is_public === true);
  document.getElementById('profile-public-status').value = isPublic ? 'true' : 'false';

  const photoEl = document.getElementById('profile-photo');
  if (profile.profile_picture_url) {
    photoEl.src = profile.profile_picture_url;
    const uploadText = document.querySelector('.upload-text');
    if (uploadText) uploadText.style.display = 'none';
  }

  // Save profile changes (write to AGENTS)
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('edit-profile-message');

    const is_public = document.getElementById('profile-public-status').value === 'true';

    const updates = {
      first_name: document.getElementById('first-name').value.trim(),
      last_name:  document.getElementById('last-name').value.trim(),
      bio:        document.getElementById('profile-bio').value.trim(),
      is_public   // boolean
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

    const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `avatars/${user.id}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) { alert('Upload failed!'); return; }

    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(filePath);
    const avatarUrl = publicUrl.publicUrl;

    const { error: updateError } = await supabase
      .from('agents')
      .update({ profile_picture_url: avatarUrl })
      .eq('id', user.id);

    if (updateError) { alert('Could not update profile picture.'); return; }

    document.getElementById('profile-photo').src = avatarUrl;
    const uploadText = document.querySelector('.upload-text');
    if (uploadText) uploadText.style.display = 'none';
  });

  // Active page highlight
  const navProfileLink = document.querySelector('a#profile-tab'); // target the NAV link specifically
  if (window.location.pathname.includes('profile')) {
    navProfileLink?.classList.add('active-page');
  } else {
    navProfileLink?.classList.remove('active-page');
  }
});

// Logout
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signOut();
  if (error) { alert('Logout failed!'); console.error(error); }
  else { window.location.href = '../index.html'; }
});
