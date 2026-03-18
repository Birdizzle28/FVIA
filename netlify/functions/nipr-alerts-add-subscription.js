// netlify/functions/nipr-alerts-add-subscription.js
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

function buildAddSubscriptionEnvelope({
  subscriptionName,
  email,
  allStates = true,
  residentStateOnly = false,
  alertTypes = ["LICENSING", "APPOINTMENTS", "RIRS", "DEMOGRAPHICS"],
}) {
  const alertTypeXml = alertTypes
    .map((type) => `<ind:alertTypeList>${escapeXml(type)}</ind:alertTypeList>`)
    .join("");

return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ind="https://pdb-services.nipr.com/pdb-alerts-industry-services/industry-ws">
  <soapenv:Header/>
  <soapenv:Body>
    <ind:addSubscription>
      <ind:subscriptionInputData>
        <ind:subscriptionName>Agents</ind:subscriptionName>
        <ind:email>YOUR_EMAIL_HERE</ind:email>

        <ind:affiliationList>
          <ind:None>false</ind:None>
          <ind:All>false</ind:All>
        </ind:affiliationList>

        <ind:stateList>
          <ind:allStates>true</ind:allStates>
        </ind:stateList>

        <ind:alertTypeList>
          <ind:alertTypeList>LICENSING</ind:alertTypeList>
          <ind:alertTypeList>APPOINTMENTS</ind:alertTypeList>
          <ind:alertTypeList>RIRS</ind:alertTypeList>
          <ind:alertTypeList>DEMOGRAPHICS</ind:alertTypeList>
        </ind:alertTypeList>
      </ind:subscriptionInputData>
    </ind:addSubscription>
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
      email,
      allStates = true,
      residentStateOnly = false,
      alertTypes = ["LICENSING", "APPOINTMENTS", "RIRS", "DEMOGRAPHICS"],
    } = body;

    if (!subscriptionName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing subscriptionName" }),
      };
    }

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing email" }),
      };
    }

    const { username, password, url } = getEnvConfig(env);

    if (!username || !password) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: `Missing Netlify credentials for env "${env}"`,
        }),
      };
    }

    const xmlBody = buildAddSubscriptionEnvelope({
      subscriptionName,
      email,
      allStates,
      residentStateOnly,
      alertTypes,
    });

    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "addSubscription",
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
          email,
          allStates,
          residentStateOnly,
          alertTypes,
        },
        raw_response: responseText,
      }),
    };
  } catch (err) {
    console.error("nipr-alerts-add-subscription error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
