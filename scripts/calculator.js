// scripts/calculator.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

/** ===== Supabase init (uses your known creds) ===== */
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

document.addEventListener('DOMContentLoaded', () => {
  // ========= State =========
  let chosenLine = null;
  let chosenProductId = null;
  let questions = [];            // [{id,q_number,label,type,...}]
  let carriers = [];             // [{carrier_product_id, carrier:{...}, pros_cons, requirements:[...] , equation, inputs }]
  let answers = {};              // { [q_number]: value }

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
    chosenLine = null; chosenProductId = null; answers = {};
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
    answers = {};
    await hydrateProduct(chosenProductId);
    slide('questions');
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

  // ===== Hydrate: questions + carriers for product =====
  async function hydrateProduct(productId){
    clearSList(); clearCList();
    // 1) questions
    const { data: qData } = await supabase
      .from('questions')
      .select('id, q_number, label, type, options_json, validations_json')
      .eq('product_id', productId)
      .order('q_number', { ascending: true });
    questions = qData || [];
    renderQChips();
    renderQForm();

    // 2) carriers (carrier_products joined)
    const { data: cpData, error } = await supabase
      .from('carrier_products')
      .select(`
        id,
        carrier_id,
        product_id,
        carriers ( carrier_name, carrier_logo, carrier_url ),
        pros_cons ( pros, cons ),
        equations ( id, equation_dsl, metadata, equation_version ),
        equation_inputs ( var_name, question_id ),
        carrier_requirements ( question_id, required_expr, applicable_expr )
      `)
      .eq('product_id', productId)
      .eq('is_active', true);

    carriers = (cpData || []).map(row => ({
      carrier_product_id: row.id,
      carrier: row.carriers || {},
      pros: (row.pros_cons && row.pros_cons[0]?.pros) || [],
      cons: (row.pros_cons && row.pros_cons[0]?.cons) || [],
      equation: row.equations?.[0] || null,
      inputs: row.equation_inputs || [],
      requirements: row.carrier_requirements || []
    }));

    renderSList();
    recomputeQuotes();
  }

  // ===== Q-Chips + Form =====
  function renderQChips(){
    const bar = $('#q-chips'); bar.innerHTML = '';
    questions.forEach(q => {
      const b = document.createElement('button');
      b.className = 'q-chip';
      b.textContent = q.q_number;
      b.title = q.label;
      b.addEventListener('click', () => scrollToQuestion(q.q_number));
      bar.appendChild(b);
    });
  }

  function renderQForm(){
    const body = $('#q-body'); body.innerHTML = '';
    questions.forEach(q => {
      const wrap = document.createElement('div');
      wrap.className = 'q-row';
      wrap.innerHTML = `<label><strong>${q.q_number}. ${q.label}</strong></label>`;
      let inputEl;

      if (q.type === 'select'){
        inputEl = document.createElement('select');
        (q.options_json || []).forEach(opt => {
          const o = document.createElement('option'); o.value = opt.value; o.textContent = opt.label; inputEl.appendChild(o);
        });
      } else if (q.type === 'bool'){
        inputEl = document.createElement('select');
        [{value:true,label:'Yes'},{value:false,label:'No'}].forEach(opt => {
          const o = document.createElement('option'); o.value = String(opt.value); o.textContent = opt.label; inputEl.appendChild(o);
        });
      } else {
        inputEl = document.createElement('input');
        inputEl.type = (q.type === 'number' || q.type === 'money') ? 'number' : 'text';
        if (q.type === 'money') inputEl.step = '1000';
      }

      inputEl.dataset.qNumber = q.q_number;
      inputEl.addEventListener('input', () => {
        const v = normalizeValue(q, inputEl.value);
        answers[q.q_number] = v;
        updateChipColors();
        recomputeQuotes();
      });

      wrap.appendChild(inputEl);
      body.appendChild(wrap);
    });

    updateChipColors();
  }

  function normalizeValue(q, raw){
    if (q.type === 'number') return raw === '' ? null : Number(raw);
    if (q.type === 'money')  return raw === '' ? null : Number(raw);
    if (q.type === 'bool')   return raw === '' ? null : (raw === 'true');
    return raw || null;
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

    carriers.forEach(c => {
      const card = document.createElement('div'); card.className = 's-card';
      card.innerHTML = `
        <img class="logo" src="${c.carrier.carrier_logo || ''}" alt="${c.carrier.carrier_name}">
        <div class="s-overlay-top">
          <span>${c.carrier.carrier_name || ''}</span>
          <a href="${c.carrier.carrier_url || '#'}" target="_blank" rel="noopener" title="Open carrier site">
            <i class="fa-solid fa-up-right-from-square"></i>
          </a>
        </div>
        <div class="s-overlay-bottom"></div>
      `;
      const chipBar = card.querySelector('.s-overlay-bottom');
      for (let i=1; i<=N; i++){
        const ch = document.createElement('span');
        ch.className = 's-chip'; ch.textContent = i;
        chipBar.appendChild(ch);
      }

      // Tooltip on hover with pros/cons
      card.title = tooltipText(c);
      box.appendChild(card);
    });

    updateChipColors(); // color after render
  }

  function tooltipText(c){
    const pros = c.pros?.length ? `Pros: ${c.pros.join(', ')}` : '';
    const cons = c.cons?.length ? `Cons: ${c.cons.join(', ')}` : '';
    return [pros, cons].filter(Boolean).join(' • ');
  }

  // ===== Chip colors (red/green/grey) per carrier requirements =====
  function updateChipColors(){
    // Q-chip bar (top)
    const qChips = $$('#q-chips .q-chip');
    qChips.forEach((el, idx) => {
      const qnum = idx + 1;
      const answered = answers[qnum] !== undefined && answers[qnum] !== null && answers[qnum] !== '';
      el.classList.remove('red','green','grey');
      el.classList.add(answered ? 'green' : 'red'); // quick visual for navigation
    });

    // S-List per carrier
    const N = questions.length;
    const cards = $$('#s-list .s-card');
    carriers.forEach((c, ci) => {
      const reqByQ = indexRequirements(c.requirements);
      for (let i=1; i<=N; i++){
        const chip = cards[ci].querySelectorAll('.s-chip')[i-1];
        const req = reqByQ[i];
        const applicable = evaluateExpr(req?.applicable_expr, answers, true);
        const required = evaluateExpr(req?.required_expr, answers, false);
        const answered = answers[i] !== undefined && answers[i] !== null && answers[i] !== '';

        chip.classList.remove('red','green','grey');
        if (!applicable) chip.classList.add('grey');
        else if (required && !answered) chip.classList.add('red');
        else if (answered) chip.classList.add('green');
        else chip.classList.add('grey'); // not required & unanswered
      }
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
    if (expr === null || expr === undefined) return defaultVal;
    if (typeof expr === 'boolean') return expr;
    if (typeof expr === 'string') {
      // accept 'true'/'false'
      if (expr === 'true') return true; if (expr === 'false') return false;
    }
    if (typeof expr === 'object' && !Array.isArray(expr)){
      // minimal ops: {"op":"and","args":[...]} etc. or legacy JSON-logic like {"and":[...]}
      const op = expr.op || Object.keys(expr)[0];
      const args = expr.args || expr[op] || [];
      switch(op){
        case 'var': return ctx?.[args.name] ?? null;
        case 'and': return args.every(a => evaluateExpr(a, ctx, true));
        case 'or':  return args.some(a => evaluateExpr(a, ctx, false));
        case '==':  return evaluateExpr(args[0], ctx, null) == evaluateExpr(args[1], ctx, null);
        case '!=':  return evaluateExpr(args[0], ctx, null) != evaluateExpr(args[1], ctx, null);
        case '>':   return evaluateExpr(args[0], ctx, null) >  evaluateExpr(args[1], ctx, null);
        case '>=':  return evaluateExpr(args[0], ctx, null) >= evaluateExpr(args[1], ctx, null);
        case '<':   return evaluateExpr(args[0], ctx, null) <  evaluateExpr(args[1], ctx, null);
        case '<=':  return evaluateExpr(args[0], ctx, null) <= evaluateExpr(args[1], ctx, null);
        default:    return defaultVal;
      }
    }
    return defaultVal;
  }

  function evalEquation(equation, inputsMap, metadata){
    if (!equation?.equation_dsl) return null;
    const ctx = {}; // build variable context from answers
    (inputsMap || []).forEach(m => {
      const q = questions.find(q => q.id === m.question_id);
      if (!q) return;
      ctx[m.var_name] = answers[q.q_number];
    });

    const node = equation.equation_dsl;
    return evalNode(node);

    function evalNode(n){
      if (n === null || n === undefined) return null;
      if (typeof n !== 'object' || Array.isArray(n)) return n;
      const op = n.op;
      const args = (n.args || []).map(a => evalNode(a));
      switch(op){
        case 'var':   return ctx[n.name];
        case 'add':   return args.reduce((a,b)=>a+(+b||0),0);
        case 'mul':   return args.reduce((a,b)=>a*(+b||1),1);
        case 'div':   return (+args[0]||0) / (+args[1]||1);
        case 'round': return Math.round((+args[0]||0) * (10**(+args[1]||0))) / (10**(+args[1]||0));
        case 'call':
          if (n.name === 'per1k_rate'){
            // metadata.per1k_table rows: [max_age, smoker(bool), sex, term, per1k]
            const [age, sex, term, smoker] = args;
            const row = (metadata?.per1k_table||[]).find(r =>
              age <= r[0] && smoker === r[1] && sex === r[2] && term === r[3]
            );
            return row ? row[4] : 1.00;
          }
          if (n.name === 'state_factor'){
            const [st] = args;
            const row = (metadata?.state_factor_table||[]).find(r => r[0] === st);
            return row ? row[1] : 1.00;
          }
          return 1;
        default: return null;
      }
    }
  }

  // ===== Quotes (C-List) =====
  function recomputeQuotes(){
    const box = $('#c-list'); box.innerHTML = '';
    if (!carriers.length) { box.innerHTML = '<p class="muted center small">No carriers yet.</p>'; return; }

    carriers.forEach(c => {
      const ready = carrierReady(c);
      if (!ready) return;

      const premium = evalEquation(c.equation, c.inputs, c.equation?.metadata) ?? null;

      const card = document.createElement('div'); card.className = 'c-card';
      card.innerHTML = `
        <div class="meta">
          <img src="${c.carrier.carrier_logo || ''}" alt="${c.carrier.carrier_name}">
          <div>
            <div><strong>${c.carrier.carrier_name}</strong></div>
            <div class="muted small">${c.pros?.[0] || ''}</div>
          </div>
        </div>
        <div class="c-price">${premium===null ? '—' : money(premium)}</div>
      `;
      card.addEventListener('click', () => {
        alert(`${c.carrier.carrier_name}\nPremium: ${premium===null?'—':money(premium)}\n(Detail overlay coming next step)`);
      });
      box.appendChild(card);
    });

    if (!box.children.length){
      box.innerHTML = '<p class="muted center small">Keep answering—quotes will pop in as carriers become ready.</p>';
    }
  }

  function carrierReady(c){
    // All required_expr true AND answered
    const reqByQ = indexRequirements(c.requirements);
    return questions.every(q => {
      const r = reqByQ[q.q_number];
      const applicable = evaluateExpr(r?.applicable_expr, answers, true);
      const required = evaluateExpr(r?.required_expr, answers, false);
      const answered = answers[q.q_number] !== undefined && answers[q.q_number] !== null && answers[q.q_number] !== '';
      return !applicable ? true : (!required || answered);
    });
  }

  // ===== Utility UI =====
  function clearSList(){ $('#s-list').innerHTML = '<p class="muted small">Carriers appear here after product selection.</p>'; }
  function clearCList(){ $('#c-list').innerHTML = '<p class="muted center small">Quotes will appear here when a carrier is ready.</p>'; }
});
