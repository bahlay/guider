import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function runFfmpeg(args, label) {
  const executable =
    process.env.FFMPEG_PATH || "/opt/homebrew/bin/ffmpeg";

  try {
    return await execFileAsync(executable, args, {
      maxBuffer: 20 * 1024 * 1024
    });
  } catch (error) {
    const details =
      error.stderr ||
      error.message ||
      "Unknown FFmpeg error";

    console.error(`\n${label} failed:\n${details}\n`);

    throw new Error(
      `${label} failed. FFmpeg says:\n${details
        .split("\n")
        .slice(-12)
        .join("\n")}`
    );
  }
}

export async function probe(file) {
  const ffprobe =
    process.env.FFPROBE_PATH || "/opt/homebrew/bin/ffprobe";

  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file
      ],
      {
        maxBuffer: 10 * 1024 * 1024
      }
    );

    const duration = Number(String(stdout).trim());

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Could not determine video duration.");
    }

    return {
      format: {
        duration
      }
    };
  } catch (error) {
    const details =
      error.stderr ||
      error.message ||
      "Unknown ffprobe error";

    console.error("\nFFPROBE ERROR:\n", details);

    throw new Error(
      `Could not read the uploaded MP4.\n${details}`
    );
  }
}

// Sampling interval, in seconds, between extracted frames.
//
// Tightened versus the original tiers (0.5 / 0.75 / 1.5) because
// claude.js now caps and evenly re-samples the frames actually SENT to
// the API (see MAX_FRAMES_TO_ANALYZE in claude.js). Extracting more raw
// frames here improves the odds of catching a fast click, keystroke, or
// dropdown selection -- WITHOUT increasing API cost, since the
// downstream cap keeps the number of frames actually sent to Claude (and
// therefore token cost) bounded regardless of how densely we sample on
// disk. Denser than this mainly costs local ffmpeg/disk time for
// diminishing benefit once the downstream cap is in place.
function intervalForDuration(duration) {
  if (duration <= 30) return 0.25;
  if (duration <= 90) return 0.4;
  return 0.6;
}

export async function extractFrames(video, outDir, duration) {
  fs.mkdirSync(outDir, { recursive: true });

  const interval = intervalForDuration(duration);

  await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-i",
      video,
      "-vf",
      `fps=1/${interval},scale=w='min(1200,iw)':h='min(1200,ih)':force_original_aspect_ratio=decrease`,
      "-q:v",
      "3",
      path.join(outDir, "frame-%04d.jpg")
    ],
    "Frame extraction"
  );

  const files = fs
    .readdirSync(outDir)
    .filter((file) => file.endsWith(".jpg"))
    .sort()
    .map((file) => path.join(outDir, file));

  const finalFrame = path.join(outDir, "final.jpg");

  // Grab the true final frame ~0.25s before EOF (avoids a black or
  // incomplete last frame some encoders produce right at EOF).
  const finalFrameOffset = 0.25;

  await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-sseof",
      `-${finalFrameOffset}`,
      "-i",
      video,
      "-frames:v",
      "1",
      "-vf",
      "scale=w='min(1200,iw)':h='min(1200,ih)':force_original_aspect_ratio=decrease",
      "-q:v",
      "3",
      finalFrame
    ],
    "Final frame extraction"
  );

  files.push(finalFrame);

  // IMPORTANT: the final frame is NOT part of the regular fps=1/interval
  // sequence, so its true timestamp is NOT (index * interval) -- that
  // formula only holds for the regularly-sampled frames. We report its
  // real timestamp explicitly here so downstream code (frame-index-to-
  // timestamp mapping, nearest-frame search during evidence refinement)
  // doesn't silently mislabel it. A wrong timestamp on this specific
  // frame is worse than on any other, since it's usually the frame that
  // proves the operation actually succeeded.
  const finalFrameTimestamp = Math.max(
    0,
    duration - finalFrameOffset
  );

  return {
    files,
    interval,
    finalFrameTimestamp
  };
}

export function imageData(file) {
  return fs.readFileSync(file).toString("base64");
}
