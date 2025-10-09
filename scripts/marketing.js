import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

const toggle = document.getElementById("agent-hub-toggle");
const menu = document.getElementById("agent-hub-menu");
if (menu) menu.style.display = "none";
toggle?.addEventListener("click", (e) => { e.stopPropagation(); menu.style.display = (menu.style.display === "block") ? "none" : "block"; });
document.addEventListener("click", (e) => { if (!e.target.closest(".dropdown")) menu.style.display = "none"; });

(async function guard(){
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  const { data: me } = await supabase.from('agents').select('is_admin').eq('id', session.user.id).single();
  if (!me?.is_admin) document.querySelector('.admin-only')?.style && (document.querySelector('.admin-only').style.display = 'none');
})();

const hubGrid = document.getElementById('hub-grid');
const hubRecent = document.getElementById('hub-recent-grid');
const chips = document.getElementById('hub-chips');
const search = document.getElementById('hub-search');
const modal = document.getElementById('hub-modal');
const modalBody = document.getElementById('hub-modal-body');

const ASSETS = [
  { id:'pb-final-expense', title:'Final Expense Playbook (Local + Referrals)', cat:'Playbooks', type:'PDF', desc:'Step-by-step: scripts, follow-ups, cadence, KPIs.', href:'files/final-expense-playbook.pdf', tags:['Life','Door-to-Door','Phone'] },
  { id:'so-life', title:'Scripts & Objections — Life', cat:'Scripts & Objections', type:'Script', desc:'Intro > Needs > Close > Top 10 rebuttals.', code:`OPEN: "Hi, this is {{first}} with Family Values Insurance..."` , tags:['Phone','In-Person'] },
  { id:'so-pc', title:'Scripts & Objections — P&C', cat:'Scripts & Objections', type:'Script', desc:'Auto/Home cross-sell plus rate-review rehashes.', code:`AUTO X-SELL: "While I have you, many clients save when we bundle..."`, tags:['Cross-sell'] },
  { id:'social-captions', title:'Social Media Caption Pack (30 days)', cat:'Social Toolkit', type:'Text', desc:'Short, compliance-safe captions with hooks/CTAs.', code:`DAY 1: "What does peace of mind cost? Less than you think..."`, tags:['Facebook','Instagram'] },
  { id:'canva-templates', title:'Canva Post Templates', cat:'Templates', type:'Link', desc:'Editable square/vertical templates for promos.', href:'https://www.canva.com', tags:['Social','Editable'] },
  { id:'brand-kit', title:'Brand Assets (Logos, Colors, Fonts)', cat:'Brand Assets', type:'ZIP', desc:'FVIA logo pack, color codes, Bellota links.', href:'files/FVIA_Brand_Kit.zip', tags:['Design','Brand'] },
  { id:'compliance-guide', title:'Advertising & Compliance Quick Guide', cat:'Compliance', type:'PDF', desc:'Disclaimers, usage rules, do/don’t examples.', href:'files/FVIA_Compliance.pdf', tags:['Legal','Required'] },
  { id:'tcpa', title:'TCPA Consent Language', cat:'Compliance', type:'Text', desc:'Copy/paste consent language for forms & ads.', code:`By clicking "Submit", you agree Family Values may contact you...`, tags:['Required'] },
  { id:'forms-referral', title:'Referral Flyer (Printable)', cat:'Forms & Docs', type:'PDF', desc:'1-pager you can hand out with QR code.', href:'files/Referral_Flyer.pdf', tags:['Handout'] },
  { id:'lead-tracker', title:'Personal Outreach Tracker (Google Sheet)', cat:'Templates', type:'Link', desc:'Daily activity & KPI tracker.', href:'https://docs.google.com', tags:['KPI','Tracker'] },
  { id:'vid-appointments', title:'Booking More Appointments', cat:'Training Videos', type:'Video', desc:'15-min micro-training on call blocks & cadence.', href:'https://www.loom.com', tags:['Training'] }
];

function mk(el, cls){ const d=document.createElement(el); if(cls) d.className=cls; return d; }
function render(list, target){
  target.innerHTML = '';
  list.forEach(a=>{
    const card = mk('div','card');
    const top = mk('div','meta');
    top.append(...(a.tags||[]).map(t=>{const s=mk('span','tag'); s.textContent=t; return s;}));
    const h = mk('h3'); h.textContent = a.title;
    const p = mk('p'); p.textContent = a.desc;
    const actions = mk('div','actions');
    if (a.code) {
      const copy = mk('button','btn'); copy.innerHTML = '<i class="fa-regular fa-copy"></i> Copy';
      copy.addEventListener('click',()=>copyText(a.code));
      const preview = mk('button','btn'); preview.innerHTML = '<i class="fa-solid fa-eye"></i> Preview';
      preview.addEventListener('click',()=>openPreview(a));
      actions.append(copy, preview);
    }
    if (a.href) {
      const dl = mk('a','btn primary'); dl.textContent = (a.type==='Link'?'Open':'Download');
      dl.href = a.href; dl.target = (a.type==='Link'?'_blank':'_self');
      actions.append(dl);
      if (a.type!=='Link') {
        const prev = mk('button','btn'); prev.innerHTML = '<i class="fa-solid fa-eye"></i> Preview';
        prev.addEventListener('click',()=>openPreview(a));
        actions.append(prev);
      }
    }
    card.append(top,h,p,actions);
    target.append(card);
  });
}

function copyText(txt){
  navigator.clipboard.writeText(txt).then(()=>{
    toast('Copied to clipboard');
    pushRecent({title:'Copied text',desc:txt.slice(0,80)+'…'});
  });
}
function openPreview(a){
  modal.setAttribute('aria-hidden','false');
  const box = mk('div','preview');
  if (a.code) {
    const h = mk('h3'); h.textContent = a.title;
    const pre = mk('pre'); pre.textContent = a.code;
    box.append(h,pre);
  } else if (a.href) {
    const h = mk('h3'); h.textContent = a.title;
    const frame = mk('iframe'); frame.src = a.href;
    box.append(h,frame);
  }
  modalBody.innerHTML = ''; modalBody.append(box);
  pushRecent(a);
}
modal.addEventListener('click',(e)=>{ if(e.target.matches('[data-close], .hub-modal-backdrop')) modal.setAttribute('aria-hidden','true'); });

function toast(msg){
  const el = mk('div'); el.textContent = msg;
  Object.assign(el.style,{position:'fixed',bottom:'22px',left:'50%',transform:'translateX(-50%)',background:'#0f172a',color:'#fff',padding:'10px 14px',zIndex:'9999'});
  document.body.appendChild(el); setTimeout(()=>el.remove(),1200);
}

const RECENT_KEY = 'fvia:marketing:recent';
function getRecent(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); }catch{ return []; } }
function pushRecent(a){
  const r = getRecent();
  const item = { id:a.id||a.title, title:a.title, desc:a.desc||'', ts:Date.now() };
  const next = [item, ...r.filter(x=>x.id!==item.id)].slice(0,8);
  localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  render(next, hubRecent);
}

function applyFilter(){
  const q = (search.value||'').toLowerCase().trim();
  const active = chips.querySelector('.chip.is-active')?.dataset.filter || 'all';
  const out = ASSETS.filter(a=>{
    const inCat = (active==='all') || (a.cat===active);
    const hit = [a.title,a.desc,a.cat,(a.tags||[]).join(' ')]
      .join(' ').toLowerCase().includes(q);
    return inCat && hit;
  });
  render(out, hubGrid);
}
chips.addEventListener('click',(e)=>{
  const b = e.target.closest('.chip'); if(!b) return;
  chips.querySelectorAll('.chip').forEach(c=>c.classList.remove('is-active'));
  b.classList.add('is-active');
  applyFilter();
});
search.addEventListener('input', applyFilter);

render(ASSETS, hubGrid);
render(getRecent(), hubRecent);
applyFilter();
