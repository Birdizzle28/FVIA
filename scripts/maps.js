// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let map; // must be global for callback
let radiusCircle = null;
let currentViewMode = 'mine'; // Default
async function geocodeZip(zip) {
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${zip}&key=AIzaSyD5nGhz1mUXK1aGsoQSzo4MXYcI-uoxPa4`);
  const data = await response.json();
  if (data.status === 'OK') {
    return data.results[0].geometry.location;
  }
  return null;
}
function haversineDistance(coord1, coord2) {
  const toRad = (x) => x * Math.PI / 180;
  const R = 3958.8; // Miles
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);
  const lat1 = toRad(coord1.lat);
  const lat2 = toRad(coord2.lat);

  const a = Math.sin(dLat / 2) ** 2 +
            Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
async function loadLeadPins(user, isAdmin, viewMode = 'mine', filters = {}, centerPoint = null, radiusMiles = null) {
  let query = supabase.from('leads').select('*').not('lat', 'is', null).not('lng', 'is', null);

  if (!isAdmin || viewMode === 'mine') {
    query = query.eq('assigned_to', user.id);
  }
  // Apply filters
  if (filters.ageMin) query = query.gte('age', filters.ageMin);
  if (filters.ageMax) query = query.lte('age', filters.ageMax);
  if (filters.leadType) query = query.eq('lead_type', filters.leadType);
  if (filters.city) query = query.ilike('city', `%${filters.city}%`);
  if (filters.zip) query = query.eq('zip', filters.zip);

  if (filters.dateRange?.length === 2) {
    query = query
      .gte('created_at', filters.dateRange[0])
      .lte('created_at', filters.dateRange[1]);
  }

  const { data: leads, error } = await query;
  if (error) {
    console.error('Error loading leads:', error.message);
    return;
  }

  // Clear existing markers from map (optional, if markers stack)
  // Clear previous markers and circle
  map.markers?.forEach(m => m.setMap(null));
  map.markers = [];
  if (radiusCircle) {
    radiusCircle.setMap(null);
    radiusCircle = null;
  }
  // Draw radius circle if applicable
  if (centerPoint && radiusMiles) {
    radiusCircle = new google.maps.Circle({
      strokeColor: "#007bff",
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: "#007bff",
      fillOpacity: 0.15,
      map,
      center: centerPoint,
      radius: radiusMiles * 1609.34 // Convert miles to meters
    });
  }
  leads.forEach((lead) => {
    if (centerPoint && radiusMiles) {
      const distance = haversineDistance(centerPoint, { lat: lead.lat, lng: lead.lng });
      if (distance > radiusMiles) return;
    }
    const { AdvancedMarkerElement } = google.maps.marker;
    const marker = new AdvancedMarkerElement({
      position: { lat: lead.lat, lng: lead.lng },
      map,
      title: `${lead.first_name} ${lead.last_name}`
    });

    marker.addListener('click', () => {
      const infoWindow = new google.maps.InfoWindow({
        content: `<strong>${lead.first_name} ${lead.last_name}</strong><br>${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`,
      });
      infoWindow.open(map, marker);
    });

    map.markers.push(marker); // Save marker to clear later
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
  const isAdmin = profile?.is_admin;
  document.getElementById('radius-center-method').addEventListener('change', (e) => {
    document.getElementById('filter-center-zip').style.display = e.target.value === 'zip' ? 'inline-block' : 'none';
  });
  document.getElementById('apply-map-filters').addEventListener('click', async () => {
    const ageMin = document.getElementById('filter-age-min').value;
    const ageMax = document.getElementById('filter-age-max').value;
    const leadType = document.getElementById('filter-lead-type').value;
    const city = document.getElementById('filter-city').value;
    const zip = document.getElementById('filter-zip').value;
    const radiusMiles = parseFloat(document.getElementById('filter-radius').value);
    const centerMethod = document.getElementById('radius-center-method').value;
    const centerZip = document.getElementById('filter-center-zip').value;
    let centerPoint = null;
    
    if (radiusMiles && centerMethod === 'zip' && centerZip) {
      centerPoint = await geocodeZip(centerZip);
    } else if (radiusMiles && centerMethod === 'current') {
      try {
        const pos = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej)
        );
        centerPoint = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
      } catch (err) {
        alert('Unable to access your location.');
      }
    }
    const rawRange = document.getElementById('filter-date-range').value;
    let dateRange = null;
    
    if (rawRange && rawRange.includes(' to ')) {
      const [start, end] = rawRange.split(' to ');
      if (start && end) {
        dateRange = [new Date(start).toISOString(), new Date(end).toISOString()];
      }
    }
  
    const filters = {
      ageMin: ageMin || null,
      ageMax: ageMax || null,
      leadType: leadType || null,
      city: city || null,
      zip: zip || null,
      dateRange
    };
    loadLeadPins(user, isAdmin, currentViewMode, filters, centerPoint, radiusMiles);
  });

document.getElementById('reset-map-filters').addEventListener('click', () => {
  document.querySelectorAll('#map-filters input, #map-filters select').forEach(el => el.value = '');
  loadLeadPins(user, isAdmin, currentViewMode);
});
  if (!isAdmin) {
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) adminLink.style.display = 'none';
  } else {
    // Show dropdown to admins
    document.getElementById('view-toggle-container').style.display = 'block';
    document.getElementById('lead-view-select').addEventListener('change', (e) => {
      currentViewMode = e.target.value;
      loadLeadPins(user, isAdmin, currentViewMode);
    });
  }
  flatpickr("#filter-date-range", {
    mode: "range",
    dateFormat: "Y-m-d"
  });
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

  currentViewMode = isAdmin ? 'mine' : 'mine'; // admin defaults to 'mine', agents forced to 'mine'
  loadLeadPins(user, isAdmin, currentViewMode);
});
