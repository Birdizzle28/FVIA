// scripts/calculator.js
document.addEventListener('DOMContentLoaded', () => {
  // ===== Slide 1: choose line =====
  let chosenLine = null;
  let chosenProduct = null;

  const slide = (name) => {
    document.querySelectorAll('.q-slide').forEach(s => s.classList.remove('is-active'));
    document.querySelector(`.q-slide[data-slide="${name}"]`)?.classList.add('is-active');
  };

  // Click a line tile
  document.querySelectorAll('[data-slide="line"] .tile').forEach(btn => {
    btn.addEventListener('click', () => {
      chosenLine = btn.dataset.line;
      document.getElementById('line-next').disabled = false;
    });
  });

  // Line -> Product
  document.getElementById('line-next')?.addEventListener('click', () => {
    if (!chosenLine) return;
    document.getElementById('chosen-line').textContent = `${chosenLine}: Select a product`;
    // Clear product tiles (we will hydrate from Supabase later)
    const productTiles = document.getElementById('product-tiles');
    productTiles.innerHTML = '';
    productTiles.classList.add('empty');

    // For now, do NOT guess products. We’ll show an empty state.
    // When you add products in Supabase for this line, we’ll query and render.
    slide('product');
  });

  // Back from product
  document.querySelector('[data-slide="product"] [data-back="line"]')?.addEventListener('click', () => {
    chosenLine = null; chosenProduct = null;
    document.getElementById('line-next').disabled = true;
    slide('line');
    clearSList(); clearCList();
  });

  // Click a product tile (will exist after we hydrate from Supabase later)
  document.getElementById('product-tiles')?.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile[data-product-id]');
    if (!tile) return;
    chosenProduct = tile.dataset.productId;
    document.getElementById('product-next').disabled = false;
  });

  // Product -> Questions
  document.getElementById('product-next')?.addEventListener('click', () => {
    if (!chosenProduct) return;
    // Hydrate questions for chosen product (later from Supabase). For now show empty.
    renderQChips([]);              // no chips yet (until you add questions)
    document.getElementById('q-body').innerHTML =
      `<p class="muted">Questions for <strong>${chosenLine}</strong> product will appear here once configured in Supabase.</p>`;
    // Populate S-List with only carriers relevant to this product (later from Supabase). Leave blank now.
    clearSList(); clearCList();
    slide('questions');
  });

  // ===== S-List / C-List helpers =====
  const sList = document.getElementById('s-list');
  const cList = document.getElementById('c-list');

  function clearSList(){ sList.innerHTML = '<p class="muted small">Carriers appear here after you select a product.</p>'; }
  function clearCList(){ cList.innerHTML = '<p class="muted center small">Quotes will appear here when a carrier is ready.</p>'; }

  clearSList(); clearCList();

  // Q-Chips renderer (1..N)
  function renderQChips(chips){
    const bar = document.getElementById('q-chips');
    bar.innerHTML = '';
    chips.forEach(ch => {
      const el = document.createElement('button');
      el.className = `q-chip ${ch.state || ''}`; // red | green | grey
      el.textContent = ch.number;
      el.title = ch.title || `Question ${ch.number}`;
      el.addEventListener('click', () => {
        // jump to question – to be implemented after you define questions
      });
      bar.appendChild(el);
    });
  }
});
