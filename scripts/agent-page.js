// /scripts/agent-page.js

document.addEventListener("DOMContentLoaded", async () => {
  const supabase = window.supabase;
  if (!supabase) {
    console.error("window.supabase missing");
    return;
  }

  // /a/<slug> -> parts[0]="a", parts[1]="<slug>"
  const parts = window.location.pathname.split("/").filter(Boolean);
  const slug = (parts[0] === "a" && parts[1]) ? parts[1] : null;
  if (!slug) {
    console.error("Missing slug in URL");
    return;
  }

  const { data: agent, error } = await supabase
    .from("agent_public_profiles")
    .select("*")
    .eq("agent_slug", slug)
    .single();

  if (error || !agent || !agent.agent_page_enabled) {
    document.body.innerHTML = `
      <h2 style="text-align:center;margin-top:120px;">
        This agent page is not active.
      </h2>
    `;
    return;
  }

  // Expose agent context for freequote.js to use
  window.AGENT_PAGE = {
    agent_id: agent.id,
    agent_slug: agent.agent_slug,
    source: "agent_page"
  };

  // Render hero/contact info
  const nameEl = document.getElementById("agent-name");
  const bioEl = document.getElementById("agent-bio");
  const photoEl = document.getElementById("agent-photo");

  if (nameEl) nameEl.textContent = `${agent.first_name} ${agent.last_name}`;
  if (bioEl) bioEl.textContent = agent.bio || "";
  if (photoEl && agent.profile_picture_url) photoEl.src = agent.profile_picture_url;

  const callEl = document.getElementById("agent-call");
  const textEl = document.getElementById("agent-text");
  const emailEl = document.getElementById("agent-email");

  if (agent.phone) {
    if (callEl) callEl.href = `tel:${agent.phone}`;
    if (textEl) textEl.href = `sms:${agent.phone}`;
  }
  if (agent.email && emailEl) {
    emailEl.href = `mailto:${agent.email}`;
  }

  // Load freequote funnel partial into #quote-container
  const quoteContainer = document.getElementById("quote-container");
  if (quoteContainer) {
    try {
      const res = await fetch("/partials/freequote-funnel.html", { cache: "no-store" });
      if (!res.ok) {
        console.error("Failed to load freequote partial:", res.status);
      } else {
        quoteContainer.innerHTML = await res.text();
      }
    } catch (e) {
      console.error("Error fetching freequote partial:", e);
    }
  }

  // Now load freequote.js AFTER the funnel markup exists
  // (prevents null element errors)
  await loadScriptOnce("/scripts/freequote.js");
});

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    // Already loaded?
    if ([...document.scripts].some(s => s.src && s.src.includes(src))) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.body.appendChild(s);
  });
}
