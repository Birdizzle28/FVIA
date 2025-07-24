// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let map; // must be global for callback
async function loadLeadPins(user, isAdmin) {
  let query = supabase.from('leads').select('*').not('lat', 'is', null).not('lng', 'is', null);

  if (!isAdmin) {
    query = query.eq('assigned_to', user.id);
  }

  const { data: leads, error } = await query;

  if (error) {
    console.error('Error loading leads:', error.message);
    return;
  }

  leads.forEach((lead) => {
    const { AdvancedMarkerElement } = google.maps.marker;
    const marker = new AdvancedMarkerElement({
      position: { lat: lead.lat, lng: lead.lng },
      map,
      title: `${lead.first_name} ${lead.last_name}`
    });

    const infoWindow = new google.maps.InfoWindow({
      content: `<strong>${lead.first_name} ${lead.last_name}</strong><br>${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`,
    });

    marker.addListener('click', () => {
      infoWindow.open(map, marker);
    });
  });
}
function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 36.1627, lng: -86.7816 },
    zoom: 8,
    mapId: '6ea480352876049060496b2a'
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }

  const user = session.user;

  const { data: profile } = await supabase
    .from('agents')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile?.is_admin) {
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) adminLink.style.display = 'none';
  }

  // Agent Hub dropdown
  const toggle = document.getElementById("agent-hub-toggle");
  const menu = document.getElementById("agent-hub-menu");
  menu.style.display = "none";

  toggle?.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      menu.style.display = "none";
    }
  });

  // Logout
  document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signOut();
    if (!error) window.location.href = '../index.html';
  });
  initMap();
  loadLeadPins(user, isAdmin);
});
