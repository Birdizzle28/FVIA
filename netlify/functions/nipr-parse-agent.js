// netlify/functions/nipr-parse-agent.js
import { createClient } from "@supabase/supabase-js";
import { parseStringPromise } from "xml2js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { agent_id } = body; // NPN

    if (!agent_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing agent_id" }),
      };
    }

    // 1) Get the latest snapshot XML for this agent
    const { data: snapshot, error: snapError } = await supabase
      .from("agent_nipr_snapshots")
      .select("*")
      .eq("agent_id", agent_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (snapError || !snapshot) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: "No NIPR snapshot found for this agent_id",
          details: snapError?.message,
        }),
      };
    }

    const xml = snapshot.raw_xml;

    // 2) Parse XML into JS object
    const pdb = await parseStringPromise(xml, {
      explicitArray: true,
      ignoreAttrs: false,
      mergeAttrs: false,
      trim: true,
    });

    // The structure is roughly:
    // PDB -> PRODUCER[0] -> INDIVIDUAL[0]

    const individual =
      pdb?.PDB?.PRODUCER?.[0]?.INDIVIDUAL?.[0] || {};

    const bio =
      individual?.ENTITY_BIOGRAPHIC?.[0]?.BIOGRAPHIC?.[0] || {};

    // --- Agent profile data ---
    const firstName = bio.NAME_FIRST?.[0] || null;
    const lastName = bio.NAME_LAST?.[0] || null;
    const middleName = bio.NAME_MIDDLE?.[0] || null;
    const suffix = bio.NAME_SUFFIX?.[0] || null;
    const dob = bio.DATE_BIRTH?.[0] || null;

    // Get one business email/phone if present
    let businessEmail = null;
    let businessPhone = null;

    const contactInfos =
      individual?.ENTITY_BIOGRAPHIC?.[0]?.CONTACT_INFOS?.[0]?.STATE || [];

    for (const stateBlock of contactInfos) {
      const ci = stateBlock.CONTACT_INFO?.[0];
      if (!ci) continue;

      if (!businessPhone && ci.BUSINESS_PHONE?.[0]) {
        businessPhone = ci.BUSINESS_PHONE[0];
      }
      if (!businessEmail && ci.BUSINESS_EMAIL?.[0]) {
        businessEmail = ci.BUSINESS_EMAIL[0];
      }
    }

    // 3) Upsert into agent_nipr_profile
    const { error: profileError } = await supabase
      .from("agent_nipr_profile")
      .upsert(
        {
          agent_id,
          first_name: firstName,
          last_name: lastName,
          middle_name: middleName,
          suffix,
          date_of_birth: dob,
          business_email: businessEmail,
          business_phone: businessPhone,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "agent_id" }
      );

    if (profileError) {
      console.error("Profile upsert error:", profileError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to upsert agent profile",
          details: profileError.message,
        }),
      };
    }

    // --- Licenses ---
    const licInfo =
      individual?.PRODUCER_LICENSING?.[0]?.LICENSE_INFORMATION?.[0]?.STATE ||
      [];

    // Clear old licenses for this agent
    await supabase
      .from("agent_nipr_licenses")
      .delete()
      .eq("agent_id", agent_id);

    const licenseRows = [];

    for (const stateBlock of licInfo) {
      const stateName = stateBlock.$?.name || null;
      const license = stateBlock.LICENSE?.[0];
      if (!license) continue;

      const details = license.DETAILS?.[0]?.DETAIL || [];

      const row = {
        agent_id,
        state: stateName,
        license_number: license.LICENSE_NUM?.[0] || null,
        license_class: license.LICENSE_CLASS?.[0] || null,
        residency_status: license.RESIDENCY_STATUS?.[0] || null,
        active: (license.ACTIVE?.[0] || "").toLowerCase() === "yes",
        date_issue_orig: license.DATE_ISSUE_LICENSE_ORIG?.[0] || null,
        date_expire: license.DATE_EXPIRE_LICENSE?.[0] || null,
        ce_compliance: license.CE_COMPLIANCE?.[0] || null,
      };

      licenseRows.push(row);
    }

    if (licenseRows.length > 0) {
      const { error: licInsertError } = await supabase
        .from("agent_nipr_licenses")
        .insert(licenseRows);

      if (licInsertError) {
        console.error("Licenses insert error:", licInsertError);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: "Failed to insert licenses",
            details: licInsertError.message,
          }),
        };
      }
    }

    // --- Appointments ---
    const appointmentBlocks =
      individual?.PRODUCER_LICENSING?.[0]?.LICENSE_INFORMATION?.[0]
        ?.STATE || [];

    // Clear old appointments
    await supabase
      .from("agent_nipr_appointments")
      .delete()
      .eq("agent_id", agent_id);

    const appointmentRows = [];

    for (const stateBlock of appointmentBlocks) {
      const stateName = stateBlock.$?.name || null;
      const apptInfo = stateBlock.APPOINTMENT_INFORMATION?.[0];
      if (!apptInfo) continue;

      const appointments = apptInfo.APPOINTMENT || [];
      for (const appt of appointments) {
        appointmentRows.push({
          agent_id,
          state: stateName,
          company_name: appt.COMPANY_NAME?.[0] || null,
          fein: appt.FEIN?.[0] || null,
          cocode: appt.COCODE?.[0] || null,
          line_of_authority: appt.LINE_OF_AUTHORITY?.[0] || null,
          loa_code: appt.LOA_CODE?.[0] || null,
          status: appt.STATUS?.[0] || null,
          termination_reason: appt.TERMINATION_REASON?.[0] || null,
          status_reason_date: appt.STATUS_REASON_DATE?.[0] || null,
          appointment_renewal_date: appt.APPONT_RENEWAL_DATE?.[0] || null,
        });
      }
    }

    if (appointmentRows.length > 0) {
      const { error: apptInsertError } = await supabase
        .from("agent_nipr_appointments")
        .insert(appointmentRows);

      if (apptInsertError) {
        console.error("Appointments insert error:", apptInsertError);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: "Failed to insert appointments",
            details: apptInsertError.message,
          }),
        };
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Parsed NIPR data successfully",
        agent_id,
        licenses_count: licenseRows.length,
        appointments_count: appointmentRows.length,
      }),
    };
  } catch (err) {
    console.error("Parse function error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        details: err.message,
      }),
    };
  }
}
