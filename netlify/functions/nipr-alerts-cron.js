import fetch from "node-fetch";

function getBaseUrl() {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    "http://localhost:8888"
  ).replace(/\/$/, "");
}

export async function handler() {
  try {
    const baseUrl = getBaseUrl();

    // yesterday’s date (NIPR reports are usually lagged)
    const d = new Date();
    d.setDate(d.getDate() - 1);

    const reportDate = d.toISOString().split("T")[0];

    const res = await fetch(
      `${baseUrl}/.netlify/functions/nipr-alerts-process-report`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          env: "prod",
          reportDate,
          runSync: true,
          runParse: true,
        }),
      }
    );

    const text = await res.text();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        reportDate,
        response: text,
      }),
    };
  } catch (err) {
    console.error("cron error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message,
      }),
    };
  }
}
