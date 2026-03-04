// scripts/agent-quote-override.js
(() => {
  "use strict";

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
        return [];
    }
  }

  function computeRequiredLinesFromSelections(selections) {
    const out = new Set();
    (selections || []).forEach((s) => {
      linesRequiredForCoverOption(s).forEach((l) => out.add(l));
    });
    if (out.size === 0) out.add("life");
    return Array.from(out);
  }

  function productTypesFromRequiredLines(requiredLines) {
    const map = {
      life: "Life Insurance",
      health: "Health Insurance",
      property: "Property Insurance",
      casualty: "Casualty Insurance",
    };
    return Array.from(new Set((requiredLines || []).map((l) => map[l]).filter(Boolean)));
  }

  async function getAgentLicensedLinesForState(supabase, agentNpn, state2) {
    const { data, error } = await supabase
      .from("agent_nipr_licenses")
      .select("active, loa_names")
      .eq("agent_id", agentNpn)
      .eq("state", state2)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error || !data || data.length === 0) return new Set();

    const row = data.find(r => r?.active === true) || data[0];
    const loaNames = Array.isArray(row?.loa_names) ? row.loa_names : [];

    const lines = new Set();

    for (const name of loaNames) {
      const n = normStr(name);

      if (n.includes("life")) lines.add("life");
      if (
        n.includes("health") ||
        n.includes("accident & health") ||
        n.includes("accident and health") ||
        n.includes("sickness")
      ) {
        lines.add("health");
      }
      if (n.includes("property")) lines.add("property");
      if (n.includes("casualty")) lines.add("casualty");
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
      const v = cb?.value || "";

      const allowed = allowedCoverSet.has(v);
      lbl.style.display = allowed ? "" : "none";

      // hard-clear any disallowed selection
      if (!allowed && cb) cb.checked = false;
      if (!allowed) lbl.classList.remove("selected");
    });

    // Refresh visible display + CSV based on checked boxes
    const coverDisplay = document.getElementById("cover-display");
    const coverCsv = document.getElementById("cover_csv");
    if (coverDisplay && coverCsv) {
      const selected = Array.from(coverMenu.querySelectorAll('input[type="checkbox"]:checked'))
        .map(cb => cb.value);
      coverDisplay.textContent = selected.length ? selected.join(", ") : "";
      coverCsv.value = selected.join(",");
    }
  }

  function initAgentOverride() {
    const supabase = window.supabase;
    if (!supabase) return console.warn("[agent-quote-override] window.supabase missing");

    const agent = window.FVG_AGENT_PAGE_AGENT;
    if (!agent) return console.warn("[agent-quote-override] Missing window.FVG_AGENT_PAGE_AGENT");

    const btnStep1 = document.getElementById("btn-step1");
    const zipEl = document.getElementById("zip");

    if (btnStep1) {
      btnStep1.addEventListener("click", async (e) => {
        const zip5 = String(zipEl?.value || "").trim();
        if (!/^\d{5}$/.test(zip5)) return;

        const geo = await getGeoFromZip(zip5);
        if (!geo?.state) return;

        const agentNpn = agent.agent_id;
        const licensedLines = await getAgentLicensedLinesForState(supabase, agentNpn, geo.state);

        const coverOptions = ["Myself", "Someone Else", "My Health", "My Business", "My Car", "My Home"];
        const allowedCover = new Set(
          coverOptions.filter((opt) => {
            const req = linesRequiredForCoverOption(opt);
            return req.length && req.every((line) => licensedLines.has(line));
          })
        );

        filterCoverMenuToAllowed(allowedCover);

        if (allowedCover.size === 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          alert(`Sorry — this agent is not licensed for any of these coverages in ${geo.state}.`);
          return;
        }
      }, true);
    }

    // Patch submitQuote payload
    const origFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      try {
        if (typeof url === "string" && url.includes("/.netlify/functions/submitQuote") && options?.body) {
          // ✅ reroute ONLY on agent pages
          url = "/.netlify/functions/submitAgentQuote";
    
          const bodyObj = JSON.parse(options.body);
    
          const selections = Array.isArray(bodyObj.selections) ? bodyObj.selections : [];
          const requiredLines = computeRequiredLinesFromSelections(selections);
          const productTypes = productTypesFromRequiredLines(requiredLines);
    
          bodyObj.requiredLines = requiredLines;
          bodyObj.productTypes = productTypes;
    
          // ✅ hard-force the slug agent
          bodyObj.forcedAgentId = agent.id; // UUID
          bodyObj.skipHierarchy = true;
    
          // ✅ make agent page free leads (optional, but aligns with what you said)
          bodyObj.totalDebtCharge = 0;
    
          options.body = JSON.stringify(bodyObj);
        }
      } catch (err) {
        console.warn("[agent-quote-override] fetch patch failed:", err);
      }
      return origFetch(url, options);
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAgentOverride, { once: true });
  } else {
    initAgentOverride();
  }
})();
