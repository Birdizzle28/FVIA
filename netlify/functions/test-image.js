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

    // Background image
    if (fs.existsSync(bgPath)) {
      doc.image(bgPath, 0, 0, { width: 1080, height: 1350 });
    } else {
      doc.rect(0, 0, 1080, 1350).fill("#f7f3ff");
    }

    // Title
    doc
      .font("BellotaBold")
      .fontSize(44)
      .fillColor("#2a245c")
      .text("Top Producers Tonight", 0, 120, {
        width: 1080,
        align: "center",
      });

    doc
      .font("BellotaBold")
      .fontSize(20)
      .fillColor("#6b5e8a")
      .text("TEST MODE", 0, 170, {
        width: 1080,
        align: "center",
      });

    // MTD pill
    doc
      .save()
      .roundedRect(280, 205, 520, 56, 18)
      .fillOpacity(0.18)
      .fill("#ffffff")
      .restore();

    doc
      .font("BellotaBold")
      .fontSize(22)
      .fillColor("#ffffff")
      .text(`Month-to-date AP: ${money(15200)}`, 0, 221, {
        width: 1080,
        align: "center",
      });

    // Daily pill
    doc
      .save()
      .roundedRect(280, 268, 520, 56, 18)
      .fillOpacity(0.14)
      .fill("#ffffff")
      .restore();

    doc
      .font("BellotaBold")
      .fontSize(22)
      .fillColor("#ffffff")
      .text(`Total AP Today: ${money(10100)}`, 0, 284, {
        width: 1080,
        align: "center",
      });

    const rows = [
      { full_name: "Chancellor Johnson", ap: 4200 },
      { full_name: "John Smith", ap: 3100 },
      { full_name: "Jane Doe", ap: 2800 },
    ];

    const leftX = 90;
    const listStartY = 380;
    const rowH = 70;

    rows.forEach((r, i) => {
      const y = listStartY + i * rowH;

      doc
        .save()
        .roundedRect(leftX, y - 24, 1080 - leftX * 2, 58, 14)
        .fillOpacity(i % 2 === 0 ? 0.16 : 0.10)
        .fill("#ffffff")
        .restore();

      doc
        .font("BellotaBold")
        .fontSize(26)
        .fillColor("#f1d58b")
        .text(`${i + 1}.`, leftX + 22, y - 2, {
          width: 50,
        });

      doc
        .font("BellotaBold")
        .fontSize(26)
        .fillColor("#1e1a3d")
        .text(r.full_name, leftX + 70, y - 2, {
          width: 600,
        });

      doc
        .font("BellotaBold")
        .fontSize(26)
        .fillColor("#2a245c")
        .text(money(r.ap), 0, y - 2, {
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
