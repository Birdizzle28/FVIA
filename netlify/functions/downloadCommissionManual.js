// netlify/functions/downloadCommissionManual.js
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, serviceKey);

/* =========================================================
   AUTH
========================================================= */

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

/* =========================================================
   ASSETS
========================================================= */

function tryLoadLogoBuffer() {
  const candidates = [
    path.join(process.cwd(), 'assets', 'logo.png'),
    path.join(process.cwd(), 'Pics', 'img17.png'),
    path.join(process.cwd(), 'images', 'logo.png'),
    path.join(process.cwd(), 'logo.png'),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {}
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
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {}
  }
  return null;
}

/* =========================================================
   TEXT
========================================================= */

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

/* =========================================================
   DESIGN TOKENS
========================================================= */

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
  footer: '#7b7694',
  cream: '#fffaf0',
  creamBorder: '#eedfb5',
  creamText: '#8a6a1f'
};

const PAGE = {
  margin: 54,
  footerReserve: 34
};

/* =========================================================
   DOC UTILS
========================================================= */

function getContentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
}

function getBottomLimit(doc) {
  return doc.page.height - doc.page.margins.bottom - PAGE.footerReserve;
}

function remainingSpace(doc) {
  return getBottomLimit(doc) - doc.y;
}

function ensureSpace(doc, needed = 80) {
  if (remainingSpace(doc) < needed) doc.addPage();
}

function textHeight(doc, text, opts = {}) {
  const font = opts.font || 'Helvetica';
  const size = opts.size || 10.5;
  const width = opts.width || getContentWidth(doc);
  const lineGap = opts.lineGap ?? 3;

  doc.save();
  doc.font(font).fontSize(size);
  const h = doc.heightOfString(cleanText(text), { width, lineGap });
  doc.restore();
  return h;
}

function roundedRect(doc, x, y, w, h, r = 16, fill = C.white, stroke = C.line) {
  doc.save();
  doc.roundedRect(x, y, w, h, r).fillAndStroke(fill, stroke);
  doc.restore();
}

function drawFullPageBackground(doc, bgBuffer) {
  if (bgBuffer) {
    try {
      doc.save();
      doc.image(bgBuffer, 0, 0, { width: doc.page.width, height: doc.page.height });
      doc.fillOpacity(0.82).rect(0, 0, doc.page.width, doc.page.height).fill('#ffffff');
      doc.restore();
    } catch {
      doc.save();
      doc.rect(0, 0, doc.page.width, doc.page.height).fill('#faf8ff');
      doc.restore();
    }
  } else {
    doc.save();
    doc.rect(0, 0, doc.page.width, doc.page.height).fill('#faf8ff');
    doc.restore();
  }

  doc.save();
  doc.rect(0, 0, doc.page.width, 22).fill(C.brand);
  doc.rect(0, doc.page.height - 16, doc.page.width, 16).fill(C.brandDark);
  doc.restore();
}

function drawFooter(doc, pageNumber) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.page.height - 28;

  doc.save();
  doc.font('Helvetica').fontSize(8.5).fillColor(C.footer);
  doc.text(cleanText(`© ${new Date().getFullYear()} Family Values Group — Internal Use`), left, y, {
    width: right - left,
    align: 'left'
  });
  doc.text(cleanText(`Page ${pageNumber}`), left, y, {
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

  doc
    .font('Helvetica-Bold')
    .fontSize(cover ? 24 : 17)
    .fillColor(C.brandDark)
    .text(cleanText('Family Values Group'), titleX, topY + 2, { width: right - titleX });

  doc
    .font('Helvetica')
    .fontSize(cover ? 13 : 11)
    .fillColor(C.muted)
    .text(cleanText('Commission Manual'), titleX, topY + (cover ? 31 : 24), { width: right - titleX });

  doc
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(C.footer)
    .text(
      cleanText(`Generated for: ${meRow?.full_name || 'Agent'}  •  ${new Date().toLocaleDateString()}`),
      titleX,
      topY + (cover ? 52 : 42),
      { width: right - titleX }
    );

  doc.fillColor(C.ink);
  doc.y = topY + (cover ? 94 : 78);
}

function addTitle(doc, text) {
  doc
    .font('Helvetica-Bold')
    .fontSize(28)
    .fillColor(C.brandDark)
    .text(cleanText(text), { align: 'left' });
  doc.moveDown(0.2);
}

function addSubTitle(doc, text) {
  doc
    .font('Helvetica')
    .fontSize(11.4)
    .fillColor(C.muted)
    .text(cleanText(text), { lineGap: 4 });
  doc.moveDown(0.7);
}

function addBody(doc, text, opts = {}) {
  doc
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(opts.size || 10.7)
    .fillColor(opts.color || C.ink)
    .text(cleanText(text), {
      width: opts.width || getContentWidth(doc),
      lineGap: opts.lineGap ?? 4
    });
  doc.moveDown(opts.after ?? 0.42);
}

function addDivider(doc) {
  doc.moveDown(0.15);
  doc.save();
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor(C.line)
    .lineWidth(1)
    .stroke();
  doc.restore();
  doc.moveDown(0.65);
}

/* =========================================================
   MEASURED BLOCKS
========================================================= */

function addWarningBox(doc, text) {
  const x = doc.page.margins.left;
  const y = doc.y;
  const w = getContentWidth(doc);
  const pad = 16;
  const title = 'Important Payment Disclosure';
  const titleX = x + 54;
  const bodyX = x + 20;

  const titleH = textHeight(doc, title, {
    font: 'Helvetica-Bold',
    size: 12,
    width: w - 66,
    lineGap: 2
  });

  const bodyH = textHeight(doc, text, {
    font: 'Helvetica',
    size: 10.4,
    width: w - 40,
    lineGap: 3
  });

  const h = pad + titleH + 10 + bodyH + pad;

  ensureSpace(doc, h + 6);

  const yy = doc.y;

  doc.save();
  doc.roundedRect(x, yy, w, h, 16).fillAndStroke(C.dangerSoft, C.pinkBorder);
  doc.roundedRect(x, yy, 12, h, 16).fill(C.danger);
  doc.restore();

  doc.save();
  doc.circle(x + 32, yy + 28, 12).fill(C.danger);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text('!', x + 28.5, yy + 18.5);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.danger)
    .text(title, titleX, yy + pad, { width: w - 66 });

  doc
    .font('Helvetica')
    .fontSize(10.4)
    .fillColor(C.ink)
    .text(cleanText(text), bodyX, yy + pad + titleH + 10, {
      width: w - 40,
      lineGap: 3
    });

  doc.y = yy + h + 14;
}

function addInfoBox(doc, title, lines = [], opts = {}) {
  const x = doc.page.margins.left;
  const w = getContentWidth(doc);
  const pad = 14;
  const fill = opts.fill || C.lavender2;
  const stroke = opts.stroke || C.line;
  const titleColor = opts.titleColor || C.brandDark;

  const titleH = textHeight(doc, title, {
    font: 'Helvetica-Bold',
    size: 11.5,
    width: w - pad * 2,
    lineGap: 2
  });

  let bodyH = 0;
  for (const line of lines) {
    bodyH += textHeight(doc, line, {
      font: 'Helvetica',
      size: 10.4,
      width: w - pad * 2,
      lineGap: 3
    }) + 5;
  }

  const h = pad + titleH + 10 + bodyH + pad;
  ensureSpace(doc, h + 6);

  const y = doc.y;
  roundedRect(doc, x, y, w, h, 16, fill, stroke);

  let cy = y + pad;

  doc
    .font('Helvetica-Bold')
    .fontSize(11.5)
    .fillColor(titleColor)
    .text(cleanText(title), x + pad, cy, { width: w - pad * 2 });

  cy += titleH + 10;

  for (const line of lines) {
    doc
      .font('Helvetica')
      .fontSize(10.4)
      .fillColor(C.ink)
      .text(cleanText(line), x + pad, cy, {
        width: w - pad * 2,
        lineGap: 3
      });

    cy += textHeight(doc, line, {
      font: 'Helvetica',
      size: 10.4,
      width: w - pad * 2,
      lineGap: 3
    }) + 5;
  }

  doc.y = y + h + 12;
}

function addBullets(doc, items, { box = false, fill = C.lavender2, stroke = C.line } = {}) {
  const x = doc.page.margins.left;
  const w = getContentWidth(doc);

  const boxPad = box ? 14 : 0;
  const bulletX = x + (box ? 14 : 4);
  const textX = bulletX + 18;
  const textW = w - (textX - x) - (box ? 14 : 0);

  let totalH = 0;
  for (const item of items) {
    totalH += textHeight(doc, item, {
      font: 'Helvetica',
      size: 10.5,
      width: textW,
      lineGap: 3
    }) + 6;
  }

  const boxH = box ? totalH + 18 + 10 : totalH;
  ensureSpace(doc, boxH + 8);

  let startY = doc.y;
  if (box) {
    roundedRect(doc, x, startY, w, boxH, 14, fill, stroke);
    doc.y = startY + boxPad;
  }

  for (const item of items) {
    const lineY = doc.y;
    const itemH = textHeight(doc, item, {
      font: 'Helvetica',
      size: 10.5,
      width: textW,
      lineGap: 3
    });

    doc.save();
    doc.circle(bulletX + 5, lineY + 8, 4).fill(C.brand);
    doc.restore();

    doc
      .font('Helvetica')
      .fontSize(10.5)
      .fillColor(C.ink)
      .text(cleanText(item), textX, lineY, {
        width: textW,
        lineGap: 3
      });

    doc.y = lineY + itemH + 6;
  }

  doc.moveDown(0.2);
}

function drawMiniHeader(doc, text) {
  const x = doc.page.margins.left;
  const w = Math.min(getContentWidth(doc), 320);
  const padX = 12;
  const padY = 6;

  const tH = textHeight(doc, text, {
    font: 'Helvetica-Bold',
    size: 12,
    width: w - padX * 2,
    lineGap: 2
  });

  const h = tH + padY * 2;
  ensureSpace(doc, h + 8);

  const y = doc.y;
  roundedRect(doc, x, y, w, h, 10, C.lavender, C.line);

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.brandDark)
    .text(cleanText(text), x + padX, y + padY, {
      width: w - padX * 2,
      lineGap: 2
    });

  doc.y = y + h + 8;
}

function drawSectionBanner(doc, title, subtitle = '') {
  const x = doc.page.margins.left;
  const w = getContentWidth(doc);
  const titleH = textHeight(doc, title, {
    font: 'Helvetica-Bold',
    size: 18,
    width: w - 44,
    lineGap: 2
  });

  const subH = subtitle
    ? textHeight(doc, subtitle, {
        font: 'Helvetica',
        size: 9.6,
        width: w - 44,
        lineGap: 2
      })
    : 0;

  const h = 12 + titleH + (subtitle ? 4 + subH : 0) + 10;
  ensureSpace(doc, h + 8);

  const y = doc.y;

  doc.save();
  doc.roundedRect(x, y, w, h, 14).fill(C.brand);
  doc.roundedRect(x + 12, y + 10, 10, Math.max(18, h - 20), 5).fill(C.gold);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(C.white)
    .text(cleanText(title), x + 32, y + 10, { width: w - 44, lineGap: 2 });

  if (subtitle) {
    doc
      .font('Helvetica')
      .fontSize(9.6)
      .fillColor('#e7e4ff')
      .text(cleanText(subtitle), x + 32, y + 10 + titleH + 4, {
        width: w - 44,
        lineGap: 2
      });
  }

  doc.y = y + h + 14;
  doc.fillColor(C.ink);
}

function addTwoColExampleBox(doc, leftTitle, leftText, rightTitle, rightText) {
  const x = doc.page.margins.left;
  const fullW = getContentWidth(doc);
  const gap = 12;
  const colW = (fullW - gap) / 2;
  const pad = 12;

  const lTitleH = textHeight(doc, leftTitle, {
    font: 'Helvetica-Bold',
    size: 11,
    width: colW - pad * 2,
    lineGap: 2
  });
  const rTitleH = textHeight(doc, rightTitle, {
    font: 'Helvetica-Bold',
    size: 11,
    width: colW - pad * 2,
    lineGap: 2
  });
  const lBodyH = textHeight(doc, leftText, {
    font: 'Helvetica',
    size: 10.2,
    width: colW - pad * 2,
    lineGap: 3
  });
  const rBodyH = textHeight(doc, rightText, {
    font: 'Helvetica',
    size: 10.2,
    width: colW - pad * 2,
    lineGap: 3
  });

  const colH = Math.max(lTitleH + 8 + lBodyH, rTitleH + 8 + rBodyH) + pad * 2;
  ensureSpace(doc, colH + 8);

  const y = doc.y;

  roundedRect(doc, x, y, colW, colH, 14, C.white, C.line);
  roundedRect(doc, x + colW + gap, y, colW, colH, 14, C.white, C.line);

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(C.brandDark)
    .text(cleanText(leftTitle), x + pad, y + pad, { width: colW - pad * 2 });
  doc
    .font('Helvetica')
    .fontSize(10.2)
    .fillColor(C.ink)
    .text(cleanText(leftText), x + pad, y + pad + lTitleH + 8, {
      width: colW - pad * 2,
      lineGap: 3
    });

  const rx = x + colW + gap;
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(C.brandDark)
    .text(cleanText(rightTitle), rx + pad, y + pad, { width: colW - pad * 2 });
  doc
    .font('Helvetica')
    .fontSize(10.2)
    .fillColor(C.ink)
    .text(cleanText(rightText), rx + pad, y + pad + rTitleH + 8, {
      width: colW - pad * 2,
      lineGap: 3
    });

  doc.y = y + colH + 14;
}

/* =========================================================
   PAGES
========================================================= */

function drawCoverCard(doc) {
  const x = doc.page.margins.left - 2;
  const y = doc.y + 8;
  const w = getContentWidth(doc) + 4;
  const h = getBottomLimit(doc) - y - 6;

  roundedRect(doc, x, y, w, h, 22, C.white, C.line);
  doc.y = y + 24;
}

function startSectionPage(doc, title, subtitle = '') {
  doc.addPage();

  const cardX = doc.page.margins.left - 4;
  const cardY = doc.y + 4;
  const cardW = getContentWidth(doc) + 8;
  const cardH = getBottomLimit(doc) - cardY - 6;

  roundedRect(doc, cardX, cardY, cardW, cardH, 20, C.white, C.line);
  doc.y = cardY + 18;

  drawSectionBanner(doc, title, subtitle);
}

/* =========================================================
   HANDLER
========================================================= */

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
    margin: PAGE.margin,
    bufferPages: true,
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

  /* ---------------- COVER ---------------- */

  drawCoverCard(doc);

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

  /* ---------------- SECTION 1 ---------------- */

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

  /* ---------------- SECTION 2 ---------------- */

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

  /* ---------------- SECTION 3 ---------------- */

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

  /* ---------------- SECTION 4 ---------------- */

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

  /* ---------------- SECTION 5 ---------------- */

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
    fill: C.cream,
    stroke: C.creamBorder,
    titleColor: C.creamText
  });

  /* ---------------- SECTION 6 ---------------- */

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

  /* ---------------- FOOTERS ON ALL PAGES ---------------- */

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    drawFooter(doc, i + 1);
  }

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
