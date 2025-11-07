// netlify/functions/zip-geo.js
import fetch from "node-fetch";

export const handler = async (event) => {
  try {
    const zip = (event.queryStringParameters?.zip || "").trim();
    if (!/^\d{5}$/.test(zip)) {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid ZIP" }) };
    }

    const key = process.env.GOOGLE_MAPS_KEY;
    if (!key) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GOOGLE_MAPS_KEY" }) };
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      zip
    )}&components=country:US|postal_code:${encodeURIComponent(zip)}&key=${key}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "OK" || !Array.isArray(data.results) || !data.results.length) {
      return { statusCode: 200, body: JSON.stringify({ state: null, city: null, lat: null, lng: null }) };
    }

    const res = data.results[0];
    const comps = res.address_components || [];

    // find state (short_name like "TN")
    const stateComp = comps.find(c => (c.types || []).includes("administrative_area_level_1"));
    const state = stateComp?.short_name || null;

    // find city (locality first, then postal_town, then sublocality)
    const cityComp =
      comps.find(c => (c.types || []).includes("locality")) ||
      comps.find(c => (c.types || []).includes("postal_town")) ||
      comps.find(c => (c.types || []).includes("sublocality")) ||
      null;
    const city = cityComp?.long_name || null;

    const lat = res.geometry?.location?.lat ?? null;
    const lng = res.geometry?.location?.lng ?? null;

    if (!/^[A-Z]{2}$/.test(state)) {
      return { statusCode: 200, body: JSON.stringify({ state: null, city, lat, lng }) };
    }

    return { statusCode: 200, body: JSON.stringify({ state, city, lat, lng }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
