// Initialize Supabase client and Google Maps API integration
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJnYWtvbG5heXFyeHNsenN4biIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzQ4ODI4NDk0LCJleHAiOjIwNjQ0MDQ0OTR9.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let map;                      // Google Map instance
let radiusCircle = null;      // Optional radius filter circle
let currentViewMode = 'mine'; // "mine" or "all" leads view
let routingMode = false;      // Whether Routing Mode is enabled
let selectedRoutePoints = []; // Array of selected stops for routing
let directionsService;
let directionsRenderer;

// Geocoding utility for ZIP codes (used for radius centering by ZIP)
async function geocodeZip(zip) {
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${zip}&key=YOUR_GOOGLE_MAPS_API_KEY`);
  const data = await response.json();
  if (data.status === 'OK') {
    return data.results[0].geometry.location;
  }
  return null;
}

// Calculate distance in miles between two coordinates (haversine formula)
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

// Load lead markers onto the map (with optional filtering and radius)
async function loadLeadPins(user, isAdmin, viewMode = 'mine', filters = {}, centerPoint = null, radiusMiles = null) {
  let query = supabase.from('leads').select('*').not('lat', 'is', null).not('lng', 'is', null);
  if (!isAdmin || viewMode === 'mine') {
    query = query.eq('assigned_to', user.id);
  }
  // Apply filter conditions
  if (filters.ageMin) query = query.gte('age', filters.ageMin);
  if (filters.ageMax) query = query.lte('age', filters.ageMax);
  if (filters.leadType) query = query.eq('lead_type', filters.leadType);
  if (filters.city) query = query.ilike('city', `%${filters.city}%`);
  if (filters.zip) query = query.eq('zip', filters.zip);
  if (filters.dateRange?.length === 2) {
    query = query.gte('created_at', filters.dateRange[0]).lte('created_at', filters.dateRange[1]);
  }

  const { data: leads, error } = await query;
  if (error) {
    console.error('Error loading leads:', error.message);
    return;
  }

  // Clear existing markers and radius circle
  map.markers?.forEach(m => m.setMap(null));
  map.markers = [];
  if (radiusCircle) {
    radiusCircle.setMap(null);
    radiusCircle = null;
  }
  // Draw radius filter circle if applicable
  if (centerPoint && radiusMiles) {
    radiusCircle = new google.maps.Circle({
      strokeColor: "#007bff",
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: "#007bff",
      fillOpacity: 0.15,
      map,
      center: centerPoint,
      radius: radiusMiles * 1609.34 // miles to meters
    });
  }

  // Plot each lead as a marker on the map
  leads.forEach((lead) => {
    if (centerPoint && radiusMiles) {
      const distance = haversineDistance(centerPoint, { lat: lead.lat, lng: lead.lng });
      if (distance > radiusMiles) return; // skip leads outside radius
    }
    const { AdvancedMarkerElement } = google.maps.marker;
    const marker = new AdvancedMarkerElement({
      position: { lat: lead.lat, lng: lead.lng },
      map,
      title: `${lead.first_name} ${lead.last_name}`
    });

    // Marker click: either add to route (if Routing Mode on) or show info window
    marker.addListener('click', () => {
      if (routingMode) {
        const stopData = {
          lat: lead.lat,
          lng: lead.lng,
          address: `${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`,
          name: `${lead.first_name} ${lead.last_name}`
        };
        // Change marker appearance to indicate selection
        marker.content = document.createElement('div');
        marker.content.innerHTML = `<div style="width: 20px; height: 20px; background-color: green; border-radius: 50%; border: 2px solid white;"></div>`;
        // Add this stop to the route and open the planner panel
        addStopToRoute(stopData);
        document.getElementById('route-panel').classList.add('open');
      } else {
        // Not in Routing Mode: open an info window with lead details
        const infoWindow = new google.maps.InfoWindow({
          content: `<strong>${lead.first_name} ${lead.last_name}</strong><br>${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`
        });
        infoWindow.open(map, marker);
      }
    });

    map.markers.push(marker);
  });
}

// Initialize the Google Map
function initMap() {
  directionsService = new google.maps.DirectionsService();
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 36.1627, lng: -86.7816 }, // initial center (Nashville, TN as example)
    zoom: 8,
    mapId: '6ea480352876049060496b2a'
  });
  directionsRenderer = new google.maps.DirectionsRenderer();
  directionsRenderer.setMap(map);
}

// On DOM content loaded, set up event handlers and load initial data
document.addEventListener('DOMContentLoaded', async () => {
  const routePanelToggle = document.getElementById('route-panel-toggle');
  const closeRoutePanelBtn = document.getElementById('close-route-panel');
  // Ensure user is logged in
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  const user = session.user;
  const { data: profile } = await supabase.from('agents').select('*').eq('id', user.id).single();
  const isAdmin = profile?.is_admin;

  // Toggle Route Planner panel open/closed
  routePanelToggle.addEventListener('click', () => {
    document.getElementById('route-panel').classList.toggle('open');
  });
  closeRoutePanelBtn.addEventListener('click', () => {
    document.getElementById('route-panel').classList.remove('open');
  });

  // Enable/disable Routing Mode via checkbox
  document.getElementById('enable-routing').addEventListener('change', (e) => {
    routingMode = e.target.checked;
    // Reset any existing route when toggling mode
    selectedRoutePoints = [];
    directionsRenderer.setDirections({ routes: [] });
    map.markers?.forEach(m => { m.content = null; }); // reset custom marker icons
    updateRouteListUI();
    // Hide external directions link and remove last leg info if any
    openExternalLink.style.display = 'none';
    document.getElementById('last-leg-info')?.remove();
  });

  // Reset Route button: clear all stops and route
  document.getElementById('reset-route').addEventListener('click', () => {
    selectedRoutePoints = [];
    directionsRenderer.setDirections({ routes: [] });
    map.markers?.forEach(m => { if (m.content) m.content = null; }); // reset markers
    updateRouteListUI();
    openExternalLink.style.display = 'none';
    document.getElementById('last-leg-info')?.remove();
  });

  // Show/hide ZIP input based on radius center method selection
  document.getElementById('radius-center-method').addEventListener('change', (e) => {
    document.getElementById('filter-center-zip').style.display = (e.target.value === 'zip') ? 'inline-block' : 'none';
  });

  // Map filter form events
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
      } catch {
        alert('Unable to access your location.');
      }
    }
    // Parse date range input (if provided)
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
    document.querySelectorAll('#map-filters input, #map-filters select').forEach(el => { el.value = ''; });
    loadLeadPins(user, isAdmin, currentViewMode);
  });

  // Admin view toggle (for admins, allow switching between "mine" and "all" leads)
  if (!isAdmin) {
    document.querySelector('.admin-only')?.style.setProperty('display', 'none');
  } else {
    document.getElementById('view-toggle-container').style.display = 'block';
    document.getElementById('lead-view-select').addEventListener('change', (e) => {
      currentViewMode = e.target.value;
      loadLeadPins(user, isAdmin, currentViewMode);
    });
  }

  // Initialize date range picker for filters
  flatpickr("#filter-date-range", { mode: "range", dateFormat: "Y-m-d" });

  // Agent Hub dropdown menu behavior
  const hubToggle = document.getElementById("agent-hub-toggle");
  const hubMenu = document.getElementById("agent-hub-menu");
  hubMenu.style.display = "none";
  hubToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    hubMenu.style.display = (hubMenu.style.display === "block" ? "none" : "block");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      hubMenu.style.display = "none";
    }
  });

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', async (e) => {
    e.preventDefault();
    const { error } = await supabase.auth.signOut();
    if (!error) window.location.href = '../index.html';
  });

  // Initialize map and load markers
  initMap();
  currentViewMode = isAdmin ? 'mine' : 'mine'; // (admin defaults to 'mine' as well)
  loadLeadPins(user, isAdmin, currentViewMode);
});

// Route planning logic

// Helper: Add a selected stop to the route list and update UI
function addStopToRoute(stopData) {
  selectedRoutePoints.push(stopData);
  updateRouteListUI();
}

// Update the Route Planner stops list UI (reflect selectedRoutePoints)
function updateRouteListUI() {
  routeStopsList.innerHTML = '';
  selectedRoutePoints.forEach((point, index) => {
    const item = document.createElement('div');
    item.className = 'route-stop';
    item.textContent = `${point.name || 'Lead'} - ${point.address}`;
    item.dataset.index = index;
    item.draggable = true;
    // Attach drag event handlers to enable reordering
    item.addEventListener('dragstart', dragStart);
    item.addEventListener('dragover', dragOver);
    item.addEventListener('dragend', dragEnd);
    routeStopsList.appendChild(item);
  });
  // Enable/disable route action buttons based on number of stops
  startRouteBtn.disabled = selectedRoutePoints.length < 2;
  optimizeRouteBtn.disabled = selectedRoutePoints.length < 2;
}

// Routing: Start button (generate directions without reordering waypoints)
startRouteBtn.addEventListener('click', () => {
  if (selectedRoutePoints.length < 2) {
    alert("Select at least 2 leads."); 
    return;
  }
  const startInput = document.getElementById('custom-start').value.trim();
  const endInput = document.getElementById('custom-end').value.trim();
  const travelMode = document.getElementById('travel-mode').value;
  // Determine origin, destination, and waypoints for directions request
  let origin = selectedRoutePoints[0].address;
  let destination = selectedRoutePoints[selectedRoutePoints.length - 1].address;
  if (startInput) origin = startInput;
  if (endInput) destination = endInput;
  let waypointsList = selectedRoutePoints.map(p => p.address);
  if (!startInput) waypointsList.shift();    // remove first if it's used as origin
  if (!endInput) waypointsList.pop();        // remove last if it's used as destination
  const waypoints = waypointsList.slice(0, waypointsList.length).map(addr => ({ location: addr, stopover: true }));
  // Request directions from Google Maps API
  directionsService.route({ origin, destination, waypoints, optimizeWaypoints: false, travelMode }, (result, status) => {
    if (status === 'OK') {
      directionsRenderer.setDirections(result);
      const legs = result.routes[0].legs;
      // Calculate and display total route time
      let totalSeconds = 0;
      legs.forEach(leg => { totalSeconds += leg.duration.value; });
      const totalMinutes = Math.round(totalSeconds / 60);
      totalTimeSpan.textContent = (totalMinutes < 60)
        ? `${totalMinutes} min`
        : `${Math.floor(totalMinutes/60)} hr ${totalMinutes % 60} min`;
      // Display travel time between stops
      displayLegDurations(legs, !!startInput, !!endInput);
      // Prepare "Open in Google Maps" directions link
      showExternalDirectionsLink(origin, destination, waypointsList, travelMode);
    } else {
      alert('Route request failed: ' + status);
    }
  });
});

// Routing: Optimize Route button (reorder waypoints for shortest route)
optimizeRouteBtn.addEventListener('click', () => {
  if (selectedRoutePoints.length < 2) {
    alert("Select at least 2 leads before optimizing the route."); 
    return;
  }
  const startInput = document.getElementById('custom-start').value.trim();
  const endInput = document.getElementById('custom-end').value.trim();
  const travelMode = document.getElementById('travel-mode').value;
  // Setup origin, destination, and waypoints similar to above, but allow Google to optimize
  let origin = selectedRoutePoints[0].address;
  let destination = selectedRoutePoints[selectedRoutePoints.length - 1].address;
  if (startInput) origin = startInput;
  if (endInput) destination = endInput;
  let waypointsList = selectedRoutePoints.map(p => p.address);
  if (!startInput) waypointsList.shift();
  if (!endInput) waypointsList.pop();
  const waypoints = waypointsList.map(addr => ({ location: addr, stopover: true }));
  directionsService.route({ origin, destination, waypoints, optimizeWaypoints: true, travelMode }, (result, status) => {
    if (status === 'OK') {
      directionsRenderer.setDirections(result);
      // Reorder selectedRoutePoints according to optimized order returned
      const order = result.routes[0].waypoint_order;
      let newOrder = [...selectedRoutePoints];
      if (order && order.length > 0) {
        // Build new order: include all leads, adjusting for any origin/dest outside list
        const firstLeadIndex = startInput ? 0 : 1;
        const lastLeadIndexOffset = endInput ? 0 : 1;
        newOrder = [
          ...(startInput ? [] : [selectedRoutePoints[0]]), 
          ...order.map(i => selectedRoutePoints[i + firstLeadIndex]), 
          ...(endInput ? [] : [selectedRoutePoints[selectedRoutePoints.length - 1]])
        ];
      }
      selectedRoutePoints = newOrder;
      updateRouteListUI();
      // Calculate and display total optimized route time
      const legs = result.routes[0].legs;
      let totalSeconds = 0;
      legs.forEach(leg => { totalSeconds += leg.duration.value; });
      const totalMinutes = Math.round(totalSeconds / 60);
      totalTimeSpan.textContent = (totalMinutes < 60)
        ? `${totalMinutes} min`
        : `${Math.floor(totalMinutes/60)} hr ${totalMinutes % 60} min`;
      // Display updated leg durations
      displayLegDurations(legs, !!startInput, !!endInput);
      // Update "Open in Google Maps" link for optimized route
      showExternalDirectionsLink(origin, destination, waypointsList, travelMode);
    } else {
      alert('Optimization failed: ' + status);
    }
  });
});

// Show durations for each leg between stops (and to start/end if applicable)
function displayLegDurations(legs, hasCustomStart, hasCustomEnd) {
  const items = routeStopsList.children;
  // Remove any existing leg duration text (if function called again)
  for (let item of items) {
    // Remove any appended parentheses text by splitting at " ("
    const baseText = item.textContent.split(' (')[0];
    item.textContent = baseText;
  }
  // Append durations to stop items where applicable
  legs.forEach((leg, idx) => {
    // If origin is custom, leg 0 ends at first stop (index 0)
    // If origin is a lead, leg 0 ends at second stop (index 1)
    let stopIndex = hasCustomStart ? idx : (idx + 1);
    if (stopIndex < items.length) {
      let label = '';
      if (idx === 0 && hasCustomStart) {
        label = `${leg.duration.text} from Start`;
      } else if (idx === legs.length - 1 && hasCustomEnd) {
        // Last leg goes to custom End (not a stop in list)
        // Attach this info to last listed stop
        label = `${leg.duration.text} to End`;
        stopIndex = items.length - 1;
      } else {
        label = `${leg.duration.text} from prev`;
      }
      if (label) {
        items[stopIndex].textContent += ` (${label})`;
      }
    }
  });
}

// Create and display the external Google Maps directions link
function showExternalDirectionsLink(origin, destination, waypointsList, travelMode) {
  // Construct Google Maps Directions URL (with up to 9 waypoints) [oai_citation:0‡developers.google.com](https://developers.google.com/maps/documentation/urls/get-started#:~:text=,waypoints%20allowed%20varies%20by%20the) [oai_citation:1‡developers.google.com](https://developers.google.com/maps/documentation/urls/get-started#:~:text=following%20waypoints%3A)
  const params = new URLSearchParams({
    api: '1',
    origin: origin,
    destination: destination,
    travelmode: travelMode.toLowerCase()
  });
  if (waypointsList.length > 0) {
    params.append('waypoints', waypointsList.map(addr => encodeURIComponent(addr)).join('|'));
  }
  openExternalLink.href = `https://www.google.com/maps/dir/?${params.toString()}`;
  openExternalLink.style.display = 'inline-block';
}

// ** Drag-and-Drop functionality for reordering route stops **

// Based on HTML5 Drag & Drop API for list items [oai_citation:2‡stackoverflow.com](https://stackoverflow.com/questions/10588607/tutorial-for-html5-dragdrop-sortable-list#:~:text=function%20dragStart%28e%29%20,target%3B) [oai_citation:3‡stackoverflow.com](https://stackoverflow.com/questions/10588607/tutorial-for-html5-dragdrop-sortable-list#:~:text=function%20isBefore%28el1%2C%20el2%29%20,return%20true%3B%20return%20false%3B)
let draggedItem = null;
function isBefore(a, b) {
  if (a.parentNode === b.parentNode) {
    for (let cur = a.previousSibling; cur; cur = cur.previousSibling) {
      if (cur === b) return true;
    }
  }
  return false;
}
function dragStart(e) {
  draggedItem = e.target;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');  // required for Firefox [oai_citation:4‡stackoverflow.com](https://stackoverflow.com/questions/10588607/tutorial-for-html5-dragdrop-sortable-list#:~:text=function%20dragStart%28e%29%20,target%3B)
  e.target.classList.add('dragging');
}
function dragOver(e) {
  e.preventDefault();
  const target = e.target;
  if (!draggedItem || target === draggedItem) return;
  if (target.classList.contains('route-stop')) {
    if (isBefore(draggedItem, target)) {
      target.parentNode.insertBefore(draggedItem, target);
    } else {
      target.parentNode.insertBefore(draggedItem, target.nextSibling);
    }
  }
}
function dragEnd(e) {
  e.target.classList.remove('dragging');
  if (!draggedItem) return;
  // Rebuild selectedRoutePoints array based on new DOM order
  const items = routeStopsList.children;
  const newOrder = [];
  for (let item of items) {
    const oldIndex = parseInt(item.dataset.index);
    newOrder.push(selectedRoutePoints[oldIndex]);
  }
  selectedRoutePoints = newOrder;
  // Update each item's data-index to reflect new order
  Array.from(items).forEach((item, idx) => { item.dataset.index = idx; });
  // Update button states (enable if now 2 or more stops)
  startRouteBtn.disabled = selectedRoutePoints.length < 2;
  optimizeRouteBtn.disabled = selectedRoutePoints.length < 2;
  draggedItem = null;
}

// Select key DOM elements for quick access
const routeStopsList = document.getElementById('route-stops-list');
const totalTimeSpan = document.getElementById('total-route-time');
const startRouteBtn = document.getElementById('start-route');
const optimizeRouteBtn = document.getElementById('optimize-route');
const openExternalLink = document.getElementById('open-external');
``` [oai_citation:5‡stackoverflow.com](https://stackoverflow.com/questions/10588607/tutorial-for-html5-dragdrop-sortable-list#:~:text=function%20dragStart%28e%29%20,target%3B) [oai_citation:6‡developers.google.com](https://developers.google.com/maps/documentation/urls/get-started#:~:text=following%20waypoints%3A)
