import fetch from "node-fetch";

// netlify/functions/makeCall.js
export async function handler(event) {
  try {
    const { agentNumber, prospectNumber, toNumber } = JSON.parse(event.body || "{}");

    // Accept either {agentNumber} or legacy {toNumber}
    const to = agentNumber || toNumber;
    if (!to) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing agentNumber/toNumber" }) };
    }

    // Build the Telnyx create-call payload
    const payload = {
      connection_id: process.env.TELNYX_CONNECTION_ID,   // Call Control Connection ID
      to,                                                // E.164 number to dial first (agent)
      from: process.env.TELNYX_FROM_NUMBER,              // Your Telnyx DID in E.164
      // audio_url: "https://example.com/whisper.mp3",   // optional: must be a valid HTTPS file
    };

    // If you plan to call the prospect after the agent answers, encode their number here.
    if (prospectNumber) {
      payload.client_state = Buffer
        .from(JSON.stringify({ prospectNumber }))
        .toString("base64");
    }

    const res = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.TELNYX_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text(); // keep raw text so 422 errors are readable
    return { statusCode: res.status, body: text };

  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
}
