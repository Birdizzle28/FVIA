// scripts/personal-info.js
document.addEventListener('DOMContentLoaded', () => {
  if (!window.supabase) {
    console.error('Supabase client missing on this page');
    return;
  }

  const supabase = window.supabase;

  /* ---------- FOLDER TABS (needed for PI folder tabs) ---------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.folder-tabs .tab');
    if (!btn) return;

    const tabs = btn.parentElement.querySelectorAll('.tab');
    const panels = btn.closest('.folder-tabs').querySelectorAll('.panel');
    const id = btn.dataset.tab;

    tabs.forEach(t => {
      const active = t === btn;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    panels.forEach(p => p.classList.toggle('is-active', p.id === `panel-${id}`));
  });

  /* ---------- COMPLIANCE CARD ---------- */
  (async function initComplianceCard() {
    const npnEl      = document.getElementById('npn-value');
    const uplNameEl  = document.getElementById('upline-name');
    const uplPhoneEl = document.getElementById('upline-phone');
    const uplEmailEl = document.getElementById('upline-email');
    const listEl     = document.getElementById('license-list');

    if (!npnEl || !listEl) return;

    const safe = (el, v) => { if (el) el.textContent = v ? v : '—'; };

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    const { data: me } = await supabase
      .from('agents')
      .select('id, full_name, phone, email, agent_id, recruiter_id')
      .eq('email', user.email)
      .single();

    if (!me) {
      safe(npnEl, null);
      listEl.innerHTML = `<p class="muted">No agent entry found for this account.</p>`;
      return;
    }

    const npn = me.agent_id;
    safe(npnEl, npn);

    if (me.recruiter_id) {
      const { data: upline } = await supabase
        .from('agents')
        .select('full_name, phone, email')
        .eq('id', me.recruiter_id)
        .single();

      safe(uplNameEl,  upline?.full_name);
      safe(uplPhoneEl, upline?.phone);
      safe(uplEmailEl, upline?.email);
    } else {
      safe(uplNameEl,  'Not assigned');
      safe(uplPhoneEl, null);
      safe(uplEmailEl, null);
    }

    const { data: licenses } = await supabase
      .from('agent_nipr_licenses')
      .select('*')
      .eq('agent_id', npn)
      .order('state');

    if (!licenses?.length) {
      listEl.innerHTML = `<p class="muted">No NIPR licenses on file yet for this agent.</p>`;
      return;
    }

    listEl.innerHTML = '';
    licenses.forEach(lic => {
      const block = document.createElement('div');
      block.className = 'license-block';

      block.innerHTML = `
        <div class="license-header">
          <span class="license-title">${lic.state} — ${lic.license_class || ''}</span>
          <span class="license-status ${lic.active ? 'active' : 'inactive'}">
            ${lic.active ? 'Active' : 'Inactive'}
          </span>
        </div>

        <div class="license-meta">
          <span><strong>Number:</strong> ${lic.license_number || '—'}</span>
          <span><strong>Issued:</strong> ${lic.date_issue_orig || '—'}</span>
          <span><strong>Expires:</strong> ${lic.date_expire || '—'}</span>
        </div>

        <div class="license-loas">
          ${(lic.loa_names || []).map(l => `<span class="license-chip">${l}</span>`).join('')
            || '<span class="muted">No LOAs listed</span>'}
        </div>
      `;

      listEl.appendChild(block);
    });
  })();

  /* ---------- PERSONAL INFO LOCK ---------- */
  (async function initPersonalInfoLock() {
    const card      = document.getElementById("pi-lock-card");
    const content   = document.getElementById("pi-content");
    const emailIn   = document.getElementById("pi-email-input");
    const sendBtn   = document.getElementById("pi-email-send");
    const codeRow   = document.getElementById("pi-code-row");
    const codeIn    = document.getElementById("pi-email-code");
    const verifyBtn = document.getElementById("pi-email-verify");
    const statusEl  = document.getElementById("pi-lock-status");

    if (!card || !content) return;

    const TTL_MS = 15 * 60 * 1000;

    const setStatus = (msg, isError = false) => {
      if (!statusEl) return;
      statusEl.textContent = msg || "";
      statusEl.style.color = isError ? "#b00020" : "#2a8f6d";
    };

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) {
      setStatus("You must be logged in to unlock this section.", true);
      return;
    }

    const userId    = user.id;
    const userEmail = user.email || "";
    const unlockKey = `pi-email-unlocked:${userId}`;

    const unlock = () => {
      card.style.display = "none";

      const wrapper =
        document.getElementById("pi-wrapper") ||
        content?.parentElement ||
        null;

      [wrapper, content].forEach((el) => {
        if (!el) return;
        el.classList.remove("pi-locked", "pi-blur");
        el.style.filter = "none";
        el.style.pointerEvents = "auto";
      });

      document
        .querySelectorAll("#pi-content .pi-locked, #pi-content .pi-blur")
        .forEach((el) => {
          el.classList.remove("pi-locked", "pi-blur");
          el.style.filter = "none";
          el.style.pointerEvents = "auto";
        });

      const expiresAt = Date.now() + TTL_MS;
      localStorage.setItem(unlockKey, String(expiresAt));
    };

    const stored = localStorage.getItem(unlockKey);
    if (stored) {
      const expiresAt = Number(stored);
      if (Number.isFinite(expiresAt) && Date.now() < expiresAt) {
        unlock();
        return;
      } else {
        localStorage.removeItem(unlockKey);
      }
    }

    if (emailIn) {
      emailIn.value = userEmail;
      emailIn.readOnly = false;
    }

    let lastCode = null;

    sendBtn?.addEventListener("click", async () => {
      const typed = (emailIn?.value || "").trim();

      if (!typed) {
        setStatus("Enter your email address first.", true);
        return;
      }
      if (!userEmail) {
        setStatus("No email found for this account.", true);
        return;
      }
      if (typed.toLowerCase() !== userEmail.toLowerCase()) {
        setStatus("That email doesn’t match the one on your account.", true);
        return;
      }

      const code = Math.floor(100000 + Math.random() * 900000).toString();
      lastCode = code;

      setStatus("Sending code…");

      try {
        const { data, error } = await supabase.functions.invoke("send-email", {
          body: {
            to: userEmail,
            subject: "Your Family Values verification code",
            html: `<p>Your unlock code is <strong>${code}</strong>.</p>`,
          },
        });

        if (error || !data?.ok) {
          console.error("send-email error:", error || data);
          setStatus("Error sending code. Please try again.", true);
          return;
        }

        if (codeRow) codeRow.hidden = false;
        setStatus("Code sent! Check your email.");
      } catch (err) {
        console.error("send-email invoke failed:", err);
        setStatus("Network error while sending code.", true);
      }
    });

    verifyBtn?.addEventListener("click", () => {
      const entered = (codeIn?.value || "").trim();

      if (!lastCode) {
        setStatus("You need to send a code first.", true);
        return;
      }
      if (!entered) {
        setStatus("Enter the code from your email.", true);
        return;
      }
      if (entered !== lastCode) {
        setStatus("That code does not match. Try again or send a new one.", true);
        return;
      }

      setStatus("Verified. Unlocking…");
      unlock();
    });
  })();
});
