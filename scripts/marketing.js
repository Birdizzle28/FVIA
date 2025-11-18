// scripts/marketing.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// Optional Agent Hub dropdown (safe if not present)
const toggle = document.getElementById('agent-hub-toggle');
const menu = document.getElementById('agent-hub-menu');
if (menu) menu.style.display = 'none';
toggle?.addEventListener('click', (e) => {
  e.stopPropagation();
  menu.style.display = (menu.style.display === 'block') ? 'none' : 'block';
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.dropdown') && menu) menu.style.display = 'none';
});

// Auth guard (must be logged in to see hub)
(async function guard() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
})();

// DOM refs
const hubGrid = document.getElementById('hub-grid');
const hubRecent = document.getElementById('hub-recent-grid');
const chips = document.getElementById('hub-chips');
const search = document.getElementById('hub-search');
const modal = document.getElementById('hub-modal');
const modalBody = document.getElementById('hub-modal-body');

// Starter built-in assets
const BUILT_IN_ASSETS = [
  { id:'pb-final-expense', title:'Final Expense Playbook (Local + Referrals)', cat:'Playbooks', type:'PDF', desc:'Step-by-step: scripts, follow-ups, cadence, KPIs.', href:'files/final-expense-playbook.pdf', tags:['Life','Door-to-Door','Phone','Playbooks'] },
  { id:'so-life', title:'Scripts & Objections — Life', cat:'Scripts & Objections', type:'Script', desc:'Intro > Needs > Close > Top 10 rebuttals.', code:`OPEN: "Hi, this is {{first}} with Family Values Insurance..."` , tags:['Phone','In-Person','Scripts & Objections'] },
  { id:'so-pc', title:'Scripts & Objections — P&C', cat:'Scripts & Objections', type:'Script', desc:'Auto/Home cross-sell plus rate-review rehashes.', code:`AUTO X-SELL: "While I have you, many clients save when we bundle..."`, tags:['Cross-sell','P&C','Scripts & Objections'] },
  { id:'social-captions', title:'Social Media Caption Pack (30 days)', cat:'Social Toolkit', type:'Text', desc:'Short, compliance-safe captions with hooks/CTAs.', code:`DAY 1: "What does peace of mind cost? Less than you think..."`, tags:['Facebook','Instagram','Social Toolkit'] },
  { id:'canva-templates', title:'Canva Post Templates', cat:'Templates', type:'Link', desc:'Editable square/vertical templates for promos.', href:'https://www.canva.com', tags:['Social','Editable','Templates'] },
  { id:'brand-kit', title:'Brand Assets (Logos, Colors, Fonts)', cat:'Brand Assets', type:'ZIP', desc:'FVIA logo pack, color codes, Bellota links.', href:'files/FVIA_Brand_Kit.zip', tags:['Design','Brand','Brand Assets'] },
  { id:'compliance-guide', title:'Advertising & Compliance Quick Guide', cat:'Compliance', type:'PDF', desc:'Disclaimers, usage rules, do/don’t examples.', href:'files/FVIA_Compliance.pdf', tags:['Legal','Required','Compliance'] },
  { id:'tcpa', title:'TCPA Consent Language', cat:'Compliance', type:'Text', desc:'Copy/paste consent language for forms & ads.', code:`By clicking "Submit", you agree Family Values may contact you...`, tags:['Required','Compliance'] },
  { id:'forms-referral', title:'Referral Flyer (Printable)', cat:'Forms & Docs', type:'PDF', desc:'1-pager you can hand out with QR code.', href:'files/Referral_Flyer.pdf', tags:['Handout','Forms & Docs'] },
  { id:'lead-tracker', title:'Personal Outreach Tracker (Google Sheet)', cat:'Templates', type:'Link', desc:'Daily activity & KPI tracker.', href:'https://docs.google.com', tags:['KPI','Tracker','Templates'] },
  { id:'vid-appointments', title:'Booking More Appointments', cat:'Training Videos', type:'Video', desc:'15-min micro-training on call blocks & cadence.', href:'https://www.loom.com', tags:['Training','Training Videos'] }
];

let ALL_ASSETS = [];

// Helpers
function mk(el, cls) {
  const d = document.createElement(el);
  if (cls) d.className = cls;
  return d;
}

function guessCategory(title, tags) {
  const t = (title || '').toLowerCase();
  const tagStr = (tags || []).join(' ').toLowerCase();

  const hay = t + ' ' + tagStr;

  if (/playbook/.test(hay)) return 'Playbooks';
  if (/script|objection/.test(hay)) return 'Scripts & Objections';
  if (/social|instagram|facebook|caption|reel/.test(hay)) return 'Social Toolkit';
  if (/template|flyer|post|sheet|tracker/.test(hay)) return 'Templates';
  if (/brand|logo|color|font/.test(hay)) return 'Brand Assets';
  if (/compliance|tcpa|disclosure|legal/.test(hay)) return 'Compliance';
  if (/form|doc|pdf|application/.test(hay)) return 'Forms & Docs';
  if (/video|training|webinar|loom|youtube/.test(hay)) return 'Training Videos';

  const catTag = (tags || []).find(tag =>
    [
      'Playbooks',
      'Scripts & Objections',
      'Social Toolkit',
      'Templates',
      'Brand Assets',
      'Compliance',
      'Forms & Docs',
      'Training Videos'
    ].includes(tag)
  );
  if (catTag) return catTag;

  return 'Templates';
}

function guessType(url) {
  if (!url) return 'Link';
  const u = url.toLowerCase();
  if (u.endsWith('.pdf')) return 'PDF';
  if (/\.(png|jpg|jpeg|gif|webp|svg)$/.test(u)) return 'Image';
  if (/\.(mp4|mov|avi|mkv)$/.test(u) || u.includes('loom.com') || u.includes('youtube.com') || u.includes('youtu.be')) return 'Video';
  if (/\.(zip|rar|7z)$/.test(u)) return 'ZIP';
  return 'Link';
}

// Render
function render(list, target) {
  if (!target) return;
  target.innerHTML = '';
  list.forEach(a => {
    const card = mk('div', 'card');

    const top = mk('div', 'meta');
    (a.tags || []).forEach(t => {
      const s = mk('span', 'tag');
      s.textContent = t;
      top.appendChild(s);
    });

    const h = mk('h3');
    h.textContent = a.title;
    const p = mk('p');
    p.textContent = a.desc || '';

    const actions = mk('div', 'actions');

    if (a.code) {
      const copy = mk('button', 'btn');
      copy.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
      copy.addEventListener('click', () => copyText(a.code));
      const preview = mk('button', 'btn');
      preview.innerHTML = '<i class="fa-solid fa-eye"></i> Preview';
      preview.addEventListener('click', () => openPreview(a));
      actions.append(copy, preview);
    }

    if (a.href) {
      const dl = mk('a', 'btn primary');
      dl.textContent = (a.type === 'Link' ? 'Open' : 'Download');
      dl.href = a.href;
      dl.target = (a.type === 'Link' || a.type === 'Video') ? '_blank' : '_self';
      actions.append(dl);

      const prev = mk('button', 'btn');
      prev.innerHTML = '<i class="fa-solid fa-eye"></i> Preview';
      prev.addEventListener('click', () => openPreview(a));
      actions.append(prev);
    }

    card.append(top, h, p, actions);
    target.append(card);
  });
}

// Clipboard + toast
function copyText(txt) {
  navigator.clipboard.writeText(txt).then(() => {
    toast('Copied to clipboard');
    pushRecent({ id: 'clipboard', title: 'Copied text', desc: txt.slice(0, 80) + '…' });
  });
}

function toast(msg) {
  const el = mk('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed',
    bottom: '22px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#0f172a',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    zIndex: '9999'
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

// Preview modal
function openPreview(a) {
  if (!modal || !modalBody) return;
  modal.setAttribute('aria-hidden', 'false');

  const box = mk('div', 'preview');

  const h = mk('h3');
  h.textContent = a.title;
  box.appendChild(h);

  if (a.code) {
    const pre = mk('pre');
    pre.textContent = a.code;
    box.appendChild(pre);
  } else if (a.href) {
    const frame = mk('iframe');
    frame.src = a.href;
    frame.style.width = '100%';
    frame.style.minHeight = '400px';
    box.appendChild(frame);
  }

  modalBody.innerHTML = '';
  modalBody.append(box);
  pushRecent(a);
}

modal?.addEventListener('click', (e) => {
  if (e.target.matches('[data-close], .hub-modal-backdrop')) {
    modal.setAttribute('aria-hidden', 'true');
  }
});

// Recent list
const RECENT_KEY = 'fvia:marketing:recent';

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function pushRecent(a) {
  const item = {
    id: a.id || a.title,
    title: a.title,
    desc: a.desc || '',
    ts: Date.now()
  };
  const r = getRecent();
  const next = [item, ...r.filter(x => x.id !== item.id)].slice(0, 8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  render(next, hubRecent);
}

// Filtering
function applyFilter() {
  if (!hubGrid) return;
  const q = (search?.value || '').toLowerCase().trim();
  const active = chips?.querySelector('.chip.is-active')?.dataset.filter || 'all';

  const out = ALL_ASSETS.filter(a => {
    const inCat = (active === 'all') || (a.cat === active);
    const hay = [
      a.title || '',
      a.desc || '',
      a.cat || '',
      (a.tags || []).join(' ')
    ].join(' ').toLowerCase();
    const hit = !q || hay.includes(q);
    return inCat && hit;
  });

  render(out, hubGrid);
}

// Load from Supabase
async function loadDbAssets() {
  const { data, error } = await supabase
    .from('marketing_assets')
    .select('*')
    .eq('is_published', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading marketing assets:', error);
    return [];
  }

  return (data || []).map(row => {
    const tags = Array.isArray(row.tags)
      ? row.tags
      : (row.tags ? String(row.tags).split(',').map(s => s.trim()).filter(Boolean) : []);

    const href = row.url || row.file_url || null;
    const cat = guessCategory(row.title, tags);
    const type = href ? guessType(href) : 'Link';

    return {
      id: row.id,
      title: row.title,
      desc: row.description || '',
      cat,
      type,
      href,
      tags
    };
  });
}

// Wire UI
chips?.addEventListener('click', (e) => {
  const b = e.target.closest('.chip');
  if (!b) return;
  chips.querySelectorAll('.chip').forEach(c => c.classList.remove('is-active'));
  b.classList.add('is-active');
  applyFilter();
});

search?.addEventListener('input', applyFilter);

// Boot
(async function bootstrap() {
  const dbAssets = await loadDbAssets();
  ALL_ASSETS = [...BUILT_IN_ASSETS, ...dbAssets];

  render(ALL_ASSETS, hubGrid);
  render(getRecent(), hubRecent);
  applyFilter();
})();
