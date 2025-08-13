export async function handler(event) {
  // Preflight for CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      },
      body: ""
    };
  }

  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  try {
    const address =
      event.queryStringParameters?.address?.trim() ||
      ""; // more reliable than rawQuery

    if (!address) {
      return {
        statusCode: 400,
        headers: cors,
        body: JSON.stringify({ error: "Missing address" })
      };
    }

    const key = process.env.GOOGLE_MAPS_KEY;
    if (!key) {
      return {
        statusCode: 500,
        headers: cors,
        body: JSON.stringify({ error: "Missing GOOGLE_MAPS_KEY env var" })
      };
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;

    const r = await fetch(url);
    if (!r.ok) {
      return {
        statusCode: 502,
        headers: cors,
        body: JSON.stringify({ error: "Upstream geocode fetch failed" })
      };
    }

    const data = await r.json();

    if (data.status !== "OK" || !data.results?.length) {
      return {
        statusCode: 200,
        headers: cors,
        body: JSON.stringify({
          zip: "",
          lat: "",
          lng: "",
          status: data.status,
          error_message: data.error_message
        })
      };
    }

    const result = data.results[0];
    const comps = result.address_components || [];
    const zipObj = comps.find(c => c.types?.includes("postal_code"));
    const zip = zipObj?.long_name || zipObj?.short_name || "";
    const { lat, lng } = result.geometry?.location || {};

    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ zip, lat, lng })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: cors,
      body: JSON.stringify({ error: "Server error" })
    };
  }
}
