import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const user = session.user;

  const { data: profile, error: profErr } = await supabase
    .from('agents').select('*').eq('id', user.id).single();

  if (profErr || !profile) {
    console.error('Load profile error:', profErr);
    // optionally redirect to onboarding
    return;
  }

  // Admin link visibility
  const adminEls = document.querySelectorAll('[data-admin-link]');
  adminEls.forEach(el => el.classList.toggle('admin-hidden', !profile.is_admin));

  // Populate fields
  document.getElementById('first-name').value = profile.first_name ?? '';
  document.getElementById('last-name').value  = profile.last_name  ?? '';
  document.getElementById('profile-email').value = user.email ?? '';
  document.getElementById('profile-agent-id').value = profile.agent_id ?? '';
  document.getElementById('profile-bio').value = profile.bio ?? '';
  const hasIsPublic = Object.prototype.hasOwnProperty.call(profile, 'is_public');
  const isPublic = hasIsPublic ? profile.is_public === true : (profile.public === true);
  document.getElementById('profile-public-status').value = isPublic ? 'true' : 'false';

  const photoEl = document.getElementById('profile-photo');
  if (profile.profile_picture_url) {
    photoEl.src = profile.profile_picture_url;
    document.querySelector('.upload-text')?.style && (document.querySelector('.upload-text').style.display = 'none');
  }

  // Save
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('edit-profile-message');

    const wantPublic = document.getElementById('profile-public-status').value === 'true';
    const updates = {
      first_name: document.getElementById('first-name').value.trim(),
      last_name:  document.getElementById('last-name').value.trim(),
      bio:        document.getElementById('profile-bio').value.trim(),
    };
    if (hasIsPublic) updates.is_public = wantPublic; else updates.public = wantPublic;

    const { error: upErr } = await supabase.from('agents').update(updates).eq('id', user.id);
    msg.textContent = upErr ? 'Failed to update profile.' : 'Profile updated!';
    if (upErr) console.error('Update profile error:', upErr);
  });

  // Upload photo
  document.getElementById('profile-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const filePath = `avatars/${user.id}.${fileExt}`;

    const { error: uploadError } = await supabase.storage.from('avatars').upload(filePath, file, { upsert: true });
    if (uploadError) { alert('Upload failed!'); return; }

    const { data: publicUrl } = supabase.storage.from('avatars').getPublicUrl(filePath);
    const avatarUrl = publicUrl.publicUrl;

    const { error: updateError } = await supabase.from('agents').update({ profile_picture_url: avatarUrl }).eq('id', user.id);
    if (updateError) { alert('Could not update profile picture.'); return; }

    document.getElementById('profile-photo').src = avatarUrl;
    document.querySelector('.upload-text')?.style && (document.querySelector('.upload-text').style.display = 'none');
  });

  // Active page highlight (nav link only)
  const navProfileLink = document.querySelector('a#profile-tab');
  if (window.location.pathname.includes('profile')) navProfileLink?.classList.add('active-page');
});
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signOut();
  window.location.href = '../index.html';
});
