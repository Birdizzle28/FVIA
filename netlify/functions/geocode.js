export async function handler(event) {
  try {
    const params = new URLSearchParams(event.rawQuery || "");
    const address = (params.get("address") || "").trim();
    if (!address) return { statusCode: 400, body: JSON.stringify({ error: "Missing address" }) };

    const key = process.env.GOOGLE_MAPS_KEY;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;

    const r = await fetch(url);
    const data = await r.json();

    if (data.status !== "OK" || !data.results?.length) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ zip: "", lat: "", lng: "", status: data.status, error_message: data.error_message })
      };
    }

    const result = data.results[0];
    const comp = result.address_components || [];
    const zipObj = comp.find(c => c.types?.includes("postal_code"));
    const zip = zipObj?.long_name || zipObj?.short_name || "";
    const { lat, lng } = result.geometry?.location || {};

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ zip, lat, lng })
    };
  } catch {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error" }) };
  }
}
