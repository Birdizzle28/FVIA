// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// Wait for DOM
document.addEventListener('DOMContentLoaded', async () => {
  const loadingScreen = document.getElementById('loading-screen');
  const { data: { session } } = await supabase.auth.getSession();
  const toggle = document.getElementById("agent-hub-toggle");
  const menu = document.getElementById("agent-hub-menu");

  // Make sure menu is hidden initially
  menu.style.display = "none";

  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      menu.style.display = "none";
    }
  });
  if (!session) {
    window.location.href = 'login.html'; // or 'login.html' if that's what you're using
    return;
  }

  const user = session.user;

  loadingScreen.style.display = 'none';

  // Load profile info
  const { data: profile } = await supabase
    .from('agents')
    .select('*')
    .eq('id', user.id)
    .single();
  
  console.log("Fetched profile:", profile);
  if (!profile.is_admin) {
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) adminLink.style.display = 'none';
  }


  if (profile) {
    document.getElementById('first-name').value = profile.first_name || '';
    document.getElementById('last-name').value = profile.last_name || '';
    document.getElementById('profile-email').value = user.email || '';
    document.getElementById('profile-agent-id').value = profile.agent_id || '';
    document.getElementById('profile-bio').value = profile.bio || '';
    document.getElementById('profile-public-status').value = profile.public || 'false';
    document.getElementById('profile-photo').src =
      profile.profile_picture_url || '../Pics/placeholder-user.png';
      if (profile.profile_picture_url) {
        const uploadText = document.querySelector('.upload-text');
        if (uploadText) uploadText.style.display = 'none';
      }

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
      .from('agents')
      .update({ profile_picture_url: avatarUrl })
      .eq('id', user.id);

    if (!updateError) {
      document.getElementById('profile-photo').src = avatarUrl;
    } else {
      alert('Could not update profile picture.');
    }
  });
  //Active page highlight tab
  const agentHubBtn = document.getElementById('profile-tab');
  const hubPages = ['profile']; // Add more if needed 
  console.log("Page Path:", window.location.pathname); // debug
  console.log("Found Agent Hub Button:", agentHubBtn); // debug
  if (hubPages.some(page => window.location.pathname.includes(page))) {
    agentHubBtn?.classList.add('active-page');
  } else {
    agentHubBtn?.classList.remove('active-page');
  }
  const toggle = document.getElementById('toolkit-toggle');
  const submenu = document.getElementById('toolkit-submenu');

  if (toggle && submenu) {
    const openSubmenu = () => {
      submenu.hidden = false;
      submenu.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
    };
    const closeSubmenu = () => {
      submenu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      // hide after animation finishes to keep height animation smooth
      setTimeout(() => { if (!submenu.classList.contains('open')) submenu.hidden = true; }, 260);
    };

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      expanded ? closeSubmenu() : openSubmenu();
    });

    // Optional: close submenu when clicking outside the mobile menu
    document.addEventListener('click', (e) => {
      const mobileMenu = document.getElementById('mobile-menu');
      if (!mobileMenu?.contains(e.target)) closeSubmenu();
    });
  }

});
//Logout
document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const { error } = await supabase.auth.signOut();
  if (error) {
    alert('Logout failed!');
    console.error(error);
  } else {
    window.location.href = '../index.html'; // or your login page
  }
});
