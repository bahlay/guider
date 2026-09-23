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

// Color per flag type, matching the four categories used throughout the
// pipeline (see claude.js's prompt schema). Kept simple/legible for
// print rather than trying to match on-screen UI styling exactly.
const FLAG_STYLES = {
  corrected_mistake: {
    label: "Corrected mistake",
    color: "#96690F"
  },
  missing_step: {
    label: "Possible missing step",
    color: "#B4442E"
  },
  low_confidence: {
    label: "Low confidence",
    color: "#7A5FB8"
  },
  unverified_outcome: {
    label: "Unverified outcome",
    color: "#B4442E"
  }
};

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

  const flagStyle = step.flag
    ? FLAG_STYLES[step.flag]
    : null;

  const flagText = flagStyle
    ? `${flagStyle.label}${
        step.flagNote ? " — " + step.flagNote : ""
      }`
    : "";

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

  const flagHeight = flagText
    ? doc.heightOfString(flagText, {
        width: contentWidth,
        lineGap: 2
      }) + 8
    : 0;

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
    flagHeight +
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

  if (flagText) {
    doc.moveDown(0.3);

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(flagStyle.color)
      .text(flagText, {
        width: contentWidth,
        lineGap: 2
      });
  }

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

// Renders the guide-level "notes" (FYI, no action needed -- e.g. a
// toggle that was switched on then back off with no net effect) and
// "warnings" (genuinely uncertain, needs human review) sections at the
// end of the PDF. Without this, that information exists in the JSON
// response but never reaches the actual exported document, which is the
// deliverable most likely to be read on its own.
export function addPdfAsides(doc, notes = [], warnings = []) {
  const margin = 42;
  const contentWidth = doc.page.width - margin * 2;

  function renderList(heading, items, color) {
    if (!items || !items.length) return;

    const availableHeight =
      doc.page.height - margin - doc.y;

    if (availableHeight < 80) {
      doc.addPage();
      addPdfHeader(doc);
    }

    doc.moveDown(0.6);

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(color)
      .text(heading, {
        width: contentWidth
      });

    doc.moveDown(0.3);

    items.forEach((item) => {
      doc
        .font("Helvetica")
        .fontSize(9.5)
        .fillColor("#333333")
        .text(`•  ${item}`, {
          width: contentWidth,
          lineGap: 2
        });

      doc.moveDown(0.2);
    });
  }

  renderList("Additional notes", notes, "#3B4A63");
  renderList("Needs human review", warnings, "#B4442E");
}
