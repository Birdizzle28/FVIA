import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:fvinsuranceagency@gmail.com";

function must(v, name) {
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function titleCaseStatus(s) {
  return String(s || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildSub(row) {
  if (!row?.endpoint || !row?.p256dh || !row?.auth) return null;
  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth
    }
  };
}

export const handler = async () => {
  try {
    must(SB_URL, "SUPABASE_URL");
    must(SB_SERVICE, "SUPABASE_SERVICE_ROLE_KEY");
    must(VAPID_PUBLIC_KEY, "VAPID_PUBLIC_KEY");
    must(VAPID_PRIVATE_KEY, "VAPID_PRIVATE_KEY");

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const sb = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

    // 1) pull unsent queue rows
    const { data: queueRows, error: qErr } = await sb
      .from("policy_status_push_queue")
      .select("id, policy_id, agent_id, old_status, new_status, event_ts")
      .eq("push_sent", false)
      .order("created_at", { ascending: true })
      .limit(200);

    if (qErr) throw qErr;

    if (!queueRows?.length) {
      return { statusCode: 200, body: JSON.stringify({ message: "No queued pushes." }) };
    }

    // 2) load policy + contact details
    const policyIds = [...new Set(queueRows.map((r) => r.policy_id).filter(Boolean))];

    const { data: policies, error: pErr } = await sb
      .from("policies")
      .select("id, policy_number, carrier_name, contact_id")
      .in("id", policyIds);

    if (pErr) throw pErr;

    const contactIds = [...new Set((policies || []).map((p) => p.contact_id).filter(Boolean))];

    const { data: contacts, error: cErr } = await sb
      .from("contacts")
      .select("id, full_name, first_name, last_name")
      .in("id", contactIds);

    if (cErr) throw cErr;

    const policyMap = {};
    (policies || []).forEach((p) => (policyMap[p.id] = p));

    const contactMap = {};
    (contacts || []).forEach((c) => {
      const nm =
        c.full_name?.trim() ||
        [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ||
        "Client";
      contactMap[c.id] = nm;
    });

    // 3) group events by agent
    const byAgent = new Map();
    for (const r of queueRows) {
      if (!r.agent_id) continue;
      if (!byAgent.has(r.agent_id)) byAgent.set(r.agent_id, []);
      byAgent.get(r.agent_id).push(r);
    }

    const agentIds = [...byAgent.keys()];
    if (!agentIds.length) {
      return { statusCode: 200, body: JSON.stringify({ message: "No agent_id on queued rows." }) };
    }

    // 4) load push subscriptions (your schema)
    const { data: subsRows, error: sErr } = await sb
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", agentIds);

    if (sErr) throw sErr;

    const subsMap = new Map(); // agentId -> [{id, sub}]
    (subsRows || []).forEach((r) => {
      const sub = buildSub(r);
      if (!sub) return;
      if (!subsMap.has(r.user_id)) subsMap.set(r.user_id, []);
      subsMap.get(r.user_id).push({ id: r.id, sub });
    });

    const sentQueueIds = [];
    const deadSubIds = [];

    // 5) send pushes
    for (const [agentId, events] of byAgent.entries()) {
      const agentSubs = subsMap.get(agentId) || [];
      if (!agentSubs.length) continue;

      const newest = events[events.length - 1];
      const pol = policyMap[newest.policy_id] || {};
      const clientName = contactMap[pol.contact_id] || "Client";
      const carrier = pol.carrier_name || "Carrier";
      const polNum = pol.policy_number || "Policy";
      const newStatus = titleCaseStatus(newest.new_status);

      const title = `Policy ${newStatus}`;
      const body =
        events.length === 1
          ? `${clientName} • ${carrier} • ${polNum}`
          : `${events.length} policies updated • Latest: ${clientName} • ${carrier} • ${polNum}`;

      const payload = JSON.stringify({
        title,
        body,
        tag: `policy-status-${agentId}`,
        data: {
          url: "/admin-commissions.html" // ✅ change to agent-facing policy page if you have one
        }
      });

      for (const row of agentSubs) {
        try {
          await webpush.sendNotification(row.sub, payload);
        } catch (e) {
          const code = e?.statusCode || e?.status || null;

          // If subscription is gone, delete it
          if (code === 404 || code === 410) {
            deadSubIds.push(row.id);
          } else {
            console.warn("Push send failed:", e?.message || e);
          }
        }
      }

      events.forEach((ev) => sentQueueIds.push(ev.id));
    }

    // 6) mark queue rows sent
    if (sentQueueIds.length) {
      await sb
        .from("policy_status_push_queue")
        .update({ push_sent: true, push_sent_at: new Date().toISOString() })
        .in("id", sentQueueIds);
    }

    // 7) cleanup dead subscriptions
    if (deadSubIds.length) {
      await sb.from("push_subscriptions").delete().in("id", deadSubIds);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        queued: queueRows.length,
        marked_sent: sentQueueIds.length,
        deleted_dead_subscriptions: deadSubIds.length
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
};
