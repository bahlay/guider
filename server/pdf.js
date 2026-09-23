import fs from "fs";
import path from "path";

export function safeName(value) {
  return String(value).replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );
}

export function getPdfImagePath(step, outputs) {
  if (!step?.imageUrl) {
    return null;
  }

  const parts = String(step.imageUrl)
    .split("/")
    .filter(Boolean);

  if (parts.length < 4) {
    console.error(
      "PDF: invalid imageUrl:",
      step.imageUrl
    );
    return null;
  }

  const job = safeName(parts[2]);
  const file = safeName(parts[3]);

  const target = path.resolve(
    outputs,
    job,
    file
  );

  const outputRoot = path.resolve(outputs);

  if (
    !target.startsWith(
      outputRoot + path.sep
    )
  ) {
    console.error(
      "PDF: unsafe image path:",
      target
    );
    return null;
  }

  if (!fs.existsSync(target)) {
    console.error(
      "PDF: image does not exist:",
      target
    );
    return null;
  }

  return target;
}

export function addPdfHeader(doc, title = "") {
  const margin = 42;
  const logoSize = 30;

  doc
    .roundedRect(
      margin,
      36,
      logoSize,
      logoSize,
      8
    )
    .fill("#171817");

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#ffffff")
    .text(
      "G",
      margin,
      44,
      {
        width: logoSize,
        height: 24,
        align: "center",
        lineBreak: false
      }
    );

  doc
    .font("Helvetica-Bold")
    .fontSize(18)
    .fillColor("#151615")
    .text(
      "Guider",
      margin + 40,
      42
    );

  if (title) {
    doc
      .font("Helvetica-Bold")
      .fontSize(15)
      .fillColor("#111111")
      .text(
        title,
        margin + 145,
        44,
        {
          width:
            doc.page.width -
            margin * 2 -
            145,
          lineBreak: false
        }
      );
  }

  doc
    .moveTo(
      margin,
      82
    )
    .lineTo(
      doc.page.width - margin,
      82
    )
    .strokeColor("#dedfd9")
    .stroke();

  doc.y = 100;
}

export function addPdfStep(
  doc,
  step,
  index,
  outputs
) {
  const margin = 42;

  const contentWidth =
    doc.page.width - margin * 2;

  const imagePath =
    getPdfImagePath(step, outputs);

  const title =
    `${index + 1}. ${step.title || "Step"}`;

  const instruction =
    step.instruction || "";

  const imageMaxHeight =
    doc.page.height -
    margin * 2 -
    120;

  const titleHeight =
    doc.heightOfString(title, {
      width: contentWidth
    });

  const instructionHeight =
    doc.heightOfString(instruction, {
      width: contentWidth,
      lineGap: 3
    });

  const estimatedImageHeight =
    imagePath
      ? Math.min(
          imageMaxHeight,
          contentWidth * 0.56
        )
      : 0;

  const requiredHeight =
    titleHeight +
    8 +
    instructionHeight +
    (imagePath
      ? 14 + estimatedImageHeight
      : 0) +
    20;

  const availableHeight =
    doc.page.height -
    margin -
    doc.y;

  if (
    requiredHeight > availableHeight &&
    doc.y > 110
  ) {
    doc.addPage();
    addPdfHeader(doc);
  }

  doc
    .font("Helvetica-Bold")
    .fontSize(13.5)
    .fillColor("#111111")
    .text(title, {
      width: contentWidth
    });

  doc.moveDown(0.3);

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#333333")
    .text(instruction, {
      width: contentWidth,
      lineGap: 3
    });

  if (imagePath) {
    doc.moveDown(0.55);

    const imageY = doc.y;

    doc.image(
      imagePath,
      margin,
      imageY,
      {
        fit: [
          contentWidth,
          imageMaxHeight
        ],
        align: "center",
        valign: "top"
      }
    );

    doc.y =
      imageY +
      estimatedImageHeight +
      18;
  } else {
    doc.moveDown(0.8);
  }
}