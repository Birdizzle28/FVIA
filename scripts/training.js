// Minimal interactivity: tabs + placeholder math (so UI works today).
document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  const tabs = Array.from(document.querySelectorAll('.product-tabs .tab'));
  const panels = Array.from(document.querySelectorAll('.panel'));
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.toggle('is-active', b === btn));
      panels.forEach(p => p.classList.toggle('is-active', p.id === `panel-${btn.dataset.tab}`));
    });
  });

  // --- Simple placeholder calc helpers (replace later with your real formulas) ---
  const money = n => isFinite(n) ? `$${(+n).toFixed(2)}` : '$—';

  // Final Expense
  document.getElementById('fe-calc')?.addEventListener('click', () => {
    const age = +document.getElementById('fe-age').value || 0;
    const smoker = document.getElementById('fe-smoker').value === 'yes';
    const face = +document.getElementById('fe-face').value || 0;
    // toy estimate: base per-$1k grows slightly with age; smoker adds 35%; +$3 fee
    const per1k = (age < 60 ? 4.0 : age < 70 ? 6.0 : 9.0) * (smoker ? 1.35 : 1);
    const monthly = per1k * (face / 1000) + 3;
    document.getElementById('fe-result').hidden = false;
    document.getElementById('fe-price').textContent = money(monthly);
    document.getElementById('fe-breakdown').textContent = `Toy estimate • ${face ? `$${face.toLocaleString()}` : '—'} face amount`;
  });

  // Term Life
  document.getElementById('term-calc')?.addEventListener('click', () => {
    const age = +document.getElementById('term-age').value || 0;
    const smoker = document.getElementById('term-smoker').value === 'yes';
    const face = +document.getElementById('term-face').value || 0;
    const term = +document.getElementById('term-length').value || 10;
    const klass = document.getElementById('term-class').value || 'Standard';
    let per1k = (age < 40 ? 0.15 : age < 50 ? 0.28 : age < 60 ? 0.55 : 1.1);
    if (smoker) per1k *= 1.9;
    per1k *= (term === 20 ? 1.25 : term === 30 ? 1.6 : 1);
    per1k *= (klass === 'Preferred' ? 0.85 : 1);
    const monthly = per1k * (face / 1000) + 2.5;
    document.getElementById('term-result').hidden = false;
    document.getElementById('term-price').textContent = money(monthly);
    document.getElementById('term-breakdown').textContent = `${term}-yr • ${klass}`;
  });

  // Auto
  document.getElementById('auto-calc')?.addEventListener('click', () => {
    const state = (document.getElementById('auto-state').value || 'TN').toUpperCase();
    const age = +document.getElementById('auto-age').value || 30;
    const acc = +document.getElementById('auto-acc').value || 0;
    const vio = +document.getElementById('auto-viol').value || 0;
    const sym = +document.getElementById('auto-sym').value || 10;
    const cov = document.getElementById('auto-cov').value;
    const baseMap = { TN: 68, MS: 72, AR: 70, KY: 85, AL: 74, GA: 88 };
    const base = baseMap[state] ?? 80;
    let driver = 1.0;
    if (age < 21) driver *= 1.8; else if (age < 25) driver *= 1.4; else if (age >= 70) driver *= 1.2;
    driver *= (1 + 0.25 * acc) * (1 + 0.10 * vio);
    const vehicle = 0.7 + (sym - 1) * (0.4 / 26);
    const coverage = cov === 'full' ? 1.45 : 1.0;
    const monthly = (base * driver * vehicle * coverage) * 1.06; // small pay-plan bump
    document.getElementById('auto-result').hidden = false;
    document.getElementById('auto-price').textContent = money(monthly);
    document.getElementById('auto-breakdown').textContent = `${state} • ${cov === 'full' ? 'Full' : 'Liability'}`;
  });

  // Home
  document.getElementById('home-calc')?.addEventListener('click', () => {
    const state = (document.getElementById('home-state').value || 'TN').toUpperCase();
    const covA = +document.getElementById('home-a').value || 250000;
    const ded = document.getElementById('home-ded').value;
    const pc = +document.getElementById('home-pc').value || 5;
    const roof = document.getElementById('home-roof').value === 'yes';
    const masonry = document.getElementById('home-masonry').value === 'yes';
    const per1k = ({TN:1.25, MS:1.55, AR:1.40, KY:1.45, AL:1.60, GA:1.50}[state] ?? 1.50);
    const pcMult = 0.90 + (pc - 1) * 0.025;
    let annual = (covA / 1000) * per1k * pcMult;
    const dedMult = ({'1000':1.00,'2500':0.93,'5000':0.86}[ded] ?? 1);
    annual *= dedMult;
    if (roof) annual *= 0.97;
    if (masonry) annual *= 0.98;
    const monthly = annual / 12;
    document.getElementById('home-result').hidden = false;
    document.getElementById('home-price').textContent = money(monthly);
    document.getElementById('home-breakdown').textContent = `${state} • PC${pc} • Ded ${ded ? `$${(+ded).toLocaleString()}` : '—'}`;
  });

  // Pro Liability (placeholder math only)
  document.getElementById('pro-calc')?.addEventListener('click', () => {
    const rev = +document.getElementById('pro-rev').value || 150000;
    const limit = document.getElementById('pro-limit').value; // 1x2, 1x1, 500x1...
    const ded = document.getElementById('pro-ded').value;
    let per1k = 0.9;                 // toy base per $1k revenue
    if (limit === '1x2') per1k *= 1.05;
    if (limit === '500x1') per1k *= 0.85;
    if (ded === '0') per1k *= 1.08;
    const annual = (rev / 1000) * per1k;
    const monthly = Math.max(annual / 12, 45); // simple min-prem floor
    document.getElementById('pro-result').hidden = false;
    document.getElementById('pro-price').textContent = money(monthly);
    document.getElementById('pro-breakdown').textContent = `${(rev).toLocaleString()} revenue • ${limit} • Ded $${(+ded).toLocaleString()}`;
  });
});
