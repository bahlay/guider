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

export async function extractFrames(video, outDir, duration) {
  fs.mkdirSync(outDir, { recursive: true });

  const interval =
    duration <= 30
      ? 0.5
      : duration <= 90
        ? 0.75
        : 1.5;

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

  await runFfmpeg(
    [
      "-hide_banner",
      "-y",
      "-sseof",
      "-0.25",
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

  return {
    files,
    interval
  };
}

export function imageData(file) {
  return fs.readFileSync(file).toString("base64");
}