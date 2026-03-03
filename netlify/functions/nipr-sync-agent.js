// netlify/functions/nipr-sync-agent.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// service role key stays ONLY on the server
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// NIPR beta credentials – move fully to env vars later if you want
const NIPR_USERNAME = process.env.NIPR_BETA_USERNAME;
const NIPR_PASSWORD = process.env.NIPR_BETA_PASSWORD;

// 🔥 IMPORTANT: replace this with the EXACT URL you see in Postman
// AFTER you typed an NPN and hit Send, for the request that returned <PDB>...</PDB>.
//
// Example shape (NOT real, just an example):
//   https://pdb-ws.api.beta.nipr.com/pdb-ws/pdbLookup?npn=19866925&customer=1&entity=1
//
// Then change the NPN value to NPN_HERE so we can .replace() it.
const NIPR_URL_TEMPLATE =
  "https://pdb-xml-reports.api.beta.nipr.com/pdb-xml-reports/entityinfo_xml.cgi?id_entity=NPN_HERE";

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

    const npn = agent_id; // right now, they’re the same thing

    // Build the URL by swapping NPN_HERE with the real NPN
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
      console.error("NIPR error:", res.status, xml);
      return {
        statusCode: res.status,
        body: JSON.stringify({
          error: "NIPR request failed",
          status: res.status,
          details: xml,
        }),
      };
    }

    // Save the raw XML snapshot
    const { data, error } = await supabase
      .from("agent_nipr_snapshots")
      .insert({
        agent_id: npn,
        raw_xml: xml,
      })
      .select()
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to save NIPR data",
          details: error.message,
        }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "NIPR sync successful",
        snapshot_id: data.id,
      }),
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
