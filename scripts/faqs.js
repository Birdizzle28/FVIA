// Accessible accordion + search filter for FAQs
// - Uses buttons with aria-expanded
// - Panels get data-open="true" when visible
// - Keyboard: Up/Down/Home/End to navigate questions
// - Search filters by question + answer text (case-insensitive)
document.addEventListener('DOMContentLoaded', () => {
  if (!supabase) {
    console.error('Supabase client missing on this page');
    return;
  }
  const list = document.getElementById('faq-list');
  const buttons = Array.from(list.querySelectorAll('.faq-button'));
  const panels = buttons.map(btn => document.getElementById(btn.getAttribute('aria-controls')));
  const search = document.getElementById('faq-query');
  const count = document.getElementById('faq-count');

  function closeAll() {
    buttons.forEach((b, i) => {
      b.setAttribute('aria-expanded', 'false');
      panels[i].removeAttribute('data-open');
    });
  }

  function toggleAt(index) {
    const btn = buttons[index];
    const panel = panels[index];
    const open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!open));
    if (open) {
      panel.removeAttribute('data-open');
    } else {
      panel.setAttribute('data-open', 'true');
    }
  }

  // Click handlers
  buttons.forEach((btn, i) => {
    btn.addEventListener('click', () => toggleAt(i));
  });

  // Keyboard nav across questions
  buttons.forEach((btn, i) => {
    btn.addEventListener('keydown', (e) => {
      const last = buttons.length - 1;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        (buttons[i + 1] || buttons[0]).focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        (buttons[i - 1] || buttons[last]).focus();
      } else if (e.key === 'Home') {
        e.preventDefault();
        buttons[0].focus();
      } else if (e.key === 'End') {
        e.preventDefault();
        buttons[last].focus();
      }
    });
  });

  // Deep link support: /faqs.html#q12 opens panel 12
  if (location.hash) {
    const target = document.querySelector(location.hash + ' .faq-button');
    if (target) {
      const idx = buttons.indexOf(target);
      if (idx >= 0) {
        target.setAttribute('aria-expanded', 'true');
        panels[idx].setAttribute('data-open', 'true');
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // Search filter
  function normalize(s) { return (s || '').toLowerCase(); }
  function applyFilter() {
    const q = normalize(search.value);
    let visible = 0;
    buttons.forEach((btn, i) => {
      const panel = panels[i];
      const text = btn.textContent + ' ' + panel.textContent;
      const match = normalize(text).includes(q);
      panel.parentElement.style.display = match ? '' : 'none';
      if (match) visible++;
    });
    if (count) count.textContent = q ? `${visible} result${visible === 1 ? '' : 's'}` : '';
  }

  if (search) {
    search.addEventListener('input', applyFilter);
  }

  // Ensure only the visible items are counted on load
  applyFilter();
});
