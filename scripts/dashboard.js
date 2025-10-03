// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

// Wait for DOM
document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  // simple tab switcher
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.folder-tabs .tab');
    if (!btn) return;
  
    const tabs   = btn.parentElement.querySelectorAll('.tab');
    const panels = btn.closest('.folder-tabs').querySelectorAll('.panel');
    const id     = btn.dataset.tab;
  
    tabs.forEach(t => {
      const active = t === btn;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  
    panels.forEach(p => p.classList.toggle('is-active', p.id === `panel-${id}`));
  });
});
