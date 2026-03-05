// scripts/agent-quote-override.js
(() => {
  "use strict";

  const DEBUG = false; // set true to log

  function log(...args) { if (DEBUG) console.log("[agent-quote-override]", ...args); }

  async function getGeoFromZip(zip5) {
    try {
      const resp = await fetch(`/.netlify/functions/zip-geo?zip=${encodeURIComponent(zip5)}`, { cache: "no-store" });
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

  // ✅ your updated mapping
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
      .limit(10);

    if (error || !data || data.length === 0) return new Set();

    // ✅ only use active rows if any exist; else fallback to all rows
    const activeRows = data.filter(r => r?.active === true);
    const rowsToUse = activeRows.length ? activeRows : data;

    const loaNames = rowsToUse.flatMap(r => Array.isArray(r?.loa_names) ? r.loa_names : []);
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
        n.includes("sickness")
      ) lines.add("health");

      // property / casualty
      if (n.includes("property")) lines.add("property");
      if (n.includes("casualty")) lines.add("casualty");
    }

    return lines;
  }

  function filterCoverMenuToAllowed(allowedCoverSet) {
    const coverMenu = document.getElementById("cover-menu");
    if (!coverMenu) return false;

    let anyShown = 0;

    coverMenu.querySelectorAll(".ms-option").forEach((lbl) => {
      const cb = lbl.querySelector('input[type="checkbox"]');
      const v = cb?.value || "";

      const allowed = allowedCoverSet.has(v);
      lbl.style.display = allowed ? "" : "none";

      if (allowed) anyShown++;

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

    return anyShown > 0;
  }

  function getSelectedCoverValues() {
    const coverMenu = document.getElementById("cover-menu");
    if (!coverMenu) return [];
    return Array.from(coverMenu.querySelectorAll('input[type="checkbox"]:checked')).map(cb => cb.value);
  }

  function startObserver(reapplyFn) {
    const coverMenu = document.getElementById("cover-menu");
    if (!coverMenu) return null;

    const obs = new MutationObserver(() => {
      // freequote.js may rebuild options; reapply filter
      reapplyFn().catch(() => {});
    });

    obs.observe(coverMenu, { childList: true, subtree: true, attributes: true });
    return obs;
  }

  function initAgentOverride() {
    const supabase = window.supabase;
    if (!supabase) return console.warn("[agent-quote-override] window.supabase missing");

    const agent = window.FVG_AGENT_PAGE_AGENT;
    if (!agent) return console.warn("[agent-quote-override] Missing window.FVG_AGENT_PAGE_AGENT");

    const zipEl = document.getElementById("zip");
    const btnStep1 = document.getElementById("btn-step1");

    if (!zipEl) {
      console.warn("[agent-quote-override] #zip not found (partial not injected yet?)");
      return;
    }

    const agentNpn = agent.agent_id;

    // cache last computed state -> allowedCoverSet
    let lastZip = "";
    let lastState = "";
    let lastAllowedCover = null;

    async function computeAndApply() {
      const zip5 = String(zipEl.value || "").trim();

      if (!/^\d{5}$/.test(zip5)) return;

      // avoid recompute if same zip and we already computed
      if (zip5 === lastZip && lastAllowedCover) {
        log("reapply cached allowed set");
        filterCoverMenuToAllowed(lastAllowedCover);
        return;
      }

      const geo = await getGeoFromZip(zip5);
      if (!geo?.state) return;

      // if same state as last time and we have allowedCover, reuse
      if (geo.state === lastState && lastAllowedCover) {
        lastZip = zip5;
        log("reapply cached allowed set (same state)");
        filterCoverMenuToAllowed(lastAllowedCover);
        return;
      }

      const licensedLines = await getAgentLicensedLinesForState(supabase, agentNpn, geo.state);

      const coverOptions = ["Myself", "Someone Else", "My Health", "My Business", "My Car", "My Home"];
      const allowedCover = new Set(
        coverOptions.filter((opt) => {
          const req = linesRequiredForCoverOption(opt);
          return req.length && req.every((line) => licensedLines.has(line));
        })
      );

      lastZip = zip5;
      lastState = geo.state;
      lastAllowedCover = allowedCover;

      log("geo/state", geo.state, "licensedLines", Array.from(licensedLines), "allowedCover", Array.from(allowedCover));

      filterCoverMenuToAllowed(allowedCover);
    }

    // 1) Apply as the user types zip (when it becomes 5 digits)
    zipEl.addEventListener("input", () => {
      computeAndApply().catch(() => {});
    });

    // 2) Apply when step1 is clicked (capture phase so we run before freequote handlers)
    if (btnStep1) {
      btnStep1.addEventListener("click", async (e) => {
        await computeAndApply();

        // If nothing allowed, block step advance
        if (lastAllowedCover && lastAllowedCover.size === 0) {
          e.preventDefault();
          e.stopImmediatePropagation();
          alert(`Sorry — this agent is not licensed for any of these coverages in ${lastState || "that state"}.`);
          return;
        }
      }, true);
    }

    // 3) MutationObserver: if freequote.js rebuilds the menu, re-apply automatically
    startObserver(computeAndApply);

    // 4) Patch submitQuote payload (your same behavior)
    const origFetch = window.fetch.bind(window);
    window.fetch = async (url, options) => {
      try {
        if (typeof url === "string" && url.includes("/.netlify/functions/submitQuote") && options?.body) {
          url = "/.netlify/functions/submitAgentQuote";

          const bodyObj = JSON.parse(options.body);

          const selections = Array.isArray(bodyObj.selections) ? bodyObj.selections : getSelectedCoverValues();
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

    // 5) If zip already filled (autofill), apply immediately
    computeAndApply().catch(() => {});
  }

  // IMPORTANT: this script is loaded dynamically AFTER DOMContentLoaded
  // so just run immediately.
  initAgentOverride();
})();
