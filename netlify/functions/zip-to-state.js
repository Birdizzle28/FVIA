// netlify/functions/zip-to-state.js
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
    )}&components=country:US&key=${key}`;

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.status !== "OK" || !Array.isArray(data.results) || !data.results.length) {
      return { statusCode: 200, body: JSON.stringify({ state: null }) };
    }

    // Find the "administrative_area_level_1" short_name (e.g., "TN")
    const comps = data.results[0].address_components || [];
    const stateComp = comps.find(c => (c.types || []).includes("administrative_area_level_1"));
    const state = stateComp?.short_name || null;

    // Extra sanity: if result isn't a proper US state code, null it
    if (!/^[A-Z]{2}$/.test(state)) {
      return { statusCode: 200, body: JSON.stringify({ state: null }) };
    }

    return { statusCode: 200, body: JSON.stringify({ state }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
