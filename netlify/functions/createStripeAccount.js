// netlify/functions/createStripeAccount.js
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // accept either npn or agent_id from caller, but we store/lookup by agent_id
  const agent_id = body.agent_id || body.npn;

  if (!agent_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'agent_id is required' }) };
  }

  try {
    // 1) Look up agent in waitlist by agent_id
    const { data: waitRow, error: waitErr } = await supabase
      .from('agent_waitlist')
      .select('id, email, stripe_account_id')
      .eq('agent_id', agent_id)
      .maybeSingle();

    if (waitErr) {
      console.error('agent_waitlist lookup error:', waitErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Waitlist lookup failed' }) };
    }

    if (!waitRow) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No agent_waitlist record found for that agent_id' }),
      };
    }

    if (!waitRow.email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'agent_waitlist record is missing an email' }),
      };
    }

    let stripeAccountId = waitRow.stripe_account_id;

    // 2) Create Stripe connected account only if we don't already have one saved
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'custom',
        country: 'US',
        business_type: 'individual',
        metadata: { agent_id },

        tos_acceptance: {
          service_agreement: 'full',
        },

        business_profile: {
          mcc: '6300',
          url: 'https://familyvaluesgroup.com',
          product_description:
            'This account is created for the purpose of recieving payment in the form of commissions and overrides from Family Values Group and nothing more.',
        },

        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });

      stripeAccountId = account.id;
    }

    // 3) Always create a fresh onboarding link
    const refreshUrl = 'https://familyvaluesgroup.com/agent/stripe-error';
    const returnUrl = 'https://familyvaluesgroup.com/agent/stripe-complete';

    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    const onboardingUrl = link.url;

    // 4) Save to agent_waitlist
    const { error: updateErr } = await supabase
      .from('agent_waitlist')
      .update({
        stripe_account_id: stripeAccountId,
        onboarding_url: onboardingUrl,
      })
      .eq('id', waitRow.id);

    if (updateErr) {
      console.error('agent_waitlist update error:', updateErr);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to update agent_waitlist' }) };
    }

    // 5) Email the onboarding link via Zoho
    const transporter = nodemailer.createTransport({
      host: 'smtp.zoho.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS,
      },
    });

    const fromEmail = process.env.ZOHO_FROM || process.env.ZOHO_USER;

    const subject = 'Finish your Stripe onboarding (Family Values Group)';
    const html = `
      <p>Hey! Your Stripe onboarding link is ready.</p>
      <p><a href="${onboardingUrl}">Click here to finish onboarding</a></p>
      <p>If the link expires, just request a new one and we’ll generate a fresh link automatically.</p>
    `;
    const text = `Your Stripe onboarding link: ${onboardingUrl}\n\nIf the link expires, request a new one and we’ll generate a fresh link automatically.`;

    await transporter.sendMail({
      from: fromEmail,
      to: waitRow.email,
      subject,
      html,
      text,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        agent_id,
        stripe_account_id: stripeAccountId,
        onboarding_url: onboardingUrl,
        emailed_to: waitRow.email,
      }),
    };
  } catch (err) {
    console.error('createStripeAccount fatal error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Stripe account creation / link / email failed',
        message: err?.message || String(err),
      }),
    };
  }
}
