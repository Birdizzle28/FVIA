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

  async function getAgentLicensedLinesForState(_supabaseIgnored, agentNpn, state2) {
    const agentKey = String(agentNpn || "").trim();
    const st = String(state2 || "").trim().toUpperCase();

    try {
      const resp = await fetch(
        `/.netlify/functions/getAgentLicensedLines?agent_id=${encodeURIComponent(agentKey)}&state=${encodeURIComponent(st)}`,
        { cache: "no-store" }
      );
      if (!resp.ok) return new Set();
      const json = await resp.json();
      const lines = Array.isArray(json?.lines) ? json.lines : [];
      return new Set(lines);
    } catch {
      return new Set();
    }
  }

  async function getAgencyLicensedLinesForState(state2) {
    const st = String(state2 || "").trim().toUpperCase();
    try {
      const resp = await fetch(
        `/.netlify/functions/getAgencyLicensedLines?state=${encodeURIComponent(st)}`,
        { cache: "no-store" }
      );
      if (!resp.ok) return null; // null = don't enforce if function fails
      const json = await resp.json();
      if (!json?.ok) return null;
      const lines = Array.isArray(json?.lines) ? json.lines : [];
      return new Set(lines);
    } catch {
      return null; // null = don't enforce if function fails
    }
  }

  function intersectSets(a, b) {
    const out = new Set();
    if (!a || !b) return out;
    for (const v of a) if (b.has(v)) out.add(v);
    return out;
  }

  function showAllCoverOptions() {
    const coverMenu = document.getElementById("cover-menu");
    if (!coverMenu) return;
    coverMenu.querySelectorAll(".ms-option").forEach((lbl) => {
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
      const selected = Array.from(coverMenu.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => cb.value);
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
    let lastEnforced = null; // { state, agentLines, agencyLines, effectiveLines }
    let inFlight = null;

    async function computeAndApply() {
      const zip5 = String(zipEl?.value || "").trim();

      if (!/^\d{5}$/.test(zip5)) {
        lastZip = "";
        lastAllowedCover = null;
        lastEnforced = null;
        showAllCoverOptions();
        setCoverLoading(false);
        return;
      }

      if (zip5 === lastZip && lastAllowedCover) {
        filterCoverMenuToAllowed(lastAllowedCover);
        setCoverLoading(false);
        return;
      }

      if (inFlight) return inFlight;

      setCoverLoading(true);

      inFlight = (async () => {
        const geo = await getGeoFromZip(zip5);

        if (!geo?.state) {
          showAllCoverOptions();
          setCoverLoading(false);
          inFlight = null;
          return;
        }

        const agentLines = await getAgentLicensedLinesForState(supabase, agent.agent_id, geo.state);

        // Agency lines (null means function failed -> don't enforce agency gating to avoid breaking UX)
        const agencyLines = await getAgencyLicensedLinesForState(geo.state);

        const effectiveLines = agencyLines ? intersectSets(agentLines, agencyLines) : agentLines;

        const coverOptions = ["Myself", "Someone Else", "My Health", "My Business", "My Car", "My Home"];
        const allowedCover = new Set(
          coverOptions.filter((opt) => {
            const req = linesRequiredForCoverOption(opt);
            return req.length && req.every((line) => effectiveLines.has(line));
          })
        );

        lastZip = zip5;
        lastAllowedCover = allowedCover;
        lastEnforced = {
          state: geo.state,
          agentLines: Array.from(agentLines),
          agencyLines: agencyLines ? Array.from(agencyLines) : null,
          effectiveLines: Array.from(effectiveLines),
        };

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

    if (zipEl) {
      zipEl.addEventListener("input", () => {
        computeAndApply().catch(() => {});
      });
    }

    if (coverSelect) {
      coverSelect.addEventListener(
        "click",
        () => {
          computeAndApply().catch(() => {});
        },
        true
      );
    }

    if (btnStep1) {
      btnStep1.addEventListener(
        "click",
        async (e) => {
          await computeAndApply();

          const zip5 = String(zipEl?.value || "").trim();
          const allowed = lastAllowedCover;

          if (/^\d{5}$/.test(zip5) && allowed && allowed.size === 0) {
            e.preventDefault();
            e.stopImmediatePropagation();

            const st = lastEnforced?.state || "your state";
            const agencyMsg = lastEnforced?.agencyLines
              ? `our agency is not licensed for those coverages in ${st}, or this agent isn't within agency bounds there.`
              : `this agent is not licensed for any of these coverages in ${st}.`;

            alert(`Sorry — we can’t quote these options because ${agencyMsg}`);
          }
        },
        true
      );
    }

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

          bodyObj.forcedAgentId = agent.id;
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
