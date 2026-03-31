import fs from "fs";
import path from "path";
import sharp from "sharp";

const BELLOTA_BASE64 = fs
  .readFileSync(
    path.join(process.cwd(), "assets", "fonts", "encoded-20260331060637.txt"),
    "utf8"
  )
  .replace(/\s+/g, "");

function money(n) {
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function safeText(s) {
  return String(s ?? "").replace(/[<>&]/g, (m) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
  }[m]));
}

function buildOverlaySvg({ width, height }) {
  const rows = [
    { full_name: "Chancellor Johnson", ap: 4200 },
    { full_name: "John Smith", ap: 3100 },
    { full_name: "Jane Doe", ap: 2800 },
  ];

  const mtdAp = 15200;
  const dailyAp = 10100;

  const leftX = 90;
  const headerY = 150;
  const mtdY = 200;
  const dailyY = 248;
  const listStartY = 330;
  const rowH = 70;

  const colorTitle = "#2a245c";
  const colorSub = "#6b5e8a";
  const colorWhite = "#ffffff";
  const colorGold = "#f1d58b";
  const colorDark = "#1e1a3d";
  
  const listSvg = rows
    .map((r, i) => {
      const y = listStartY + i * rowH;
  
      return `
        <g>
          <rect x="${leftX}" y="${y - 40}" rx="14" ry="14" width="${width - leftX * 2}" height="58" fill="${colorWhite}" opacity="0.15" />
          <text class="bellota" x="${leftX + 22}" y="${y}" font-size="26" font-weight="800" fill="${colorGold}">${i + 1}.</text>
          <text class="bellota" x="${leftX + 70}" y="${y}" font-size="26" font-weight="700" fill="${colorDark}">${safeText(r.full_name)}</text>
          <text class="bellota" x="${width - leftX - 22}" y="${y}" font-size="26" font-weight="900" fill="${colorTitle}" text-anchor="end">${safeText(money(r.ap))}</text>
        </g>
      `;
    })
    .join("");

  return `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        @font-face {
          font-family: 'Bellota';
          src: url(data:font/ttf;base64,${BELLOTA_BASE64}) format("truetype");
          font-weight: 700;
          font-style: normal;
        }
    
        .bellota {
          font-family: 'Bellota';
          font-style: normal;
        }
      </style>
    </defs>
    <text class="bellota" x="${width / 2}" y="${headerY}" font-size="44" font-weight="900" fill="${colorTitle}" text-anchor="middle">
      Top Producers Tonight
    </text>

    <text class="bellota" x="${width / 2}" y="${headerY + 34}" font-size="20" font-weight="700" fill="${colorSub}" text-anchor="middle">
      TEST MODE
    </text>

    <!-- MTD -->
    <text class="bellota" x="${width / 2}" y="${mtdY}" font-size="22" font-weight="800" fill="${colorDark}" text-anchor="middle">
      Month-to-date AP: ${money(mtdAp)}
    </text>

    <!-- Daily -->
    <text class="bellota" x="${width / 2}" y="${dailyY}" font-size="22" font-weight="800" fill="${colorDark}" text-anchor="middle">
      Total AP Today: ${money(dailyAp)}
    </text>

    ${listSvg}
  </svg>`;
}

export default async function handler() {
  try {
    const templatePath = path.join(
      process.cwd(),
      "assets",
      "announcements",
      "top-producers-template.jpg"
    );

    if (!fs.existsSync(templatePath)) {
      return new Response("Template not found", { status: 500 });
    }

    const base = sharp(templatePath);
    const meta = await base.metadata();

    const width = meta.width || 1080;
    const height = meta.height || 1350;

    const svg = buildOverlaySvg({ width, height });

    const buffer = await base
      .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
      .jpeg({ quality: 90 })
      .toBuffer();

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response(e.message, { status: 500 });
  }
}
