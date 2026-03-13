// netlify/functions/downloadCommissionManual.js
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
   TEXT SANITIZER
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
  cream: '#fffaf0',
  creamBorder: '#eedfb5',
  creamText: '#8a6a1f',
  footer: '#7b7694',
};

const L = {
  pageW: 612,
  pageH: 792,
  margin: 42,

  topBarH: 22,
  bottomBarH: 16,

  headerLogo: 62,

  cardX: 36,
  cardY: 116,
  cardW: 540,
  cardH: 620,

  contentX: 58,
  contentY: 140,
  contentW: 496,

  // moved up so PDFKit does not force phantom pages
  footerY: 736
};

/* =========================================================
   BASE DRAW HELPERS
========================================================= */

function drawBackground(doc, bgBuffer) {
  if (bgBuffer) {
    try {
      doc.save();
      doc.image(bgBuffer, 0, 0, { width: L.pageW, height: L.pageH });
      doc.fillOpacity(0.84).rect(0, 0, L.pageW, L.pageH).fill('#ffffff');
      doc.restore();
    } catch {
      doc.save();
      doc.rect(0, 0, L.pageW, L.pageH).fill('#faf8ff');
      doc.restore();
    }
  } else {
    doc.save();
    doc.rect(0, 0, L.pageW, L.pageH).fill('#faf8ff');
    doc.restore();
  }

  doc.save();
  doc.rect(0, 0, L.pageW, L.topBarH).fill(C.brand);
  doc.rect(0, L.pageH - L.bottomBarH, L.pageW, L.bottomBarH).fill(C.brandDark);
  doc.restore();
}

function drawRoundedCard(doc, x, y, w, h, fill = C.white, stroke = C.line, radius = 18) {
  doc.save();
  doc.roundedRect(x, y, w, h, radius).fillAndStroke(fill, stroke);
  doc.restore();
}

function drawHeader(doc, logo, meRow, pageNumber, { cover = false } = {}) {
  const left = L.margin;
  const titleX = left + (logo ? 80 : 0);
  const topY = cover ? 40 : 32;

  if (logo) {
    try {
      doc.image(logo, left, topY, { fit: [L.headerLogo, L.headerLogo], align: 'left', valign: 'top' });
    } catch {}
  }

  doc
    .font('Helvetica-Bold')
    .fontSize(cover ? 23 : 16.5)
    .fillColor(C.brandDark)
    .text('Family Values Group', titleX, topY + 2, { width: 420 });

  doc
    .font('Helvetica')
    .fontSize(cover ? 12.5 : 10.5)
    .fillColor(C.muted)
    .text('Commission Manual', titleX, topY + (cover ? 30 : 22), { width: 420 });

  doc
    .font('Helvetica')
    .fontSize(9.2)
    .fillColor(C.footer)
    .text(
      cleanText(`Generated for: ${meRow?.full_name || 'Agent'}  •  ${new Date().toLocaleDateString()}`),
      titleX,
      topY + (cover ? 50 : 39),
      { width: 420 }
    );

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C.footer)
    .text(`© ${new Date().getFullYear()} Family Values Group — Internal Use`, L.margin, L.footerY, {
      width: L.pageW - (L.margin * 2),
      align: 'left',
      lineBreak: false
    });

  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C.footer)
    .text(`Page ${pageNumber}`, L.margin, L.footerY, {
      width: L.pageW - (L.margin * 2),
      align: 'right',
      lineBreak: false
    });
}

function startPage(doc, bgBuffer, logo, meRow, pageNumber, opts = {}) {
  if (pageNumber > 1) doc.addPage();
  drawBackground(doc, bgBuffer);
  drawHeader(doc, logo, meRow, pageNumber, opts);
  drawRoundedCard(doc, L.cardX, L.cardY, L.cardW, L.cardH, C.white, C.line, 22);
  doc.x = L.contentX;
  doc.y = L.contentY;
}

function hText(doc, text, {
  font = 'Helvetica',
  size = 10.5,
  width = L.contentW,
  lineGap = 3
} = {}) {
  doc.save();
  doc.font(font).fontSize(size);
  const h = doc.heightOfString(cleanText(text), { width, lineGap });
  doc.restore();
  return h;
}

/* =========================================================
   STYLED CONTENT HELPERS
========================================================= */

function addPageTitle(doc, title, subtitle = null) {
  doc
    .font('Helvetica-Bold')
    .fontSize(27)
    .fillColor(C.brandDark)
    .text(cleanText(title), L.contentX, doc.y, {
      width: L.contentW,
      lineGap: 2
    });

  doc.y += hText(doc, title, {
    font: 'Helvetica-Bold',
    size: 27,
    width: L.contentW,
    lineGap: 2
  }) + 6;

  if (subtitle) {
    doc
      .font('Helvetica')
      .fontSize(11.3)
      .fillColor(C.muted)
      .text(cleanText(subtitle), L.contentX, doc.y, {
        width: L.contentW,
        lineGap: 4
      });

    doc.y += hText(doc, subtitle, {
      font: 'Helvetica',
      size: 11.3,
      width: L.contentW,
      lineGap: 4
    }) + 10;
  }
}

function addSectionBanner(doc, title, subtitle = '') {
  const x = L.contentX;
  const y = doc.y;
  const w = L.contentW;

  const titleH = hText(doc, title, {
    font: 'Helvetica-Bold',
    size: 18,
    width: w - 44,
    lineGap: 2
  });

  const subtitleH = subtitle
    ? hText(doc, subtitle, {
        font: 'Helvetica',
        size: 9.4,
        width: w - 44,
        lineGap: 2
      })
    : 0;

  const h = 12 + titleH + (subtitle ? 4 + subtitleH : 0) + 10;

  doc.save();
  doc.roundedRect(x, y, w, h, 16).fill(C.brand);
  doc.roundedRect(x + 12, y + 10, 10, h - 20, 5).fill(C.gold);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor(C.white)
    .text(cleanText(title), x + 30, y + 10, {
      width: w - 42,
      lineGap: 2
    });

  if (subtitle) {
    doc
      .font('Helvetica')
      .fontSize(9.4)
      .fillColor('#e7e4ff')
      .text(cleanText(subtitle), x + 30, y + 10 + titleH + 4, {
        width: w - 42,
        lineGap: 2
      });
  }

  doc.y = y + h + 14;
}

function addMiniHeader(doc, text) {
  const x = L.contentX;
  const y = doc.y;
  const w = 270;
  const padX = 12;
  const padY = 6;

  const textH = hText(doc, text, {
    font: 'Helvetica-Bold',
    size: 12,
    width: w - (padX * 2),
    lineGap: 2
  });

  const h = textH + (padY * 2);

  doc.save();
  doc.roundedRect(x, y, w, h, 11).fill(C.lavender);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.brandDark)
    .text(cleanText(text), x + padX, y + padY, {
      width: w - (padX * 2),
      lineGap: 2
    });

  doc.y = y + h + 10;
}

function addBody(doc, text, opts = {}) {
  const width = opts.width || L.contentW;
  const size = opts.size || 10.7;
  const lineGap = opts.lineGap ?? 4;

  const x = opts.x || L.contentX;
  const y = doc.y;

  doc
    .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
    .fontSize(size)
    .fillColor(opts.color || C.ink)
    .text(cleanText(text), x, y, {
      width,
      lineGap
    });

  doc.y = y + hText(doc, text, {
    font: opts.bold ? 'Helvetica-Bold' : 'Helvetica',
    size,
    width,
    lineGap
  }) + (opts.after ?? 8);
}

function addDivider(doc) {
  doc.save();
  doc.moveTo(L.contentX, doc.y)
    .lineTo(L.contentX + L.contentW, doc.y)
    .strokeColor(C.line)
    .lineWidth(1)
    .stroke();
  doc.restore();
  doc.y += 12;
}

function addWarningBox(doc, text) {
  const x = L.contentX;
  const y = doc.y;
  const w = L.contentW;
  const pad = 16;

  const title = 'Important Payment Disclosure';
  const titleH = hText(doc, title, {
    font: 'Helvetica-Bold',
    size: 12,
    width: w - 66,
    lineGap: 2
  });

  const bodyH = hText(doc, text, {
    font: 'Helvetica',
    size: 10.3,
    width: w - 36,
    lineGap: 3
  });

  const h = pad + titleH + 10 + bodyH + pad;

  doc.save();
  doc.roundedRect(x, y, w, h, 16).fillAndStroke(C.dangerSoft, C.pinkBorder);
  doc.roundedRect(x, y, 12, h, 16).fill(C.danger);
  doc.restore();

  doc.save();
  doc.circle(x + 31, y + 28, 12).fill(C.danger);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(C.white).text('!', x + 27.8, y + 18.2);
  doc.restore();

  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(C.danger)
    .text(title, x + 54, y + pad, {
      width: w - 66
    });

  doc
    .font('Helvetica')
    .fontSize(10.3)
    .fillColor(C.ink)
    .text(cleanText(text), x + 18, y + pad + titleH + 10, {
      width: w - 30,
      lineGap: 3
    });

  doc.y = y + h + 14;
}

function addInfoBox(doc, title, lines = [], opts = {}) {
  const x = L.contentX;
  const y = doc.y;
  const w = L.contentW;
  const pad = 14;
  const fill = opts.fill || C.lavender2;
  const stroke = opts.stroke || C.line;
  const titleColor = opts.titleColor || C.brandDark;

  const titleH = hText(doc, title, {
    font: 'Helvetica-Bold',
    size: 11.3,
    width: w - (pad * 2),
    lineGap: 2
  });

  let bodyH = 0;
  for (const line of lines) {
    bodyH += hText(doc, line, {
      font: 'Helvetica',
      size: 10.3,
      width: w - (pad * 2),
      lineGap: 3
    }) + 5;
  }

  const h = pad + titleH + 10 + bodyH + pad;

  drawRoundedCard(doc, x, y, w, h, fill, stroke, 16);

  let yy = y + pad;

  doc
    .font('Helvetica-Bold')
    .fontSize(11.3)
    .fillColor(titleColor)
    .text(cleanText(title), x + pad, yy, {
      width: w - (pad * 2)
    });

  yy += titleH + 10;

  for (const line of lines) {
    doc
      .font('Helvetica')
      .fontSize(10.3)
      .fillColor(C.ink)
      .text(cleanText(line), x + pad, yy, {
        width: w - (pad * 2),
        lineGap: 3
      });

    yy += hText(doc, line, {
      font: 'Helvetica',
      size: 10.3,
      width: w - (pad * 2),
      lineGap: 3
    }) + 5;
  }

  doc.y = y + h + 12;
}

function addBullets(doc, items, opts = {}) {
  const box = !!opts.box;
  const fill = opts.fill || C.lavender2;
  const stroke = opts.stroke || C.line;

  const x = L.contentX;
  const y = doc.y;
  const w = L.contentW;

  const bulletX = x + (box ? 18 : 8);
  const textX = bulletX + 16;
  const textW = w - (textX - x) - (box ? 14 : 0);

  let totalH = 0;
  for (const item of items) {
    totalH += hText(doc, item, {
      font: 'Helvetica',
      size: 10.4,
      width: textW,
      lineGap: 3
    }) + 7;
  }

  if (box) {
    drawRoundedCard(doc, x, y, w, totalH + 18, fill, stroke, 14);
    doc.y = y + 12;
  }

  for (const item of items) {
    const itemY = doc.y;
    const itemH = hText(doc, item, {
      font: 'Helvetica',
      size: 10.4,
      width: textW,
      lineGap: 3
    });

    doc.save();
    doc.circle(bulletX + 4, itemY + 8, 4).fill(C.brand);
    doc.restore();

    doc
      .font('Helvetica')
      .fontSize(10.4)
      .fillColor(C.ink)
      .text(cleanText(item), textX, itemY, {
        width: textW,
        lineGap: 3
      });

    doc.y = itemY + itemH + 7;
  }

  if (!box) doc.y += 4;
}

function addTwoColExampleBox(doc, leftTitle, leftText, rightTitle, rightText) {
  const x = L.contentX;
  const y = doc.y;
  const fullW = L.contentW;
  const gap = 12;
  const colW = (fullW - gap) / 2;
  const pad = 12;
  const bodyW = colW - (pad * 2);

  const lTitleH = hText(doc, leftTitle, {
    font: 'Helvetica-Bold',
    size: 11,
    width: bodyW,
    lineGap: 2
  });
  const rTitleH = hText(doc, rightTitle, {
    font: 'Helvetica-Bold',
    size: 11,
    width: bodyW,
    lineGap: 2
  });
  const lBodyH = hText(doc, leftText, {
    font: 'Helvetica',
    size: 10.2,
    width: bodyW,
    lineGap: 3
  });
  const rBodyH = hText(doc, rightText, {
    font: 'Helvetica',
    size: 10.2,
    width: bodyW,
    lineGap: 3
  });

  const h = Math.max(lTitleH + 8 + lBodyH, rTitleH + 8 + rBodyH) + (pad * 2);

  drawRoundedCard(doc, x, y, colW, h, C.white, C.line, 14);
  drawRoundedCard(doc, x + colW + gap, y, colW, h, C.white, C.line, 14);

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(C.brandDark)
    .text(cleanText(leftTitle), x + pad, y + pad, {
      width: bodyW
    });

  doc
    .font('Helvetica')
    .fontSize(10.2)
    .fillColor(C.ink)
    .text(cleanText(leftText), x + pad, y + pad + lTitleH + 8, {
      width: bodyW,
      lineGap: 3
    });

  const rx = x + colW + gap;

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(C.brandDark)
    .text(cleanText(rightTitle), rx + pad, y + pad, {
      width: bodyW
    });

  doc
    .font('Helvetica')
    .fontSize(10.2)
    .fillColor(C.ink)
    .text(cleanText(rightText), rx + pad, y + pad + rTitleH + 8, {
      width: bodyW,
      lineGap: 3
    });

  doc.y = y + h + 14;
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
    margin: L.margin,
    autoFirstPage: true,
    info: {
      Title: 'Family Values Group — Commission Manual',
      Author: 'Family Values Group',
    }
  });

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const logo = tryLoadLogoBuffer();
  const bg = tryLoadBackgroundBuffer();

  /* ---------------- PAGE 1 ---------------- */

  startPage(doc, bg, logo, meRow, 1, { cover: true });

  addPageTitle(
    doc,
    'Commission Manual',
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

  /* ---------------- PAGE 2 ---------------- */

  startPage(doc, bg, logo, meRow, 2);

  addSectionBanner(
    doc,
    '1) How commissions are calculated',
    'The foundation: AP, commission rates, advances, pay-thru, renewals, and overrides.'
  );

  addBody(
    doc,
    'Your commission amounts are driven by Annual Premium (AP) and the carrier-specific commission schedule for the product you wrote. The platform annualizes the premium, matches the right schedule, and then applies the correct percentages.'
  );

  addMiniHeader(doc, 'Key definitions');

  addBullets(doc, [
    'Annual Premium (AP): the annualized premium used for commission calculations.',
    'Commission Rate: the percentage assigned to the matching carrier schedule.',
    'Advance: part of expected first-year commission paid upfront on the weekly cycle.',
    'Pay-Thru / Trails / Renewals: the remaining amount paid over time as commission is released.',
    'Overrides: commission earned from the production of agents in your downline.'
  ], { box: true });

  addMiniHeader(doc, 'Commission example');

  addTwoColExampleBox(
    doc,
    'Policy details',
    'Monthly premium: $80\nAnnual Premium: $960\nSchedule rate: 90%',
    'Payout breakdown',
    'Total commission: $864\nAdvance at 75%: $648\nRemaining pay-thru: $216'
  );

  /* ---------------- PAGE 3 ---------------- */

  startPage(doc, bg, logo, meRow, 3);

  addSectionBanner(
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

  /* ---------------- PAGE 4 ---------------- */

  startPage(doc, bg, logo, meRow, 4);

  addSectionBanner(
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

  /* ---------------- PAGE 5 ---------------- */

  startPage(doc, bg, logo, meRow, 5);

  addSectionBanner(
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

  /* ---------------- PAGE 6 ---------------- */

  startPage(doc, bg, logo, meRow, 6);

  addSectionBanner(
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

  /* ---------------- PAGE 7 ---------------- */

  startPage(doc, bg, logo, meRow, 7);

  addSectionBanner(
    doc,
    '6) SSN, W-9, 1099, and security',
    'Why this information may be required and how to handle it safely.'
  );

  addBody(
    doc,
    'To receive commission payouts, carriers and payment processors may require identity verification and tax reporting information. This commonly includes your Social Security Number or Tax ID for W-9 and 1099 reporting.'
  );

  addMiniHeader(doc, 'Why it may be required');

  addBullets(doc, [
    'Tax reporting: commissions are commonly reported on a 1099-NEC for independent agents.',
    'Identity verification: processors may require SSN or TIN to verify the payment recipient.',
    'Compliance: carriers may require tax information to issue producer payments correctly.'
  ], { box: true });

  addMiniHeader(doc, 'Security reminders');

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
