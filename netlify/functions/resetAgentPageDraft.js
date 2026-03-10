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

const DEFAULT_SECTION_CONTENT = {
  home: {
    hero: {
      heading: "",
      subheading: "",
      body: "",
      button_text: "",
      button_link: "",
      image_url: ""
    },
    contact: {},
    licenses: {},
    quote: {}
  },
  about: {
    hero: {
      heading: "",
      subheading: "",
      body: "",
      button_text: "",
      button_link: "",
      image_url: ""
    },
    summary: {
      heading: "About Me",
      body: ""
    },
    story: {
      heading: "My Story",
      body: ""
    },
    approach: {
      heading: "My Approach",
      body: ""
    },
    who_i_help: {
      heading: "Who I Help",
      body: ""
    },
    licenses: {},
    cta: {
      heading: "Ready to Talk?",
      body: "",
      button_text: "",
      button_link: ""
    }
  },
  careers: {
    intro: {
      heading: "",
      subheading: "",
      body: ""
    },
    notice: {
      heading: "We’re not hiring right now",
      body: "Hiring is temporarily paused."
    },
    roles: {
      agent_role_title: "Licensed Life Insurance Agent",
      agent_role_location: "",
      agent_role_type: "",
      agent_role_description: "",
      setter_role_title: "Appointment Setter",
      setter_role_location: "",
      setter_role_type: "",
      setter_role_description: ""
    },
    cta: {
      heading: "Want to keep in touch?",
      body: "",
      button_text: "Contact Me",
      button_link: ""
    },
    faq: {}
  },
  faqs: {
    intro: {
      heading: "Frequently Asked Questions",
      body: ""
    },
    list: {},
    cta: {
      heading: "Still have questions?",
      body: "",
      button_text: "Contact Me",
      button_link: ""
    }
  }
};

const DEFAULT_SECTION_STYLE = {
  text_align: "left",
  heading_size: "md",
  color_preset: "default"
};

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
    const agentId = String(body.agent_id || "").trim();
    const pageKey = String(body.page_key || "").trim();
    const sectionKey = String(body.section_key || "").trim();
    const mode = String(body.mode || "").trim(); // "page" or "section"

    if (!agentId || !pageKey || !mode) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ ok: false, error: "Missing required fields" })
      };
    }

    if (mode === "section") {
      if (!sectionKey) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: "Missing section_key" })
        };
      }

      const content = DEFAULT_SECTION_CONTENT?.[pageKey]?.[sectionKey] || {};
      const style = { ...DEFAULT_SECTION_STYLE };

      const { error } = await supabase
        .from("agent_page_sections")
        .update({
          draft_content: content,
          draft_style: style,
          is_enabled: true,
          updated_at: new Date().toISOString()
        })
        .eq("agent_id", agentId)
        .eq("page_key", pageKey)
        .eq("section_key", sectionKey);

      if (error) throw error;

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, mode: "section" })
      };
    }

    if (mode === "page") {
      const pageDefaults = DEFAULT_SECTION_CONTENT?.[pageKey];
      if (!pageDefaults) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ ok: false, error: "Invalid page_key" })
        };
      }

      for (const [secKey, content] of Object.entries(pageDefaults)) {
        const { error } = await supabase
          .from("agent_page_sections")
          .update({
            draft_content: content || {},
            draft_style: { ...DEFAULT_SECTION_STYLE },
            is_enabled: true,
            updated_at: new Date().toISOString()
          })
          .eq("agent_id", agentId)
          .eq("page_key", pageKey)
          .eq("section_key", secKey);

        if (error) throw error;
      }

      if (pageKey === "careers" || pageKey === "faqs") {
        const { error: faqDeleteErr } = await supabase
          .from("agent_page_faqs")
          .delete()
          .eq("agent_id", agentId)
          .eq("page_key", pageKey);

        if (faqDeleteErr) throw faqDeleteErr;
      }

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({ ok: true, mode: "page" })
      };
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: "Invalid mode" })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ ok: false, error: e?.message || "Unknown error" })
    };
  }
};
