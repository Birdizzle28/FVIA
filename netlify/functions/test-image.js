// netlify/functions/test-image.js
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

function money(n) {
  return Number(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export async function handler() {
  try {
    const fontPath = path.join(
      process.cwd(),
      "assets",
      "fonts",
      "BellotaText-Bold.ttf"
    );

    const bgPath = path.join(
      process.cwd(),
      "assets",
      "announcements",
      "top-producers-template.jpg"
    );

    if (!fs.existsSync(fontPath)) {
      return {
        statusCode: 500,
        body: `Missing font file: ${fontPath}`,
      };
    }

    const doc = new PDFDocument({
      size: [1080, 1350],
      margin: 0,
      info: {
        Title: "Top Producers Test",
        Author: "Family Values Group",
      },
    });

    const chunks = [];
    doc.on("data", (c) => chunks.push(c));

    doc.registerFont("BellotaBold", fontPath);

    if (fs.existsSync(bgPath)) {
      doc.image(bgPath, 0, 0, { width: 1080, height: 1350 });
    } else {
      doc.rect(0, 0, 1080, 1350).fill("#f7f3ff");
    }

    const headerY = 240;
    const subY = 295;
    const mtdBoxY = 345;
    const dailyBoxY = 420;
    const listStartY = 555;

    const darkPurple = "#3d3a78";
    const darkPurple2 = "#353468";

    doc
      .font("BellotaBold")
      .fontSize(44)
      .fillColor("#2a245c")
      .text("Top Producers Tonight", 0, headerY, {
        width: 1080,
        align: "center",
      });

    doc
      .font("BellotaBold")
      .fontSize(20)
      .fillColor("#6b5e8a")
      .text("TEST MODE", 0, subY, {
        width: 1080,
        align: "center",
      });

    doc
      .save()
      .roundedRect(260, mtdBoxY, 560, 64, 20)
      .fillOpacity(0.92)
      .fill(darkPurple)
      .restore();

    doc
      .font("BellotaBold")
      .fontSize(22)
      .fillColor("#ffffff")
      .text(`Month-to-date AP: ${money(15200)}`, 0, mtdBoxY + 19, {
        width: 1080,
        align: "center",
      });

    doc
      .save()
      .roundedRect(260, dailyBoxY, 560, 64, 20)
      .fillOpacity(0.92)
      .fill(darkPurple2)
      .restore();

    doc
      .font("BellotaBold")
      .fontSize(22)
      .fillColor("#ffffff")
      .text(`Total AP Today: ${money(10100)}`, 0, dailyBoxY + 19, {
        width: 1080,
        align: "center",
      });

    const rows = [
      { full_name: "Chancellor Johnson", ap: 4200 },
      { full_name: "John Smith", ap: 3100 },
      { full_name: "Jane Doe", ap: 2800 },
    ];

    const leftX = 90;
    const rowH = 72; // about half the previous spacing

    rows.forEach((r, i) => {
      const y = listStartY + i * rowH;

      doc
        .save()
        .roundedRect(leftX, y - 22, 1080 - leftX * 2, 56, 16)
        .fillOpacity(i % 2 === 0 ? 0.92 : 0.86)
        .fill(i % 2 === 0 ? darkPurple : darkPurple2)
        .restore();

      doc
        .font("BellotaBold")
        .fontSize(24)
        .fillColor("#f1d58b")
        .text(`${i + 1}.`, leftX + 22, y + 2, {
          width: 50,
        });

      doc
        .font("BellotaBold")
        .fontSize(24)
        .fillColor("#ffffff")
        .text(r.full_name, leftX + 80, y + 2, {
          width: 600,
        });

      doc
        .font("BellotaBold")
        .fontSize(24)
        .fillColor("#ffffff")
        .text(money(r.ap), 0, y + 2, {
          width: 1080 - leftX - 22,
          align: "right",
        });
    });

    doc.end();

    const pdfBuffer = await new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="top-producers-test.pdf"',
        "Cache-Control": "no-store",
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    console.error("test-image error:", e);
    return {
      statusCode: 500,
      body: e?.message || "Unknown error",
    };
  }
}
