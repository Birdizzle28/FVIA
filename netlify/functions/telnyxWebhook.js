// netlify/functions/telnyxWebhook.js
export async function handler(event) {
  // Optional: log to see events arriving
  console.log("Telnyx webhook:", event.headers["telnyx-event-type"], event.body);
  // Always 200 so Telnyx is happy
  return { statusCode: 200, body: "ok" };
}
