// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// Wait for DOM
document.addEventListener('DOMContentLoaded', async () => {
  const loadingScreen = document.getElementById('loading-screen');
  const user = (await supabase.auth.getUser()).data.user;

  if (!user) {
    window.location.href = '../login.html';
    return;
  }

  loadingScreen.style.display = 'none';

  // Load profile info
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (profile) {
    document.getElementById('first-name').value = profile.first_name || '';
    document.getElementById('last-name').value = profile.last_name || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-agent-id').value = profile.agent_id || '';
    document.getElementById('profile-bio').value = profile.bio || '';
    document.getElementById('profile-public-status').value = profile.public || 'false';
    document.getElementById('profile-photo').src =
      profile.avatar_url || '../Pics/placeholder-user.png';
  }

  // Save profile changes
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const updates = {
      id: user.id,
      first_name: document.getElementById('first-name').value,
      last_name: document.getElementById('last-name').value,
      bio: document.getElementById('profile-bio').value,
      public: document.getElementById('profile-public-status').value
    };

    const { error } = await supabase.from('profiles').upsert(updates);
    const message = document.getElementById('edit-profile-message');

    if (error) {
      message.textContent = 'Failed to update profile.';
    } else {
      message.textContent = 'Profile updated!';
    }
  });

  // Upload profile picture
  document.getElementById('profile-photo-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileExt = file.name.split('.').pop();
    const filePath = `avatars/${user.id}.${fileExt}`;

    let { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      alert('Upload failed!');
      return;
    }

    const { data: publicUrl } = supabase.storage
      .from('avatars')
      .getPublicUrl(filePath);

    const avatarUrl = publicUrl.publicUrl;

    const { error: updateError } = await supabase
      .from('profiles')
      .update({ avatar_url: avatarUrl })
      .eq('id', user.id);

    if (!updateError) {
      document.getElementById('profile-photo').src = avatarUrl;
    } else {
      alert('Could not update profile picture.');
    }
  });
});
