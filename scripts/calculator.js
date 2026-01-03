document.addEventListener('DOMContentLoaded', () => {
  if (!supabase) {
    console.error('Supabase client missing on this page');
    return;
  }
  // ========= State =========
  let chosenLine = null;
  let chosenProductId = null;
  let questions = [];            // [{id,q_number,label,type,...}]
  let carriers = [];             // [{carrier_product_id, carrier:{...}, pros_cons, requirements:[...] , equation, inputs }]
  let answers = {};              // { [q_number]: value }
  let derivedCtx = {};           // computed fields available to rules/equations (e.g., uw_tier)

  // ========= Helpers =========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const slide = (name) => {
    $$('.q-slide').forEach(s => s.classList.remove('is-active'));
    $(`.q-slide[data-slide="${name}"]`)?.classList.add('is-active');
  };
  const money = (n) => isFinite(n) ? `$${(+n).toFixed(2)}` : '—';

  // ===== Slide 1: choose line =====
  $$('#q-list [data-slide="line"] .tile').forEach(btn => {
    btn.addEventListener('click', () => {
      chosenLine = btn.dataset.line; $('#line-next').disabled = false;
    });
  });

  $('#line-next')?.addEventListener('click', async () => {
    if (!chosenLine) return;
    $('#chosen-line').textContent = `${chosenLine}: Select a product`;
    await loadProductsForLine(chosenLine);
    slide('product');
  });

  $('[data-slide="product"] [data-back="line"]')?.addEventListener('click', () => {
    chosenLine = null; chosenProductId = null; answers = {}; derivedCtx = {};
    $('#line-next').disabled = true; clearSList(); clearCList(); slide('line');
  });

  $('#product-tiles')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile[data-product-id]');
    if (!tile) return;
    $$('#product-tiles .tile').forEach(t => t.classList.remove('active'));
    tile.classList.add('active');
    chosenProductId = tile.dataset.productId;
    $('#product-next').disabled = false;
  });

  $('#product-next')?.addEventListener('click', async () => {
    if (!chosenProductId) return;
    answers = {}; derivedCtx = {};
    await hydrateProduct(chosenProductId);
    slide('questions');
  });

  $('#only-ready')?.addEventListener('change', () => {
    renderSList();        // re-render cards so we can hide non-ready
    recomputeQuotes();    // C-List will auto-update
  });

  // ===== Fetch: products for line =====
  async function loadProductsForLine(line){
    const box = $('#product-tiles');
    box.innerHTML = '';
    $('#product-next').disabled = true;
    const { data, error } = await supabase
      .from('products')
      .select('id, label')
      .eq('line', line)
      .eq('is_active', true)
      .order('label', { ascending: true });
    if (error) { box.innerHTML = `<p class="muted">Error loading products.</p>`; return; }
    if (!data || !data.length){ box.innerHTML = `<p class="muted">No products yet for ${line}.</p>`; return; }
    data.forEach(p => {
      const div = document.createElement('button');
      div.className = 'tile';
      div.dataset.productId = p.id;
      div.innerHTML = `<i class="fa-solid fa-box-open"></i><span>${p.label}</span>`;
      box.appendChild(div);
    });
  }

  // ===== Hydrate: questions + carriers for product (NO EMBEDS) =====
  async function hydrateProduct(productId){
    clearSList(); clearCList();
  
    // 1) questions
    const { data: qData, error: qErr } = await supabase
      .from('questions')
      .select('id, q_number, label, type, options_json, validations_json')
      .eq('product_id', productId)
      .order('q_number', { ascending: true });
    if (qErr) console.error('questions error:', qErr);
    questions = qData || [];
    renderQChips();
    renderQForm();
  
    // 2) carrier_products (ids only)
    const { data: cps, error: e1 } = await supabase
      .from('carrier_products')
      .select('id, product_id, carrier_id, plan_title, is_active')
      .eq('product_id', productId)
      .eq('is_active', true);
    if (e1) { console.error('carrier_products list error:', e1); carriers = []; renderSList(); recomputeQuotes(); return; }
    if (!cps || !cps.length) { carriers = []; renderSList(); recomputeQuotes(); return; }
  
    const cpIds = cps.map(r => r.id);
    const carrierIds = cps.map(r => r.carrier_id);
  
    // 3) fetch pieces in parallel (no joins)
    const [
      { data: carrierRows,  error: e2 },
      { data: prosRows,     error: e3 },
      { data: reqRows,      error: e4 },
      { data: eqRows,       error: e5 }
    ] = await Promise.all([
      supabase.from('carriers').select('id, carrier_name, carrier_logo, carrier_url').in('id', carrierIds),
      supabase.from('pros_cons').select('carrier_product_id, pros, cons').in('carrier_product_id', cpIds),
      supabase.from('carrier_requirements').select('carrier_product_id, question_id, required_expr, applicable_expr, validation_overrides_json').in('carrier_product_id', cpIds),
      supabase.from('equations').select('id, carrier_product_id, equation_dsl, metadata, equation_version, is_active').in('carrier_product_id', cpIds)
    ]);
    if (e2 || e3 || e4 || e5) console.error('fetch pieces error:', { e2, e3, e4, e5 });
  
    // 4) get equation_inputs for only the equations we have
    const eqIds = (eqRows || []).filter(r => r.is_active !== false).map(r => r.id);
    let inputsRows = [];
    if (eqIds.length){
      const { data: _inputs, error: e6 } = await supabase
        .from('equation_inputs')
        .select('equation_id, var_name, question_id')
        .in('equation_id', eqIds);
      if (e6) console.error('equation_inputs error:', e6);
      inputsRows = _inputs || [];
    }
  
    // ---- index helpers
    const carrierById = new Map((carrierRows || []).map(r => [r.id, r]));
    const prosByCP    = new Map((prosRows || []).map(r => [r.carrier_product_id, r]));
    const reqsByCP    = cpIds.reduce((m, id) => (m[id] = [], m), {});
    (reqRows || []).forEach(r => reqsByCP[r.carrier_product_id]?.push(r));
  
    const eqByCP      = new Map();
    (eqRows || []).forEach(r => { if (r.is_active !== false && !eqByCP.has(r.carrier_product_id)) eqByCP.set(r.carrier_product_id, r); });
  
    const inputsByEq  = new Map();
    (inputsRows || []).forEach(r => {
      if (!inputsByEq.has(r.equation_id)) inputsByEq.set(r.equation_id, []);
      inputsByEq.get(r.equation_id).push({ var_name: r.var_name, question_id: r.question_id });
    });
  
    // ---- assemble carriers model for UI
    carriers = cps.map(cp => {
      const carrier = carrierById.get(cp.carrier_id) || {};
      const prosRec = prosByCP.get(cp.id) || {};
      const eq      = eqByCP.get(cp.id) || null;
      const inputs  = eq ? (inputsByEq.get(eq.id) || []) : [];
      return {
        carrier_product_id: cp.id,
        plan_title: cp.plan_title || 'Base',   // ✅ add this
        carrier,
        pros: prosRec.pros || [],
        cons: prosRec.cons || [],
        equation: eq,
        inputs,
        requirements: reqsByCP[cp.id] || []
      };
    });
  
    renderSList();
    recomputeQuotes();
  }

  function carriersRequiring(qnum){
    return carriers
      .filter(c => {
        const reqByQ = indexRequirements(c.requirements);
        const r = reqByQ[qnum];
        if (!r) return false;
        const applicable = evaluateExpr(r?.applicable_expr, answers, true);
        const required = evaluateExpr(r?.required_expr, answers, false);
        return applicable && required;
      })
      .map(c => c.carrier?.carrier_name)
      .filter(Boolean);
  }

  // ===== Q-Chips + Form =====
  function renderQChips(){
    const bar = $('#q-chips'); bar.innerHTML = '';
    questions.forEach(q => {
      const b = document.createElement('button');
      b.className = 'q-chip';
      b.textContent = q.q_number;
      b.title = q.label; // initial
      b.addEventListener('mouseenter', () => {
        const who = carriersRequiring(q.q_number);
        if (who.length) b.title = `${q.label}\nRequired by: ${who.join(', ')}`;
        else b.title = `${q.label}\n(Optional or N/A)`;
      });
      b.addEventListener('click', () => {
        // handled by renderQForm() attaching onclick by index
      });
      bar.appendChild(b);
    });
  }

  let currentQIndex = 0;

  function renderQForm(){
    const body = $('#q-body');
    body.innerHTML = '';
  
    // wrapper
    const wrap = document.createElement('div');
    wrap.className = 'q-carousel';
  
    // arrows
    const prev = document.createElement('button');
    prev.className = 'q-nav q-prev';
    prev.type = 'button';
    prev.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  
    const next = document.createElement('button');
    next.className = 'q-nav q-next';
    next.type = 'button';
    next.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  
    // viewport + track
    const viewport = document.createElement('div');
    viewport.className = 'q-viewport';
    
    const track = document.createElement('div');
    track.className = 'q-track';
  
    // slides
    questions.forEach((q, idx) => {
      const slide = document.createElement('div');
      slide.className = 'q-card';
  
      slide.innerHTML = `
        <div class="q-card-head">
          <div class="q-card-num">${q.q_number}</div>
          <div class="q-card-title">${q.label}</div>
        </div>
      `;
  
      let inputEl;
  
      if (q.type === 'select'){
        inputEl = document.createElement('select');

        // placeholder
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = 'Select...';
        ph.disabled = true;
        ph.selected = true;
        inputEl.appendChild(ph);
        
        // options
        (q.options_json || []).forEach(opt => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          inputEl.appendChild(o);
        });
      } else if (q.type === 'bool'){
        inputEl = document.createElement('select');

        // placeholder
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = 'Select...';
        ph.disabled = true;
        ph.selected = true;
        inputEl.appendChild(ph);
        
        [{value:true,label:'Yes'},{value:false,label:'No'}].forEach(opt => {
          const o = document.createElement('option');
          o.value = String(opt.value);
          o.textContent = opt.label;
          inputEl.appendChild(o);
        });
      } else {
        inputEl = document.createElement('input');
        inputEl.type = (q.type === 'number' || q.type === 'money') ? 'number' : 'text';
        if (q.type === 'money') inputEl.step = '100'; // <— change to 1000 if you want strict thousands
      }
  
      // restore saved answer into field
      const existing = answers[q.q_number];
      if (existing !== undefined && existing !== null) inputEl.value = String(existing);
  
      const onField = () => {
        const v = normalizeValue(q, inputEl.value);
        answers[q.q_number] = v;
        updateChipColors();
        recomputeQuotes();
      };
  
      inputEl.dataset.qNumber = q.q_number;
      inputEl.addEventListener('input', onField);
      inputEl.addEventListener('change', onField); // important on mobile selects
  
      slide.appendChild(inputEl);
      track.appendChild(slide);
    });
  
    viewport.appendChild(track);
    wrap.appendChild(prev);
    wrap.appendChild(viewport);
    wrap.appendChild(next);
    body.appendChild(wrap);
  
    // controls
    const goTo = (idx) => {
      currentQIndex = Math.max(0, Math.min(idx, questions.length - 1));
      const w = viewport.getBoundingClientRect().width;
      track.style.transform = `translate3d(${-currentQIndex * w}px, 0, 0)`;
      prev.disabled = currentQIndex === 0;
      next.disabled = currentQIndex === questions.length - 1;
    };
    window.addEventListener('resize', () => goTo(currentQIndex));
    prev.addEventListener('click', () => goTo(currentQIndex - 1));
    next.addEventListener('click', () => goTo(currentQIndex + 1));
  
    // chip click -> slide to question
    $$('#q-chips .q-chip').forEach((chipEl, idx) => {
      chipEl.onclick = () => goTo(idx);
    });
  
    goTo(0);
    updateChipColors();
  }
  function normalizeValue(q, raw){
    if (raw === '') return null;
    if (q.type === 'number' || q.type === 'money') return Number(raw);
    if (q.type === 'bool') return raw === 'true';
    if (q.type === 'select') {
      const n = Number(raw);
      return Number.isNaN(n) ? raw : n;
    }
    return raw;
  }

  function scrollToQuestion(num){
    const idx = questions.findIndex(q => q.q_number === num);
    if (idx >= 0){
      const el = $('#q-body').children[idx];
      el?.scrollIntoView({ behavior:'smooth', block:'center' });
    }
  }

  // ===== S-List rendering (logo + chips + hover pros/cons) =====
  function renderSList(){
    const box = $('#s-list'); box.innerHTML = '';
    if (!carriers.length){ box.innerHTML = '<p class="muted small">No carriers for this product yet.</p>'; return; }
    const N = questions.length;
    const onlyReady = $('#only-ready')?.checked;
  
    carriers.forEach(c => {
      const ready = carrierReady(c);
      const card = document.createElement('div');
      card.className = 's-card' + (onlyReady && !ready ? ' hidden' : '');
      card.innerHTML = `
        <img class="logo" src="${c.carrier.carrier_logo || ''}" alt="${c.carrier.carrier_name}">
        <div class="s-overlay-top">
          <div class="s-namewrap">
            <div class="s-name">${c.carrier.carrier_name || ''}</div>
            <div class="s-sub">${c.plan_title || ''}</div>
          </div>
          <a href="${c.carrier.carrier_url || '#'}" target="_blank" rel="noopener" title="Open carrier site">
            <i class="fa-solid fa-up-right-from-square"></i>
          </a>
        </div>
        <div class="s-overlay-bottom"></div>
      `;
      const img = card.querySelector('img.logo');
      img?.addEventListener('error', () => {
        img.remove();
        const ph = document.createElement('div');
        ph.className = 'logo-fallback';
        const initials = (c.carrier.carrier_name || '')
          .split(/\s+/).map(s => s[0]).join('').slice(0,3).toUpperCase();
        ph.textContent = initials || '—';
        card.prepend(ph);
      });
  
      const chipBar = card.querySelector('.s-overlay-bottom');
      for (let i=1; i<=N; i++){
        const ch = document.createElement('span');
        ch.className = 's-chip'; ch.textContent = i;
        chipBar.appendChild(ch);
      }
      card.title = tooltipText(c);
      const issues = violationsForCarrier(c);
      if (issues.length){
        const msgs = issues.map(it => `${it.label}: ${it.code}`);
        card.title += (card.title ? ' • ' : '') + `Ineligible — ${msgs.join(', ')}`;
      }
      box.appendChild(card);
    });
  
    updateChipColors();
  }

  function tooltipText(c){
    const pros = c.pros?.length ? `Pros: ${c.pros.join(', ')}` : '';
    const cons = c.cons?.length ? `Cons: ${c.cons.join(', ')}` : '';
    return [pros, cons].filter(Boolean).join(' • ');
  }

  function isDisqualifyingAnswer(qnum, q, req) {
    const val = answers[qnum];
  
    // carrier-level override wins
    const over = (req?.validation_overrides_json) || {};
    const base = (q?.validations_json) || {};
  
    // If you store disqualify rules like:
    // { "disqualify_if_true": true }  (for yes/no questions)
    // or { "disqualify_if_equals": "SomeValue" }
    const disqTrue = over.disqualify_if_true ?? base.disqualify_if_true;
    if (disqTrue && val === true) return true;
  
    const disqEquals = over.disqualify_if_equals ?? base.disqualify_if_equals;
    if (disqEquals !== undefined && disqEquals !== null && val === disqEquals) return true;
  
    return false;
  }
  
  // ===== Chip colors (red/green/grey) per carrier requirements =====
  function updateChipColors(){
    // Q-chip bar (top)
    const qChips = $$('#q-chips .q-chip');
    qChips.forEach((el, idx) => {
      const qnum = questions[idx]?.q_number;
      const answered = answers[qnum] !== undefined && answers[qnum] !== null && answers[qnum] !== '';
      el.classList.remove('red','green','grey');
      el.classList.add(answered ? 'green' : 'red'); // quick visual for navigation
    });

    // S-List per carrier
    const N = questions.length;
    const cards = $$('#s-list .s-card');
    carriers.forEach((c, ci) => {
      const reqByQ = indexRequirements(c.requirements);
      const chips = cards[ci].querySelectorAll('.s-chip');

      questions.forEach((q, idx) => {
        const qnum = q.q_number;
        const chip = chips[idx];
        if (!chip) return;
      
        const req = reqByQ[qnum];
      
        // ✅ If no carrier_requirements row exists, it is NOT applicable to that carrier
        const applicable = req ? evaluateExpr(req.applicable_expr, answers, true) : false;
        const required   = req ? evaluateExpr(req.required_expr,   answers, false) : false;
      
        const answered =
          answers[qnum] !== undefined &&
          answers[qnum] !== null &&
          answers[qnum] !== '';
      
        const over = req?.validation_overrides_json || {};
        const base = q.validations_json || {};
        const val  = answers[qnum];
      
        const vcode = validateValue(val, base, over);
        const disq  = isDisqualifyingAnswer(qnum, q, req);
      
        chip.classList.remove('red','green','grey','disq-x');
      
        if (!applicable) {
          chip.classList.add('grey');
        } else if (disq) {
          chip.classList.add('red','disq-x');
        } else if (vcode) {
          chip.classList.add('red');
        } else if (required && !answered) {
          chip.classList.add('red');
        } else if (answered) {
          chip.classList.add('green');
        } else {
          chip.classList.add('grey');
        }
      });
    });
  }

  function indexRequirements(reqs){
    const map = {}; (reqs || []).forEach(r => map[ findQnum(r.question_id) ] = r); return map;
  }
  function findQnum(question_id){
    const q = questions.find(q => q.id === question_id); return q?.q_number;
  }

  // ===== JSON-logic mini evaluator for required/applicable + equation DSL =====
  function evaluateExpr(expr, ctx, defaultVal){
    // merged context so expressions can see derived fields (e.g., uw_tier)
    const ctxAll = { ...(ctx || {}), ...(derivedCtx || {}) };
    if (expr === null || expr === undefined) return defaultVal;
    if (typeof expr === 'boolean') return expr;
    if (typeof expr === 'string') {
      if (expr === 'true') return true; if (expr === 'false') return false;
    }
    if (typeof expr === 'object' && !Array.isArray(expr)){
      const op = expr.op || Object.keys(expr)[0];
      const args = expr.args || expr[op] || [];
      const val = x => evaluateExpr(x, ctxAll, null);
      switch(op){
        case 'var': return ctxAll?.[args.name] ?? null;
        case 'and': return args.every(a => evaluateExpr(a, ctxAll, true));
        case 'or':  return args.some(a => evaluateExpr(a, ctxAll, false));
        case '==':  return val(args[0]) == val(args[1]);
        case '!=':  return val(args[0]) != val(args[1]);
        case '>':   return val(args[0]) >  val(args[1]);
        case '>=':  return val(args[0]) >= val(args[1]);
        case '<':   return val(args[0]) <  val(args[1]);
        case '<=':  return val(args[0]) <= val(args[1]);
        default:    return defaultVal;
      }
    }
    return defaultVal;
  }

  // ===== Derived inputs (generic underwriting tier from health questions) =====
  async function computeDerivedInputs(productId, answers){
    // Match by label so we don't care what q_numbers are.
    // Tweak the phrases to whatever you actually stored in `questions.label`.
    const sectionAKeys = [
      'you are not eligible',                // gate question wording
      'confined', 'hospice', 'advised to receive home health care',
      'oxygen', 'wheelchair', 'dialysis', 'alzheim', 'dementia',
      'hiv', 'aids',
      'terminal', 'organ transplant', 'sclerosis (amyotrophic)', // etc...
      'more than one cancer'                 // you can expand this list
    ];
    const sectionBKeys = [
      'within the past 2 years',
      'diagnosed with, received or been advised to receive',
      'diabetes with complications',         // examples; keep expanding
      'circulatory', 'coronary', 'stroke',   // etc…
    ];
  
    // helpers
    const hasAny = (label, keys) => {
      const L = (label || '').toLowerCase();
      return keys.some(k => L.includes(k.toLowerCase()));
    };
    const yes = (q) => answers[q.q_number] === true || answers[q.q_number] === 'true';
  
    // Find the questions that belong to each section by label keywords
    const sectionAQs = questions.filter(q => hasAny(q.label, sectionAKeys));
    const sectionBQs = questions.filter(q => hasAny(q.label, sectionBKeys));
  
    const A = sectionAQs.some(yes);
    const B = sectionBQs.some(yes);
  
    return {
      uw_tier: A ? 'Decline' : (B ? 'Modified' : 'Level')
    };
  }

  function evalEquation(equation, inputsMap, metadata){
    if (!equation?.equation_dsl) return null;
    const ctx = {}; // build variable context from answers
    (inputsMap || []).forEach(m => {
      const q = questions.find(q => q.id === m.question_id);
      if (!q) return;
      ctx[m.var_name] = answers[q.q_number];
    });
    // merge derived inputs
    if (evalEquation._derived) Object.assign(ctx, evalEquation._derived);

    const node = equation.equation_dsl;
    return evalNode(node);

    function evalNode(n){
      if (n === null || n === undefined) return null;
      if (typeof n !== 'object' || Array.isArray(n)) return n;
      const op = n.op;
      const args = (n.args || []).map(a => evalNode(a));
      switch(op){
        case 'var': {
          // allow constants from metadata (e.g., policy_fee_annual, modal_factor_monthly)
          if (ctx[n.name] !== undefined) return ctx[n.name];
          if (metadata && Object.prototype.hasOwnProperty.call(metadata, n.name)) return metadata[n.name];
          return undefined;
        }
        case 'add':   return args.reduce((a,b)=>a+(+b||0),0);
        case 'mul': {
          // if any argument is null/undefined/NaN, the product is invalid
          for (const x of args) {
            const n = Number(x);
            if (x === null || x === undefined || Number.isNaN(n)) return null;
          }
          return args.reduce((a, b) => a * Number(b), 1);
        }
        case 'div':   return (+args[0]||0) / (+args[1]||1);
        case 'round': return Math.round((+args[0]||0) * (10**(+args[1]||0))) / (10**(+args[1]||0));
        case 'call': {
          // legacy handler (kept for compatibility)
          if (n.name === 'per1k_rate') {
            const [age, sexIn, smoker, stateIn, planIn] = args;
          
            const state = String(stateIn || '').toUpperCase();   // e.g. TN
            const plan  = String(planIn || 'level').toLowerCase();
            let sex = String(sexIn || '').toUpperCase();         // M / F
          
            // 🔥 IMPORTANT: map state -> tableKey using metadata.states
            const tableKey =
              (metadata?.states && (metadata.states[state] || metadata.states.DEFAULT)) || state;
          
            const tables = (metadata?.rates?.[tableKey]?.[plan]) || [];
          
            const row = tables.find(r =>
              Number(age) === Number(r[0]) &&
              sex === r[1] &&
              Boolean(smoker) === Boolean(r[2])
            );
          
            return row ? row[3] : null;
          }
          // new handler: choose table by derived uw_tier
          if (n.name === 'per1k_by_tier') {
            const [tier, age, sex, smoker] = args;
            const table = (tier === 'Modified') ? (metadata?.modified_table || [])
                        : (tier === 'Level')    ? (metadata?.level_table    || [])
                        : [];
            // rows: [max_age, sex, smoker_bool, per1k]
            const row = table.find(r => (age <= r[0]) && (sex === r[1]) && (Boolean(smoker) === Boolean(r[2])));
            return row ? row[3] : null;
          }
          if (n.name === 'state_factor'){
            const [st] = args;
            const row = (metadata?.state_factor_table||[]).find(r => r[0] === st);
            return row ? row[1] : 1.00;
          }
          // inside evalEquation -> switch(op) { case 'call': ... }
          if (n.name === 'per1k_by_age') {
            // args: tier(string), age(number), sex('M'|'F'|'U'), smoker(bool)
            const [tierIn, ageIn, sexIn, smokerIn] = args;
            const tier   = String(tierIn || 'Level');
            const age    = Number(ageIn || 0);
            let   sex    = String(sexIn || 'U').toUpperCase();
            const smoker = Boolean(smokerIn);
          
            // metadata schema:
            // metadata.age_rates = {
            //   Level: { M: { "NS": { "47": 2.58, ... }, "S": {...} },
            //            F: { "NS": {...}, "S": {...} },
            //            U: { "NS": {...}, "S": {...} } },
            //   Modified: {...}
            // }
            const table = (metadata?.age_rates?.[tier]) || {};
            const sexBlock = table[sex] || table['U'] || {};
            const band = smoker ? (sexBlock['S'] || {}) : (sexBlock['NS'] || {});
          
            // Exact age first, else fall back to the nearest lower age, else nearest lower of any sex/unisex
            if (band[String(age)] != null) return band[String(age)];
          
            // nearest lower age in this smoker/sex band
            const ages = Object.keys(band).map(Number).filter(n => !Number.isNaN(n)).sort((a,b)=>a-b);
            let best = null;
            for (const a of ages) if (a <= age) best = a;
            if (best != null) return band[String(best)];
          
            // last resort: unisex band if present
            if (sex !== 'U' && (table['U']?.[smoker ? 'S' : 'NS'])) {
              const uBand = table['U'][smoker ? 'S' : 'NS'];
              if (uBand[String(age)] != null) return uBand[String(age)];
              const uAges = Object.keys(uBand).map(Number).filter(n => !Number.isNaN(n)).sort((a,b)=>a-b);
              let uBest = null;
              for (const a of uAges) if (a <= age) uBest = a;
              if (uBest != null) return uBand[String(uBest)];
            }
            return null;
          }
          return 1;
        }
        default: return null;
      }
    }
  }

  // ===== Quotes (C-List) =====
  async function recomputeQuotes(){
    const box = $('#c-list'); box.innerHTML = '';
    if (!carriers.length) { box.innerHTML = '<p class="muted center small">No carriers yet.</p>'; return; }
  
    // 1) compute derived inputs once (shared)
    const derived = await computeDerivedInputs(chosenProductId, answers);
    derivedCtx = derived;              // ⬅️ expose to expressions
    evalEquation._derived = derived;   // ⬅️ expose to equations

    const levelWrap = document.createElement('div');
    const modWrap   = document.createElement('div');
    let levelCount=0, modCount=0;

    // optional section headers
    levelWrap.innerHTML = '<h4 class="muted">Level</h4>';
    modWrap.innerHTML   = '<h4 class="muted">Modified / Graded</h4>';
  
    carriers.forEach(c => {
      const ready = carrierReady(c);
      if (!ready) return;

      const premium = evalEquation(c.equation, c.inputs, c.equation?.metadata) ?? null;

      const card = document.createElement('div'); card.className = 'c-card';
      card.innerHTML = `
        <div class="meta">
          <img src="${c.carrier.carrier_logo || ''}" alt="${c.carrier.carrier_name}">
          <div>
            <div><strong>${c.carrier.carrier_name}${c.plan_title ? ` • ${c.plan_title}` : ''}</strong></div>
          </div>
        </div>
        <div class="c-price">${premium===null ? '—' : money(premium)}</div>
      `;
      card.addEventListener('click', () => openPlanOverlay(c, premium));

      if (derivedCtx.uw_tier === 'Modified') { modWrap.appendChild(card); modCount++; }
      else if (derivedCtx.uw_tier === 'Level') { levelWrap.appendChild(card); levelCount++; }
      // Decline => nothing appended
    });

    if (levelCount) box.appendChild(levelWrap);
    if (modCount)   box.appendChild(modWrap);

    if (!box.children.length){
      box.innerHTML = '<p class="muted center small">Keep answering—quotes will pop in as carriers become ready.</p>';
    }
  }

  function validateValue(val, base = {}, override = {}) {
    const v = val;
    const rules = { ...base, ...override }; // per-carrier overrides win
    if (rules.required && (v === null || v === undefined || v === '')) return 'required';
    // allowed_values check (used for STATE restrictions, etc)
    if (Array.isArray(rules.allowed_values) && rules.allowed_values.length) {
      if (v === null || v === undefined || v === '') {
        return rules.required ? 'required' : null;
      }
    
      // normalize case so "tn" === "TN"
      const vv = String(v).toUpperCase();
      const allowed = rules.allowed_values.map(x => String(x).toUpperCase());
    
      if (!allowed.includes(vv)) return 'not_allowed';
    }
    return null;
  }
  
  function violationsForCarrier(c){
    const reqByQ = indexRequirements(c.requirements);
    const issues = []; // [{qnum,label,code}]
    questions.forEach(q => {
      const r = reqByQ[q.q_number];
      const applicable = evaluateExpr(r?.applicable_expr, answers, true);
      if (!applicable) return;
      const baseVal = q.validations_json || {};
      const overVal = r?.validation_overrides_json || {};
      const val = answers[q.q_number];
      const code = validateValue(val, baseVal, overVal);
      if (code) issues.push({ qnum: q.q_number, label: q.label, code });
    });
    return issues;
  }
  
  function carrierReady(c){
    // must meet required/applicable AND pass per-carrier validations
    const reqByQ = indexRequirements(c.requirements);
    const basicOk = questions.every(q => {
      const r = reqByQ[q.q_number];
      const applicable = evaluateExpr(r?.applicable_expr, answers, true);
      const required = evaluateExpr(r?.required_expr, answers, false);
      const answered = answers[q.q_number] !== undefined && answers[q.q_number] !== null && answers[q.q_number] !== '';
      return !applicable ? true : (!required || answered);
    });
    if (!basicOk) return false;
    const issues = violationsForCarrier(c);
    if (issues.length) return false;

    // Declines don’t render a quote
    if (derivedCtx.uw_tier === 'Decline') return false;
    return true;
  }

  // ===== Utility UI =====
  function clearSList(){ $('#s-list').innerHTML = '<p class="muted small">Carriers appear here after product selection.</p>'; }
  function clearCList(){ $('#c-list').innerHTML = '<p class="muted center small">Quotes will appear here when a carrier is ready.</p>'; }
  async function openPlanOverlay(cModel, premium){
    const $ov = $('#plan-overlay');
    $ov.setAttribute('aria-hidden','false');
  
    const carrier = cModel.carrier || {};
    // basics
    $('#po-name').textContent = `${carrier.carrier_name || ''}${cModel.plan_title ? ` • ${cModel.plan_title}` : ''}`;
    $('#po-link').href = carrier.carrier_url || '#';
    $('#po-price').textContent = premium == null ? '—' : money(premium);
  
    const logo = $('#po-logo');
    logo.src = carrier.carrier_logo || '';
    logo.alt = carrier.carrier_name || '';
  
    // inputs shown
    const ulInputs = $('#po-inputs'); ulInputs.innerHTML = '';
    const answeredList = questions
      .filter(q => answers[q.q_number] !== undefined && answers[q.q_number] !== null && answers[q.q_number] !== '')
      .map(q => ({ q_number: q.q_number, label: q.label, value: answers[q.q_number] }));
    answeredList.forEach(row => {
      const li = document.createElement('li');
      li.textContent = `${row.label}: ${row.value}`;
      ulInputs.appendChild(li);
    });
  
    // pros/cons
    const prosUl = $('#po-pros'); prosUl.innerHTML = '';
    const consUl = $('#po-cons'); consUl.innerHTML = '';
    (cModel?.pros || []).forEach(p => { const li=document.createElement('li'); li.textContent=p; prosUl.appendChild(li); });
    (cModel?.cons || []).forEach(p => { const li=document.createElement('li'); li.textContent=p; consUl.appendChild(li); });
  
    // save button
    $('#po-save').onclick = async () => {
      const { data: ures } = await supabase.auth.getUser();
      const user_id = ures?.user?.id || null;
      const payload = {
        user_id,
        product_id: chosenProductId,
        carrier_product_id: cModel.carrier_product_id,
        carrier_name: carrier.carrier_name || 'Unknown Carrier',
        premium: premium == null ? 0 : Number(premium),
        answers_json: answeredList,
        metadata: {
          line: chosenLine,
          url: carrier.carrier_url || null,
          equation_version: cModel?.equation?.equation_version || 1,
          uw_tier: derivedCtx.uw_tier || null,
          plan_title: cModel.plan_title || null
        }
      };
      const { error } = await supabase.from('quotes').insert(payload);
      if (error) {
        console.error('save quote error:', error);
        alert('Could not save quote. If you are not logged in, please sign in first.');
        return;
      }
      alert('Quote saved!');
      $ov.setAttribute('aria-hidden','true');
    };
  
    const close = () => $ov.setAttribute('aria-hidden','true');
    $('#plan-close').onclick = close;
    $ov.onclick = (e) => { if (e.target === $ov) close(); };
    document.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  }

  // ===== Saved Quotes Drawer =====
  $('#open-saved')?.addEventListener('click', async () => {
    await loadSavedQuotes();
    $('#saved-drawer').setAttribute('aria-hidden','false');
  });
  $('#saved-close')?.addEventListener('click', () => {
    $('#saved-drawer').setAttribute('aria-hidden','true');
  });
  
  async function loadSavedQuotes(){
    const list = $('#saved-list');
    list.innerHTML = '<div class="sd-empty">Loading…</div>';
  
    const { data: ures } = await supabase.auth.getUser();
    const user_id = ures?.user?.id || null;
    if (!user_id){
      list.innerHTML = '<div class="sd-empty">Please sign in to view saved quotes.</div>';
      return;
    }
  
    const { data, error } = await supabase
      .from('quotes')
      .select('id, created_at, product_id, carrier_product_id, carrier_name, premium, answers_json, metadata')
      .order('created_at', { ascending: false })
      .limit(100);
  
    if (error) {
      console.error('loadSavedQuotes error:', error);
      list.innerHTML = '<div class="sd-empty">Could not load quotes.</div>';
      return;
    }
  
    if (!data || !data.length){
      list.innerHTML = '<div class="sd-empty">No saved quotes yet.</div>';
      return;
    }
  
    list.innerHTML = '';
    data.forEach(row => {
      const div = document.createElement('div');
      div.className = 'sd-item';
      const when = new Date(row.created_at).toLocaleString();
      const line = row?.metadata?.line || '';
      const title = `${row.carrier_name} • ${money(row.premium)}`;
      div.innerHTML = `
        <div>
          <h4>${title}</h4>
          <div class="sd-meta">${line || '—'} • ${when}</div>
        </div>
        <div class="sd-actions">
          <button class="btn open">Open</button>
          <button class="btn del">Delete</button>
        </div>
      `;
      div.querySelector('.open').addEventListener('click', () => openSavedQuote(row));
      div.querySelector('.del').addEventListener('click', () => deleteSavedQuote(row.id, div));
      list.appendChild(div);
    });
  }

  async function openSavedQuote(row){
    if (row.product_id !== chosenProductId) {
      const targetLine = row?.metadata?.line || chosenLine;
      if (targetLine && targetLine !== chosenLine) {
        chosenLine = targetLine;
        $('#line-next').disabled = false;
        $('#chosen-line').textContent = `${chosenLine}: Select a product`;
        await loadProductsForLine(chosenLine);
        slide('product');
      }
      const tile = $(`#product-tiles .tile[data-product-id="${row.product_id}"]`);
      if (!tile){
        alert('This quote is for a product not currently available on this page.');
        return;
      }
      $$('#product-tiles .tile').forEach(t => t.classList.remove('active'));
      tile.classList.add('active');
      chosenProductId = row.product_id;
      $('#product-next').disabled = false;
      await hydrateProduct(chosenProductId);
      slide('questions');
    }
    answers = {};
    (row.answers_json || []).forEach(a => {
      const q = questions.find(q => q.q_number === a.q_number) || questions.find(q => q.label === a.label);
      if (q) answers[q.q_number] = a.value;
    });
    // populate inputs in the NEW carousel layout
    $$('#q-body .q-card').forEach((card, idx) => {
      const q = questions[idx];
      const inputEl = card.querySelector('input, select');
      if (!q || !inputEl) return;
    
      const val = answers[q.q_number];
      inputEl.value = (val === undefined || val === null) ? '' : String(val);
    });
    updateChipColors();
    recomputeQuotes();
  }

  async function deleteSavedQuote(id, node){
    const { data: ures } = await supabase.auth.getUser();
    const user_id = ures?.user?.id || null;
    if (!user_id){
      alert('Please sign in first.');
      return;
    }
    const { error } = await supabase.from('quotes').delete().eq('id', id);
    if (error){
      console.error('delete quote error:', error);
      alert('Could not delete quote.');
      return;
    }
    node.remove();
  }
});
