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

function cleanText(input) {
  if (input == null) return '';
  let s = String(input);

  s = s
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u2022/g, '•')
    .replace(/\u2192/g, ' to ')
    .replace(/\u2190/g, ' to ')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return s;
}

/* ------------------------ DESIGN TOKENS ------------------------ */

const C = {
  brand: '#353468',
  brandDark: '#25234c',
  brandDeep: '#1b1938',
  lavender: '#efe9ff',
  lavender2: '#f7f3ff',
  pinkSoft: '#fdeef3',
  pinkBorder: '#efc7d4',
  gold: '#d7b56d',
  ink: '#1f1d37',
  muted: '#6f6a89',
  line: '#ddd7ef',
  white: '#ffffff',
  danger: '#a71d3f',
  dangerSoft: '#fff0f4',
  successSoft: '#eef8f4',
  success: '#2a8f6d',
  footer: '#7b7694'
};

/* ------------------------ PDF HELPERS ------------------------ */

function drawFullPageBackground(doc, bgBuffer) {
  if (bgBuffer) {
    try {
      doc.save();
      doc.image(bgBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });
      doc.fillOpacity(0.82).rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
      doc.restore();
    } catch {}
  } else {
    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#faf8ff');
    doc.restore();
  }

  // decorative top and bottom wash
  doc.save();
  doc.fillOpacity(1);
  doc.rect(0, 0, doc.page.width, 22).fill(C.brand);
  doc.rect(0, doc.page.height - 16, doc.page.width, 16).fill(C.brandDark);
  doc.restore();
}

function drawFooter(doc) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.page.height - 30;

  doc.save();
  doc.font('Helvetica').fontSize(8.5).fillColor(C.footer);
  doc.text(cleanText(`© ${new Date().getFullYear()} Family Values Group — Internal Use`), left, y, {
    width: right - left,
    align: 'left'
  });
  doc.text(cleanText(`Page ${doc.page.number}`), left, y, {
    width: right - left,
    align: 'right'
  });
  doc.restore();
}

function drawHeader(doc, logo, meRow, { cover = false } = {}) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const topY = cover ? 42 : 34;

  if (logo) {
    try {
      doc.image(logo, left, topY, { fit: [64, 64], align: 'left', valign: 'top' });
    } catch {}
  }

  const titleX = left + (logo ? 80 : 0);

  doc.font('Helvetica-Bold')
    .fontSize(cover ? 24 : 17)
    .fillColor(C.brandDark)
    .text(cleanText('Family Values Group'), titleX, topY + 2, { width: right - titleX });

  doc.font('Helvetica')
    .fontSize(cover ? 13 : 11)
    .fillColor(C.muted)
    .text(cleanText('Commission Manual'), titleX, topY + (cover ? 31 : 24), { width: right - titleX });

  doc.font('Helvetica')
    .fontSize(9.5)
    .fillColor(C.footer)
    .text(
      cleanText(`Generated for: ${meRow?.full_name || 'Agent'}  •  ${new Date().toLocaleDateString()}`),
      titleX,
      topY + (cover ? 52 : 42),
      { width: right - titleX }
    );

  doc.y = topY + (cover ? 94 : 78);
}

function drawRoundedCard(doc, x, y, w, h, fill = C.white, stroke = C.line, radius = 16) {
  doc.save();
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
  doc.restore();
}

function drawSectionBanner(doc, title, subtitle = '') {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  ensureSpace(doc, 90);

  doc.save();
  doc.roundedRect(x, doc.y, w, 48, 14).fill(C.brand);
  doc.roundedRect(x + 12, doc.y + 10, 10, 28, 5).fill(C.gold);
  doc.restore();

  doc.font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(C.white)
    .text(cleanText(title), x + 32, doc.y + 9, { width: w - 44 });

  if (subtitle) {
    doc.font('Helvetica')
      .fontSize(9.6)
      .fillColor('#e7e4ff')
      .text(cleanText(subtitle), x + 32, doc.y + 28, { width: w - 44 });
  }

  doc.y += 62;
  doc.fillColor(C.ink);
}

function drawMiniHeader(doc, text) {
  ensureSpace(doc, 40);
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.save();
  doc.roundedRect(x, doc.y, Math.min(w, 260), 24, 10).fill(C.lavender);
  doc.restore();

  doc.font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.brandDark)
    .text(cleanText(text), x + 12, doc.y + 6, { width: 240 });

  doc.y += 32;
  doc.fillColor(C.ink);
}

function addTitle(doc, text) {
  doc.font('Helvetica-Bold')
    .fontSize(28)
    .fillColor(C.brandDark)
    .text(cleanText(text), { align: 'left' });
  doc.moveDown(0.2);
}

function addSubTitle(doc, text) {
  doc.font('Helvetica')
    .fontSize(11.4)
    .fillColor(C.muted)
    .text(cleanText(text), { lineGap: 4 });
  doc.moveDown(0.7);
}

function addBody(doc, text, opts = {}) {
  doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.size || 10.7)
    .fillColor(opts.color || C.ink)
    .text(cleanText(text), {
      lineGap: opts.lineGap ?? 4,
      width: opts.width || (doc.page.width - doc.page.margins.left - doc.page.margins.right - 4)
    });
  doc.moveDown(opts.after ?? 0.42);
}

function addBullets(doc, items, {
  box = false,
  fill = C.lavender2,
  stroke = C.line
} = {}) {
  ensureSpace(doc, 80);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  let startY = doc.y;

  if (box) {
    // measure box height first
    let measure = 18;
    items.forEach(item => {
      measure += doc.heightOfString(cleanText(item), {
        width: w - 42,
        lineGap: 3
      }) + 8;
    });
    drawRoundedCard(doc, x, startY, w, measure, fill, stroke, 14);
    doc.y = startY + 14;
  }

  items.forEach(item => {
    ensureSpace(doc, 26);

    const bulletX = x + (box ? 14 : 4);
    const textX = bulletX + 18;
    const y = doc.y;

    doc.save();
    doc.circle(bulletX + 5, y + 8, 4).fill(C.brand);
    doc.restore();

    doc.font('Helvetica')
      .fontSize(10.5)
      .fillColor(C.ink)
      .text(cleanText(item), textX, y, {
        width: w - (textX - x) - (box ? 14 : 0),
        lineGap: 3
      });

    doc.y += 4;
  });

  doc.moveDown(0.35);
}

function addWarningBox(doc, text) {
  ensureSpace(doc, 120);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pad = 16;

  doc.font('Helvetica-Bold').fontSize(12);
  const title = 'Important Payment Disclosure';
  const titleH = doc.heightOfString(title, { width: w - 48 });

  doc.font('Helvetica').fontSize(10.4);
  const textH = doc.heightOfString(cleanText(text), { width: w - 48, lineGap: 3 });

  const h = pad + titleH + 10 + textH + pad;

  doc.save();
  doc.roundedRect(x, doc.y, w, h, 16).fillAndStroke(C.dangerSoft, C.pinkBorder);
  doc.roundedRect(x, doc.y, 12, h, 16).fill(C.danger);
  doc.restore();

  // icon-ish badge
  doc.save();
  doc.circle(x + 32, doc.y + 28, 12).fill(C.danger);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text('!', x + 28.5, doc.y + 18.5);
  doc.restore();

  doc.font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.danger)
    .text(title, x + 54, doc.y + pad, { width: w - 66 });

  doc.font('Helvetica')
    .fontSize(10.4)
    .fillColor(C.ink)
    .text(cleanText(text), x + 20, doc.y + pad + titleH + 10, {
      width: w - 40,
      lineGap: 3
    });

  doc.y += h + 14;
}

function addInfoBox(doc, title, lines = [], opts = {}) {
  ensureSpace(doc, 90);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pad = 14;
  const fill = opts.fill || C.lavender2;
  const stroke = opts.stroke || C.line;
  const titleColor = opts.titleColor || C.brandDark;

  doc.font('Helvetica-Bold').fontSize(11.5);
  const titleH = doc.heightOfString(cleanText(title), { width: w - pad * 2 });

  doc.font('Helvetica').fontSize(10.4);
  let bodyH = 0;
  lines.forEach(line => {
    bodyH += doc.heightOfString(cleanText(line), { width: w - pad * 2, lineGap: 3 }) + 5;
  });

  const h = pad + titleH + 10 + bodyH + pad;

  drawRoundedCard(doc, x, doc.y, w, h, fill, stroke, 16);

  let y = doc.y + pad;

  doc.font('Helvetica-Bold')
    .fontSize(11.5)
    .fillColor(titleColor)
    .text(cleanText(title), x + pad, y, { width: w - pad * 2 });

  y += titleH + 10;

  doc.font('Helvetica')
    .fontSize(10.4)
    .fillColor(C.ink);

  lines.forEach(line => {
    doc.text(cleanText(line), x + pad, y, { width: w - pad * 2, lineGap: 3 });
    y += doc.heightOfString(cleanText(line), { width: w - pad * 2, lineGap: 3 }) + 5;
  });

  doc.y += h + 12;
}

function addTwoColExampleBox(doc, leftTitle, leftText, rightTitle, rightText) {
  ensureSpace(doc, 120);

  const x = doc.page.margins.left;
  const fullW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const gap = 12;
  const colW = (fullW - gap) / 2;
  const y = doc.y;

  const pad = 12;

  doc.font('Helvetica-Bold').fontSize(11);
  const lTitleH = doc.heightOfString(cleanText(leftTitle), { width: colW - pad * 2 });
  const rTitleH = doc.heightOfString(cleanText(rightTitle), { width: colW - pad * 2 });

  doc.font('Helvetica').fontSize(10.2);
  const lBodyH = doc.heightOfString(cleanText(leftText), { width: colW - pad * 2, lineGap: 3 });
  const rBodyH = doc.heightOfString(cleanText(rightText), { width: colW - pad * 2, lineGap: 3 });

  const h = Math.max(lTitleH + lBodyH, rTitleH + rBodyH) + pad * 2 + 10;

  drawRoundedCard(doc, x, y, colW, h, '#ffffff', C.line, 14);
  drawRoundedCard(doc, x + colW + gap, y, colW, h, '#ffffff', C.line, 14);

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.brandDark)
    .text(cleanText(leftTitle), x + pad, y + pad, { width: colW - pad * 2 });
  doc.font('Helvetica').fontSize(10.2).fillColor(C.ink)
    .text(cleanText(leftText), x + pad, y + pad + lTitleH + 8, { width: colW - pad * 2, lineGap: 3 });

  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.brandDark)
    .text(cleanText(rightTitle), x + colW + gap + pad, y + pad, { width: colW - pad * 2 });
  doc.font('Helvetica').fontSize(10.2).fillColor(C.ink)
    .text(cleanText(rightText), x + colW + gap + pad, y + pad + rTitleH + 8, { width: colW - pad * 2, lineGap: 3 });

  doc.y += h + 14;
}

function addDivider(doc) {
  doc.moveDown(0.15);
  doc.save();
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(C.line)
    .lineWidth(1)
    .stroke();
  doc.restore();
  doc.moveDown(0.65);
}

function ensureSpace(doc, needed = 80) {
  const remaining = doc.page.height - doc.y - doc.page.margins.bottom - 22;
  if (remaining < needed) doc.addPage();
}

function startSectionPage(doc, title, subtitle = '') {
  doc.addPage();

  const cardX = doc.page.margins.left - 4;
  const cardY = doc.y + 4;
  const cardW = doc.page.width - doc.page.margins.left - doc.page.margins.right + 8;
  const cardH = doc.page.height - cardY - doc.page.margins.bottom - 24;

  drawRoundedCard(doc, cardX, cardY, cardW, cardH, C.white, C.line, 20);
  doc.y = cardY + 18;

  drawSectionBanner(doc, title, subtitle);
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
    margin: 54,
    info: {
      Title: 'Family Values Group — Commission Manual',
      Author: 'Family Values Group',
    }
  });

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const logo = tryLoadLogoBuffer();
  const bg   = tryLoadBackgroundBuffer();

  drawFullPageBackground(doc, bg);
  drawHeader(doc, logo, meRow, { cover: true });

  doc.on('pageAdded', () => {
    drawFullPageBackground(doc, bg);
    drawHeader(doc, logo, meRow, { cover: false });
  });

  /* ------------------------ COVER PAGE ------------------------ */

  {
    const x = doc.page.margins.left - 2;
    const y = doc.y + 8;
    const w = doc.page.width - doc.page.margins.left - doc.page.margins.right + 4;
    const h = 610;
    drawRoundedCard(doc, x, y, w, h, 'rgba(255,255,255,0.95)', C.line, 22);
    doc.y = y + 24;

    addTitle(doc, 'Commission Manual');
    addSubTitle(
      doc,
      'A clearer guide to how Family Values Group handles commissions, advances, pay-thru, overrides, promotions, and payment-related compliance.'
    );

    addWarningBox(
      doc,
      'Family Values Group does not accept debit cards, credit cards, cash, or direct money payments collected by an agent. If a client tries to pay using one of those methods, the agent will not be paid commission on that sale. The correct process is to tell the client that Family Values Group does not accept those payment methods and then provide the insurance carrier’s official payment phone number so the client can pay the carrier directly.'
    );

    addDivider(doc);

    addInfoBox(doc, 'Inside this manual', [
      '1. How commissions are calculated',
      '2. How to read your commission schedules',
      '3. When and how you get paid',
      '4. Override examples',
      '5. Level promotions',
      '6. SSN, W-9, 1099, and security guidance'
    ], {
      fill: C.lavender2,
      stroke: C.line
    });

    addInfoBox(doc, 'Who this is for', [
      'This guide is meant for Family Values Group agents and leaders who need a practical, easy-to-read explanation of how the commission system works.'
    ], {
      fill: C.pinkSoft,
      stroke: C.pinkBorder,
      titleColor: C.brandDark
    });
  }

  /* ------------------------ SECTION 1 ------------------------ */

  startSectionPage(
    doc,
    '1) How commissions are calculated',
    'The foundation: AP, commission rates, advances, pay-thru, renewals, and overrides.'
  );

  addBody(
    doc,
    'Your commission amounts are driven by Annual Premium (AP) and the carrier-specific commission schedule for the product you wrote. The platform annualizes the premium, matches the right schedule, and then applies the correct percentages.'
  );

  drawMiniHeader(doc, 'Key definitions');
  addBullets(doc, [
    'Annual Premium (AP): the annualized premium used for commission calculations.',
    'Commission Rate: the percentage assigned to the matching carrier schedule.',
    'Advance: part of expected first-year commission paid upfront on the weekly cycle.',
    'Pay-Thru / Trails / Renewals: the remaining amount paid over time as commission is released.',
    'Overrides: commission earned from the production of agents in your downline.'
  ], { box: true });

  drawMiniHeader(doc, 'Commission example');
  addTwoColExampleBox(
    doc,
    'Policy details',
    'Monthly premium: $80\nAnnual Premium: $960\nSchedule rate: 90%',
    'Payout breakdown',
    'Total commission: $864\nAdvance at 75%: $648\nRemaining pay-thru: $216'
  );

  /* ------------------------ SECTION 2 ------------------------ */

  startSectionPage(
    doc,
    '2) How to read your commission schedules',
    'Schedules are the source of truth for percentages and payout behavior.'
  );

  addBody(
    doc,
    'Commission schedules can vary by carrier, product line, and policy type. The system always uses the schedule that matches the business you wrote and your current level.'
  );

  addInfoBox(doc, 'How to read a schedule', [
    'Carrier: the insurance company.',
    'Product Line: the broad category, such as final expense, whole life, term, health, or P&C.',
    'Policy Type: the more specific schedule label for that carrier.',
    'Rates: the percentages used to determine total commission, advance, and renewal behavior.'
  ], {
    fill: C.lavender2,
    stroke: C.line
  });

  addBody(
    doc,
    'Two products under the same carrier can still pay differently. The product line and policy type matter, so always match the exact schedule to the business written.'
  );

  /* ------------------------ SECTION 3 ------------------------ */

  startSectionPage(
    doc,
    '3) When and how you get paid',
    'A cleaner breakdown of advances, pay-thru, renewals, and overrides.'
  );

  addInfoBox(doc, 'Weekly advances', [
    'Advances are generally processed on a weekly cycle.',
    'The platform checks eligible commission ledger items and creates a weekly payout batch.',
    'If lead debt or chargebacks are open, repayment rules may reduce the payout.'
  ], {
    fill: C.successSoft,
    stroke: '#cde9dc',
    titleColor: C.success
  });

  addInfoBox(doc, 'Monthly pay-thru, trails, and renewals', [
    'Pay-thru is generally processed on a monthly cycle.',
    'This usually includes the part of first-year commission not advanced upfront.',
    'It can also include trail or renewal amounts when the carrier and product support them.'
  ], {
    fill: C.lavender2,
    stroke: C.line
  });

  addInfoBox(doc, 'Overrides', [
    'Overrides are earned when agents in your hierarchy write business.',
    'The system calculates the difference between eligible levels and applies the matching schedule rules.'
  ], {
    fill: C.pinkSoft,
    stroke: C.pinkBorder
  });

  /* ------------------------ SECTION 4 ------------------------ */

  startSectionPage(
    doc,
    '4) Override example',
    'A simplified view of how leadership earnings are created.'
  );

  addBody(
    doc,
    'Override calculations depend on the difference between your level and the level below you. Here is a simple example.'
  );

  addTwoColExampleBox(
    doc,
    'Downline agent',
    'Level payout: 80%\nAP: $1,200',
    'Your override',
    'Your level payout: 90%\nDifference: 10%\nOverride earned: $120'
  );

  addBody(
    doc,
    'Actual override behavior may vary depending on product, carrier, and schedule design, but the platform applies your stored hierarchy and the matching schedule consistently.'
  );

  /* ------------------------ SECTION 5 ------------------------ */

  startSectionPage(
    doc,
    '5) Level promotions',
    'How production and team growth support advancement.'
  );

  addBody(
    doc,
    'Your level is based on consistent production and, for higher levels, active team growth. These benchmarks are used as operating guidance inside Family Values Group.'
  );

  addBullets(doc, [
    'Agent to MIT: $10,000 AP for 3 months in a row.',
    'MIT to Manager: $30,000 AP for 3 months in a row and at least 3 active agents in the downline.',
    'Manager to MGA: $50,000 AP for 3 months in a row and at least 5 active agents.',
    'MGA to Area Manager: $100,000 AP for 3 months in a row and at least 15 active agents.'
  ], {
    box: true,
    fill: C.lavender2,
    stroke: C.line
  });

  addInfoBox(doc, 'Reminder', [
    'Promotions are based on sustained performance, not one strong week. Consistency and team development both matter.'
  ], {
    fill: '#fffaf0',
    stroke: '#eedfb5',
    titleColor: '#8a6a1f'
  });

  /* ------------------------ SECTION 6 ------------------------ */

  startSectionPage(
    doc,
    '6) SSN, W-9, 1099, and security',
    'Why this information may be required and how to handle it safely.'
  );

  addBody(
    doc,
    'To receive commission payouts, carriers and payment processors may require identity verification and tax reporting information. This commonly includes your Social Security Number or Tax ID for W-9 and 1099 reporting.'
  );

  drawMiniHeader(doc, 'Why it may be required');
  addBullets(doc, [
    'Tax reporting: commissions are commonly reported on a 1099-NEC for independent agents.',
    'Identity verification: processors may require SSN or TIN to verify the payment recipient.',
    'Compliance: carriers may require tax information to issue producer payments correctly.'
  ], { box: true });

  drawMiniHeader(doc, 'Security reminders');
  addBullets(doc, [
    'Do not text or email SSNs in plain text.',
    'Only submit SSN or TIN information through secure official portals or verified encrypted channels.',
    'If something feels suspicious, contact the carrier or administrator directly before sending sensitive information.'
  ], {
    box: true,
    fill: C.pinkSoft,
    stroke: C.pinkBorder
  });

  addInfoBox(doc, 'Final note', [
    'This manual is intended as operational guidance for Family Values Group agents. It is not legal or tax advice. For legal or tax questions, consult a qualified professional.'
  ], {
    fill: C.dangerSoft,
    stroke: C.pinkBorder,
    titleColor: C.danger
  });

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
