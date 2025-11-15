// netlify/functions/nipr-sync-agent-prod.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// service role stays ONLY on server
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// NIPR PRODUCTION credentials
// (you’ll set these in Netlify env vars)
const NIPR_USERNAME =
  process.env.NIPR_PROD_USERNAME || process.env.NIPR_USERNAME;
const NIPR_PASSWORD =
  process.env.NIPR_PROD_PASSWORD || process.env.NIPR_PASSWORD;

/**
 * IMPORTANT: replace this with the EXACT PRODUCTION URL from Postman.
 *
 * Steps:
 *  1. Open the **production** Postman collection (not beta).
 *  2. Find the "Get Entity Info" (entityinfo_xml) request.
 *  3. Put a REAL NPN in the query param (e.g. 19987739), hit Send.
 *  4. Copy the final URL from that request (the one that worked).
 *     It will look something like:
 *
 *     https://pdb-xml-reports.api.nipr.com/pdb-xml-reports/entityinfo_xml.cgi?id_entity=19987739
 *
 *  5. Paste it below and change ONLY the NPN part to NPN_HERE.
 */
const NIPR_URL_TEMPLATE =
  "https://pdb-xml-reports.api.nipr.com/pdb-xml-reports/entityinfo_xml.cgi?id_entity=NPN_HERE";

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { agent_id } = body; // 👈 this IS your NPN

    if (!agent_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing agent_id" }),
      };
    }

    const npn = agent_id;

    // Build the URL by swapping placeholder with the real NPN
    const url = NIPR_URL_TEMPLATE.replace("NPN_HERE", encodeURIComponent(npn));

    const auth = Buffer.from(`${NIPR_USERNAME}:${NIPR_PASSWORD}`).toString(
      "base64"
    );

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/xml",
      },
    });

    const xml = await res.text();

    if (!res.ok) {
      console.error("NIPR PROD error:", res.status, xml);
      return {
        statusCode: res.status,
        body: JSON.stringify({
          error: "NIPR PROD request failed",
          status: res.status,
          details: xml,
        }),
      };
    }

    // Save the raw XML snapshot – same table as beta
    const { data, error } = await supabase
      .from("agent_nipr_snapshots")
      .insert({
        agent_id: npn,
        raw_xml: xml,
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error (PROD):", error);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to save NIPR PROD data",
          details: error.message,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "NIPR PROD sync successful",
        snapshot_id: data.id,
      }),
    };
  } catch (err) {
    console.error("NIPR PROD function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
