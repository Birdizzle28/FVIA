import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";

function getBaseUrl() {
  return (
    process.env.URL ||
    process.env.DEPLOY_PRIME_URL ||
    "http://localhost:8888"
  ).replace(/\/$/, "");
}

function collectProducerNpns(node, results = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectProducerNpns(item, results);
    return results;
  }

  if (!node || typeof node !== "object") {
    return results;
  }

  // Look for ExternalIdentifier blocks anywhere in the XML
  if (node.ExternalIdentifier) {
    const ids = Array.isArray(node.ExternalIdentifier)
      ? node.ExternalIdentifier
      : [node.ExternalIdentifier];

    for (const ext of ids) {
      const typeCode = Array.isArray(ext?.TypeCode)
        ? ext.TypeCode[0]
        : ext?.TypeCode;

      const id = Array.isArray(ext?.Id) ? ext.Id[0] : ext?.Id;

      if (String(typeCode || "").trim() === "NAICProducerCode" && id) {
        results.push(String(id).trim());
      }
    }
  }

  for (const key of Object.keys(node)) {
    collectProducerNpns(node[key], results);
  }

  return results;
}

async function callJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    ok: res.ok,
    status: res.status,
    body: json,
  };
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
      env = "prod",
      reportDate,
      attachmentXml,
      npns,
      runSync = true,
      runParse = true,
    } = body;

    let xmlToProcess = attachmentXml || null;
    const baseUrl = getBaseUrl();

    // Option 1: explicit XML passed in
    // Option 2: explicit npns passed in
    // Option 3: pull XML from your existing receive-specific-report function
    if (!xmlToProcess && (!Array.isArray(npns) || npns.length === 0)) {
      if (!reportDate) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: "Provide attachmentXml, npns, or reportDate",
          }),
        };
      }

      const reportResult = await callJson(
        `${baseUrl}/.netlify/functions/nipr-alerts-receive-specific-report`,
        { env, reportDate }
      );

      if (!reportResult.ok) {
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: "Failed to retrieve specific report",
            details: reportResult.body,
          }),
        };
      }

      xmlToProcess = reportResult.body?.attachment_xml || null;

      if (!xmlToProcess) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            success: true,
            message: "No attachment XML found in report response",
            reportDate,
            parsed: reportResult.body?.parsed || null,
            found_npns: [],
            processed: [],
          }),
        };
      }
    }

    let foundNpns = [];

    if (Array.isArray(npns) && npns.length > 0) {
      foundNpns = npns.map((x) => String(x).trim()).filter(Boolean);
    } else {
      const parsedXml = await parseStringPromise(xmlToProcess, {
        explicitArray: true,
        ignoreAttrs: false,
        trim: true,
      });

      foundNpns = [...new Set(collectProducerNpns(parsedXml).filter(Boolean))];
    }

    const processed = [];

    for (const agent_id of foundNpns) {
      const result = {
        agent_id,
        sync: null,
        parse: null,
      };

      if (runSync) {
        const syncResult = await callJson(
          `${baseUrl}/.netlify/functions/nipr-sync-agent`,
          { agent_id }
        );
        result.sync = syncResult.body;
      }

      if (runParse) {
        const parseResult = await callJson(
          `${baseUrl}/.netlify/functions/nipr-parse-agent`,
          { agent_id }
        );
        result.parse = parseResult.body;
      }

      processed.push(result);
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: true,
        reportDate: reportDate || null,
        found_npns: foundNpns,
        processed_count: processed.length,
        processed,
      }),
    };
  } catch (err) {
    console.error("nipr-alerts-process-report error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
