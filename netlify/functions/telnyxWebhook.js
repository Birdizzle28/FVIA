// netlify/functions/telnyxWebhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";
const VOICE = "Telnyx.KokoroTTS.af";

// ---- utils
const toE164 = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
};

// core Telnyx action helper (with optional quiet404 to avoid noisy logs)
const act = async (id, action, body = {}, opts = {}) => {
  const headers = {
    Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
    "Content-Type": "application/json",
  };
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  const payload = { id, action, status: r.status, json: json ?? txt };

  if (!r.ok) {
    const isQuiet404 = opts.quiet404 && r.status === 404;
    if (!isQuiet404) console.error("Telnyx action failed", payload);
  } else {
    console.log("Telnyx action ok", { id, action, json: json ?? txt });
  }
  return { ok: r.ok, status: r.status, json: json ?? txt };
};

// stop any IVR state on a leg (important before bridging)
const safeStop = async (id) => {
  if (!id) return;
  await act(id, "stop_gather", {}, { quiet404: true });
  await act(id, "stop_speaking", {}, { quiet404: true });
};

async function startVoicemailOn(callId) {
  if (!callId) return;
  await safeStop(callId);
  await act(callId, "speak", {
    voice: VOICE, language: "en-US",
    payload: "Please leave a message after the tone."
  });
  await act(callId, "record_start", {
    // voicemail: single channel is fine
    format: "mp3",
    channels: "single",
    play_beep: true,
    max_duration_secs: 120,
    terminate_silence_secs: 6
  });
}

const encodeState = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64");
const decodeState = (b64) => {
  try { return JSON.parse(Buffer.from(String(b64 || ""), "base64").toString("utf8")); }
  catch { return {}; }
};

// optional: parse cover=... for nicer whispers
function humanizeCoverFromNotes(notes = "") {
  const m = String(notes).match(/cover=([^\s|]+)/i) || String(notes).match(/cover=([^|]+)/i);
  if (!m) return null;
  const parts = m[1].trim().split(',').map(s => s.trim()).filter(Boolean);
  const toPhrase = (s) => ({
    "Myself":"their life",
    "Someone Else":"a loved one",
    "My Car":"their car",
    "My Home":"their home",
    "My Business":"their business",
    "My Health":"their health",
    "Legal Protection Plan":"legal protection",
    "My Identity":"identity protection"
  }[s] || s.toLowerCase());
  return parts.map(toPhrase).join(" and ");
}

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST")
      return { statusCode: 405, body: "Method Not Allowed" };

    const payload = JSON.parse(event.body || "{}");
    const eventType = payload?.data?.event_type;
    const p = payload?.data?.payload || {};
    const callId = p?.call_control_id;

    const fromNum = toE164(p.from);
    const toNum = toE164(p.to);
    const businessNum = toE164(process.env.TELNYX_BUSINESS_NUMBER);
    const adminList = (process.env.ADMIN_NUMBERS || "")
      .split(",").map(toE164).filter(Boolean);
    const clientState = decodeState(p?.client_state);
    const inboundConnId = p?.connection_id || process.env.TELNYX_CONNECTION_ID;

    console.log("TELNYX EVENT", {
      eventType, callId, fromNum, toNum, clientState,
      inboundConnId, envConn: process.env.TELNYX_CONNECTION_ID
    });

    if (!callId) return { statusCode: 200, body: "OK" };

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // ---- unified session lookup (either leg id)
    async function findSessionByAnyLeg(id) {
      const { data: rows, error } = await supabase
        .from("call_sessions")
        .select("*")
        .or(`telnyx_call_id.eq.${id},client_call_id.eq.${id}`)
        .limit(1);
      if (error) throw error;
      const s = rows?.[0];
      if (!s) return { s: null, isAgent: false, isClient: false };
      return {
        s,
        isAgent: s.telnyx_call_id === id,
        isClient: s.client_call_id === id
      };
    }

    const { s: sessionAny, isAgent: isAgentLeg, isClient: isClientLeg } =
      await findSessionByAnyLeg(callId);

    // Treat as client leg by tag even if DB hasn't updated yet
    const looksLikeClientLeg = isClientLeg || clientState?.kind === "client";

    const isInboundToBiz =
      !!businessNum && toNum === businessNum && !isAgentLeg && !looksLikeClientLeg;

    const fromMatchesBizOrFrom =
      [toE164(process.env.TELNYX_FROM_NUMBER), businessNum].filter(Boolean).includes(fromNum);
    const isToAdmin = adminList.includes(toNum);
    const isAdminLeg =
      fromMatchesBizOrFrom && isToAdmin && clientState?.kind === "admin";

    // ====== recording saved (voicemail or call) ======
    if (eventType === "call.recording.saved") {
      const rec = payload?.data?.payload;
      const url = rec?.recording_urls?.[0]?.url || rec?.recording_url;
      const row = {
        call_id: rec?.call_control_id,
        from_number: toE164(rec?.from),
        to_number: toE164(rec?.to),
        recording_url: url
      };

      // Try a generic call recordings table first; ignore if not present
      try { await supabase.from("call_recordings").insert(row); } catch {}
      // Keep your existing voicemail insert path too
      try { await supabase.from("voicemails").insert(row); } catch {}

      return { statusCode: 200, body: "OK" };
    }

    // ===== inbound biz DID → ring admins =====
    if (eventType === "call.initiated" && isInboundToBiz) {
      await act(callId, "answer", {});
      await act(callId, "speak", {
        voice: VOICE, language: "en-US",
        payload: "Please hold while we connect you to a representative."
      });

      const fromForAdmins = toE164(process.env.TELNYX_FROM_NUMBER) || businessNum;
      let targets = adminList.filter(n => n !== fromNum);
      if (targets.length === 0) targets = adminList.slice();

      for (const adminNumber of targets) {
        const r = await fetch(`${TAPI}/calls`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            connection_id: inboundConnId,
            to: adminNumber,
            from: fromForAdmins,
            client_state: encodeState({ kind: "admin", inbound_id: callId })
          }),
        });
        const j = await r.json().catch(() => ({}));
        console.log("ADMIN LEG CREATE", {
          adminNumber, status: r.status, id: j?.data?.id, err: j?.errors
        });
      }
      return { statusCode: 200, body: "OK" };
    }

    // ===== client leg ANSWERED → disclosure, then bridge (after speak.ended) =====
    if (eventType === "call.answered" && looksLikeClientLeg) {
      // disclosure to client before they get connected
      await safeStop(callId);
      await act(callId, "speak", {
        voice: VOICE, language: "en-US",
        payload: "Hi! This call may be recorded for quality assurance and training purposes. Please hold while I connect you."
      });
      // Do NOT bridge here; wait for call.speak.ended (see handler below)
      return { statusCode: 200, body: "OK" };
    }

    // ===== agent leg ANSWERED → start recording immediately + whisper + gather =====
    if (eventType === "call.answered" && isAgentLeg) {
      // start recording during the whisper (dual-channel, no beep, long max)
      await act(callId, "record_start", {
        format: "mp3",
        channels: "dual",
        play_beep: false,
        max_duration_secs: 4 * 60 * 60 // 4 hours safety ceiling
      });

      let name = "Prospect", summary = "";
      let whisper = sessionAny?.whisper || "";
      let wantsPhrase = null;

      if (sessionAny?.lead_id) {
        const { data: lead } = await supabase
          .from("leads").select(
            "first_name,last_name,product_type,contact_id,zip,notes,contacts:contact_id(first_name,last_name)"
          )
          .eq("id", sessionAny.lead_id).maybeSingle();

        const lf = lead?.first_name || lead?.contacts?.first_name || "";
        const ll = lead?.last_name || lead?.contacts?.last_name || "";
        name = `${lf} ${ll}`.trim() || name;

        wantsPhrase = humanizeCoverFromNotes(lead?.notes || "") || wantsPhrase;

        if (lead?.product_type) summary += `Product: ${lead.product_type}. `;
        if (lead?.zip) summary += `ZIP ${lead.zip}. `;
      }

      const sp = whisper
        ? whisper
        : `New lead: ${name}${wantsPhrase ? `, wants to cover ${wantsPhrase}` : ""}. ${summary}Press 1 to connect now.`;

      await act(callId, "gather_using_speak", {
        voice: VOICE, language: "en-US",
        minimum_digits: 1, maximum_digits: 1, valid_digits: "1",
        inter_digit_timeout_ms: 6000,
        payload: sp
      });
      return { statusCode: 200, body: "OK" };
    }

    // ===== admin leg ANSWERED → whisper + gather =====
    if (eventType === "call.answered" && isAdminLeg) {
      await act(callId, "gather_using_speak", {
        voice: VOICE, language: "en-US",
        minimum_digits: 1, maximum_digits: 1, valid_digits: "1",
        inter_digit_timeout_ms: 6000,
        payload: "Administrative call. Press 1 to connect."
      });
      return { statusCode: 200, body: "OK" };
    }

    // ===== Agent timeout (gather ended with no digit) =====
    if (eventType === "call.gather.ended" && isAgentLeg) {
      const pay = payload?.data?.payload || {};
      const digits = (pay.digits || "").toString();
      if (!digits) {
        await act(callId, "speak", {
          voice: VOICE, language: "en-US",
          payload: "No input received. Ending this call."
        });
        await act(callId, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }
    }

    // ===== DTMF (only process dtmf.received to avoid duplicates) =====
    if (eventType === "call.dtmf.received") {
      const pay = payload?.data?.payload || {};
      const digit = (pay.digit || "").toString();

      // website lead → agent pressed key
      if (isAgentLeg) {
        await safeStop(callId);

        if (digit === "1" && sessionAny?.prospect_number) {
          // place the client/prospect leg and tag it; recording already running on agent leg
          const r = await fetch(`${TAPI}/calls`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              connection_id: process.env.TELNYX_CONNECTION_ID,
              to: sessionAny.prospect_number,
              from: process.env.TELNYX_FROM_NUMBER,
              client_state: encodeState({
                kind: "client",
                session_id: sessionAny.id,
                agent_id: sessionAny.telnyx_call_id
              })
            }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) {
            await act(callId, "speak", {
              voice: VOICE, language: "en-US",
              payload: "Unable to reach the client."
            });
            return { statusCode: r.status, body: JSON.stringify(j) };
          }

          const clientCallId = j?.data?.id;
          await supabase.from("call_sessions")
            .update({ client_call_id: clientCallId })
            .eq("id", sessionAny.id);

          await act(callId, "speak", {
            voice: VOICE, language: "en-US",
            payload: "Dialing the client now."
          });
          return { statusCode: 200, body: JSON.stringify({ ok: true }) };
        }

        await act(callId, "speak", {
          voice: VOICE, language: "en-US", payload: "Got it. Canceling."
        });
        await act(callId, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }

      // admin leg → connect or voicemail
      if (isAdminLeg) {
        const inboundId = clientState?.inbound_id;
        if (!inboundId) {
          console.warn("Missing inbound_id in client_state for admin leg.");
          await act(callId, "speak", { voice: VOICE, language: "en-US", payload: "Unable to connect." });
          return { statusCode: 200, body: "OK" };
        }

        if (digit === "1") {
          await safeStop(callId);
          await safeStop(inboundId);
          const r = await act(callId, "bridge", { call_control_id: inboundId });
          if (!r.ok) {
            console.error("Admin bridge failed", { status: r.status, json: r.json });
            await act(callId, "speak", { voice: VOICE, language: "en-US",
              payload: r.status === 422 ? "The caller has disconnected." : "Unable to connect." });
          }
          return { statusCode: 200, body: "OK" };
        }

        await act(callId, "speak", { voice: VOICE, language: "en-US", payload: "Sending to voicemail." });
        await startVoicemailOn(inboundId);
        await act(callId, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }
    }

    // ===== client disclosure finished → now bridge =====
    if (eventType === "call.speak.ended" && looksLikeClientLeg) {
      const agentLegId = sessionAny?.telnyx_call_id || clientState?.agent_id;
      if (agentLegId) {
        await safeStop(agentLegId);
        await safeStop(callId);
        const r = await act(agentLegId, "bridge", { call_control_id: callId });
        if (!r.ok) console.error("Bridge after disclosure failed", { status: r.status, json: r.json });
      }
      return { statusCode: 200, body: "OK" };
    }

    if (eventType === "call.hangup") {
      console.log("HANGUP", {
        callId,
        isInboundToBiz,
        isAdminLeg,
        isAgentLeg,
        isClientLeg: looksLikeClientLeg
      });
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
