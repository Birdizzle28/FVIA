// scripts/agent-quote-override.js
// Runs on the AGENT PAGE only.
// Must be loaded BEFORE freequote.js.
// Goal: filter "I want to cover..." based on agent NIPR licenses for ZIP's state,
// and force submitQuote payload to route to this agent (no hierarchy).

(() => {
  "use strict";

  // --- helpers ---
  async function getGeoFromZip(zip5) {
    try {
      const resp = await fetch(`/.netlify/functions/zip-geo?zip=${encodeURIComponent(zip5)}`);
      if (!resp.ok) return { state: null };
      const json = await resp.json();
      return { state: json?.state || null, city: json?.city || null, lat: json?.lat ?? null, lng: json?.lng ?? null };
    } catch {
      return { state: null };
    }
  }

  function normStr(s) {
    return String(s || "").trim().toLowerCase();
  }

  function linesRequiredForCoverOption(label) {
    // Your rules:
    // - Myself, Someone Else => life
    // - My Health => health
    // - My Business, My Car, My Home => property AND casualty
    switch (label) {
      case "Myself":
      case "Someone Else":
        return ["life"];
      case "My Health":
        return ["health"];
      case "My Business":
      case "My Car":
      case "My Home":
        return ["property", "casualty"];
      default:
        return []; // unknown option => treat as not allowed
    }
  }

  function computeRequiredLinesFromSelections(selections) {
    // Used to overwrite payload sent by freequote.js
    const out = new Set();
    (selections || []).forEach((s) => {
      linesRequiredForCoverOption(s).forEach((l) => out.add(l));
    });
    // keep freequote default behavior if none picked
    if (out.size === 0) out.add("life");
    return Array.from(out);
  }

  function productTypesFromRequiredLines(requiredLines) {
    // Must match freequote.js mapping strings.  [oai_citation:2‡freequote.js](sediment://file_000000003b44722fb438de1be5c95df2)
    const map = {
      life: "Life Insurance",
      health: "Health Insurance",
      property: "Property Insurance",
      casualty: "Casualty Insurance",
    };
    return Array.from(new Set((requiredLines || []).map((l) => map[l]).filter(Boolean)));
  }

  async function getAgentLicensedLinesForState(supabase, agentNpn, state2) {
    // agent_nipr_licenses.agent_id is TEXT (NPN), state is TEXT.  [oai_citation:3‡Necessary Schemas.txt](sediment://file_000000005cf071f595b2e51d96a0af1a)
    const { data, error } = await supabase
      .from("agent_nipr_licenses")
      .select("active, loa_names, loa_details")
      .eq("agent_id", agentNpn)
      .eq("state", state2)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !data || data.length === 0) return new Set();

    // pick the newest active row if present, else newest row
    const row = data.find(r => r?.active === true) || data[0];
    const loaNames = Array.isArray(row?.loa_names) ? row.loa_names : [];

    const lines = new Set();

    // Very tolerant matching because LOA naming varies
    for (const name of loaNames) {
      const n = normStr(name);

      // LIFE
      if (n.includes("life")) lines.add("life");

      // HEALTH (sometimes "Accident & Health" or "Health")
      if (n.includes("health") || n.includes("accident")) lines.add("health");

      // PROPERTY / CASUALTY
      if (n.includes("property")) lines.add("property");
      if (n.includes("casualty")) lines.add("casualty");

      // If they store combined strings like "Property & Casualty"
      if (n.includes("property") && n.includes("casualty")) {
        lines.add("property");
        lines.add("casualty");
      }
    }

    return lines;
  }

  function filterCoverMenuToAllowed(allowedCoverSet) {
    const coverMenu = document.getElementById("cover-menu");
    if (!coverMenu) return;

    coverMenu.querySelectorAll(".ms-option").forEach((lbl) => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      const v = cb?.value || lbl.textContent.trim();

      const allowed = allowedCoverSet.has(v);
      lbl.style.display = allowed ? "" : "none";

      // if it was selected but now disallowed, unselect it
      if (!allowed && lbl.classList.contains("selected")) {
        lbl.classList.remove("selected");
        if (cb) cb.checked = false;
      }
    });

    // Try to trigger freequote.js display refresh if present
    try {
      const coverDisplay = document.getElementById("cover-display");
      const coverCsv = document.getElementById("cover_csv");
      if (coverDisplay && coverCsv) {
        const selected = Array.from(coverMenu.querySelectorAll(".ms-option.selected"))
          .map(lbl => (lbl.dataset.value ?? lbl.textContent).trim());
        coverDisplay.textContent = selected.join(", ");
        coverCsv.value = selected.join(",");
      }
    } catch {}
  }

  // --- main ---
  document.addEventListener("DOMContentLoaded", () => {
    const supabase = window.supabase; // on public agent page you’re using window.supabase (anon client)
    if (!supabase) {
      console.warn("[agent-quote-override] window.supabase missing");
      return;
    }

    // agent-page.js should set this after it loads agent_public_profiles row
    const agent = window.FVG_AGENT_PAGE_AGENT;
    if (!agent) {
      console.warn("[agent-quote-override] Missing window.FVG_AGENT_PAGE_AGENT");
      return;
    }

    const btnStep1 = document.getElementById("btn-step1");
    const zipEl = document.getElementById("zip");

    // 1) Intercept Step 1 click BEFORE freequote.js runs its handler
    // (capture + early registration because this script loads before freequote.js)
    if (btnStep1) {
      btnStep1.addEventListener(
        "click",
        async (e) => {
          // If ZIP invalid, let freequote.js handle its own validation UI
          const zip5 = String(zipEl?.value || "").trim();
          if (!/^\d{5}$/.test(zip5)) return;

          // Determine state from ZIP (same function freequote.js uses)  [oai_citation:4‡freequote.js](sediment://file_000000003b44722fb438de1be5c95df2)
          const geo = await getGeoFromZip(zip5);
          if (!geo?.state) return;

          // Load agent's license lines for that state
          const agentNpn = agent.agent_id; // NPN text
          const licensedLines = await getAgentLicensedLinesForState(supabase, agentNpn, geo.state);

          // Compute which cover options are allowed given your rules
          const coverOptions = ["Myself", "Someone Else", "My Health", "My Business", "My Car", "My Home"];
          const allowedCover = new Set(
            coverOptions.filter((opt) => {
              const req = linesRequiredForCoverOption(opt);
              if (req.length === 0) return false;
              return req.every((line) => licensedLines.has(line));
            })
          );

          filterCoverMenuToAllowed(allowedCover);

          // If NONE are allowed, stop the flow here and show a message
          if (allowedCover.size === 0) {
            e.preventDefault();
            e.stopImmediatePropagation();
            alert(`Sorry — this agent is not licensed for any of these coverages in ${geo.state}.`);
            return;
          }
        },
        true // capture
      );
    }

    // 2) Patch submitQuote payload so it:
    // - forces the agent id
    // - removes hierarchy logic on the server side (server must honor this flag)
    // - uses YOUR required-line rules (Car/Home require BOTH P & C)
    const origFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      try {
        if (typeof url === "string" && url.includes("/.netlify/functions/submitQuote") && options?.body) {
          const bodyObj = JSON.parse(options.body);

          // selections already exist in payload from freequote.js  [oai_citation:5‡freequote.js](sediment://file_000000003b44722fb438de1be5c95df2)
          const selections = Array.isArray(bodyObj.selections) ? bodyObj.selections : [];
          const requiredLines = computeRequiredLinesFromSelections(selections);
          const productTypes = productTypesFromRequiredLines(requiredLines);

          bodyObj.requiredLines = requiredLines;
          bodyObj.productTypes = productTypes;

          // Force-routing fields (you’ll implement in the Netlify function)
          bodyObj.forcedAgentId = agent.id; // auth uuid
          bodyObj.skipHierarchy = true;

          options.body = JSON.stringify(bodyObj);
        }
      } catch (err) {
        console.warn("[agent-quote-override] fetch patch failed:", err);
      }
      return origFetch(url, options);
    };
  });
})();
