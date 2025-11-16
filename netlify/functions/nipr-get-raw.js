// netlify/functions/nipr-get-raw.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Use POST" })
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { agent_id } = body;

    if (!agent_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing agent_id" })
      };
    }

    // Pull LATEST snapshot XML for this agent
    const { data, error } = await supabase
      .from("agent_nipr_snapshots")
      .select("raw_xml, created_at")
      .eq("agent_id", agent_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "No snapshot found",
          details: error?.message
        })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/xml" },
      body: data.raw_xml
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message
      })
    };
  }
}
