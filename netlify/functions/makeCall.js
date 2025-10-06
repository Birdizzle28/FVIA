import fetch from "node-fetch";

export async function handler(event) {
  try {
    const { toNumber } = JSON.parse(event.body || "{}");

    if (!toNumber) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing toNumber" }) };
    }

    const res = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        connection_id: process.env.TELNYX_CONNECTION_ID,
        to: toNumber,
        from: process.env.TELNYX_NUMBER,
        audio_url: "https://example.com/whisper.mp3" // optional whisper audio
      })
    });

    const data = await res.json();
    return { statusCode: res.status, body: JSON.stringify(data) };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
}
