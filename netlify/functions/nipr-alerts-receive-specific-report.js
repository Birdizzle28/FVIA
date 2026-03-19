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

function buildReceiveSpecificReportEnvelope({ reportDate }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ind="https://pdb-services.nipr.com/pdb-alerts-industry-services/industry-ws">
  <soapenv:Header/>
  <soapenv:Body>
    <ind:receiveSpecificReport>
      <ind:reportDate>${escapeXml(reportDate)}</ind:reportDate>
    </ind:receiveSpecificReport>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function extractXmlParts(raw = "") {
  const xmlParts = raw.match(/<\?xml[\s\S]*?<\/[^>]+>|<soap:Envelope[\s\S]*?<\/soap:Envelope>|<[^>]+ReportProcessResult[\s\S]*?<\/[^>]+ReportProcessResult>/g) || [];

  if (xmlParts.length > 0) {
    return xmlParts;
  }

  const fallback = raw
    .split(/--uuid:[^\r\n-]+(?:--)?/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const start = part.indexOf("<");
      return start >= 0 ? part.slice(start).trim() : "";
    })
    .filter((part) => part.startsWith("<"));

  return fallback;
}

function getTagValue(xml = "", tagName = "") {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
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
    const { env = "beta", reportDate } = body;

    if (!reportDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing reportDate" }),
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

    const xmlBody = buildReceiveSpecificReportEnvelope({ reportDate });
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
    const xmlParts = extractXmlParts(responseText);

    const soapXml =
      xmlParts.find((part) => part.includes("<soap:Envelope")) || null;

    const attachmentXml =
      xmlParts.find(
        (part) =>
          part.includes("ReportProcessResult") ||
          part.includes("LicensingReportProcessResult") ||
          part.includes("DemographicsReportProcessResult") ||
          part.includes("AppointmentsReportProcessResult") ||
          part.includes("RIRSReportProcessResult")
      ) || null;

    const messageDocumentCount = attachmentXml
      ? getTagValue(attachmentXml, "MessageDocumentCount")
      : null;

    const statusCodeValue = attachmentXml
      ? getTagValue(attachmentXml, "StatusCode")
      : null;

    const successCode = attachmentXml
      ? getTagValue(attachmentXml, "SuccessCode")
      : null;

    const typeCode = attachmentXml
      ? getTagValue(attachmentXml, "TypeCode")
      : null;

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
        request: { reportDate },
        parsed: {
          messageDocumentCount,
          statusCode: statusCodeValue,
          successCode,
          typeCode,
          hasSoapEnvelope: !!soapXml,
          hasAttachmentXml: !!attachmentXml,
        },
        soap_xml: soapXml,
        attachment_xml: attachmentXml,
        raw_response: responseText,
      }),
    };
  } catch (err) {
    console.error("nipr-alerts-receive-specific-report error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
