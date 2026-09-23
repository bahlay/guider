import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import PDFDocument from "pdfkit";

import {
  probe,
  extractFrames
} from "./video.js";

import {
  analyzeWithClaude
} from "./claude.js";

import {
  safeName,
  addPdfHeader,
  addPdfStep,
  addPdfAsides
} from "./pdf.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const ROOT = process.cwd();
const UPLOADS = path.join(ROOT, "uploads");
const OUTPUTS = path.join(ROOT, "outputs");

fs.mkdirSync(UPLOADS, {
  recursive: true
});

fs.mkdirSync(OUTPUTS, {
  recursive: true
});

const upload = multer({
  dest: UPLOADS,
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});

app.post(
  "/api/analyze",
  upload.single("video"),
  async (req, res) => {
    const started = Date.now();
    let input = req.file?.path;

    if (!input) {
      return res.status(400).json({
        error: "No video uploaded."
      });
    }

    try {
      if (
        !req.file.originalname
          .toLowerCase()
          .endsWith(".mp4")
      ) {
        throw new Error(
          "Only MP4 files are supported."
        );
      }

      const info = await probe(input);

      const duration = Number(
        info.format?.duration || 0
      );

      if (
        !duration ||
        duration > 120.5
      ) {
        throw new Error(
          `Video must be 2 minutes or shorter. Detected ${duration.toFixed(
            1
          )} seconds.`
        );
      }

      const job =
        crypto.randomUUID();

      const frameDir = path.join(
        OUTPUTS,
        job
      );

      const {
        files: frames,
        interval,
        finalFrameTimestamp
      } = await extractFrames(
        input,
        frameDir,
        duration
      );

      const framesStarted = Date.now();

      const guide =
        await analyzeWithClaude(
          frames,
          interval,
          duration,
          req.file.originalname,
          finalFrameTimestamp
        );

      const analysisMs =
        Date.now() - framesStarted;

      const frameBase =
        path.basename(frameDir);

      guide.steps =
        (guide.steps || []).map(
          (step) => {
            const index = Math.max(
              0,
              Math.min(
                frames.length - 1,
                Number(
                  step.frameIndex ?? 0
                )
              )
            );

            const imageName =
              path.basename(
                frames[index]
              );

            return {
              ...step,
              timestamp: Number(
                step.timestamp ??
                  index * interval
              ),
              imageUrl: `/api/frames/${frameBase}/${imageName}`
            };
          }
        );

      // These numbers come straight from what actually happened this
      // run (real token counts from the API responses, real wall-clock
      // time), not an estimate written separately -- see claude.js's
      // usage tracker. MODEL_RATES_USD_PER_MTOK in claude.js is a
      // hardcoded snapshot of published pricing; verify against
      // Anthropic's live pricing page before quoting these numbers
      // anywhere final, and note that hosting/infra cost is separate
      // from this per-operation API cost estimate.
      guide.metrics = {
        totalSeconds:
          (Date.now() - started) /
          1000,
        analysisSeconds: analysisMs / 1000,
        videoDurationSeconds:
          duration,
        framesExtracted: frames.length,
        framesAnalyzed:
          guide.framesAnalyzed ??
          Math.min(frames.length, 50),
        frameIntervalSeconds:
          interval,
        buildModel:
          process.env.ANTHROPIC_MODEL ||
          "claude-sonnet-5",
        refineModel:
          process.env.ANTHROPIC_REFINE_MODEL ||
          "claude-haiku-4-5-20251001",
        estimatedCostUsd:
          guide.usage?.estimatedCostUsd ?? null,
        totalApiCalls:
          guide.usage?.totalApiCalls ?? null,
        totalApiSeconds: guide.usage
          ? guide.usage.totalApiMs / 1000
          : null
      };

      res.json(guide);
    } catch (error) {
      console.error(error);

      res.status(500).json({
        error:
          error.message ||
          "Analysis failed."
      });
    } finally {
      try {
        fs.unlinkSync(input);
      } catch {}
    }
  }
);

app.post(
  "/api/pdf",
  async (req, res) => {
    try {
      const {
        title,
        steps,
        notes,
        warnings
      } = req.body || {};

      if (
        !title ||
        !Array.isArray(steps)
      ) {
        return res.status(400).json({
          error:
            "Invalid guide data."
        });
      }

      const doc = new PDFDocument({
        size: "A4",
        layout: "landscape",
        margins: {
          top: 42,
          bottom: 42,
          left: 42,
          right: 42
        },
        autoFirstPage: true
      });

      res.setHeader(
        "Content-Type",
        "application/pdf"
      );

      res.setHeader(
        "Content-Disposition",
        'attachment; filename="guider-guide.pdf"'
      );

      doc.pipe(res);

      addPdfHeader(doc, title);

      steps.forEach(
        (step, index) => {
          addPdfStep(
            doc,
            step,
            index,
            OUTPUTS
          );
        }
      );

      addPdfAsides(
        doc,
        Array.isArray(notes) ? notes : [],
        Array.isArray(warnings) ? warnings : []
      );

      doc.end();
    } catch (error) {
      console.error(
        "PDF generation failed:",
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          error:
            error.message ||
            "Could not generate PDF."
        });
      }
    }
  }
);

app.get(
  "/api/frames/:job/:file",
  (req, res) => {
    const file = safeName(
      req.params.file
    );

    const job = safeName(
      req.params.job
    );

    const outputRoot =
      path.resolve(OUTPUTS);

    const target = path.resolve(
      OUTPUTS,
      job,
      file
    );

    if (
      !target.startsWith(
        outputRoot + path.sep
      ) ||
      !fs.existsSync(target)
    ) {
      return res.status(404).end();
    }

    res.sendFile(target);
  }
);

app.get(
  "/api/health",
  (_, res) =>
    res.json({ ok: true })
);

const port = Number(
  process.env.PORT || 8787
);

app.listen(port, () => {
  console.log(
    `Guider API running on http://localhost:${port}`
  );
});
