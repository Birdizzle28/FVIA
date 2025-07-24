// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJnY29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let map; // must be global for callback
let radiusCircle = null;
let currentViewMode = 'mine'; // Default view mode
let routingMode = false;
let selectedRoutePoints = [];
let directionsService;
let directionsRenderer;

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
  const R = 3958.8; // Earth radius in miles
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

  // Clear previous markers and radius circle
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
    // If radius filter is active, skip leads outside the radius
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
      if (routingMode) {
        // In routing mode, select this lead as a route stop
        selectedRoutePoints.push({
          lat: lead.lat,
          lng: lead.lng,
          address: `${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`,
          name: `${lead.first_name} ${lead.last_name}`
        });
        // Mark the selected point visually (small green dot)
        marker.content = document.createElement('div');
        marker.content.innerHTML = `<div style="width: 20px; height: 20px; background-color: green; border-radius: 50%; border: 2px solid white;"></div>`;
        // Enable "Generate Route" button if at least two points are selected
        document.getElementById('generate-route').disabled = selectedRoutePoints.length < 2;
        // Update route stops list in the side panel and open the panel
        updateRouteListUI();
        document.getElementById('route-panel').classList.add('open');
      } else {
        // In normal mode, show info window for the lead
        const infoWindow = new google.maps.InfoWindow({
          content: `<strong>${lead.first_name} ${lead.last_name}</strong><br>${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`
        });
        infoWindow.open(map, marker);
      }
    });

    map.markers.push(marker);
  });
}

function initMap() {
  directionsService = new google.maps.DirectionsService();
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 36.1627, lng: -86.7816 },
    zoom: 8,
    mapId: '6ea480352876049060496b2a'
  });
  directionsRenderer = new google.maps.DirectionsRenderer();
  directionsRenderer.setMap(map);
}

function updateRouteListUI() {
  const list = document.getElementById('route-stops-list');
  list.innerHTML = '';
  selectedRoutePoints.forEach((point, index) => {
    const item = document.createElement('div');
    item.className = 'route-stop';
    item.textContent = `${index + 1}. ${point.name || 'Lead'} - ${point.address}`;
    list.appendChild(item);
  });
}

function formatDuration(totalSeconds) {
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) {
    return minutes + ' min';
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${mins} min`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const routePanel = document.getElementById('route-panel');
  const routePanelToggle = document.getElementById('route-panel-toggle');
  const closeRoutePanelBtn = document.getElementById('close-route-panel');
  const enableRoutingCheckbox = document.getElementById('enable-routing');
  const generateRouteBtn = document.getElementById('generate-route');
  const resetRouteBtn = document.getElementById('reset-route');
  const travelModeSelect = document.getElementById('travel-mode');
  const customStartInput = document.getElementById('custom-start');
  const customEndInput = document.getElementById('custom-end');
  const optimizeRouteBtn = document.getElementById('optimize-route');
  const startRouteBtn = document.getElementById('start-route');

  // Check user session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  const user = session.user;
  const { data: profile } = await supabase.from('agents').select('*').eq('id', user.id).single();
  const isAdmin = profile?.is_admin;

  // If not admin, hide admin-only links; if admin, enable view toggle
  if (!isAdmin) {
    const adminLink = document.querySelector('.admin-only');
    if (adminLink) adminLink.style.display = 'none';
  } else {
    document.getElementById('view-toggle-container').style.display = 'block';
    document.getElementById('lead-view-select').addEventListener('change', (e) => {
      currentViewMode = e.target.value;
      loadLeadPins(user, isAdmin, currentViewMode);
    });
  }

  // Toggle route planner panel
  routePanelToggle.addEventListener('click', () => {
    routePanel.classList.toggle('open');
  });
  closeRoutePanelBtn.addEventListener('click', () => {
    routePanel.classList.remove('open');
  });

  // Enable/disable routing mode
  enableRoutingCheckbox.addEventListener('change', (e) => {
    routingMode = e.target.checked;
    selectedRoutePoints = [];
    // Clear any existing route from the map
    directionsRenderer?.setDirections({ routes: [] });
    // Reset any custom marker styling
    map.markers?.forEach(m => { if (m.content) m.content = null; });
    // Reset route UI
    updateRouteListUI();
    document.getElementById('total-route-time').textContent = '--';
    generateRouteBtn.disabled = true;
    // If exiting routing mode, close the route panel
    if (!routingMode) {
      routePanel.classList.remove('open');
    }
  });

  // Show/hide ZIP code input based on radius center method
  document.getElementById('radius-center-method').addEventListener('change', (e) => {
    document.getElementById('filter-center-zip').style.display = e.target.value === 'zip' ? 'inline-block' : 'none';
  });

  // Apply filters to reload map pins
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
        const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
        centerPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude };
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

  // Reset filters and reload pins
  document.getElementById('reset-map-filters').addEventListener('click', () => {
    document.querySelectorAll('#map-filters input, #map-filters select').forEach(el => el.value = '');
    loadLeadPins(user, isAdmin, currentViewMode);
  });

  // Initialize date range picker
  flatpickr('#filter-date-range', {
    mode: 'range',
    dateFormat: 'Y-m-d'
  });

  // Agent Hub dropdown menu behavior
  const toggleBtn = document.getElementById('agent-hub-toggle');
  const dropdownMenu = document.getElementById('agent-hub-menu');
  dropdownMenu.style.display = 'none';
  toggleBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.style.display = dropdownMenu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      dropdownMenu.style.display = 'none';
    }
  });

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signOut();
    if (!error) window.location.href = '../index.html';
  });

  // Generate Route (initial route drawing without optimization)
  generateRouteBtn.addEventListener('click', () => {
    if (selectedRoutePoints.length < 2) {
      alert('Select at least two locations for routing.');
      return;
    }
    const travelMode = travelModeSelect.value;
    let origin = selectedRoutePoints[0].address;
    let destination = selectedRoutePoints[selectedRoutePoints.length - 1].address;
    const startAddr = customStartInput.value.trim();
    const endAddr = customEndInput.value.trim();
    if (startAddr) origin = startAddr;
    if (endAddr) destination = endAddr;
    const waypoints = selectedRoutePoints.slice(1, -1).map(p => ({ location: p.address, stopover: true }));
    directionsService.route({ origin, destination, waypoints, optimizeWaypoints: false, travelMode }, (result, status) => {
      if (status === 'OK') {
        directionsRenderer.setDirections(result);
        // Calculate total travel time
        let totalSeconds = 0;
        result.routes[0].legs.forEach(leg => { totalSeconds += leg.duration.value; });
        document.getElementById('total-route-time').textContent = formatDuration(totalSeconds);
        // Open the route planner panel to show stops and total time
        routePanel.classList.add('open');
      } else {
        alert('Route generation failed: ' + status);
      }
    });
  });

  // Optimize Route (recalculate route with optimized waypoints order)
  optimizeRouteBtn.addEventListener('click', () => {
    if (selectedRoutePoints.length < 2) {
      alert('Select at least two locations before optimizing the route.');
      return;
    }
    const travelMode = travelModeSelect.value;
    let origin = selectedRoutePoints[0].address;
    let destination = selectedRoutePoints[selectedRoutePoints.length - 1].address;
    const startAddr = customStartInput.value.trim();
    const endAddr = customEndInput.value.trim();
    if (startAddr) origin = startAddr;
    if (endAddr) destination = endAddr;
    const waypoints = selectedRoutePoints.slice(1, -1).map(p => ({ location: p.address, stopover: true }));
    directionsService.route({ origin, destination, waypoints, optimizeWaypoints: true, travelMode }, (result, status) => {
      if (status === 'OK') {
        directionsRenderer.setDirections(result);
        // Reorder selectedRoutePoints according to the optimized order returned by Google Maps
        const order = result.routes[0].waypoint_order;
        const newOrder = [ selectedRoutePoints[0] ];
        order.forEach(i => {
          newOrder.push(selectedRoutePoints[i + 1]);
        });
        newOrder.push(selectedRoutePoints[selectedRoutePoints.length - 1]);
        selectedRoutePoints = newOrder;
        updateRouteListUI();
        // Update total travel time
        let totalSeconds = 0;
        result.routes[0].legs.forEach(leg => { totalSeconds += leg.duration.value; });
        document.getElementById('total-route-time').textContent = formatDuration(totalSeconds);
      } else {
        alert('Route optimization failed: ' + status);
      }
    });
  });

  // Start Route (open the route in Google Maps for navigation)
  startRouteBtn.addEventListener('click', () => {
    if (selectedRoutePoints.length < 2) {
      alert('Select at least two locations to start the route.');
      return;
    }
    let origin = selectedRoutePoints[0].address;
    let destination = selectedRoutePoints[selectedRoutePoints.length - 1].address;
    const startAddr = customStartInput.value.trim();
    const endAddr = customEndInput.value.trim();
    if (startAddr) origin = startAddr;
    if (endAddr) destination = endAddr;
    let waypointsParam = '';
    if (selectedRoutePoints.length > 2) {
      const midPoints = selectedRoutePoints.slice(1, -1).map(p => p.address);
      waypointsParam = midPoints.join('|');
    }
    const travelMode = travelModeSelect.value.toLowerCase();
    let googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${travelMode}`;
    if (waypointsParam) {
      googleMapsUrl += `&waypoints=${encodeURIComponent(waypointsParam)}`;
    }
    window.open(googleMapsUrl, '_blank');
  });

  // Reset Route (clear selections and route display)
  resetRouteBtn.addEventListener('click', () => {
    selectedRoutePoints = [];
    directionsRenderer.setDirections({ routes: [] });
    map.markers?.forEach(m => { if (m.content) m.content = null; });
    updateRouteListUI();
    document.getElementById('total-route-time').textContent = '--';
    generateRouteBtn.disabled = true;
  });

  // Initialize map and load pins after Google Maps API is loaded
  if (window.google && window.google.maps) {
    initMap();
    currentViewMode = isAdmin ? 'mine' : 'mine'; // default to "My Leads"
    loadLeadPins(user, isAdmin, currentViewMode);
  } else {
    window.addEventListener('maps-loaded', () => {
      initMap();
      currentViewMode = isAdmin ? 'mine' : 'mine';
      loadLeadPins(user, isAdmin, currentViewMode);
    });
  }
});
