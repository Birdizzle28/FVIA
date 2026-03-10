import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function safeJsonParse(str) {
  try {
    return JSON.parse(str || "{}");
  } catch {
    return {};
  }
}

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: "Method Not Allowed" })
    };
  }

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing Supabase env vars" })
      };
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false }
    });

    const body = safeJsonParse(event.body);
    const action = String(body.action || "").trim();
    const agentId = String(body.agent_id || "").trim();
    const reviewerId = body.reviewer_id ? String(body.reviewer_id).trim() : null;
    const rejectionReason = String(body.rejection_reason || "").trim();

    if (!agentId) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing agent_id" })
      };
    }

    if (!["publish", "reject", "submit"].includes(action)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Invalid action" })
      };
    }

    const { data: settings, error: settingsLoadErr } = await supabase
      .from("agent_page_settings")
      .select("*")
      .eq("agent_id", agentId)
      .single();

    if (settingsLoadErr) throw settingsLoadErr;

    const enabledPages = [
      settings.home_enabled,
      settings.about_enabled,
      settings.careers_enabled,
      settings.faqs_enabled
    ].filter(Boolean);

    if (enabledPages.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          error: "At least one page must be enabled."
        })
      };
    }

    if (action === "submit") {
      const { error: submitErr } = await supabase
        .from("agent_page_settings")
        .update({
          status: "pending_review",
          submitted_for_review_at: new Date().toISOString(),
          draft_updated_at: new Date().toISOString()
        })
        .eq("agent_id", agentId);

      if (submitErr) throw submitErr;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, action: "submit" })
      };
    }

    if (action === "reject") {
      const { error: rejectErr } = await supabase
        .from("agent_page_settings")
        .update({
          status: "draft",
          draft_updated_at: new Date().toISOString(),
          rejection_notes: rejectionReason,
          reviewed_at: new Date().toISOString()
        })
        .eq("agent_id", agentId);

      if (rejectErr) throw rejectErr;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: true,
          action: "reject",
          rejection_reason: rejectionReason || null
        })
      };
    }

    const { data: sections, error: sectionsErr } = await supabase
      .from("agent_page_sections")
      .select("*")
      .eq("agent_id", agentId);

    if (sectionsErr) throw sectionsErr;

    if (!sections || sections.length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          error: "Agent page has no sections."
        })
      };
    }

    const emptySections = sections.filter(s => {
      const c = s.draft_content || {};
      return (
        !c.heading &&
        !c.subheading &&
        !c.body &&
        !c.button_text &&
        !c.image_url
      );
    });

    if (emptySections.length === sections.length) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          ok: false,
          error: "Cannot publish an empty site."
        })
      };
    }

    const { data: sectionRows, error: sectionLoadErr } = await supabase
      .from("agent_page_sections")
      .select("id, draft_content, draft_style")
      .eq("agent_id", agentId);

    if (sectionLoadErr) throw sectionLoadErr;

    for (const row of sectionRows || []) {
      const { error: updateErr } = await supabase
        .from("agent_page_sections")
        .update({
          published_content: row.draft_content || {},
          published_style: row.draft_style || {},
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

      if (updateErr) throw updateErr;
    }

    const { data: faqRows, error: faqLoadErr } = await supabase
      .from("agent_page_faqs")
      .select("id, draft_question, draft_answer")
      .eq("agent_id", agentId);

    if (faqLoadErr) throw faqLoadErr;

    for (const row of faqRows || []) {
      const { error: updateErr } = await supabase
        .from("agent_page_faqs")
        .update({
          published_question: row.draft_question || "",
          published_answer: row.draft_answer || "",
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

      if (updateErr) throw updateErr;
    }

    const { data: socialRows, error: socialLoadErr } = await supabase
      .from("agent_social_links")
      .select("id, draft_url")
      .eq("agent_id", agentId);

    if (socialLoadErr) throw socialLoadErr;

    for (const row of socialRows || []) {
      const { error: updateErr } = await supabase
        .from("agent_social_links")
        .update({
          published_url: row.draft_url || "",
          updated_at: new Date().toISOString()
        })
        .eq("id", row.id);

      if (updateErr) throw updateErr;
    }

    const nowIso = new Date().toISOString();

    const { error: settingsErr } = await supabase
      .from("agent_page_settings")
      .update({
        status: "published",
        published_at: nowIso,
        approved_by: reviewerId,
        approved_at: nowIso,
        draft_updated_at: nowIso
      })
      .eq("agent_id", agentId);

    if (settingsErr) throw settingsErr;

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        action: "publish",
        agent_id: agentId
      })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: false,
        error: e?.message || "Unknown error"
      })
    };
  }
};
