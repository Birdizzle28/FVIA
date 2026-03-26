import fetch from "node-fetch";

function getBaseUrl() {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    "http://localhost:8888"
  ).replace(/\/$/, "");
}

function formatLocalDate(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function handler() {
  try {
    const baseUrl = getBaseUrl();

    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const reportDates = [
      formatLocalDate(today),
      formatLocalDate(yesterday)
    ];

    const results = [];

    for (const reportDate of reportDates) {
      const res = await fetch(
        `${baseUrl}/.netlify/functions/nipr-alerts-process-report`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            env: "prod",
            reportDate,
            runSync: true,
            runParse: true
          }),
        }
      );

      const text = await res.text();
      results.push({
        reportDate,
        status: res.status,
        response: text
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        tried: results
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
