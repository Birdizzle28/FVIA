// netlify/functions/downloadCommissionManual.js
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || '';
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function requireAuthedUser(event) {
  const token = getBearerToken(event);
  if (!token) return { ok: false, statusCode: 401, body: 'Missing Authorization Bearer token' };

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, statusCode: 401, body: 'Invalid/expired session token' };
  }
  return { ok: true, user: data.user };
}

/* ------------------------ ASSET LOADERS ------------------------ */

function tryLoadLogoBuffer() {
  const candidates = [
    path.join(process.cwd(), 'assets', 'logo.png'),
    path.join(process.cwd(), 'Pics', 'img17.png'),
    path.join(process.cwd(), 'images', 'logo.png'),
    path.join(process.cwd(), 'logo.png'),
  ];

  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p); } catch {}
  }
  return null;
}

function tryLoadBackgroundBuffer() {
  // Put your background here (recommended):
  // assets/commission-bg.jpg (or png)
  const candidates = [
    path.join(process.cwd(), 'assets', 'commission-bg.jpg'),
    path.join(process.cwd(), 'assets', 'commission-bg.png'),
    path.join(process.cwd(), 'assets', 'background.jpg'),
    path.join(process.cwd(), 'assets', 'background.png'),
    path.join(process.cwd(), 'Pics', 'commission-bg.jpg'),
    path.join(process.cwd(), 'Pics', 'commission-bg.png'),
  ];

  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p); } catch {}
  }
  return null;
}

/* ------------------------ TEXT SANITIZER ------------------------ */
/**
 * PDFKit's built-in fonts are not full-Unicode.
 * Smart punctuation / arrows / special bullets can get rendered as weird junk like "!'" etc.
 * We normalize them here to safe ASCII-ish equivalents.
 */
function cleanText(input) {
  if (input == null) return '';
  let s = String(input);

  // normalize common smart punctuation
  s = s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // smart single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // smart double quotes
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-') // hyphens/em-dash
    .replace(/\u2026/g, '...')                    // ellipsis
    .replace(/\u2022/g, '•')                      // bullet (we keep this; safe usually)
    .replace(/\u2192/g, '->')                     // →
    .replace(/\u2190/g, '<-')                     // ←
    .replace(/\u00A0/g, ' ')                      // non-breaking space
    .replace(/[\u200B-\u200D\uFEFF]/g, '');       // zero-width chars

  // strip any remaining control chars except newline/tab
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

  return s;
}

/* ------------------------ PDF HELPERS ------------------------ */

function drawFullPageBackground(doc, bgBuffer) {
  if (!bgBuffer) return;
  try {
    doc.save();
    // Draw behind everything; no opacity so it matches your image fully
    doc.image(bgBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });
    doc.restore();
  } catch {
    // If image fails to render, silently continue (PDF still generates)
  }
}

function drawHeader(doc, logo, meRow) {
  // Keep header content consistent on every page
  const left = doc.page.margins.left;

  // Reserve some space for header
  const topY = 32;

  if (logo) {
    try {
      doc.image(logo, left, topY, { width: 60, height: 60 });
    } catch {}
  }

  doc.fillColor('#111111');
  doc.fontSize(18).text(cleanText('Family Values Group'), left + 75, topY + 5);
  doc.fontSize(12).text(cleanText('Commission Manual'), left + 75, topY + 27);

  doc.fontSize(9.5).fillColor('#555555')
    .text(
      cleanText(`Generated for: ${meRow?.full_name || 'Agent'}   •   Date: ${new Date().toLocaleDateString()}`),
      left + 75,
      topY + 45
    );

  doc.fillColor('#000000');

  // Put cursor beneath header area
  doc.y = topY + 80;
}

function drawFooter(doc) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const bottomY = doc.page.height - 28;

  doc.save();
  doc.fontSize(9).fillColor('#777777');
  doc.text(cleanText(`© ${new Date().getFullYear()} Family Values Group — Internal Use`), left, bottomY, {
    width: right - left,
    align: 'center'
  });
  doc.text(cleanText(`Page ${doc.page.number}`), left, bottomY, {
    width: right - left,
    align: 'right'
  });
  doc.restore();
}

function addTitle(doc, text) {
  doc.fontSize(20).fillColor('#111111').text(cleanText(text), { align: 'left' });
  doc.moveDown(0.4);
}

function addH1(doc, text) {
  doc.moveDown(0.6);
  doc.fontSize(16).fillColor('#111111').text(cleanText(text), { underline: false });
  doc.moveDown(0.2);
}

function addH2(doc, text) {
  doc.moveDown(0.4);
  doc.fontSize(13).fillColor('#111111').text(cleanText(text));
  doc.moveDown(0.15);
}

function addBody(doc, text) {
  doc.fontSize(10.5).fillColor('#111111').text(cleanText(text), { lineGap: 3 });
  doc.moveDown(0.35);
}

function addBullet(doc, items) {
  doc.fontSize(10.5).fillColor('#111111');
  items.forEach(t => {
    doc.text(cleanText(`• ${t}`), { indent: 14, lineGap: 2 });
  });
  doc.moveDown(0.35);
}

/**
 * FIX #1: Banner auto-resizes height so text NEVER clips.
 * Also checks if there's enough space on the page before drawing it.
 */
function addRedBanner(doc, text) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const padX = 10;
  const padY = 10;

  const content = cleanText(text);
  const textWidth = w - (padX * 2);

  // Measure required text height
  doc.save();
  doc.fontSize(11);
  const textH = doc.heightOfString(content, { width: textWidth, lineGap: 2 });
  doc.restore();

  const h = Math.ceil(textH + (padY * 2)); // dynamic height

  // If not enough space remaining, start a new page first
  const remaining = doc.page.height - doc.y - doc.page.margins.bottom;
  if (remaining < h + 10) doc.addPage();

  const y = doc.y;

  doc.save();
  doc.rect(x, y, w, h).fill('#b00020');
  doc.fillColor('#ffffff').fontSize(11).text(content, x + padX, y + padY, {
    width: textWidth,
    lineGap: 2
  });
  doc.restore();

  doc.fillColor('#111111');
  doc.y = y + h + 12; // move cursor below banner
}

function addDivider(doc) {
  doc.moveDown(0.4);
  doc.save();
  doc.moveTo(doc.page.margins.left, doc.y)
     .lineTo(doc.page.width - doc.page.margins.right, doc.y)
     .strokeColor('#cccccc')
     .stroke();
  doc.restore();
  doc.moveDown(0.6);
}

/**
 * FIX #2: Start each section on its own page.
 */
function startNewSectionPage(doc) {
  // Put footer on the previous page before creating the new one
  drawFooter(doc);
  doc.addPage();
}

/* ------------------------ HANDLER ------------------------ */

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Use GET' };
  }

  const authed = await requireAuthedUser(event);
  if (!authed.ok) return { statusCode: authed.statusCode, body: authed.body };

  const userId = authed.user.id;
  const { data: meRow } = await supabase
    .from('agents')
    .select('id, full_name, is_active, is_admin')
    .eq('id', userId)
    .maybeSingle();

  if (meRow?.is_active === false) {
    return { statusCode: 403, body: 'Account inactive. Contact admin.' };
  }

  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 50,
    info: {
      Title: 'Family Values Group — Commission Manual',
      Author: 'Family Values Group',
    }
  });

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const logo = tryLoadLogoBuffer();
  const bg   = tryLoadBackgroundBuffer();

  // Draw background + header on FIRST page
  drawFullPageBackground(doc, bg);
  drawHeader(doc, logo, meRow);

  // Draw background + header on EVERY new page
  doc.on('pageAdded', () => {
    drawFullPageBackground(doc, bg);
    drawHeader(doc, logo, meRow);
  });

  /* ------------------------ PAGE 1: Intro + TOC ------------------------ */

  addTitle(doc, 'Commission Manual');

  addRedBanner(
    doc,
    'IMPORTANT PAYMENT DISCLOSURE (READ FIRST):\n' +
    'Family Values Group DOES NOT accept debit/credit cards, cash, or any direct money payments collected by an agent. ' +
    'If a client attempts to pay using any of these methods, the agent will NOT be paid commission on that sale. ' +
    'The correct process is to inform the client that Family Values Group does not accept those methods, and then provide the insurance carrier’s official payment phone number so the client can pay the carrier directly.'
  );

  addDivider(doc);

  addH1(doc, 'Table of Contents');
  addBody(doc,
    '1. How commissions are calculated (AP, commission rates, advances, pay-thru, renewals)\n' +
    '2. How to read your Commission Schedules\n' +
    '3. Pay timing and payout types (Advance, Pay-Thru, Renewals, Overrides)\n' +
    '4. Override examples (different levels)\n' +
    '5. Level promotions (Agent -> MIT -> Manager -> MGA -> Area Manager)\n' +
    '6. Tax & identity verification (SSN/W-9/1099) + security'
  );

  /* ------------------------ PAGE 2: Section 1 ------------------------ */
  startNewSectionPage(doc);

  addH1(doc, '1) How commissions are calculated');
  addBody(doc,
    'Your commission amounts are driven by Annual Premium (AP) and the carrier-specific commission schedule for the product you wrote. ' +
    'In simple terms, we take the policy premium and convert it into AP, then apply the schedule percentages.'
  );

  addH2(doc, 'Key Definitions');
  addBullet(doc, [
    'Annual Premium (AP): the annualized premium used for commission calculations.',
    'Commission Rate: the percentage from your commission schedule (varies by carrier/product/type).',
    'Advance: a portion of your expected first-year commission paid upfront (weekly).',
    'Pay-Thru / Trails / Renewals: the remainder paid over time as the carrier pays commissions (usually monthly).',
    'Overrides: commission you earn from the production of agents in your downline (based on your level).',
  ]);

  addH2(doc, 'Basic math (example)');
  addBody(doc,
    'Example policy:\n' +
    '• Monthly premium = $80\n' +
    '• AP = $80 x 12 = $960\n' +
    '• Schedule rate = 90% (0.90)\n' +
    '• Total commission (first year) = $960 x 0.90 = $864\n' +
    'If the schedule advances 75%, then:\n' +
    '• Advance = $864 x 0.75 = $648\n' +
    '• Pay-Thru remainder = $864 - $648 = $216 (paid out over time depending on carrier rules)'
  );

  /* ------------------------ PAGE 3: Section 2 ------------------------ */
  startNewSectionPage(doc);

  addH1(doc, '2) How to read your Commission Schedules');
  addBody(doc,
    'Your Commission Schedules are the source of truth for your commission percentages. ' +
    'Schedules can vary by Carrier, Product Line, and Policy Type. Your payout is calculated using the schedule that matches the policy you wrote.'
  );

  addBullet(doc, [
    'Carrier: the insurance company (example: TransAmerica).',
    'Product Line: broad category (example: Term, Whole Life, Final Expense).',
    'Policy Type: a more specific sub-type used in schedules (varies by carrier).',
    'Rates: the % used to calculate total commissions, plus rules for advance vs pay-thru.',
  ]);

  /* ------------------------ PAGE 4: Section 3 ------------------------ */
  startNewSectionPage(doc);

  addH1(doc, '3) When you get paid (Advance, Pay-Thru, Renewals, Overrides)');
  addH2(doc, 'Advances (Weekly)');
  addBody(doc,
    'Advances are paid on a weekly cycle. Your system calculates eligible commission ledger items and produces a weekly payout batch. ' +
    'If you have outstanding debt (lead debt and/or chargebacks), your payout can be reduced based on repayment rules.'
  );

  addH2(doc, 'Pay-Thru / Trails / Renewals (Monthly)');
  addBody(doc,
    'Pay-Thru (often called trails or renewals depending on product) is processed on a monthly schedule. ' +
    'This is typically the remainder of commission not paid as an advance, plus ongoing renewal/trail payments when applicable.'
  );

  addH2(doc, 'Overrides (Weekly, tied to your downline)');
  addBody(doc,
    'Overrides are earnings generated when an agent in your downline writes business. ' +
    'Overrides are paid based on your level and the override rules in effect for your hierarchy.'
  );

  /* ------------------------ PAGE 5: Section 4 ------------------------ */
  startNewSectionPage(doc);

  addH1(doc, '4) Override example (different levels)');
  addBody(doc,
    'Overrides depend on level differences between you and the agent below you. Here is a simplified example.'
  );

  addBody(doc,
    'Example:\n' +
    '• Downline agent level payout = 80%\n' +
    '• Your level payout = 90%\n' +
    '• Override = (90% - 80%) = 10%\n' +
    'If the policy AP is $1,200:\n' +
    '• Override commission = $1,200 x 10% = $120'
  );

  addBody(doc,
    'Important: The exact override structure can vary by program. The platform uses your stored hierarchy + levels to compute overrides consistently.'
  );

  /* ------------------------ PAGE 6: Section 5 ------------------------ */
  startNewSectionPage(doc);

  addH1(doc, '5) Level promotions (how to move up)');
  addBody(doc,
    'Your level is based on consistent production and (for higher levels) active downline growth. ' +
    'The rules below are evaluated by production over time.'
  );

  addBullet(doc, [
    'Agent -> MIT (Manager in Training): $10,000 AP for 3 months in a row.',
    'MIT -> Manager: $30,000 AP for 3 months in a row AND at least 3 active agents in downline.',
    'Manager -> MGA (Managing General Agent): $50,000 AP for 3 months in a row AND 5 active agents.',
    'MGA -> Area Manager: $100,000 AP for 3 months in a row AND 15 active agents.',
  ]);

  /* ------------------------ PAGE 7: Section 6 ------------------------ */
  startNewSectionPage(doc);

  addH1(doc, '6) SSN, tax forms, and legal disclosures (W-9 / 1099 / security)');
  addBody(doc,
    'To get paid commissions, carriers and/or payment processors may require identity verification and tax reporting information. ' +
    'This commonly includes your Social Security Number (SSN) or Tax ID for W-9/1099 reporting.'
  );

  addH2(doc, 'Why SSN/W-9 may be required');
  addBullet(doc, [
    'Tax reporting: commissions are typically reported on a 1099-NEC for independent agents.',
    'Identity verification: payment processors may require SSN/TIN to verify the recipient.',
    'Compliance: carriers may require it to issue producer payments correctly.',
  ]);

  addH2(doc, 'Security & handling');
  addBullet(doc, [
    'Never text or email SSNs in plain text.',
    'Only submit SSN/TIN through secure official portals or verified encrypted channels.',
    'If you suspect fraud or incorrect payment instructions, contact the carrier directly.',
  ]);

  addBody(doc,
    'This manual is informational and operational guidance for agent payments within Family Values Group. ' +
    'It is not legal or tax advice. Consult a qualified professional for legal/tax questions.'
  );

  // Footer on final page
  drawFooter(doc);

  doc.end();

  const pdfBuffer = await new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="Family-Values-Group-Commission-Manual.pdf"',
      'Cache-Control': 'no-store'
    },
    body: pdfBuffer.toString('base64'),
    isBase64Encoded: true,
  };
}
