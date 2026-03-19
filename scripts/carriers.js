document.addEventListener("DOMContentLoaded", async () => {
  const sb = window.supabaseClient;
  if (!sb) {
    console.warn("Supabase client missing on carriers page.");
    return;
  }

  const els = {
    html: document.documentElement,

    mobileMenu: document.getElementById("mobile-menu"),
    menuToggle: document.getElementById("menu-toggle"),
    toolkitToggle: document.getElementById("toolkit-toggle"),
    toolkitSubmenu: document.getElementById("toolkit-submenu"),
    mobileAdminLink: document.getElementById("mobile-admin-link"),

    contractedCount: document.getElementById("contracted-count"),
    eligibleCount: document.getElementById("eligible-count"),
    ineligibleCount: document.getElementById("ineligible-count"),

    carrierSearch: document.getElementById("carrier-search"),
    carrierStateFilter: document.getElementById("carrier-state-filter"),
    carrierLineFilter: document.getElementById("carrier-line-filter"),
    carrierStatusFilter: document.getElementById("carrier-status-filter"),
    applyCarrierFilters: document.getElementById("apply-carrier-filters"),
    resetCarrierFilters: document.getElementById("reset-carrier-filters"),
    activeFilterChips: document.getElementById("active-filter-chips"),

    showAllCarriersBtn: document.getElementById("show-all-carriers-btn"),
    openAppetiteSearchBtn: document.getElementById("open-appetite-search-btn"),

    railStatus: document.getElementById("carrier-rail-status"),
    carrierTileList: document.getElementById("carrier-tile-list"),
    carrierRailEmpty: document.getElementById("carrier-rail-empty"),
    railGridViewBtn: document.getElementById("rail-grid-view-btn"),
    railListViewBtn: document.getElementById("rail-list-view-btn"),

    detailEmpty: document.getElementById("carrier-detail-empty"),
    detailContent: document.getElementById("carrier-detail-content"),

    detailLogo: document.getElementById("carrier-detail-logo"),
    detailName: document.getElementById("carrier-detail-name"),
    detailSummary: document.getElementById("carrier-detail-summary"),
    carrierSiteLink: document.getElementById("carrier-site-link"),
    requestContractingBtn: document.getElementById("request-contracting-btn"),

    chipContracted: document.getElementById("chip-contracted"),
    chipEligible: document.getElementById("chip-eligible"),

    supportPhone: document.getElementById("carrier-support-phone"),
    supportEmail: document.getElementById("carrier-support-email"),
    supportUrl: document.getElementById("carrier-support-url"),
    contractingNotes: document.getElementById("carrier-contracting-notes"),

    refreshEligibilityBtn: document.getElementById("refresh-eligibility-btn"),
    eligibilityBanner: document.getElementById("eligibility-summary-banner"),
    eligibilityAgentList: document.getElementById("eligibility-agent-list"),
    eligibilityUplineList: document.getElementById("eligibility-upline-list"),
    eligibilityMissingList: document.getElementById("eligibility-missing-list"),

    runAppetiteMatchBtn: document.getElementById("run-appetite-match-btn"),
    appetiteList: document.getElementById("carrier-appetite-list"),
    appetiteEmpty: document.getElementById("carrier-appetite-empty"),

    productsList: document.getElementById("carrier-products-list"),
    productsEmpty: document.getElementById("carrier-products-empty"),

    filesList: document.getElementById("carrier-files-list"),
    filesEmpty: document.getElementById("carrier-files-empty"),

    appetiteModal: document.getElementById("appetite-modal"),
    closeAppetiteModal: document.getElementById("close-appetite-modal"),
    appetiteState: document.getElementById("appetite-state"),
    appetiteLine: document.getElementById("appetite-line"),
    appetiteProduct: document.getElementById("appetite-product"),
    appetiteKeywords: document.getElementById("appetite-keywords"),
    runAppetiteSearchBtn: document.getElementById("run-appetite-search-btn"),
    resetAppetiteSearchBtn: document.getElementById("reset-appetite-search-btn"),
    appetiteSearchResults: document.getElementById("appetite-search-results"),

    contractingModal: document.getElementById("contracting-modal"),
    closeContractingModal: document.getElementById("close-contracting-modal"),
    requestCarrierName: document.getElementById("request-carrier-name"),
    requestEligibilityText: document.getElementById("request-eligibility-text"),
    requestStates: document.getElementById("request-states"),
    requestProducts: document.getElementById("request-products"),
    requestNotes: document.getElementById("request-notes"),
    contractingRequestForm: document.getElementById("contracting-request-form"),
    contractingFormMessage: document.getElementById("contracting-form-message"),
    cancelContractingRequest: document.getElementById("cancel-contracting-request"),

    toast: document.getElementById("carrier-toast")
  };

  const state = {
    session: null,
    authUser: null,
    me: null,
    carriers: [],
    carrierMap: new Map(),
    agentCarriers: [],
    agentCarrierMap: new Map(),
    products: [],
    productMap: new Map(),
    carrierProducts: [],
    carrierProductsByCarrier: new Map(),
    prosConsByCarrierProduct: new Map(),
    appetitesByCarrier: new Map(),
    filesByCarrier: new Map(),
    ridersByCarrierProduct: new Map(),
    discountsByCarrierProduct: new Map(),
    eligibilityRulesByCarrier: new Map(),
    uplinesById: new Map(),
    niprByAgentRef: new Map(),
    selectedCarrierId: null,
    selectedCarrier: null,
    filteredCarrierIds: [],
    railView: "grid"
  };

  const US_STATES = [
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
    "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
    "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
    "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
    "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"
  ];

  const LINE_SYNONYMS = {
    life: ["life", "life insurance"],
    health: ["health", "accident and health", "accident & health", "sickness", "medical"],
    property: ["property"],
    casualty: ["casualty"],
    pnc: ["property", "casualty", "property and casualty", "property & casualty", "p&c"]
  };

  wireToolbar();
  wireRailControls();
  wireModals();

  await bootstrap();

  async function bootstrap() {
    try {
      setRailStatus("Checking session...");

      const sessionResp = await sb.auth.getSession();
      state.session = sessionResp?.data?.session ?? null;
      state.authUser = state.session?.user ?? null;

      if (!state.authUser) {
        window.location.replace("login.html");
        return;
      }

      await loadCurrentAgent();
      await loadReferenceData();
      populateStaticSelects();
      buildAgentCarrierMap();
      computeEligibilityForAllCarriers();
      renderHeroCounts();
      renderRail();
      setRailStatus(`${state.filteredCarrierIds.length} carrier${state.filteredCarrierIds.length === 1 ? "" : "s"} found`);

      if (state.filteredCarrierIds.length) {
        selectCarrier(state.filteredCarrierIds[0]);
      } else {
        renderEmptyDetail();
      }

      els.html.style.visibility = "visible";
    } catch (err) {
      console.error("Carriers bootstrap error:", err);
      setRailStatus("Could not load carriers.");
      showToast("Could not load carriers.", "bad");
      els.html.style.visibility = "visible";
    }
  }

  async function loadCurrentAgent() {
    const email = state.authUser.email?.toLowerCase() || "";

    const { data, error } = await sb
      .from("agents")
      .select("*")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new Error("No matching agent row found for logged-in user.");
    }

    state.me = data;

    if (els.mobileAdminLink && !state.me.is_admin) {
      els.mobileAdminLink.style.display = "none";
    }
  }

  async function loadReferenceData() {
    await loadCarriers();
    await loadProducts();
    await loadCarrierProducts();
    await loadAgentCarriers();
  
    await loadAppetites();
    await loadFiles();
    await loadEligibilityRules();
  
    await loadProsCons();
    await loadRiders();
    await loadDiscounts();
  
    await loadUplineChain();
    await loadNiprLicenses();
  }

  async function loadCarriers() {
    const { data, error } = await sb
      .from("carriers")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("carrier_name", { ascending: true });

    if (error) throw error;

    state.carriers = data || [];
    state.carrierMap = new Map(state.carriers.map(c => [c.id, c]));
  }

  async function loadProducts() {
    const { data, error } = await sb
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("label", { ascending: true });

    if (error) throw error;

    state.products = data || [];
    state.productMap = new Map(state.products.map(p => [p.id, p]));
  }

  async function loadCarrierProducts() {
    const { data, error } = await sb
      .from("carrier_products")
      .select(`
        *,
        products:product_id (
          id,
          slug,
          label,
          line,
          is_active
        )
      `)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    state.carrierProducts = data || [];
    state.carrierProductsByCarrier = groupBy(state.carrierProducts, row => row.carrier_id);
  }

  async function loadAgentCarriers() {
    const { data, error } = await sb
      .from("agent_carriers")
      .select("*")
      .eq("agent_id", state.me.id);

    if (error) throw error;

    state.agentCarriers = data || [];
  }

  async function loadProsCons() {
    const carrierProductIds = state.carrierProducts.map(cp => cp.id);
    if (!carrierProductIds.length) return;

    const { data, error } = await sb
      .from("pros_cons")
      .select("*")
      .in("carrier_product_id", carrierProductIds);

    if (error) throw error;

    state.prosConsByCarrierProduct = new Map((data || []).map(row => [row.carrier_product_id, row]));
  }

  async function loadAppetites() {
    const carrierIds = state.carriers.map(c => c.id);
    if (!carrierIds.length) return;

    const { data, error } = await sb
      .from("carrier_appetites")
      .select("*")
      .eq("is_active", true)
      .in("carrier_id", carrierIds)
      .order("priority", { ascending: false })
      .order("sort_order", { ascending: true });

    if (error && !isMissingTable(error)) throw error;
    const rows = isMissingTable(error) ? [] : (data || []);
    state.appetitesByCarrier = groupBy(rows, row => row.carrier_id);
  }

  async function loadFiles() {
    const carrierIds = state.carriers.map(c => c.id);
    if (!carrierIds.length) return;

    const { data, error } = await sb
      .from("carrier_files")
      .select("*")
      .eq("is_active", true)
      .in("carrier_id", carrierIds)
      .eq("visible_to_agents", true)
      .order("sort_order", { ascending: true })
      .order("title", { ascending: true });

    if (error && !isMissingTable(error)) throw error;
    const rows = isMissingTable(error) ? [] : (data || []);
    state.filesByCarrier = groupBy(rows, row => row.carrier_id);
  }

  async function loadRiders() {
    const carrierProductIds = state.carrierProducts.map(cp => cp.id);
    if (!carrierProductIds.length) return;

    const { data, error } = await sb
      .from("carrier_product_riders")
      .select("*")
      .eq("is_active", true)
      .in("carrier_product_id", carrierProductIds)
      .order("sort_order", { ascending: true });

    if (error && !isMissingTable(error)) throw error;
    const rows = isMissingTable(error) ? [] : (data || []);
    state.ridersByCarrierProduct = groupBy(rows, row => row.carrier_product_id);
  }

  async function loadDiscounts() {
    const carrierProductIds = state.carrierProducts.map(cp => cp.id);
    if (!carrierProductIds.length) return;

    const { data, error } = await sb
      .from("carrier_product_discounts")
      .select("*")
      .eq("is_active", true)
      .in("carrier_product_id", carrierProductIds)
      .order("sort_order", { ascending: true });

    if (error && !isMissingTable(error)) throw error;
    const rows = isMissingTable(error) ? [] : (data || []);
    state.discountsByCarrierProduct = groupBy(rows, row => row.carrier_product_id);
  }

  async function loadEligibilityRules() {
    const carrierIds = state.carriers.map(c => c.id);
    if (!carrierIds.length) return;

    const { data, error } = await sb
      .from("carrier_eligibility_requirements")
      .select("*")
      .eq("is_active", true)
      .in("carrier_id", carrierIds);

    if (error && !isMissingTable(error)) throw error;
    const rows = isMissingTable(error) ? [] : (data || []);
    state.eligibilityRulesByCarrier = groupBy(rows, row => row.carrier_id);
  }

  async function loadUplineChain() {
    const visited = new Set();
    let currentRecruiterId = state.me.recruiter_id;

    while (currentRecruiterId && !visited.has(currentRecruiterId)) {
      visited.add(currentRecruiterId);

      const { data, error } = await sb
        .from("agents")
        .select("*")
        .eq("id", currentRecruiterId)
        .maybeSingle();

      if (error) throw error;
      if (!data) break;

      state.uplinesById.set(data.id, data);
      currentRecruiterId = data.recruiter_id;
    }
  }

  async function loadNiprLicenses() {
    const refs = new Set();

    const agentRefs = getAgentReferenceValues(state.me);
    agentRefs.forEach(ref => refs.add(ref));

    for (const upline of state.uplinesById.values()) {
      const uplineRefs = getAgentReferenceValues(upline);
      uplineRefs.forEach(ref => refs.add(ref));
    }

    const refValues = Array.from(refs).filter(Boolean);
    if (!refValues.length) return;

    const { data, error } = await sb
      .from("agent_nipr_licenses")
      .select("*")
      .in("agent_id", refValues);

    if (error && !isMissingTable(error)) throw error;
    const rows = isMissingTable(error) ? [] : (data || []);

    state.niprByAgentRef = groupBy(rows, row => String(row.agent_id));
  }

  function getAgentReferenceValues(agent) {
    return [
      agent?.agent_id ? String(agent.agent_id) : null,
      agent?.id ? String(agent.id) : null
    ].filter(Boolean);
  }

  function buildAgentCarrierMap() {
    state.agentCarrierMap = new Map(state.agentCarriers.map(row => [row.carrier_id, row]));
  }

  function computeEligibilityForAllCarriers() {
    for (const carrier of state.carriers) {
      const eligibility = computeCarrierEligibility(carrier.id);
      carrier._eligibility = eligibility;
      carrier._agentCarrier = state.agentCarrierMap.get(carrier.id) || null;
    }
  }

  function computeCarrierEligibility(carrierId) {
    const rules = state.eligibilityRulesByCarrier.get(carrierId) || [];
    const carrierProducts = state.carrierProductsByCarrier.get(carrierId) || [];
    const agentCarrier = state.agentCarrierMap.get(carrierId) || null;

    if (agentCarrier?.eligibility_override) {
      return {
        eligible: true,
        statusText: "Eligibility overridden",
        summaryClass: "warn",
        missing: agentCarrier.eligibility_override_reason
          ? [`Override: ${agentCarrier.eligibility_override_reason}`]
          : [],
        agentLines: [],
        uplineChecks: [],
        checkedRules: [],
        openRequest: null
      };
    }

    if (!rules.length) {
      return {
        eligible: true,
        statusText: "No eligibility rules configured",
        summaryClass: "warn",
        missing: [],
        agentLines: [],
        uplineChecks: [],
        checkedRules: [],
        openRequest: null
      };
    }

    const missing = [];
    const agentLines = [];
    const uplineChecks = [];
    const checkedRules = [];
    let allPassed = true;

    for (const rule of rules) {
      const productTitle = getRuleProductLabel(rule, carrierProducts);
      const ruleLabel = [rule.state, productTitle].filter(Boolean).join(" • ");

      const agentCheck = checkAgentForRule(state.me, rule);
      checkedRules.push({
        id: rule.id,
        label: ruleLabel,
        passed: agentCheck.passed,
        missing: [...agentCheck.missing]
      });

      if (agentCheck.linesText.length) {
        agentLines.push(`${ruleLabel}: ${agentCheck.linesText.join(", ")}`);
      } else {
        agentLines.push(`${ruleLabel}: no matching active licenses found`);
      }

      if (!agentCheck.passed) {
        allPassed = false;
        agentCheck.missing.forEach(item => missing.push(`You: ${item}`));
      }

      if (rule.require_upline_match) {
        const uplines = Array.from(state.uplinesById.values());
        const depth = typeof rule.upline_depth === "number" && rule.upline_depth > 0
          ? rule.upline_depth
          : uplines.length;

        const chain = uplines.slice(0, depth);

        if (!chain.length) {
          allPassed = false;
          missing.push(`No upline found for ${ruleLabel}, but upline match is required.`);
          uplineChecks.push(`Missing upline for ${ruleLabel}`);
        } else {
          chain.forEach((upline, index) => {
            const uplineCheck = checkAgentForRule(upline, rule);
            const prefix = `Upline ${index + 1} (${upline.full_name || upline.email || upline.id})`;
            uplineChecks.push(
              `${prefix} • ${ruleLabel}: ${
                uplineCheck.linesText.length ? uplineCheck.linesText.join(", ") : "no matching active licenses found"
              }`
            );

            if (!uplineCheck.passed) {
              allPassed = false;
              uplineCheck.missing.forEach(item => missing.push(`${prefix}: ${item}`));
            }
          });
        }
      }
    }

    return {
      eligible: allPassed,
      statusText: allPassed ? "Eligible to apply" : "Not eligible",
      summaryClass: allPassed ? "good" : "bad",
      missing: dedupe(missing),
      agentLines: dedupe(agentLines),
      uplineChecks: dedupe(uplineChecks),
      checkedRules
    };
  }

  function checkAgentForRule(agent, rule) {
    const stateCode = normalizeState(rule.state);
    const requiredLines = Array.isArray(rule.required_lines) ? rule.required_lines : [];
    const normalizedRequired = requiredLines.map(normalizeLine).filter(Boolean);

    const linesHeld = new Set();
    const missing = [];

    const niprRows = getNiprRowsForAgent(agent);

    for (const row of niprRows) {
      if (rule.requires_active_license && row?.active === false) continue;

      const rowState = normalizeState(row.state);
      if (rowState !== stateCode) continue;

      const loaNames = Array.isArray(row.loa_names) ? row.loa_names : [];
      loaNames.forEach(name => {
        const norm = normalizeLine(name);
        if (norm) linesHeld.add(norm);
      });
    }

    normalizedRequired.forEach(line => {
      if (!linesHeld.has(line)) {
        missing.push(`Missing ${prettyLine(line)} in ${stateCode}`);
      }
    });

    return {
      passed: missing.length === 0,
      missing,
      linesText: Array.from(linesHeld).sort().map(prettyLine)
    };
  }

  function getNiprRowsForAgent(agent) {
    const refs = getAgentReferenceValues(agent);
    const rows = [];

    refs.forEach(ref => {
      const matched = state.niprByAgentRef.get(String(ref)) || [];
      matched.forEach(row => rows.push(row));
    });

    return rows;
  }

  function renderHeroCounts() {
    let contracted = 0;
    let eligible = 0;
    let ineligible = 0;

    state.carriers.forEach(carrier => {
      const agentCarrier = state.agentCarrierMap.get(carrier.id);
      const isContracted = !!agentCarrier?.is_contracted;

      if (isContracted) contracted += 1;

      if (carrier._eligibility?.eligible) eligible += 1;
      else ineligible += 1;
    });

    if (els.contractedCount) els.contractedCount.textContent = String(contracted);
    if (els.eligibleCount) els.eligibleCount.textContent = String(eligible);
    if (els.ineligibleCount) els.ineligibleCount.textContent = String(ineligible);
  }

  function renderRail() {
    const filtered = getFilteredCarriers();
    state.filteredCarrierIds = filtered.map(c => c.id);

    renderFilterChips();
    renderStateOptions();
    renderAppetiteStateOptions();
    renderAppetiteProductOptions();

    els.carrierTileList.innerHTML = "";
    els.carrierTileList.classList.toggle("grid-mode", state.railView === "grid");

    if (!filtered.length) {
      els.carrierRailEmpty.hidden = false;
      setRailStatus("No carriers matched your filters.");
      return;
    }

    els.carrierRailEmpty.hidden = true;
    setRailStatus(`${filtered.length} carrier${filtered.length === 1 ? "" : "s"} found`);

    filtered.forEach(carrier => {
      const tile = createCarrierTile(carrier);
      els.carrierTileList.appendChild(tile);
    });

    if (state.selectedCarrierId && !state.filteredCarrierIds.includes(state.selectedCarrierId)) {
      state.selectedCarrierId = null;
      renderEmptyDetail();
    }
  }

  function createCarrierTile(carrier) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "carrier-tile";
    if (state.selectedCarrierId === carrier.id) tile.classList.add("active");

    const agentCarrier = state.agentCarrierMap.get(carrier.id);
    const isContracted = !!agentCarrier?.is_contracted;
    const eligibility = carrier._eligibility || { eligible: false };
    const isDim = !isContracted && !eligibility.eligible;
    if (isDim) tile.classList.add("is-dim");

    const logo = carrier.carrier_logo || "./Pics/img17.png";
    const productCount = (state.carrierProductsByCarrier.get(carrier.id) || []).length;

    tile.innerHTML = `
      <img src="${escapeHtmlAttr(logo)}" alt="${escapeHtmlAttr(carrier.carrier_name || "Carrier")} logo" />
      <div class="carrier-tile-overlay">
        <div class="carrier-tile-top">
          ${isContracted ? `<span class="mini-chip contracted">Contracted</span>` : ""}
          ${!isContracted && eligibility.eligible ? `<span class="mini-chip eligible">Eligible</span>` : ""}
          ${!eligibility.eligible ? `<span class="mini-chip ineligible">Ineligible</span>` : ""}
        </div>
        <div class="carrier-tile-bottom">
          <h3 class="carrier-tile-name">${escapeHtml(carrier.carrier_name || "Unnamed Carrier")}</h3>
          <span class="carrier-tile-sub">${productCount} product${productCount === 1 ? "" : "s"}</span>
        </div>
      </div>
    `;

    tile.addEventListener("click", () => selectCarrier(carrier.id));
    return tile;
  }

  function selectCarrier(carrierId) {
    state.selectedCarrierId = carrierId;
    state.selectedCarrier = state.carrierMap.get(carrierId) || null;

    Array.from(els.carrierTileList.querySelectorAll(".carrier-tile")).forEach((tile, index) => {
      const id = state.filteredCarrierIds[index];
      tile.classList.toggle("active", id === carrierId);
    });

    if (!state.selectedCarrier) {
      renderEmptyDetail();
      return;
    }

    renderCarrierDetail(state.selectedCarrier);
  }

  function renderEmptyDetail() {
    els.detailEmpty.hidden = true;
    els.detailContent.hidden = false;
    if (els.detailEmpty) {
      els.detailEmpty.hidden = false;
    }
    if (els.detailContent) {
      els.detailContent.hidden = true;
    }
  }

  function renderCarrierDetail(carrier) {
    els.detailEmpty.hidden = true;
    els.detailContent.hidden = false;

    const agentCarrier = state.agentCarrierMap.get(carrier.id) || null;
    const eligibility = carrier._eligibility || computeCarrierEligibility(carrier.id);
    const products = state.carrierProductsByCarrier.get(carrier.id) || [];
    const appetites = state.appetitesByCarrier.get(carrier.id) || [];
    const files = state.filesByCarrier.get(carrier.id) || [];

    els.detailLogo.src = carrier.carrier_logo || "./Pics/img17.png";
    els.detailLogo.alt = `${carrier.carrier_name || "Carrier"} logo`;
    els.detailName.textContent = carrier.carrier_name || "Carrier";
    els.detailSummary.textContent = carrier.short_description || carrier.notes || "No summary has been added for this carrier yet.";

    if (carrier.carrier_url) {
      els.carrierSiteLink.href = carrier.carrier_url;
      els.carrierSiteLink.style.display = "";
    } else {
      els.carrierSiteLink.removeAttribute("href");
      els.carrierSiteLink.style.display = "none";
    }

    els.supportPhone.textContent = carrier.support_phone || "—";
    els.supportEmail.textContent = carrier.support_email || "—";
    els.supportUrl.innerHTML = carrier.support_url
      ? `<a href="${escapeHtmlAttr(carrier.support_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(carrier.support_url)}</a>`
      : "—";
    els.contractingNotes.textContent = carrier.contracting_notes || "—";

    renderTopChips(agentCarrier, eligibility);
    renderEligibility(eligibility);
    renderAppetites(appetites, products);
    renderProducts(products);
    renderFiles(files);

    els.requestContractingBtn.disabled = false;
  }

  function renderTopChips(agentCarrier, eligibility) {
    if (agentCarrier?.is_contracted) {
      setChip(els.chipContracted, "Contracted", "good");
    } else if (agentCarrier?.status) {
      setChip(els.chipContracted, prettyStatus(agentCarrier.status), "warn");
    } else {
      setChip(els.chipContracted, "Not contracted", "neutral");
    }

    if (eligibility?.eligible) {
      setChip(els.chipEligible, "Eligible to apply", "good");
    } else {
      setChip(els.chipEligible, "Not eligible", "bad");
    }
  }

  function renderEligibility(eligibility) {
    const klass = eligibility?.summaryClass || "neutral";
    els.eligibilityBanner.className = `banner ${klass}`;
    els.eligibilityBanner.textContent = eligibility?.statusText || "Eligibility unknown.";

    renderBulletList(
      els.eligibilityAgentList,
      eligibility?.agentLines?.length ? eligibility.agentLines : ["No agent license details found."]
    );

    renderBulletList(
      els.eligibilityUplineList,
      eligibility?.uplineChecks?.length ? eligibility.uplineChecks : ["No upline requirements blocked this carrier, or no upline match was required."]
    );

    renderBulletList(
      els.eligibilityMissingList,
      eligibility?.missing?.length ? eligibility.missing : ["No missing items found."]
    );
  }

  function renderAppetites(appetites, products) {
    els.appetiteList.innerHTML = "";

    if (!appetites.length) {
      els.appetiteEmpty.hidden = false;
      return;
    }

    els.appetiteEmpty.hidden = true;

    appetites.forEach(appetite => {
      const card = document.createElement("article");
      card.className = "appetite-card";

      const productLabel = appetite.carrier_product_id
        ? getCarrierProductLabel(appetite.carrier_product_id, products)
        : "All Products";

      const states = Array.isArray(appetite.states) && appetite.states.length
        ? appetite.states.join(", ")
        : "All States";

      const tags = Array.isArray(appetite.appetite_tags) ? appetite.appetite_tags : [];

      card.innerHTML = `
        <h4>${escapeHtml(appetite.title || "Appetite Note")}</h4>
        <p>${escapeHtml(appetite.description || "No appetite description added yet.")}</p>
        <div class="appetite-meta">
          <span class="appetite-tag">${escapeHtml(productLabel)}</span>
          <span class="appetite-tag">${escapeHtml(states)}</span>
          ${tags.map(tag => `<span class="appetite-tag">${escapeHtml(tag)}</span>`).join("")}
        </div>
      `;

      els.appetiteList.appendChild(card);
    });
  }

  function renderProducts(products) {
    els.productsList.innerHTML = "";
  
    if (!products.length) {
      els.productsEmpty.hidden = false;
      return;
    }
  
    els.productsEmpty.hidden = true;
  
    products.forEach((cp, index) => {
      const product = cp.products || state.productMap.get(cp.product_id) || {};
      const prosCons = state.prosConsByCarrierProduct.get(cp.id) || null;
      const riders = state.ridersByCarrierProduct.get(cp.id) || [];
      const discounts = state.discountsByCarrierProduct.get(cp.id) || [];
  
      const productCard = document.createElement("article");
      productCard.className = "product-card collapsible-card";
      productCard.dataset.open = "false";
  
      const pros = Array.isArray(prosCons?.pros) ? prosCons.pros : [];
      const cons = Array.isArray(prosCons?.cons) ? prosCons.cons : [];
      const bestFor = Array.isArray(prosCons?.best_for) ? prosCons.best_for : [];
      const avoidIf = Array.isArray(prosCons?.avoid_if) ? prosCons.avoid_if : [];
  
      productCard.innerHTML = `
        <button type="button" class="collapse-header product-collapse-header">
          <div class="product-top-left">
            <h4>${escapeHtml(cp.plan_title || product.label || "Product")}</h4>
            <span class="product-line">${escapeHtml(product.label || product.slug || "Product")} • ${escapeHtml(product.line || "Line")}</span>
          </div>
  
          <div class="collapse-header-right">
            <div class="product-note-row">
              ${cp.requires_contract ? `<span class="note-pill">Contracting Required</span>` : ""}
              ${cp.requires_appointment ? `<span class="note-pill">Appointment Required</span>` : ""}
              ${Array.isArray(cp.availability_states) && cp.availability_states.length ? `<span class="note-pill">${escapeHtml(cp.availability_states.join(", "))}</span>` : ""}
            </div>
            <span class="collapse-chevron">▸</span>
          </div>
        </button>
  
        <div class="collapse-body" hidden>
          <div class="product-content">
            <p>${escapeHtml(cp.description || cp.summary || "No product description added yet.")}</p>
  
            <div class="product-grid">
              <div class="product-subcard">
                <h5>Overview</h5>
                <ul>
                  ${renderListItems([
                    cp.summary ? `Summary: ${cp.summary}` : null,
                    bestFor.length ? `Best for: ${bestFor.join("; ")}` : null,
                    avoidIf.length ? `Avoid if: ${avoidIf.join("; ")}` : null,
                    pros.length ? `Pros: ${pros.join("; ")}` : null,
                    cons.length ? `Cons: ${cons.join("; ")}` : null,
                    cp.notes ? `Notes: ${cp.notes}` : null,
                    cp.application_url ? `Application: ${cp.application_url}` : null
                  ])}
                </ul>
              </div>
  
              <div class="product-subcard">
                <h5>Riders / Endorsements</h5>
                <ul>
                  ${renderListItems(
                    riders.length
                      ? riders.map(r => `${r.rider_name}${r.description ? ` — ${r.description}` : ""}`)
                      : ["No riders added yet."]
                  )}
                </ul>
              </div>
  
              <div class="product-subcard">
                <h5>Discounts</h5>
                <ul>
                  ${renderListItems(
                    discounts.length
                      ? discounts.map(d => `${d.discount_name}${d.description ? ` — ${d.description}` : ""}`)
                      : ["No discounts added yet."]
                  )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      `;
  
      const header = productCard.querySelector(".collapse-header");
      const body = productCard.querySelector(".collapse-body");
      const chevron = productCard.querySelector(".collapse-chevron");
  
      header.addEventListener("click", () => {
        const isOpen = productCard.dataset.open === "true";
        productCard.dataset.open = isOpen ? "false" : "true";
        body.hidden = isOpen;
        chevron.textContent = isOpen ? "▸" : "▾";
      });
  
      els.productsList.appendChild(productCard);
    });
  }

  function renderFiles(files) {
    els.filesList.innerHTML = "";
  
    if (!files.length) {
      els.filesEmpty.hidden = false;
      return;
    }
  
    els.filesEmpty.hidden = true;
  
    files.forEach(file => {
      const card = document.createElement("article");
      card.className = "file-card collapsible-card";
      card.dataset.open = "false";
  
      const category = file.category || "other";
  
      card.innerHTML = `
        <button type="button" class="collapse-header file-collapse-header">
          <div class="file-top-left">
            <h4>${escapeHtml(file.title || "Untitled File")}</h4>
            <span class="file-category">${escapeHtml(category.replaceAll("_", " "))}</span>
          </div>
          <span class="collapse-chevron">▸</span>
        </button>
  
        <div class="collapse-body" hidden>
          <p>${escapeHtml(file.description || "No description added.")}</p>
          <div class="file-actions">
            <a class="file-link-btn" href="${escapeHtmlAttr(file.file_url)}" target="_blank" rel="noopener noreferrer">
              <i class="fa-solid fa-file-arrow-down"></i>
              <span>Open File</span>
            </a>
          </div>
        </div>
      `;
  
      const header = card.querySelector(".collapse-header");
      const body = card.querySelector(".collapse-body");
      const chevron = card.querySelector(".collapse-chevron");
  
      header.addEventListener("click", () => {
        const isOpen = card.dataset.open === "true";
        card.dataset.open = isOpen ? "false" : "true";
        body.hidden = isOpen;
        chevron.textContent = isOpen ? "▸" : "▾";
      });
  
      els.filesList.appendChild(card);
    });
  }

  function renderBulletList(target, items) {
    target.innerHTML = "";
    items.forEach(item => {
      const li = document.createElement("li");
      li.textContent = item;
      target.appendChild(li);
    });
  }

  function renderFilterChips() {
    const chips = [];
    const search = els.carrierSearch.value.trim();
    const stateFilter = els.carrierStateFilter.value;
    const lineFilter = els.carrierLineFilter.value;
    const statusFilter = els.carrierStatusFilter.value;

    if (search) chips.push(`Search: ${search}`);
    if (stateFilter) chips.push(`State: ${stateFilter}`);
    if (lineFilter) chips.push(`Line: ${prettyLine(lineFilter)}`);
    if (statusFilter) chips.push(`Status: ${prettyStatus(statusFilter)}`);

    els.activeFilterChips.innerHTML = chips
      .map(chip => `<span class="filter-chip">${escapeHtml(chip)}</span>`)
      .join("");
  }

  function renderStateOptions() {
    const states = new Set(US_STATES);

    state.carriers.forEach(carrier => {
      const rules = state.eligibilityRulesByCarrier.get(carrier.id) || [];
      rules.forEach(rule => {
        if (rule.state) states.add(normalizeState(rule.state));
      });

      const products = state.carrierProductsByCarrier.get(carrier.id) || [];
      products.forEach(cp => {
        (cp.availability_states || []).forEach(s => states.add(normalizeState(s)));
      });

      const appetites = state.appetitesByCarrier.get(carrier.id) || [];
      appetites.forEach(a => {
        (a.states || []).forEach(s => states.add(normalizeState(s)));
      });
    });

    const html = [`<option value="">All States</option>`]
      .concat(Array.from(states).filter(Boolean).sort().map(s => `<option value="${escapeHtmlAttr(s)}">${escapeHtml(s)}</option>`))
      .join("");

    els.carrierStateFilter.innerHTML = html;
  }

  function populateStaticSelects() {
    const options = US_STATES.map(s => `<option value="${s}">${s}</option>`).join("");
    if (els.requestStates) els.requestStates.innerHTML = options;
    if (els.appetiteState) els.appetiteState.innerHTML = `<option value="">Select State</option>${options}`;
  }

  function renderAppetiteStateOptions() {
    const stateValue = els.appetiteState.value;
    const html = [`<option value="">Select State</option>`]
      .concat(US_STATES.map(s => `<option value="${s}" ${s === stateValue ? "selected" : ""}>${s}</option>`))
      .join("");
    els.appetiteState.innerHTML = html;
  }

  function renderAppetiteProductOptions() {
    const current = els.appetiteProduct.value;
    const options = state.products
      .map(p => `<option value="${escapeHtmlAttr(p.id)}" ${p.id === current ? "selected" : ""}>${escapeHtml(p.label)}</option>`)
      .join("");
    els.appetiteProduct.innerHTML = `<option value="">Select Product</option>${options}`;

    if (els.requestProducts) {
      els.requestProducts.innerHTML = state.products
        .map(p => `<option value="${escapeHtmlAttr(p.id)}">${escapeHtml(p.label)}</option>`)
        .join("");
    }
  }

  function getFilteredCarriers() {
    const search = els.carrierSearch.value.trim().toLowerCase();
    const stateFilter = normalizeState(els.carrierStateFilter.value);
    const lineFilter = normalizeLine(els.carrierLineFilter.value);
    const statusFilter = els.carrierStatusFilter.value;

    return state.carriers.filter(carrier => {
      const carrierProducts = state.carrierProductsByCarrier.get(carrier.id) || [];
      const appetites = state.appetitesByCarrier.get(carrier.id) || [];
      const eligibility = carrier._eligibility || { eligible: false };
      const agentCarrier = state.agentCarrierMap.get(carrier.id);

      if (search) {
        const haystack = [
          carrier.carrier_name,
          carrier.short_description,
          carrier.notes,
          ...carrierProducts.flatMap(cp => [
            cp.plan_title,
            cp.summary,
            cp.description,
            cp.notes,
            cp.products?.label,
            cp.products?.slug,
            cp.products?.line
          ]),
          ...appetites.flatMap(a => [
            a.title,
            a.description,
            ...(a.appetite_tags || [])
          ])
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(search)) return false;
      }

      if (stateFilter) {
        const productStateMatch = carrierProducts.some(cp =>
          Array.isArray(cp.availability_states) && cp.availability_states.map(normalizeState).includes(stateFilter)
        );

        const ruleStateMatch = (state.eligibilityRulesByCarrier.get(carrier.id) || []).some(rule =>
          normalizeState(rule.state) === stateFilter
        );

        const appetiteStateMatch = appetites.some(a =>
          Array.isArray(a.states) && a.states.map(normalizeState).includes(stateFilter)
        );

        if (!productStateMatch && !ruleStateMatch && !appetiteStateMatch) {
          return false;
        }
      }

      if (lineFilter) {
        const productLineMatch = carrierProducts.some(cp => normalizeLine(cp.products?.line) === lineFilter);
        if (!productLineMatch) return false;
      }

      if (statusFilter === "contracted" && !agentCarrier?.is_contracted) return false;
      if (statusFilter === "eligible" && !eligibility.eligible) return false;
      if (statusFilter === "ineligible" && eligibility.eligible) return false;

      return true;
    });
  }

  function wireMenu() {
    if (els.menuToggle && els.mobileMenu) {
      els.menuToggle.addEventListener("click", e => {
        e.stopPropagation();
        els.mobileMenu.classList.toggle("open");
      });

      document.addEventListener("click", e => {
        if (!els.mobileMenu.contains(e.target) && !els.menuToggle.contains(e.target)) {
          els.mobileMenu.classList.remove("open");
        }
      });
    }

    if (els.toolkitToggle && els.toolkitSubmenu) {
      els.toolkitToggle.addEventListener("click", () => {
        const isHidden = els.toolkitSubmenu.hasAttribute("hidden");
        if (isHidden) {
          els.toolkitSubmenu.removeAttribute("hidden");
          els.toolkitToggle.setAttribute("aria-expanded", "true");
        } else {
          els.toolkitSubmenu.setAttribute("hidden", "");
          els.toolkitToggle.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  function wireToolbar() {
    els.applyCarrierFilters?.addEventListener("click", () => {
      renderRail();
      if (state.filteredCarrierIds.length && !state.selectedCarrierId) {
        selectCarrier(state.filteredCarrierIds[0]);
      }
    });

    els.resetCarrierFilters?.addEventListener("click", () => {
      els.carrierSearch.value = "";
      els.carrierStateFilter.value = "";
      els.carrierLineFilter.value = "";
      els.carrierStatusFilter.value = "";
      renderRail();
      if (state.filteredCarrierIds.length) selectCarrier(state.filteredCarrierIds[0]);
    });

    els.showAllCarriersBtn?.addEventListener("click", () => {
      els.carrierSearch.value = "";
      els.carrierStateFilter.value = "";
      els.carrierLineFilter.value = "";
      els.carrierStatusFilter.value = "";
      renderRail();
      if (state.filteredCarrierIds.length) selectCarrier(state.filteredCarrierIds[0]);
    });

    els.openAppetiteSearchBtn?.addEventListener("click", openAppetiteModal);
    els.runAppetiteMatchBtn?.addEventListener("click", () => {
      openAppetiteModal();
      if (state.selectedCarrier) {
        els.appetiteKeywords.value = state.selectedCarrier.carrier_name || "";
      }
      runAppetiteSearch();
    });

    els.refreshEligibilityBtn?.addEventListener("click", () => {
      if (!state.selectedCarrier) return;
      const updated = computeCarrierEligibility(state.selectedCarrier.id);
      state.selectedCarrier._eligibility = updated;
      renderCarrierDetail(state.selectedCarrier);
      renderHeroCounts();
      renderRail();
      showToast("Eligibility refreshed.", "good");
    });
  }

  function wireRailControls() {
    els.railGridViewBtn?.addEventListener("click", () => {
      state.railView = "grid";
      els.railGridViewBtn.classList.add("active");
      els.railListViewBtn.classList.remove("active");
      els.carrierTileList.classList.add("grid-mode");
    });

    els.railListViewBtn?.addEventListener("click", () => {
      state.railView = "list";
      els.railListViewBtn.classList.add("active");
      els.railGridViewBtn.classList.remove("active");
      els.carrierTileList.classList.remove("grid-mode");
    });
  }

  function wireModals() {
    els.closeAppetiteModal?.addEventListener("click", closeAppetiteModal);
    els.appetiteModal?.addEventListener("click", e => {
      if (e.target === els.appetiteModal) closeAppetiteModal();
    });

    els.runAppetiteSearchBtn?.addEventListener("click", runAppetiteSearch);
    els.resetAppetiteSearchBtn?.addEventListener("click", () => {
      els.appetiteState.value = "";
      els.appetiteLine.value = "";
      els.appetiteProduct.value = "";
      els.appetiteKeywords.value = "";
      els.appetiteSearchResults.innerHTML = "";
    });

    els.requestContractingBtn?.addEventListener("click", openContractingModal);
    els.closeContractingModal?.addEventListener("click", closeContractingModal);
    els.cancelContractingRequest?.addEventListener("click", closeContractingModal);
    els.contractingModal?.addEventListener("click", e => {
      if (e.target === els.contractingModal) closeContractingModal();
    });

    els.contractingRequestForm?.addEventListener("submit", submitContractingRequest);
  }

  function openAppetiteModal() {
    els.appetiteModal.hidden = false;
  }

  function closeAppetiteModal() {
    els.appetiteModal.hidden = true;
  }

  function runAppetiteSearch() {
    const stateFilter = normalizeState(els.appetiteState.value);
    const lineFilter = normalizeLine(els.appetiteLine.value);
    const productId = els.appetiteProduct.value;
    const keywords = els.appetiteKeywords.value.trim().toLowerCase();

    const results = [];

    state.carriers.forEach(carrier => {
      const products = state.carrierProductsByCarrier.get(carrier.id) || [];
      const appetites = state.appetitesByCarrier.get(carrier.id) || [];
      const eligibility = carrier._eligibility || { eligible: false };
      const agentCarrier = state.agentCarrierMap.get(carrier.id);

      const matchedAppetites = appetites.filter(a => {
        const productMatch = !productId || (
          a.carrier_product_id
            ? products.some(cp => cp.id === a.carrier_product_id && cp.product_id === productId)
            : true
        );

        const stateMatch = !stateFilter || !Array.isArray(a.states) || !a.states.length
          ? true
          : a.states.map(normalizeState).includes(stateFilter);

        const lineMatch = !lineFilter
          ? true
          : products.some(cp => {
              const productMatchesThisAppetite = !a.carrier_product_id || cp.id === a.carrier_product_id;
              return productMatchesThisAppetite && normalizeLine(cp.products?.line) === lineFilter;
            });

        const keywordHaystack = [
          carrier.carrier_name,
          a.title,
          a.description,
          ...(a.appetite_tags || [])
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const keywordMatch = !keywords || keywordHaystack.includes(keywords);

        return productMatch && stateMatch && lineMatch && keywordMatch;
      });

      if (!matchedAppetites.length) return;

      results.push({
        carrier,
        eligibility,
        isContracted: !!agentCarrier?.is_contracted,
        matchedAppetites
      });
    });

    els.appetiteSearchResults.innerHTML = "";

    if (!results.length) {
      els.appetiteSearchResults.innerHTML = `
        <div class="search-result-card">
          <h4>No matches found</h4>
          <p>Try a broader state, line, product, or keyword search.</p>
        </div>
      `;
      return;
    }

    results.forEach(result => {
      const card = document.createElement("article");
      card.className = "search-result-card";

      const statusText = result.isContracted
        ? "Contracted"
        : result.eligibility.eligible
          ? "Eligible"
          : "Ineligible";

      card.innerHTML = `
        <h4>${escapeHtml(result.carrier.carrier_name)} • ${escapeHtml(statusText)}</h4>
        <p>${escapeHtml(result.carrier.short_description || "No carrier summary available.")}</p>
        <div class="appetite-meta">
          ${result.matchedAppetites.slice(0, 6).map(a => `<span class="appetite-tag">${escapeHtml(a.title || "Appetite Note")}</span>`).join("")}
        </div>
      `;

      card.addEventListener("click", () => {
        closeAppetiteModal();
        selectCarrier(result.carrier.id);
        document.getElementById("carrier-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      els.appetiteSearchResults.appendChild(card);
    });
  }

  function openContractingModal() {
    if (!state.selectedCarrier) {
      showToast("Select a carrier first.", "bad");
      return;
    }

    const carrier = state.selectedCarrier;
    const eligibility = carrier._eligibility || { eligible: false };
    const carrierProducts = state.carrierProductsByCarrier.get(carrier.id) || [];

    els.requestCarrierName.textContent = carrier.carrier_name || "Carrier";
    els.requestEligibilityText.textContent = eligibility.eligible ? "Eligible to apply" : "Not eligible";
    els.requestNotes.value = "";
    els.contractingFormMessage.textContent = "";
    els.contractingFormMessage.className = "form-message";

    Array.from(els.requestStates.options).forEach(opt => {
      opt.selected = false;
    });

    els.requestProducts.innerHTML = carrierProducts
      .map(cp => {
        const p = cp.products || {};
        const label = `${cp.plan_title || p.label || "Product"} • ${p.label || p.slug || "Product"}`;
        return `<option value="${escapeHtmlAttr(cp.product_id)}">${escapeHtml(label)}</option>`;
      })
      .join("");

    els.contractingModal.hidden = false;
  }

  function closeContractingModal() {
    els.contractingModal.hidden = true;
  }

  async function submitContractingRequest(e) {
    e.preventDefault();

    if (!state.selectedCarrier || !state.me) return;

    const carrier = state.selectedCarrier;
    const eligibility = carrier._eligibility || { eligible: false };

    const requestedStates = Array.from(els.requestStates.selectedOptions).map(o => o.value);
    const requestedProductIds = Array.from(els.requestProducts.selectedOptions).map(o => o.value).filter(Boolean);
    const notes = els.requestNotes.value.trim();

    setFormMessage("", "");

    try {
      const openStatuses = ["draft", "queued", "sent"];
      const { data: existing, error: existingError } = await sb
        .from("carrier_contracting_requests")
        .select("id,status")
        .eq("agent_id", state.me.id)
        .eq("carrier_id", carrier.id)
        .in("status", openStatuses)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError && !isMissingColumn(existingError)) throw existingError;

      const payload = {
        agent_id: state.me.id,
        carrier_id: carrier.id,
        requested_by: state.me.id,
        status: "draft",
        notes,
        eligibility_snapshot: {
          eligible: eligibility.eligible,
          statusText: eligibility.statusText,
          missing: eligibility.missing || [],
          checkedAt: new Date().toISOString()
        }
      };

      if (await columnExists("carrier_contracting_requests", "requested_states")) {
        payload.requested_states = requestedStates;
      }

      if (await columnExists("carrier_contracting_requests", "requested_product_ids")) {
        payload.requested_product_ids = requestedProductIds;
      }

      let saveError = null;

      if (existing?.id) {
        const { error } = await sb
          .from("carrier_contracting_requests")
          .update(payload)
          .eq("id", existing.id);
        saveError = error || null;
      } else {
        const { error } = await sb
          .from("carrier_contracting_requests")
          .insert(payload);
        saveError = error || null;
      }

      if (saveError) throw saveError;

      setFormMessage("Contracting request saved.", "good");
      showToast("Contracting request saved.", "good");
      closeContractingModal();
    } catch (err) {
      console.error("Contracting request error:", err);
      setFormMessage(err.message || "Could not save request.", "bad");
      showToast("Could not save contracting request.", "bad");
    }
  }

  async function columnExists(table, column) {
    try {
      const { error } = await sb.from(table).select(column).limit(1);
      return !error;
    } catch {
      return false;
    }
  }

  function setFormMessage(text, type) {
    els.contractingFormMessage.textContent = text || "";
    els.contractingFormMessage.className = `form-message${type ? ` ${type}` : ""}`;
  }

  function setRailStatus(text) {
    if (els.railStatus) els.railStatus.textContent = text || "";
  }

  function setChip(el, text, klass) {
    if (!el) return;
    el.textContent = text;
    el.className = `status-chip ${klass || "neutral"}`;
  }

  function showToast(message, type = "neutral") {
    if (!els.toast) return;
    els.toast.hidden = false;
    els.toast.textContent = message;
    els.toast.style.background = type === "good"
      ? "#1b7b48"
      : type === "bad"
        ? "#a12d2d"
        : "#353468";

    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2600);
  }

  function groupBy(arr, keyFn) {
    const map = new Map();
    (arr || []).forEach(item => {
      const key = keyFn(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });
    return map;
  }

  function dedupe(arr) {
    return Array.from(new Set((arr || []).filter(Boolean)));
  }

  function normalizeLine(value) {
    if (!value) return "";
    const raw = String(value).trim().toLowerCase();

    for (const [canonical, aliases] of Object.entries(LINE_SYNONYMS)) {
      if (aliases.includes(raw)) return canonical;
    }

    if (raw.includes("life")) return "life";
    if (raw.includes("health") || raw.includes("accident")) return "health";
    if (raw.includes("medicare")) return "medicare";
    if (raw.includes("property") && raw.includes("casualty")) return "pnc";
    if (raw.includes("property")) return "property";
    if (raw.includes("casualty")) return "casualty";

    return raw;
  }

  function prettyLine(value) {
    const norm = normalizeLine(value);
    if (norm === "life") return "Life";
    if (norm === "health") return "Health";
    if (norm === "property") return "Property";
    if (norm === "casualty") return "Casualty";
    if (norm === "medicare") return "Medicare";
    if (norm === "pnc") return "Property & Casualty";
    return value ? titleCase(String(value)) : "Unknown";
  }

  function normalizeState(value) {
    return String(value || "").trim().toUpperCase();
  }

  function prettyStatus(value) {
    if (!value) return "Unknown";
    return titleCase(String(value).replaceAll("_", " "));
  }

  function titleCase(str) {
    return String(str)
      .split(" ")
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  function getRuleProductLabel(rule, carrierProducts) {
    if (!rule?.carrier_product_id) return "All Products";
    const cp = carrierProducts.find(row => row.id === rule.carrier_product_id);
    if (!cp) return "Product Rule";
    const p = cp.products || {};
    return cp.plan_title || p.label || "Product";
  }

  function getCarrierProductLabel(carrierProductId, productsForCarrier) {
    const cp = (productsForCarrier || []).find(row => row.id === carrierProductId);
    if (!cp) return "Product";
    const p = cp.products || {};
    return cp.plan_title || p.label || "Product";
  }

  function renderListItems(items) {
    return (items || [])
      .filter(Boolean)
      .map(item => `<li>${escapeHtml(String(item))}</li>`)
      .join("");
  }

  function isMissingTable(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("relation") || msg.includes("does not exist") || msg.includes("schema cache");
  }

  function isMissingColumn(error) {
    const msg = String(error?.message || "").toLowerCase();
    return msg.includes("column") && msg.includes("does not exist");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeHtmlAttr(value) {
    return escapeHtml(value);
  }
});
