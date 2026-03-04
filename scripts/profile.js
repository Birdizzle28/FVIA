// scripts/profile.js — uses shared window.supabaseClient (UMD) like admin pages

document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabaseClient;
  if (!supabase) {
    console.error("Supabase client missing (window.supabaseClient) on profile page");
    return;
  }

  // Require auth
  const { data: { session } = {} } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return;
  }
  const user = session.user;

  // Load this agent's profile row
  const { data: profile, error: profErr } = await supabase
    .from("agents")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profErr || !profile) {
    console.error("Load profile error:", profErr);
    return;
  }

  // ✅ Sync agents.email to auth email (after confirmation)
  if ((profile.email || "").toLowerCase() !== (user.email || "").toLowerCase()) {
    const { error: syncErr } = await supabase
      .from("agents")
      .update({ email: user.email })
      .eq("id", user.id);
  
    if (syncErr) console.warn("Could not sync agents.email:", syncErr);
  }
  // Show/hide admin links
  document.querySelectorAll("[data-admin-link]")
    .forEach(el => el.classList.toggle("admin-hidden", !profile.is_admin));

  // Fill fields (first/last locked)
  const firstNameEl = document.getElementById("first-name");
  const lastNameEl  = document.getElementById("last-name");
  const emailEl     = document.getElementById("profile-email");

  if (firstNameEl) {
    firstNameEl.value = profile.first_name ?? "";
    firstNameEl.disabled = true;
  }
  if (lastNameEl) {
    lastNameEl.value = profile.last_name ?? "";
    lastNameEl.disabled = true;
  }
  if (emailEl) {
    emailEl.value = user.email ?? "";
    emailEl.disabled = false;
  }

  document.getElementById("profile-agent-id").value = profile.agent_id ?? "";
  document.getElementById("profile-bio").value = profile.bio ?? "";

  // Profile photo
  const photoEl = document.getElementById("profile-photo");
  if (profile.profile_picture_url) {
    photoEl.src = profile.profile_picture_url;
    const t = document.querySelector(".upload-text");
    if (t) t.style.display = "none";
  }

  // ===== Save profile changes =====
  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = document.getElementById("edit-profile-message");
    if (msg) msg.textContent = "";

    const newEmail = (document.getElementById("profile-email").value || "").trim().toLowerCase();
    const oldEmail = (user.email || "").trim().toLowerCase();

    // Only update fields you actually want agents to edit in "agents"
    const updates = {
      bio: (document.getElementById("profile-bio").value || "").trim()
    };

    // 1) Update agents row
    const { error: upErr } = await supabase
      .from("agents")
      .update(updates)
      .eq("id", user.id);

    if (upErr) {
      console.error("Update profile error:", upErr);
      if (msg) msg.textContent = "Failed to update profile.";
      return;
    }

    // 2) Update auth email if changed
    if (newEmail && newEmail !== oldEmail) {
      const { error: emailErr } = await supabase.auth.updateUser({ email: newEmail });
      if (emailErr) {
        console.error("Email update error:", emailErr);
        if (msg) msg.textContent = "Profile saved, but email update failed.";
        return;
      }
      if (msg) {
        msg.textContent = "Profile saved! Check your email to confirm the new address.";
      }
      return;
    }

    if (msg) msg.textContent = "Profile updated!";
  });

  // ===== Upload profile picture =====
  const fileInput = document.getElementById("profile-photo-input");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      try {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `profile-pictures/${user.id}.${ext}`;

        const { error: uploadError } = await supabase
          .storage
          .from("profile-pictures")
          .upload(path, file, { upsert: true });

        if (uploadError) {
          console.error("Upload failed:", uploadError);
          alert("Upload failed! Check console for details.");
          return;
        }

        const { data: pub } = supabase.storage.from("profile-pictures").getPublicUrl(path);
        const avatarUrl = pub?.publicUrl;

        if (!avatarUrl) {
          alert("Upload succeeded but could not get public URL.");
          return;
        }

        const { error: updateError } = await supabase
          .from("agents")
          .update({ profile_picture_url: avatarUrl })
          .eq("id", user.id);

        if (updateError) {
          console.error("Could not update profile picture URL:", updateError);
          alert("Uploaded image, but could not save it to your profile.");
          return;
        }

        const img = document.getElementById("profile-photo");
        if (img) img.src = avatarUrl;

        const t = document.querySelector(".upload-text");
        if (t) t.style.display = "none";
      } catch (err) {
        console.error("Unexpected upload error:", err);
        alert("Upload failed (unexpected error). Check console.");
      } finally {
        e.target.value = "";
      }
    });
  }

  // ===== Push subscription button =====
  const pushBtn = document.getElementById("enable-notifications-btn");
  const pushMsg = document.getElementById("push-status-message");

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) throw new Error("Service workers not supported.");

    // Try common SW paths
    const candidates = ["/sw.js", "/service-worker.js"];
    let lastErr = null;

    for (const url of candidates) {
      try {
        const reg = await navigator.serviceWorker.register(url);
        await navigator.serviceWorker.ready;
        return reg;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Could not register service worker.");
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function upsertPushSubscription(sub) {
    const json = sub.toJSON();
    const endpoint = json.endpoint;
    const p256dh = json.keys && json.keys.p256dh;
    const auth = json.keys && json.keys.auth;

    if (!endpoint || !p256dh || !auth) throw new Error("Subscription missing required keys.");

    // Upsert by endpoint (matches unique constraint)
    const payload = {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      last_seen_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(payload, { onConflict: "user_id,endpoint" });

    if (error) throw error;
  }

  if (pushBtn) {
    pushBtn.addEventListener("click", async () => {
      try {
        if (pushMsg) pushMsg.textContent = "";

        if (!("Notification" in window)) {
          alert("This browser does not support notifications.");
          return;
        }

        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          if (pushMsg) pushMsg.textContent = "Notifications not enabled (permission denied).";
          return;
        }

        const reg = await registerServiceWorker();

        if (!("PushManager" in window)) {
          alert("Push notifications are not supported on this device/browser.");
          return;
        }

        // You MUST set this somewhere safe (build-time / config):
        // e.g. window.VAPID_PUBLIC_KEY = "BOr...."
        const VAPID_PUBLIC_KEY = window.VAPID_PUBLIC_KEY;
        if (!VAPID_PUBLIC_KEY) {
          alert("Missing VAPID public key (window.VAPID_PUBLIC_KEY).");
          return;
        }

        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        await upsertPushSubscription(sub);

        if (pushMsg) pushMsg.textContent = "Notifications enabled ✅";
      } catch (err) {
        console.error("Push subscribe error:", err);
        if (pushMsg) pushMsg.textContent = "Failed to enable notifications. Check console.";
        alert("Failed to enable notifications. Check console.");
      }
    });
  }

  // Active page highlight
  const navProfileLink = document.querySelector("a#profile-tab");
  if (window.location.pathname.includes("profile")) navProfileLink?.classList.add("active-page");
});

// Logout (use shared client)
document.getElementById("logout-btn")?.addEventListener("click", async (e) => {
  e.preventDefault();
  const supabase = window.supabaseClient;
  if (!supabase) return;

  await supabase.auth.signOut();
  window.location.href = "../index.html";
});
