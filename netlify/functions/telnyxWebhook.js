// netlify/functions/telnyxWebhook.js
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const TAPI = "https://api.telnyx.com/v2";
const headers = {
  Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
  "Content-Type": "application/json",
};
const VOICE = "Telnyx.KokoroTTS.af";

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

const act = async (id, action, body = {}) => {
  const r = await fetch(`${TAPI}/calls/${id}/actions/${action}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!r.ok) console.error("Telnyx action failed", { id, action, status: r.status, txt });
  else console.log("Telnyx action ok", { id, action, json: json ?? txt });
  return { ok: r.ok, status: r.status, json: json ?? txt };
};

async function startVoicemailOn(callId) {
  if (!callId) return;
  await act(callId, "speak", {
    voice: VOICE, language: "en-US",
    payload: "Please leave a message after the tone."
  });
  await act(callId, "record_start", {
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

// ---- helper: turn "cover=My Home,My Business" into human text
function humanizeCoverFromNotes(notes = "") {
  const m = String(notes).match(/cover=([^\s|]+)/i) || String(notes).match(/cover=([^|]+)/i);
  if (!m) return null;
  const raw = m[1].trim();
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

  const toPhrase = (s) => {
    if (s === 'Myself') return 'their life';
    if (s === 'Someone Else') return 'a loved one';
    if (s === 'My Car') return 'their car';
    if (s === 'My Home') return 'their home';
    if (s === 'My Business') return 'their business';
    if (s === 'My Health') return 'their health';
    if (s === 'Legal Protection Plan') return 'legal protection';
    if (s === 'My Identity') return 'identity protection';
    return s.toLowerCase();
  };
  return parts.map(toPhrase).join(' and ');
}

// ---------- main handler ----------
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

    // look up the call_session for either leg
    let { data: sessionAgent } = await supabase
      .from("call_sessions").select("*")
      .eq("telnyx_call_id", callId).maybeSingle();

    let { data: sessionClient } = await supabase
      .from("call_sessions").select("*")
      .eq("client_call_id", callId).maybeSingle();

    const isAgentLeg = !!sessionAgent;
    const isClientLeg = !!sessionClient;

    const isInboundToBiz =
      !!businessNum && toNum === businessNum && !isAgentLeg && !isClientLeg;

    const fromMatchesBizOrFrom =
      [toE164(process.env.TELNYX_FROM_NUMBER), businessNum]
        .filter(Boolean).includes(fromNum);
    const isToAdmin = adminList.includes(toNum);
    const isAdminLeg =
      fromMatchesBizOrFrom && isToAdmin && clientState?.kind === "admin";

    // recordings saved
    if (eventType === "call.recording.saved") {
      const rec = payload?.data?.payload;
      const url = rec?.recording_urls?.[0]?.url || rec?.recording_url;
      await supabase.from("voicemails").insert({
        call_id: rec?.call_control_id,
        from_number: toE164(rec?.from),
        to_number: toE164(rec?.to),
        recording_url: url
      });
      return { statusCode: 200, body: "OK" };
    }

    // inbound to business — unchanged
    if (eventType === "call.initiated" && isInboundToBiz) {
      await act(callId, "answer", {});
      await act(callId, "speak", {
        voice: VOICE, language: "en-US",
        payload: "Please hold while we connect you to a representative."
      });

      const fromForAdmins =
        toE164(process.env.TELNYX_FROM_NUMBER) || businessNum;

      let targets = adminList.filter(n => n !== fromNum);
      if (targets.length === 0) targets = adminList.slice();

      for (const adminNumber of targets) {
        const resp = await fetch(`${TAPI}/calls`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            connection_id: inboundConnId,
            to: adminNumber,
            from: fromForAdmins,
            client_state: encodeState({ kind: "admin", inbound_id: callId })
          }),
        });
        const j = await resp.json().catch(() => ({}));
        console.log("ADMIN LEG CREATE", {
          adminNumber, status: resp.status, id: j?.data?.id, err: j?.errors
        });
      }
      return { statusCode: 200, body: "OK" };
    }

    // bridge client leg — unchanged
    if (eventType === "call.answered" && isClientLeg) {
      // fix: actually bridge the two existing call legs
      if (sessionClient?.telnyx_call_id) {
        const r = await act(sessionClient.telnyx_call_id, "bridge", { call_control_id: callId });
        if (!r.ok) console.error("Bridge failed", { status: r.status, json: r.json });
      }
      return { statusCode: 200, body: "OK" };
    }

    // ====== agent answered → WHISPER UPGRADE ======
    if (eventType === "call.answered" && isAgentLeg) {
      let name = "Prospect", summary = "";
      let whisper = sessionAgent?.whisper || ""; // if makeCall saved it
      let wantsPhrase = null;

      if (sessionAgent?.lead_id) {
        const { data: lead } = await supabase
          .from("leads").select(
            "first_name,last_name,product_type,contact_id,zip,notes,contacts:contact_id(first_name,last_name)"
          )
          .eq("id", sessionAgent.lead_id).maybeSingle();

        const lf = lead?.first_name || lead?.contacts?.first_name || "";
        const ll = lead?.last_name || lead?.contacts?.last_name || "";
        name = `${lf} ${ll}`.trim() || name;

        // parse “cover=…” from notes if no explicit whisper was provided
        wantsPhrase = humanizeCoverFromNotes(lead?.notes || "") || wantsPhrase;

        if (lead?.product_type) summary += `Product: ${lead.product_type}. `;
        if (lead?.zip) summary += `ZIP ${lead.zip}. `;
      }

      const payload = whisper
        ? whisper
        : `New lead: ${name}${wantsPhrase ? `, wants to cover ${wantsPhrase}` : ""}. ${summary}Press 1 to connect now.`;

      await act(callId, "gather_using_speak", {
        voice: VOICE, language: "en-US",
        minimum_digits: 1, maximum_digits: 1, valid_digits: "1",
        inter_digit_timeout_ms: 6000,
        payload
      });
      return { statusCode: 200, body: "OK" };
    }

    // admin answered — unchanged
    if (eventType === "call.answered" && isAdminLeg) {
      await act(callId, "gather_using_speak", {
        voice: VOICE, language: "en-US",
        minimum_digits: 1, maximum_digits: 1, valid_digits: "1",
        inter_digit_timeout_ms: 6000,
        payload: "Administrative call. Press 1 to connect."
      });
      return { statusCode: 200, body: "OK" };
    }

    // DTMF — unchanged (bridging, voicemail, etc.)
    if (eventType === "call.dtmf.received" || eventType === "call.gather.ended") {
      const pay = payload?.data?.payload || {};
      const digit = eventType === "call.dtmf.received"
        ? pay.digit : (pay.digits || "")[0];

      if (isAgentLeg) {
        if (digit === "1" && sessionAgent.prospect_number) {
          const make = await fetch(`${TAPI}/calls`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              connection_id: process.env.TELNYX_CONNECTION_ID,
              to: sessionAgent.prospect_number,
              from: process.env.TELNYX_FROM_NUMBER,
            }),
          });
          const j = await make.json();
          if (!make.ok) {
            await act(callId, "speak", {
              voice: VOICE, language: "en-US",
              payload: "Unable to reach the client."
            });
            return { statusCode: make.status, body: JSON.stringify(j) };
          }
          const clientCallId = j?.data?.id;
          await supabase.from("call_sessions")
            .update({ client_call_id: clientCallId })
            .eq("id", sessionAgent.id);
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

      if (isAdminLeg) {
        const inboundId = clientState?.inbound_id;
        if (!inboundId) {
          console.warn("Missing inbound_id in client_state for admin leg.");
          await act(callId, "speak", {
            voice: VOICE, language: "en-US", payload: "Unable to connect."
          });
          return { statusCode: 200, body: "OK" };
        }

        if (digit === "1") {
          const r = await act(callId, "bridge", { call_control_id: inboundId });
          if (!r.ok) {
            console.error("Admin bridge failed", { status: r.status, json: r.json });
            if (r.status === 422) {
              await act(callId, "speak", { voice: VOICE, language: "en-US",
                payload: "The caller has disconnected." });
            } else {
              await act(callId, "speak", { voice: VOICE, language: "en-US",
                payload: "Unable to connect." });
            }
          }
          return { statusCode: 200, body: "OK" };
        }

        await act(callId, "speak", {
          voice: VOICE, language: "en-US", payload: "Sending to voicemail."
        });
        await startVoicemailOn(inboundId);
        await act(callId, "hangup", {});
        return { statusCode: 200, body: "OK" };
      }
    }

    if (eventType === "call.hangup") {
      console.log("HANGUP", { callId, isInboundToBiz, isAdminLeg, isAgentLeg, isClientLeg });
      return { statusCode: 200, body: "OK" };
    }

    return { statusCode: 200, body: "OK" };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
