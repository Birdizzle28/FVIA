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
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return s;
}

/* ------------------------ DESIGN HELPERS ------------------------ */

const COLORS = {
  brand: '#353468',
  brandDark: '#25234c',
  ink: '#1e1d35',
  muted: '#66627f',
  softLine: '#ddd8ee',
  white: '#ffffff',
  offWhite: '#fbfbfe',
  warning: '#b00020',
  warningSoft: '#fdecef',
  lavenderSoft: '#f5f1ff',
  footer: '#6f6a89'
};

function drawFullPageBackground(doc, bgBuffer) {
  if (!bgBuffer) return;
  try {
    doc.save();
    doc.image(bgBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });
    // soften it so content cards sit on top cleanly
    doc.fillOpacity(0.86).rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
    doc.restore();
  } catch {
    // ignore
  }
}

function drawTopBrandBar(doc) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 18).fill(COLORS.brand);
  doc.restore();
}

function drawHeader(doc, logo, meRow, isCover = false) {
  drawTopBrandBar(doc);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const topY = isCover ? 42 : 34;

  if (logo) {
    try {
      doc.image(logo, left, topY, { fit: [64, 64], align: 'left', valign: 'top' });
    } catch {}
  }

  const titleX = left + (logo ? 78 : 0);

  doc
    .font('Helvetica-Bold')
    .fontSize(isCover ? 24 : 17)
    .fillColor(COLORS.brandDark)
    .text(cleanText('Family Values Group'), titleX, topY + 2, { width: right - titleX });

  doc
    .font('Helvetica')
    .fontSize(isCover ? 13 : 11)
    .fillColor(COLORS.muted)
    .text(cleanText('Commission Manual'), titleX, topY + (isCover ? 31 : 24), {
      width: right - titleX
    });

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(COLORS.footer)
    .text(
      cleanText(`Generated for: ${meRow?.full_name || 'Agent'}  •  ${new Date().toLocaleDateString()}`),
      titleX,
      topY + (isCover ? 52 : 42),
      { width: right - titleX }
    );

  doc.fillColor(COLORS.ink);
  doc.y = topY + (isCover ? 92 : 78);
}

function drawFooter(doc) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.page.height - 30;

  doc.save();
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.footer)
    .text(cleanText(`© ${new Date().getFullYear()} Family Values Group — Internal Use`), left, y, {
      width: right - left,
      align: 'left'
    });

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(COLORS.footer)
    .text(cleanText(`Page ${doc.page.number}`), left, y, {
      width: right - left,
      align: 'right'
    });
  doc.restore();
}

function drawContentCard(doc, startY, height = null) {
  const x = doc.page.margins.left - 4;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right + 8;
  const y = startY;
  const h = height ?? (doc.page.height - y - doc.page.margins.bottom - 18);

  doc.save();
  doc.roundedRect(x, y, w, h, 16).fillAndStroke('#ffffff', COLORS.softLine);
  doc.restore();
}

function ensureSpace(doc, needed = 80) {
  const remaining = doc.page.height - doc.y - doc.page.margins.bottom - 24;
  if (remaining < needed) {
    doc.addPage();
  }
}

function sectionStart(doc, title, subtitle = '') {
  doc.addPage();
  const cardY = doc.y + 4;
  drawContentCard(doc, cardY);
  doc.y = cardY + 18;

  const left = doc.page.margins.left + 10;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right - 20;

  doc.save();
  doc.roundedRect(left, doc.y, w, 34, 10).fill(COLORS.lavenderSoft);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(COLORS.brandDark)
    .text(cleanText(title), left + 14, doc.y + 8, { width: w - 28 });

  doc.y += 42;

  if (subtitle) {
    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(COLORS.muted)
      .text(cleanText(subtitle), left + 2, doc.y, { width: w - 4, lineGap: 2 });
    doc.y += 24;
  }

  doc.fillColor(COLORS.ink);
}

function addTitle(doc, text) {
  doc
    .font('Helvetica-Bold')
    .fontSize(26)
    .fillColor(COLORS.brandDark)
    .text(cleanText(text), { align: 'left' });
  doc.moveDown(0.25);
}

function addIntroSub(doc, text) {
  doc
    .font('Helvetica')
    .fontSize(11.5)
    .fillColor(COLORS.muted)
    .text(cleanText(text), { lineGap: 3 });
  doc.moveDown(0.8);
}

function addH1(doc, text) {
  ensureSpace(doc, 70);
  doc.moveDown(0.35);
  doc.save();
  doc.roundedRect(doc.page.margins.left, doc.y, 6, 20, 3).fill(COLORS.brand);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(COLORS.brandDark)
    .text(cleanText(text), doc.page.margins.left + 16, doc.y - 1, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 16
    });

  doc.moveDown(0.55);
  doc.fillColor(COLORS.ink);
}

function addH2(doc, text) {
  ensureSpace(doc, 50);
  doc.moveDown(0.2);
  doc
    .font('Helvetica-Bold')
    .fontSize(12.5)
    .fillColor(COLORS.brand)
    .text(cleanText(text));
  doc.moveDown(0.22);
  doc.fillColor(COLORS.ink);
}

function addBody(doc, text) {
  doc
    .font('Helvetica')
    .fontSize(10.6)
    .fillColor(COLORS.ink)
    .text(cleanText(text), {
      lineGap: 4,
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 10
    });
  doc.moveDown(0.45);
}

function addBullet(doc, items) {
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.ink);

  items.forEach(item => {
    ensureSpace(doc, 28);
    const bulletX = doc.page.margins.left + 6;
    const textX = bulletX + 14;
    const y = doc.y;

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor(COLORS.brand)
      .text('•', bulletX, y);

    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(COLORS.ink)
      .text(cleanText(item), textX, y, {
        width: doc.page.width - textX - doc.page.margins.right,
        lineGap: 3
      });

    doc.y += 3;
  });

  doc.moveDown(0.35);
}

function addRedBanner(doc, text) {
  ensureSpace(doc, 120);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const padX = 16;
  const padY = 14;
  const content = cleanText(text);

  doc.save();
  doc.font('Helvetica-Bold').fontSize(12);
  const title = 'Important Payment Disclosure';
  const titleH = doc.heightOfString(title, { width: w - (padX * 2) });

  doc.font('Helvetica').fontSize(10.4);
  const textH = doc.heightOfString(content, { width: w - (padX * 2), lineGap: 3 });

  const h = padY + titleH + 8 + textH + padY;

  doc.roundedRect(x, doc.y, w, h, 14).fill(COLORS.warningSoft);
  doc.roundedRect(x, doc.y, 8, h, 14).fill(COLORS.warning);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(COLORS.warning)
    .text(title, x + padX + 4, doc.y + padY, { width: w - (padX * 2) });

  doc
    .font('Helvetica')
    .fontSize(10.4)
    .fillColor(COLORS.ink)
    .text(content, x + padX + 4, doc.y + padY + titleH + 8, {
      width: w - (padX * 2) - 4,
      lineGap: 3
    });

  doc.restore();
  doc.y += h + 14;
}

function addDivider(doc) {
  doc.moveDown(0.25);
  doc.save();
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(COLORS.softLine)
    .lineWidth(1)
    .stroke();
  doc.restore();
  doc.moveDown(0.7);
}

function addInfoBox(doc, title, lines = []) {
  ensureSpace(doc, 80);

  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const pad = 14;

  doc.save();
  doc.font('Helvetica-Bold').fontSize(11.5);
  const titleH = doc.heightOfString(cleanText(title), { width: w - (pad * 2) });

  doc.font('Helvetica').fontSize(10.4);
  let bodyH = 0;
  lines.forEach(line => {
    bodyH += doc.heightOfString(cleanText(line), {
      width: w - (pad * 2),
      lineGap: 3
    }) + 4;
  });

  const h = pad + titleH + 8 + bodyH + pad;

  doc.roundedRect(x, doc.y, w, h, 12).fill('#faf9ff').stroke(COLORS.softLine);

  let y = doc.y + pad;

  doc
    .font('Helvetica-Bold')
    .fontSize(11.5)
    .fillColor(COLORS.brandDark)
    .text(cleanText(title), x + pad, y, { width: w - (pad * 2) });

  y += titleH + 8;

  doc.font('Helvetica').fontSize(10.4).fillColor(COLORS.ink);
  lines.forEach(line => {
    doc.text(cleanText(line), x + pad, y, {
      width: w - (pad * 2),
      lineGap: 3
    });
    y += doc.heightOfString(cleanText(line), {
      width: w - (pad * 2),
      lineGap: 3
    }) + 4;
  });

  doc.restore();
  doc.y += h + 12;
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
  drawHeader(doc, logo, meRow, true);

  doc.on('pageAdded', () => {
    drawFullPageBackground(doc, bg);
    drawHeader(doc, logo, meRow, false);
  });

  /* ------------------------ COVER / INTRO PAGE ------------------------ */

  drawContentCard(doc, doc.y + 4, 620);
  doc.y += 22;

  addTitle(doc, 'Commission Manual');
  addIntroSub(
    doc,
    'This guide explains how Family Values Group handles commission schedules, advances, pay-thru, overrides, promotions, and payment-related compliance.'
  );

  addRedBanner(
    doc,
    'Family Values Group does not accept debit cards, credit cards, cash, or direct money payments collected by an agent. If a client tries to pay using one of those methods, the agent will not be paid commission on that sale. The correct process is to tell the client that Family Values Group does not accept those payment methods and then provide the insurance carrier’s official payment phone number so the client can pay the carrier directly.'
  );

  addDivider(doc);

  addInfoBox(doc, 'What is inside this manual?', [
    '1. How commissions are calculated',
    '2. How to read your commission schedules',
    '3. When and how you get paid',
    '4. Override examples',
    '5. Level promotions',
    '6. SSN, W-9, 1099, and security guidance'
  ]);

  addInfoBox(doc, 'Who this is for', [
    'This manual is written for Family Values Group agents and leaders who need a practical explanation of how commission payouts work inside the platform.'
  ]);

  /* ------------------------ SECTION 1 ------------------------ */

  sectionStart(
    doc,
    '1) How commissions are calculated',
    'The core ideas behind AP, commission rates, advances, pay-thru, renewals, and overrides.'
  );

  addBody(
    doc,
    'Your commission amounts are driven by Annual Premium (AP) and the carrier-specific commission schedule for the product you wrote. In simple terms, the system annualizes the premium, matches the correct schedule, and then applies the relevant percentages.'
  );

  addH2(doc, 'Key definitions');
  addBullet(doc, [
    'Annual Premium (AP): the annualized premium used for commission calculations.',
    'Commission Rate: the percentage from your commission schedule for that carrier and product.',
    'Advance: a portion of expected first-year commission paid upfront on the weekly cycle.',
    'Pay-Thru / Trails / Renewals: the remaining amount paid over time as the carrier releases commission.',
    'Overrides: commission earned from the production of agents in your downline, based on your level.'
  ]);

  addH2(doc, 'Example');
  addInfoBox(doc, 'Basic example math', [
    'Monthly premium = $80',
    'AP = $80 x 12 = $960',
    'Schedule rate = 90%',
    'Total commission = $960 x 90% = $864',
    'If the advance rate is 75%, then the upfront advance is $648 and the remaining $216 is paid as pay-thru over time.'
  ]);

  /* ------------------------ SECTION 2 ------------------------ */

  sectionStart(
    doc,
    '2) How to read your commission schedules',
    'Your schedules are the source of truth for payout percentages.'
  );

  addBody(
    doc,
    'Commission schedules can vary by carrier, product line, and policy type. The system uses the schedule that matches the business you wrote and your level in the hierarchy.'
  );

  addBullet(doc, [
    'Carrier: the insurance company.',
    'Product Line: the broad category, such as final expense, whole life, term, health, or P&C.',
    'Policy Type: the more specific schedule label used for that carrier.',
    'Rates: the percentages used to determine commission, including how much is advanced and how renewals or trails are paid.'
  ]);

  addH2(doc, 'Why this matters');
  addBody(
    doc,
    'If two products are sold through the same carrier, they can still pay differently. Always look at the schedule that matches the exact product line and policy type.'
  );

  /* ------------------------ SECTION 3 ------------------------ */

  sectionStart(
    doc,
    '3) When and how you get paid',
    'A clean breakdown of weekly advances, monthly pay-thru, renewals, and overrides.'
  );

  addH2(doc, 'Advances');
  addBody(
    doc,
    'Advances are generally processed on a weekly cycle. The platform checks eligible commission ledger items and produces a weekly payout batch. If you have open lead debt or chargebacks, your payout may be reduced according to repayment rules.'
  );

  addH2(doc, 'Pay-Thru / Trails / Renewals');
  addBody(
    doc,
    'Pay-thru is generally processed on a monthly cycle. This usually includes the part of first-year commission not advanced upfront, plus any ongoing trail or renewal amounts when the product supports them.'
  );

  addH2(doc, 'Overrides');
  addBody(
    doc,
    'Overrides are earned when agents in your hierarchy write business and your level entitles you to the difference between schedule levels. The system calculates those differences using your stored hierarchy and the matching commission schedules.'
  );

  /* ------------------------ SECTION 4 ------------------------ */

  sectionStart(
    doc,
    '4) Override example',
    'A simplified look at how override differences create earnings for leaders.'
  );

  addBody(
    doc,
    'Override calculations depend on the level difference between you and the agent below you. Here is a simplified example.'
  );

  addInfoBox(doc, 'Simple override example', [
    'Downline level payout = 80%',
    'Your level payout = 90%',
    'Override difference = 10%',
    'If AP is $1,200, then override commission = $1,200 x 10% = $120'
  ]);

  addBody(
    doc,
    'Actual override behavior may vary depending on product, carrier, and schedule design, but the system applies the stored hierarchy and schedule rules consistently.'
  );

  /* ------------------------ SECTION 5 ------------------------ */

  sectionStart(
    doc,
    '5) Level promotions',
    'How production and team growth impact leadership progression.'
  );

  addBody(
    doc,
    'Your level is based on consistent production and, for higher levels, active downline growth. These benchmarks are used as operational guidance inside Family Values Group.'
  );

  addBullet(doc, [
    'Agent -> MIT: $10,000 AP for 3 months in a row.',
    'MIT -> Manager: $30,000 AP for 3 months in a row and at least 3 active agents in the downline.',
    'Manager -> MGA: $50,000 AP for 3 months in a row and at least 5 active agents.',
    'MGA -> Area Manager: $100,000 AP for 3 months in a row and at least 15 active agents.'
  ]);

  addBody(
    doc,
    'Promotions are about sustained performance, not one strong week. Production consistency and team development both matter.'
  );

  /* ------------------------ SECTION 6 ------------------------ */

  sectionStart(
    doc,
    '6) SSN, W-9, 1099, and security',
    'Why tax and identity information may be required and how to handle it safely.'
  );

  addBody(
    doc,
    'To receive commission payouts, carriers and payment processors may require identity verification and tax reporting information. This commonly includes your Social Security Number or Tax ID for W-9 and 1099 reporting.'
  );

  addH2(doc, 'Why this information may be required');
  addBullet(doc, [
    'Tax reporting: commissions are commonly reported on a 1099-NEC for independent agents.',
    'Identity verification: processors may require SSN or TIN to verify the payment recipient.',
    'Compliance: carriers may require tax information to issue producer payments correctly.'
  ]);

  addH2(doc, 'Security reminders');
  addBullet(doc, [
    'Do not text or email SSNs in plain text.',
    'Only submit SSN or TIN information through secure official portals or verified encrypted channels.',
    'If something seems suspicious, contact the carrier or administrator directly before sending sensitive information.'
  ]);

  addInfoBox(doc, 'Final note', [
    'This manual is intended as operational guidance for Family Values Group agents. It is not legal or tax advice. For legal or tax questions, consult a qualified professional.'
  ]);

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
