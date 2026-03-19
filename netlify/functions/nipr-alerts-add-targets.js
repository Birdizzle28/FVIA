import fetch from "node-fetch";

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getEnvConfig(envName = "beta") {
  const env = String(envName).toLowerCase();

  if (env === "prod") {
    return {
      username: process.env.NIPR_PROD_USERNAME,
      password: process.env.NIPR_PROD_PASSWORD,
      url: "https://pdb-alerts-industry-services.api.nipr.com/pdb-alerts-industry-services/services/industry-ws",
    };
  }

  return {
    username: process.env.NIPR_BETA_USERNAME,
    password: process.env.NIPR_BETA_PASSWORD,
    url: "https://pdb-alerts-industry-services.api.beta.nipr.com/pdb-alerts-industry-services/services/industry-ws",
  };
}

function buildAddTargetsEnvelope({ subscriptionName, npns }) {
  const npnXml = npns
    .map((npn) => `<ind:npnList>${escapeXml(npn)}</ind:npnList>`)
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ind="https://pdb-services.nipr.com/pdb-alerts-industry-services/industry-ws">
  <soapenv:Header/>
  <soapenv:Body>
    <ind:addTargets>
      <ind:subscriptionName>${escapeXml(subscriptionName)}</ind:subscriptionName>
      <ind:targetInputData>
        <ind:inputFormat>NPN</ind:inputFormat>
        <ind:targetInputList>
          ${npnXml}
        </ind:targetInputList>
      </ind:targetInputData>
    </ind:addTargets>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    const {
      env = "beta",
      subscriptionName,
      npns,
    } = body;

    if (!subscriptionName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing subscriptionName" }),
      };
    }

    if (!Array.isArray(npns) || npns.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing npns array" }),
      };
    }

    const cleanedNpns = npns
      .map((x) => String(x).trim())
      .filter(Boolean);

    if (cleanedNpns.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No valid NPNs provided" }),
      };
    }

    const { username, password, url } = getEnvConfig(env);

    if (!username || !password) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: `Missing NIPR credentials for env "${env}"`,
        }),
      };
    }

    const xmlBody = buildAddTargetsEnvelope({
      subscriptionName,
      npns: cleanedNpns,
    });

    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "text/xml; charset=utf-8",
        Accept: "text/xml, application/xml",
      },
      body: xmlBody,
    });

    const responseText = await res.text();

    return {
      statusCode: res.ok ? 200 : res.status,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: res.ok,
        env,
        endpoint: url,
        status: res.status,
        request: {
          subscriptionName,
          npns: cleanedNpns,
        },
        raw_response: responseText,
      }),
    };
  } catch (err) {
    console.error("nipr-alerts-add-targets error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
