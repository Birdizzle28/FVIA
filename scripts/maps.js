// Initialize Supabase client
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';
const supabase = createClient(
  'https://ddlbgkolnayqrxslzsxn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkbGJna29sbmF5cXJ4c2x6c3huIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDg4Mjg0OTQsImV4cCI6MjA2NDQwNDQ5NH0.-L0N2cuh0g-6ymDyClQbM8aAuldMQzOb3SXV5TDT5Ho'
);

let map;                    // Google Map instance
let directionsService;      // Google Maps Directions service
let directionsRenderer;     // Renderer for displaying directions
let routingMode = false;    // Whether routing mode is enabled
let selectedRoutePoints = [];// Array of selected route stops (with lat, lng, name, address, id)
let radiusCircle = null;    // Optional radius filter circle
let currentViewMode = 'mine';// Default lead view mode ('mine' or 'all')

// Utility: Geocode a ZIP code to lat/lng using Google Geocoding API
async function geocodeZip(zip) {
  const response = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${zip}&key=AIzaSyD5nGhz1mUXK1aGsoQSzo4MXYcI-uoxPa4`);
  const data = await response.json();
  if (data.status === 'OK') {
    return data.results[0].geometry.location;
  }
  return null;
}

// Utility: Calculate haversine distance (miles) between two lat/lng coordinates
function haversineDistance(coord1, coord2) {
  const toRad = x => x * Math.PI / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(coord2.lat - coord1.lat);
  const dLng = toRad(coord2.lng - coord1.lng);
  const lat1 = toRad(coord1.lat);
  const lat2 = toRad(coord2.lat);
  const a = Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Initialize Google Map and directions services
function initMap() {
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer();
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 36.1627, lng: -86.7816 }, // default center (e.g. Nashville)
    zoom: 8,
    mapId: '6ea480352876049060496b2a'
  });
  directionsRenderer.setMap(map);
}

// Load lead pins from Supabase for the given user (and filters). Adds markers to map.
async function loadLeadPins(user, isAdmin, viewMode = 'mine', filters = {}, centerPoint = null, radiusMiles = null) {
  // Build Supabase query for leads
  let query = supabase.from('leads').select('*').not('lat', 'is', null).not('lng', 'is', null);
  if (!isAdmin || viewMode === 'mine') {
    query = query.eq('assigned_to', user.id);
  }
  // Apply filters if provided
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

  // Clear existing markers and radius circle from map
  map.markers?.forEach(m => m.setMap(null));
  map.markers = [];
  if (radiusCircle) {
    radiusCircle.setMap(null);
    radiusCircle = null;
  }
  // If radius filter applied, draw the circle
  if (centerPoint && radiusMiles) {
    radiusCircle = new google.maps.Circle({
      strokeColor: '#007bff',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#007bff',
      fillOpacity: 0.15,
      map,
      center: centerPoint,
      radius: radiusMiles * 1609.34  // miles to meters
    });
  }

  // Create a marker for each lead
  const { AdvancedMarkerElement } = google.maps.marker;  // Using AdvancedMarker for custom content
  leads.forEach(lead => {
    // If radius filter active, skip leads outside radius
    if (centerPoint && radiusMiles) {
      const distance = haversineDistance(centerPoint, { lat: lead.lat, lng: lead.lng });
      if (distance > radiusMiles) return;
    }
    const marker = new AdvancedMarkerElement({
      position: { lat: lead.lat, lng: lead.lng },
      map,
      title: `${lead.first_name} ${lead.last_name}`
    });
    // Marker click event
    marker.addListener('click', () => {
      if (routingMode) {
        // In routing mode, select this lead as a route stop
        const pointData = {
          id: lead.id,
          lat: lead.lat,
          lng: lead.lng,
          address: `${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`,
          name: `${lead.first_name} ${lead.last_name}`
        };
        selectedRoutePoints.push(pointData);
        // Visually mark the selected point by changing marker appearance
        marker.content = document.createElement('div');
        marker.content.innerHTML = `<div style="width: 16px; height: 16px; background-color: green; border: 2px solid white; border-radius: 50%;"></div>`;
        // Ensure the route panel is open and UI updated
        document.getElementById('route-panel').classList.add('open');
        updateRouteListUI();
        // Enable routing buttons if at least two points selected
        const startBtn = document.getElementById('start-route');
        const optBtn = document.getElementById('optimize-route');
        if (selectedRoutePoints.length >= 2) {
          if (startBtn) startBtn.disabled = false;
          if (optBtn) optBtn.disabled = false;
        }
      } else {
        // Not in routing mode: show lead info in an info window
        const infoWindow = new google.maps.InfoWindow({
          content: `<strong>${lead.first_name} ${lead.last_name}</strong><br>${lead.address}, ${lead.city}, ${lead.state} ${lead.zip}`
        });
        infoWindow.open(map, marker);
      }
    });
    map.markers.push(marker);
  });
}

// Update the route stops list UI in the side panel (called after selecting or reordering stops)
function updateRouteListUI(legDurations = []) {
  const listEl = document.getElementById('route-stops-list');
  if (!listEl) return;
  listEl.innerHTML = '';  // clear current list
  // Determine if a custom start location is being used (if the start address input has value)
  const customStartUsed = !!document.getElementById('custom-start')?.value.trim();
  const customEndUsed   = !!document.getElementById('custom-end')?.value.trim();
  // Loop through each selected stop and add to UI list
  selectedRoutePoints.forEach((point, index) => {
    const item = document.createElement('div');
    item.className = 'route-stop';
    // Determine travel time text for this stop if available
    let timeText = '';
    if (legDurations.length > 0) {
      if (customStartUsed) {
        // If custom start provided, legDurations array corresponds one-to-one with stops (first leg is start->first stop)
        if (index < legDurations.length) {
          timeText = ` (${legDurations[index].text})`;
          if (index === 0) {
            // Optionally clarify first stop time is from start
            timeText = ` (${legDurations[index].text} from start)`;
          }
        }
      } else {
        // No custom start: legDurations[0] corresponds to travel to second stop, etc.
        if (index === 0) {
          timeText = ''; // first stop is starting point, no travel time
        } else if (index - 1 < legDurations.length) {
          timeText = ` (${legDurations[index - 1].text})`;
        }
      }
      // If custom end is used, the last leg (to end) is not attached to a stop here (handled separately for end).
    }
    item.textContent = `${point.name} - ${point.address}${timeText}`;
    item.draggable = true;
    // Drag events for reordering
    item.addEventListener('dragstart', () => {
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      // After drag, update the selectedRoutePoints order based on new DOM order
      const newOrder = [];
      document.querySelectorAll('#route-stops-list .route-stop').forEach(stopEl => {
        // Find matching point by address (addresses are unique per lead)
        const addr = stopEl.textContent.split(' - ')[1].split('(')[0].trim();
        const pt = selectedRoutePoints.find(p => p.address === addr);
        if (pt) newOrder.push(pt);
      });
      selectedRoutePoints = newOrder;
      // Automatically regenerate route for new order if a route was already displayed
      if (directionsRenderer && directionsRenderer.getDirections()?.routes?.length) {
        generateRoute(false); // recalc route with new order
      } else {
        // If no route drawn yet, just update UI times (none in this case)
        updateRouteListUI();
      }
    });
    listEl.appendChild(item);
  });
}

// Helper: Determine the element after which to insert the dragged item (for drag-and-drop list reordering) [oai_citation:0‡medium.com](https://medium.com/codex/drag-n-drop-with-vanilla-javascript-75f9c396ecd#:~:text=insert%20this%20node%20into%20the,container%2C%20where%20we%20want%20it)
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.route-stop:not(.dragging)')];
  let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
  for (const child of draggableElements) {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      closest = { offset: offset, element: child };
    }
  }
  return closest.element;
}

// Attach dragover event on the stops list container to handle reordering
document.addEventListener('dragover', e => {
  const container = document.getElementById('route-stops-list');
  if (!container) return;
  e.preventDefault();
  const afterElement = getDragAfterElement(container, e.clientY);
  const dragged = document.querySelector('.dragging');
  if (dragged) {
    if (!afterElement) {
      container.appendChild(dragged);
    } else {
      container.insertBefore(dragged, afterElement);
    }
  }
});

// Generate and display the route on the map for the current selectedRoutePoints.
// If optimize=true, will optimize waypoint order for shortest path.
function generateRoute(optimize = false) {
  if (selectedRoutePoints.length < 2) {
    alert('Select at least two locations for routing.');
    return;
  }
  const travelMode = document.getElementById('travel-mode')?.value || 'DRIVING';
  // Determine origin and destination
  const startInput = document.getElementById('custom-start')?.value.trim();
  const endInput   = document.getElementById('custom-end')?.value.trim();
  let origin, destination;
  if (startInput) {
    origin = startInput;
  } else {
    origin = selectedRoutePoints[0].address;
  }
  if (endInput) {
    destination = endInput;
  } else {
    destination = selectedRoutePoints[selectedRoutePoints.length - 1].address;
  }
  // Build waypoints (all intermediate stops that are not origin or final destination)
  let waypoints = [];
  // If custom start is used, include all selected points as waypoints (destination might be custom end or last lead)
  // If no custom start, include selected points except first and last (which serve as origin/destination)
  if (startInput) {
    // Use all selected points as waypoints (they all come after custom origin)
    waypoints = selectedRoutePoints.map(pt => ({ location: { lat: pt.lat, lng: pt.lng }, stopover: true }));
    // If custom end also used, we'll include all points and let destination be separate.
    // Remove the last one if it's also the destination and custom end not used:
    if (!endInput) {
      // If no custom end, the last selected point is actually the destination (we should not include it in waypoints)
      waypoints = selectedRoutePoints.slice(0, -1).map(pt => ({ location: { lat: pt.lat, lng: pt.lng }, stopover: true }));
    }
  } else {
    // No custom start: origin is first selected, destination is last selected (unless custom end overrides it)
    if (endInput) {
      // If custom end given but no custom start, include all selected points (origin is first lead, dest is custom end)
      waypoints = selectedRoutePoints.slice(1).map(pt => ({ location: { lat: pt.lat, lng: pt.lng }, stopover: true }));
    } else {
      // No custom start or end: use intermediate points (excluding first and last)
      waypoints = selectedRoutePoints.slice(1, -1).map(pt => ({ location: { lat: pt.lat, lng: pt.lng }, stopover: true }));
    }
  }
  // Prepare request for Directions API
  const request = {
    origin,
    destination,
    waypoints,
    travelMode: travelMode.toUpperCase(),
    optimizeWaypoints: optimize
  };
  directionsService.route(request, (result, status) => {
    if (status === 'OK') {
      directionsRenderer.setDirections(result);
      // If optimizing, reorder the selectedRoutePoints according to Google's optimized order
      if (optimize && result.routes[0].waypoint_order) {
        const order = result.routes[0].waypoint_order;
        // Reconstruct new order: keep origin and destination fixed if they are actual leads
        let newPoints = [];
        if (!startInput) newPoints.push(selectedRoutePoints[0]); // include first lead as origin if not custom start
        order.forEach(idx => {
          newPoints.push(selectedRoutePoints[idx + (startInput ? 0 : 1)]);
        });
        if (!endInput) newPoints.push(selectedRoutePoints[selectedRoutePoints.length - 1]); // include last lead as destination if no custom end
        // If custom start or end are used, the above logic ensures all selected leads are included in order. 
        selectedRoutePoints = newPoints;
      }
      // Compute leg durations and total time
      const route = result.routes[0];
      let totalSeconds = 0;
      let legDurations = route.legs.map(leg => {
        totalSeconds += leg.duration.value;
        return leg.duration;
      });
      // If custom end was provided, the last leg in legs is from last lead to end (not a "stop"), so exclude it for per-stop times
      if (endInput && legDurations.length > 0) {
        // Remove final leg duration from per-stop list
        legDurations = legDurations.slice(0, -1);
      }
      // Update total time display
      const totalTimeMin = Math.round(totalSeconds / 60);
      const totalTimeSpan = document.getElementById('total-route-time');
      if (totalTimeSpan) {
        totalTimeSpan.textContent = `Total: ${ totalTimeMin < 60 
          ? totalTimeMin + ' min' 
          : Math.floor(totalTimeMin/60) + ' hr ' + (totalTimeMin % 60) + ' min' }`;
      }
      // Update the stops list UI with travel times for each stop
      updateRouteListUI(legDurations);
      // Enable export button now that route is available
      const exportBtn = document.getElementById('export-route');
      if (exportBtn) exportBtn.disabled = false;
    } else {
      alert('Could not generate route: ' + status);
    }
  });
}

// Prompt user to open route in Google Maps app or stay in web
function promptOpenInMaps() {
  // Build Google Maps Directions URL for external app
  const travelMode = document.getElementById('travel-mode')?.value || 'DRIVING';
  const origin = document.getElementById('custom-start')?.value.trim() || selectedRoutePoints[0]?.address;
  const destination = document.getElementById('custom-end')?.value.trim() || selectedRoutePoints[selectedRoutePoints.length - 1]?.address;
  let waypointsParam = '';
  if (selectedRoutePoints.length > 2) {
    // Exclude first and last selected points if they serve as origin/destination in URL
    const intermediate = selectedRoutePoints.slice(1, -1).map(p => p.address);
    if (intermediate.length > 0) {
      waypointsParam = '&waypoints=' + intermediate.map(addr => encodeURIComponent(addr)).join('|');
    }
  }
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=${travelMode.toLowerCase()}${waypointsParam}`;
  // Confirm with user [oai_citation:1‡developers.google.com](https://developers.google.com/maps/documentation/urls/get-started#:~:text=,waypoints%20allowed%20varies%20by%20the)
  if (confirm('Open this route in Google Maps?')) {
    window.open(mapsUrl, '_blank');
  }
}

// On DOM content load, set up event listeners and initial state
document.addEventListener('DOMContentLoaded', async () => {
  const routePanel = document.getElementById('route-panel');
  const routePanelToggle = document.getElementById('route-panel-toggle');
  const closeRoutePanelBtn = document.getElementById('close-route-panel');
  // Require login
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'login.html';
    return;
  }
  const user = session.user;
  // Fetch agent profile to check admin status
  const { data: profile } = await supabase.from('agents').select('*').eq('id', user.id).single();
  const isAdmin = profile?.is_admin;

  // Toggle side panel visibility
  routePanelToggle.addEventListener('click', () => {
    routePanel.classList.toggle('open');
  });
  closeRoutePanelBtn.addEventListener('click', () => {
    routePanel.classList.remove('open');
  });

  // Enable/disable routing mode
  document.getElementById('enable-routing').addEventListener('change', e => {
    routingMode = e.target.checked;
    selectedRoutePoints = [];
    // Reset all markers to default appearance
    map.markers?.forEach(m => { if (m.content) m.content = null; });
    // If turning off routing mode, clear any existing route from map and close panel
    if (!routingMode) {
      directionsRenderer.setDirections({ routes: [] });
      routePanel.classList.remove('open');
    }
    // Reset route list UI
    updateRouteListUI();
    // Disable route control buttons until new selection
    const startBtn = document.getElementById('start-route');
    const optBtn = document.getElementById('optimize-route');
    const expBtn = document.getElementById('export-route');
    if (startBtn) startBtn.disabled = true;
    if (optBtn) optBtn.disabled = true;
    if (expBtn) expBtn.disabled = true;
  });

  // Start button: generate route (in entered order) and prompt for Maps app
  const startRouteBtn = document.getElementById('start-route');
  startRouteBtn.addEventListener('click', () => {
    generateRoute(false);
    // After drawing route, prompt to open in Google Maps app or stay in web
    setTimeout(promptOpenInMaps, 500);
  });

  // Optimize Route button: generate optimized route
  document.getElementById('optimize-route').addEventListener('click', () => {
    generateRoute(true);
  });

  // Reset Route button: clear selections and map directions
  document.getElementById('reset-route').addEventListener('click', () => {
    selectedRoutePoints = [];
    directionsRenderer.setDirections({ routes: [] });
    map.markers?.forEach(m => { if (m.content) m.content = null; }); // reset marker icons
    updateRouteListUI();
    // Disable route buttons
    document.getElementById('start-route').disabled = true;
    document.getElementById('optimize-route').disabled = true;
    document.getElementById('export-route')?.setAttribute('disabled', 'true');
  });

  // Export Route button (optional): export route stops and times to CSV
  const exportBtn = document.getElementById('export-route');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!directionsRenderer.getDirections() || !directionsRenderer.getDirections().routes.length) {
        alert('Please generate a route before exporting.');
        return;
      }
      const route = directionsRenderer.getDirections().routes[0];
      const legs = route.legs;
      const customStart = !!document.getElementById('custom-start')?.value.trim();
      const customEnd   = !!document.getElementById('custom-end')?.value.trim();
      // Prepare CSV lines
      const lines = [];
      lines.push(['Stop Name', 'Address', 'Travel Time from Previous'].join(','));
      // If custom start provided, include start address as first line (no travel time)
      if (customStart) {
        const startAddr = document.getElementById('custom-start').value.trim();
        lines.push(`Start,${startAddr},`);
      }
      // List each selected lead stop with travel time from previous
      selectedRoutePoints.forEach((pt, idx) => {
        let travelTime = '';
        if (idx === 0) {
          if (customStart) {
            // first stop travel from custom start
            travelTime = legs[0]?.duration.text || '';
          } else {
            travelTime = ''; // starting point
          }
        } else {
          // Subsequent stops
          if (customStart) {
            travelTime = legs[idx]?.duration.text || '';
          } else {
            travelTime = legs[idx - 1]?.duration.text || '';
          }
        }
        lines.push(`${pt.name},${pt.address},${travelTime}`);
      });
      // If custom end provided, include end address with travel time from last stop
      if (customEnd) {
        const endAddr = document.getElementById('custom-end').value.trim();
        const lastLeg = legs[legs.length - 1];
        lines.push(`End,${endAddr},${lastLeg?.duration.text || ''}`);
      }
      // Create CSV blob and trigger download
      const csvContent = lines.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'route_export.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // Apply radius filter UI logic (show/hide ZIP input based on method)
  document.getElementById('radius-center-method').addEventListener('change', e => {
    document.getElementById('filter-center-zip').style.display = e.target.value === 'zip' ? 'inline-block' : 'none';
  });

  // Apply Map Filters button
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
    await loadLeadPins(user, isAdmin, currentViewMode, filters, centerPoint, radiusMiles);
  });

  // Reset Map Filters button
  document.getElementById('reset-map-filters').addEventListener('click', () => {
    document.querySelectorAll('#map-filters input, #map-filters select').forEach(el => el.value = '');
    loadLeadPins(user, isAdmin, currentViewMode);
  });

  // If user is not admin, hide any admin-only links
  if (!isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  } else {
    // Show admin view toggle dropdown if admin
    document.getElementById('view-toggle-container').style.display = 'block';
    document.getElementById('lead-view-select').addEventListener('change', e => {
      currentViewMode = e.target.value;
      loadLeadPins(user, isAdmin, currentViewMode);
    });
  }

  // Initialize date range picker for filter
  flatpickr('#filter-date-range', {
    mode: 'range',
    dateFormat: 'Y-m-d'
  });

  // Agent hub menu dropdown toggle
  const hubToggle = document.getElementById('agent-hub-toggle');
  const hubMenu = document.getElementById('agent-hub-menu');
  if (hubMenu) hubMenu.style.display = 'none';
  hubToggle?.addEventListener('click', e => {
    e.stopPropagation();
    if (hubMenu) hubMenu.style.display = hubMenu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown') && hubMenu) {
      hubMenu.style.display = 'none';
    }
  });

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', async e => {
    e.preventDefault();
    const { error: logoutError } = await supabase.auth.signOut();
    if (!logoutError) window.location.href = '../index.html';
  });

  // Initialize the map and load initial lead markers
  initMap();
  currentViewMode = isAdmin ? 'mine' : 'mine';  // Admin defaults to 'mine' as well
  await loadLeadPins(user, isAdmin, currentViewMode);
  // Set initial state of route control buttons
  document.getElementById('start-route').disabled = true;
  document.getElementById('optimize-route').disabled = true;
  if (exportBtn) exportBtn.disabled = true;

  //Active page highlight tab
  const agentHubBtn = document.getElementById('maps-tab');
  const hubPages = ['maps']; // Add more if needed 
  console.log("Page Path:", window.location.pathname); // debug
  console.log("Found Agent Hub Button:", agentHubBtn); // debug
  if (hubPages.some(page => window.location.pathname.includes(page))) {
    agentHubBtn?.classList.add('active-page');
  } else {
    agentHubBtn?.classList.remove('active-page');
  }
});
