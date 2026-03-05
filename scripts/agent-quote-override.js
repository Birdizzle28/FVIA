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
      case "My Home":
        return ["property"];
      case "My Car":
        return ["casualty"];
      case "My Business":
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
      .limit(25);

    if (error || !data || data.length === 0) return new Set();

    // Use ALL active rows; if none active, fall back to all rows (but this is rare)
    const activeRows = data.filter(r => r?.active === true);
    const rowsToUse = activeRows.length ? activeRows : data;

    const loaNames = rowsToUse.flatMap(r => Array.isArray(r.loa_names) ? r.loa_names : []);
    const lines = new Set();

    for (const name of loaNames) {
      const n = normStr(name);

      // life
      if (n.includes("life")) lines.add("life");

      // health
      if (
        n.includes("health") ||
        n.includes("accident & health") ||
        n.includes("accident and health") ||
        n.includes("sickness") ||
        n.includes("accident") && n.includes("health")
      ) {
        lines.add("health");
      }

      // property / casualty
      if (n.includes("property")) lines.add("property");
      if (n.includes("casualty")) lines.add("casualty");
    }

    return lines;
  }

  function showAllCoverOptions() {
    const coverMenu = document.getElementById("cover-menu");
    if (!coverMenu) return;
    coverMenu.querySelectorAll(".ms-option").forEach(lbl => {
      lbl.style.display = "";
    });
  }

  function setCoverLoading(isLoading) {
    const coverSelect = document.getElementById("cover-select");
    const coverDisplay = document.getElementById("cover-display");
    if (!coverSelect) return;

    if (isLoading) {
      coverSelect.setAttribute("aria-busy", "true");
      coverSelect.style.pointerEvents = "none";
      coverSelect.style.opacity = "0.75";
      if (coverDisplay && !coverDisplay.textContent.trim()) {
        coverDisplay.textContent = "Checking licenses…";
      }
    } else {
      coverSelect.removeAttribute("aria-busy");
      coverSelect.style.pointerEvents = "";
      coverSelect.style.opacity = "";
      if (coverDisplay && coverDisplay.textContent === "Checking licenses…") {
        coverDisplay.textContent = "";
      }
    }
  }

  function filterCoverMenuToAllowed(allowedCoverSet) {
    const coverMenu = document.getElementById("cover-menu");
    if (!coverMenu) return;

    coverMenu.querySelectorAll(".ms-option").forEach((lbl) => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      const v = cb?.value || "";

      const allowed = allowedCoverSet.has(v);
      lbl.style.display = allowed ? "" : "none";

      if (!allowed && cb) cb.checked = false;
      if (!allowed) lbl.classList.remove("selected");
    });

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
    const coverSelect = document.getElementById("cover-select");

    let lastZip = "";
    let lastAllowedCover = null;
    let inFlight = null;

    async function computeAndApply() {
      const zip5 = String(zipEl?.value || "").trim();

      // Not ready → do NOT filter (prevents blank menu)
      if (!/^\d{5}$/.test(zip5)) {
        lastZip = "";
        lastAllowedCover = null;
        showAllCoverOptions();
        setCoverLoading(false);
        return;
      }

      // Cache hit
      if (zip5 === lastZip && lastAllowedCover) {
        filterCoverMenuToAllowed(lastAllowedCover);
        setCoverLoading(false);
        return;
      }

      // Merge concurrent calls
      if (inFlight) return inFlight;

      setCoverLoading(true);

      inFlight = (async () => {
        const geo = await getGeoFromZip(zip5);

        // If geo fails → do NOT hide menu
        if (!geo?.state) {
          showAllCoverOptions();
          setCoverLoading(false);
          inFlight = null;
          return;
        }

        const licensedLines = await getAgentLicensedLinesForState(supabase, agent.agent_id, geo.state);

        const coverOptions = ["Myself", "Someone Else", "My Health", "My Business", "My Car", "My Home"];
        const allowedCover = new Set(
          coverOptions.filter((opt) => {
            const req = linesRequiredForCoverOption(opt);
            return req.length && req.every((line) => licensedLines.has(line));
          })
        );

        lastZip = zip5;
        lastAllowedCover = allowedCover;

        // IMPORTANT: never blank the menu silently
        if (allowedCover.size === 0) {
          showAllCoverOptions();
        } else {
          filterCoverMenuToAllowed(allowedCover);
        }

        setCoverLoading(false);
        inFlight = null;
      })();

      return inFlight;
    }

    // Recompute when ZIP becomes valid
    if (zipEl) {
      zipEl.addEventListener("input", () => {
        computeAndApply().catch(() => {});
      });
    }

    // Recompute right before user opens the dropdown
    if (coverSelect) {
      coverSelect.addEventListener("click", () => {
        computeAndApply().catch(() => {});
      }, true);
    }

    // Block Step1 if truly none allowed AFTER compute
    if (btnStep1) {
      btnStep1.addEventListener("click", async (e) => {
        await computeAndApply();

        const zip5 = String(zipEl?.value || "").trim();
        const allowed = lastAllowedCover;

        if (/^\d{5}$/.test(zip5) && allowed && allowed.size === 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          alert(`Sorry — this agent is not licensed for any of these coverages in your state.`);
        }
      }, true);
    }

    // Patch submitQuote payload (unchanged logic, just kept)
    const origFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      try {
        if (typeof url === "string" && url.includes("/.netlify/functions/submitQuote") && options?.body) {
          url = "/.netlify/functions/submitAgentQuote";

          const bodyObj = JSON.parse(options.body);

          const selections = Array.isArray(bodyObj.selections) ? bodyObj.selections : [];
          const requiredLines = computeRequiredLinesFromSelections(selections);
          const productTypes = productTypesFromRequiredLines(requiredLines);

          bodyObj.requiredLines = requiredLines;
          bodyObj.productTypes = productTypes;

          bodyObj.forcedAgentId = agent.id; // UUID
          bodyObj.skipHierarchy = true;
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
