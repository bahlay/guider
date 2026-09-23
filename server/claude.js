import Anthropic from "@anthropic-ai/sdk";
import { imageData } from "./video.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Pass 1 (buildGuide) does the hard judgment work: reconstructing a
// whole multi-step workflow from many images at once. Keep this on the
// stronger model.
const MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

// Pass 2 (refineStepEvidence) picks the single best frame among a
// handful of close-together candidates for ONE step at a time. This
// still requires precise visual judgment -- telling an open dropdown
// from closed, or a cursor exactly on a checkbox vs. merely near it --
// so it defaults to the SAME model as pass 1 rather than a cheaper one.
// A prior attempt to move this to a cheaper model measurably hurt
// screenshot precision; that assumption ("narrow task = easy task") was
// wrong for fine-grained visual grounding specifically. Override via env
// var only after you've confirmed quality holds up with your own tests.
const REFINE_MODEL =
  process.env.ANTHROPIC_REFINE_MODEL ||
  MODEL;

// Approximate published per-million-token rates (USD), used only to
// estimate cost for the metrics report. ALWAYS re-check against
// Anthropic's live pricing page (https://platform.claude.com/docs/en/about-claude/pricing)
// before quoting these as final -- rates change and are not fetched
// dynamically here. Current as of the date this file was last edited.
const MODEL_RATES_USD_PER_MTOK = {
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0 }
};

// Frames actually sent to Pass 1 are capped here as a safety ceiling,
// not a routine constraint -- this was set too aggressively (50) in a
// prior revision while trying to fix a cost-related log inaccuracy, and
// that cut measurably hurt precision by showing pass 1 roughly a third
// of the frames it used to see for a typical test video. 150 keeps
// effectively all frames for any recording under the app's 2-minute
// limit (a 120s video at the densest interval tier produces ~200 raw
// frames, so this still trims extreme cases without binding on normal
// ones). Tune down via ANTHROPIC_MAX_FRAMES once you've checked real
// measured cost (see guide.metrics / guide.usage) against your budget --
// don't guess at this number without looking at the actual cost first.
const MAX_FRAMES_TO_ANALYZE = Number(
  process.env.ANTHROPIC_MAX_FRAMES
) || 150;

function parseJson(text) {
  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: the model may have written analysis/reasoning BEFORE the
    // JSON despite being told not to (this happens more than you'd
    // expect on complex prompts). Try every "{" in the string in turn,
    // walking forward from each to find ITS matching "}" via brace
    // depth-tracking, and attempt to parse that slice. We don't stop at
    // the first "{" found -- if the preamble itself contains a stray
    // brace (e.g. the model quoting an inline example while explaining
    // itself), that first slice may fail to parse, and naively giving up
    // there would miss the real JSON object later in the text.
    let searchFrom = 0;

    while (true) {
      const start = cleaned.indexOf("{", searchFrom);
      if (start === -1) break;

      let depth = 0;
      let end = -1;

      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === "{") depth++;

        if (cleaned[i] === "}") {
          depth--;

          if (depth === 0) {
            end = i;
            break;
          }
        }
      }

      if (end === -1) break; // unterminated from here on, nothing more to try

      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        searchFrom = start + 1; // this candidate wasn't it -- try the next "{"
      }
    }

    console.error(
      "Claude raw response:",
      cleaned
    );

    throw new Error(
      "Claude did not return valid JSON."
    );
  }
}

function makeFrameObjects(
  files,
  interval,
  finalFrameTimestamp
) {
  const lastIndex = files.length - 1;

  return files.map((file, index) => ({
    file,
    index,
    // The final frame (see video.js) isn't part of the regular
    // fps=1/interval sequence, so index * interval would mislabel it --
    // use its real reported timestamp instead.
    timestamp:
      index === lastIndex &&
      typeof finalFrameTimestamp === "number"
        ? finalFrameTimestamp
        : index * interval,
  }));
}

// Evenly samples down to `maxCount` frames across the WHOLE recording,
// rather than just taking the first N (which would bias coverage toward
// the start of the video and could miss everything after it). Always
// keeps the first and last frame -- the last frame in particular is
// usually the strongest evidence of whether the operation actually
// succeeded, so it must never be dropped by sampling.
function sampleFrames(frames, maxCount) {
  if (frames.length <= maxCount) {
    return frames;
  }

  const lastIndex = frames.length - 1;
  const step = lastIndex / (maxCount - 1);
  const result = [];
  const seen = new Set();

  for (let i = 0; i < maxCount; i++) {
    const idx = Math.min(
      Math.round(i * step),
      lastIndex
    );

    if (!seen.has(idx)) {
      seen.add(idx);
      result.push(frames[idx]);
    }
  }

  return result;
}

function nearestFrame(
  frames,
  timestamp
) {
  if (!frames.length) return null;

  return frames.reduce(
    (best, frame) => {
      const bestDistance =
        Math.abs(
          best.timestamp -
            timestamp
        );

      const currentDistance =
        Math.abs(
          frame.timestamp -
            timestamp
        );

      return currentDistance <
        bestDistance
        ? frame
        : best;
    }
  );
}

function getNearbyFrames(
  frames,
  timestamp,
  radius = 3
) {
  if (!frames.length) return [];

  const candidates =
    frames.filter(
      (frame) =>
        Math.abs(
          frame.timestamp -
            timestamp
        ) <= radius
    );

  if (candidates.length) {
    return candidates;
  }

  const nearest =
    nearestFrame(
      frames,
      timestamp
    );

  return nearest
    ? [nearest]
    : [];
}

// Tracks token usage and timing for every Claude call in a single video's
// analysis, so the app can report a REAL measured cost/time per video
// rather than an estimate written after the fact.
function createUsageTracker() {
  const calls = [];

  return {
    record(stage, model, inputTokens, outputTokens, ms) {
      calls.push({
        stage,
        model,
        inputTokens,
        outputTokens,
        ms
      });
    },
    summary() {
      let estimatedCostUsd = 0;
      let totalApiMs = 0;

      for (const call of calls) {
        const rate =
          MODEL_RATES_USD_PER_MTOK[call.model] || {
            input: 0,
            output: 0
          };

        estimatedCostUsd +=
          (call.inputTokens / 1_000_000) * rate.input +
          (call.outputTokens / 1_000_000) * rate.output;

        totalApiMs += call.ms;
      }

      return {
        calls,
        totalApiCalls: calls.length,
        estimatedCostUsd: Number(
          estimatedCostUsd.toFixed(6)
        ),
        totalApiMs
      };
    }
  };
}

async function callClaude(
  content,
  { model = MODEL, maxTokens = 12000, stage, usage } = {}
) {
  const started = Date.now();

  const response =
    await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content,
        },
      ],
    });

  const ms = Date.now() - started;

  if (usage) {
    usage.record(
      stage || "unknown",
      model,
      response.usage?.input_tokens || 0,
      response.usage?.output_tokens || 0,
      ms
    );
  }

  return response.content
    .filter(
      (item) =>
        item.type === "text"
    )
    .map(
      (item) => item.text
    )
    .join("\n");
}

async function buildGuide(
  frames,
  duration,
  originalname,
  usage
) {
  const selectedFrames = sampleFrames(
    frames,
    MAX_FRAMES_TO_ANALYZE
  );

  const content = [
    {
      type: "text",
      text: `
You are reconstructing a precise, reproducible how-to guide from a screen recording.

VIDEO:
${originalname || "screen recording"}

DURATION:
${Number(duration || 0).toFixed(2)} seconds

The video shows ONE browser operation.

VISUAL EVIDENCE IS THE SOURCE OF TRUTH.

Your job is to:

1. Understand what the user actually did.
2. Reconstruct the smallest workflow needed to reproduce the successful final state.
3. Remove abandoned mistakes and intermediate values that were later changed.
4. Preserve final intended values.
5. Never invent an action that is not visibly supported.
6. Include silent visible actions when they are necessary.
7. Omit unchanged/default settings unless the user explicitly changed them.
8. Confirm the final successful state from the recording.
9. Identify any critical transition that is not visually supported.
10. Produce 3–8 concise steps.

TIMESTAMP RULE:

For every step, timestamp means the moment when the ACTION described by the instruction actually happens.

Do NOT use the timestamp of the resulting state merely because it is easier to read.

Examples:

- "Click Create new table" → use the frame where the original page is visible and the cursor is on Create new table, BEFORE the modal opens.
- "Enter Guider as the table name" → use a frame showing the input field being edited, ideally with the cursor inside the field.
- "Enable Realtime" → use a frame showing the cursor directly on the Realtime checkbox/toggle during the interaction.
- "Select numeric" → use a frame showing the dropdown OPEN with numeric visible and the cursor on/near the intended option.
- "Save the table" → use a frame showing the cursor on the Save button during/just before the click.
- Final verification → use the resulting successful state.

CORRECTIONS AND TRANSPARENCY:

If a value is changed multiple times, use the final value that is actually committed in the successful state. Do not recommend abandoned values, and do not give an abandoned action its own numbered step.

But do NOT silently erase evidence of a correction -- transparency about what was corrected is required, not optional:

- If a whole action was tried and fully reversed with NO net effect on the final result (e.g. a toggle switched on then back off, ending exactly where it started), add ONE entry to "notes" describing this plainly (e.g. "The Public toggle was switched on and off; this had no effect on the final result and was left out of the steps."). Do not create a step for it.
- If a segment mixes an abandoned sub-action with a kept one (e.g. "typed the name AND toggled a setting that was later reverted"), still create the step for the KEPT part, and separately note the abandoned part in "notes".
- If a value was corrected to something DIFFERENT from its starting/default state (not just reverted to where it started), it still needs its own step describing the FINAL value, with "flag": "corrected_mistake" and a "flagNote" explaining what was tried and changed.

DEFAULTS:

If a setting starts at some default and the recording leaves it unchanged, do not make it a step. If EVERY optional setting on a form ends up unchanged from default, add one short clause to the step nearest the final commit action (e.g. "...then, leaving the optional settings unchanged, click Save") rather than omitting any mention of them at all.

If the user explicitly changes a setting, include it as its own step.

DROPDOWNS:

For a dropdown/select action, the preferred timestamp MUST correspond to a frame where:

- the dropdown is OPEN;
- the intended option is visibly present;
- the cursor is on or clearly associated with the intended option.

Do not use a later closed dropdown merely because the selected value is visible.

If no frame clearly captures the dropdown interaction, use the clearest available frame showing the final selected value, set "flag": "low_confidence", and say so plainly in "flagNote".

SCREENSHOTS:

The screenshot for each step must visually support the ACTION described by the step.

The screenshot and evidence note must refer to the SAME exact frame.

For text entry:

- prefer a frame where the cursor is directly inside or clearly over the relevant input field;
- the intended value should also be visible if possible.
- If NO frame clearly shows the value being entered, but a LATER frame confirms the true final value (e.g. the created item's own listed properties), you may reference that later frame as evidence instead -- state the confirmed value plainly in the instruction, set "flag": "low_confidence", and explain in "flagNote" that the exact typing moment wasn't clearly captured even though the final value is confirmed elsewhere.

For checkbox/toggle:

- prefer a frame where the cursor is directly on or clearly touching the control.

For buttons:

- prefer a frame immediately before/during the click with the cursor directly on the button.

For Create New Table:

- prefer the original screen with the cursor on Create new table;
- NEVER use the already-open modal as evidence for the click that opened the modal.

The action that COMMITS the operation (e.g. clicking "Save"/"Create") and the step that shows the CONFIRMATION of success (e.g. a toast, the new item appearing in a list) are always TWO SEPARATE STEPS, even if one segment of the recording captures both. Never write one instruction that describes both the click and its result together. If the recording doesn't clearly show a success confirmation, set "flag": "unverified_outcome" on the last step and say so honestly in "flagNote" rather than claiming a success the footage doesn't show.

If the recording jumps over a step that seems necessary but isn't shown (a state changed with no visible cause), add a step (or, if nothing can usefully be instructed, a "notes" entry) with "flag": "missing_step" explaining what's missing. Do not invent a plausible action to fill the gap.

IMPORTANT:

Do not choose a later result frame merely because the final value is clearer, UNLESS you are explicitly using the "later frame as evidence for an unclear value" allowance above, and you disclose it via "flag": "low_confidence".

The selected frame must represent the action described by the instruction.

Return ONLY valid JSON. Do not write any analysis, reasoning, or commentary before the JSON -- your reply must start with "{" as its very first character. Do all your reasoning internally, then output only the final JSON object.

Use exactly this shape:

{
  "title": "How to ...",
  "summary": "One short sentence.",
  "steps": [
    {
      "step": 1,
      "instruction": "Click ...",
      "timestamp": 12.5,
      "frame": 25,
      "evidence": "The Create new table control is visible with the cursor on it.",
      "flag": null,
      "flagNote": null
    }
  ],
  "notes": [
    "FYI context needing no user action, e.g. a toggle switched on then back off with no net effect."
  ],
  "warnings": [
    "Anything genuinely uncertain that needs human review."
  ]
}

"flag" must be exactly one of: null, "corrected_mistake", "missing_step", "low_confidence", "unverified_outcome".

Do not include markdown.
`,
    },
  ];

  for (const frame of selectedFrames) {
    content.push({
      type: "text",
      text:
        `FRAME ${frame.index} — ` +
        `${frame.timestamp.toFixed(2)}s`,
    });

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: imageData(
          frame.file
        ),
      },
    });
  }

  const raw = await callClaude(content, {
    model: MODEL,
    maxTokens: 12000,
    stage: "build_guide",
    usage
  });

  const parsed = parseJson(raw);

  // Defensive validation: a syntactically-valid JSON object doesn't
  // guarantee the right shape. Drop any step missing the fields the rest
  // of the pipeline depends on, rather than letting a malformed step
  // silently propagate through frame lookups and the PDF export.
  const steps = Array.isArray(parsed.steps)
    ? parsed.steps.filter((step) => {
        const valid =
          step &&
          typeof step.instruction === "string" &&
          step.instruction.trim().length > 0 &&
          Number.isFinite(Number(step.timestamp));

        if (!valid) {
          console.error(
            "Dropping malformed step from model output:",
            step
          );
        }

        return valid;
      })
    : [];

  return {
    ...parsed,
    steps,
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings
      : []
  };
}

async function refineStepEvidence(
  step,
  frames,
  usage
) {
  const candidates =
    getNearbyFrames(
      frames,
      Number(step.timestamp),
      3
    );

  if (!candidates.length) {
    return step;
  }

  const content = [
    {
      type: "text",
      text: `
Select the SINGLE best screenshot for this browser how-to step.

STEP:
"${step.instruction}"

The original action timestamp selected by another model is:
${step.timestamp}s

Your task is ONLY to select the best frame from the candidate frames below.

CRITICAL RULE:

Choose the frame that most directly captures the ACTION described by the instruction.

Do NOT choose a later resulting state merely because the final value is clearer.

RULES:

1. The screenshot must support the exact action.
2. The evidence must describe ONLY what is visible in the selected frame.
3. Button click:
   prefer the frame immediately before/during the click with the cursor directly on the button.
4. Text entry:
   prefer the frame with the cursor directly inside/over the input field and the intended value visible.
5. Checkbox/toggle:
   prefer the frame with the cursor directly on the checkbox/toggle.
6. Dropdown/select:
   if ANY candidate shows the dropdown OPEN with the intended option visible, you MUST select that frame.
7. NEVER select a closed dropdown when a candidate shows the dropdown open with the intended option.
8. Create new table:
   select the original page with the cursor on Create new table.
   NEVER select the already-open modal as evidence for this click.
9. If no frame clearly captures the interaction, choose the closest useful frame and state the limitation honestly.
10. Never claim that something was clicked, typed, selected, opened, or changed unless the selected frame visibly supports it.

Return ONLY:

{
  "frame": 12,
  "evidence": "Short description of exactly what is visible in this frame."
}

No markdown.
`,
    },
  ];

  for (const frame of candidates) {
    content.push({
      type: "text",
      text:
        `CANDIDATE FRAME ${frame.index} — ` +
        `${frame.timestamp.toFixed(2)}s`,
    });

    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: imageData(
          frame.file
        ),
      },
    });
  }

  try {
    const raw =
      await callClaude(
        content,
        {
          model: REFINE_MODEL,
          maxTokens: 3000,
          stage: "refine_evidence",
          usage
        }
      );

    const selected =
      parseJson(raw);

    const actualFrame =
      candidates.find(
        (frame) =>
          Number(frame.index) ===
          Number(
            selected.frame
          )
      );

    if (!actualFrame) {
      const fallback =
        nearestFrame(
          candidates,
          Number(
            step.timestamp
          )
        );

      return {
        ...step,
        frameIndex:
          fallback?.index ??
          step.frameIndex ??
          0,
        timestamp:
          fallback?.timestamp ??
          step.timestamp,
      };
    }

    return {
      ...step,
      frameIndex: actualFrame.index,
      timestamp: actualFrame.timestamp,
      evidence: selected.evidence,
    };
  } catch (error) {
    console.error(
      "Evidence refinement failed:",
      error.message
    );

    const fallback =
      nearestFrame(
        candidates,
        Number(
          step.timestamp
        )
      );

    return {
      ...step,
      frameIndex:
        fallback?.index ??
        step.frameIndex ??
        0,
      timestamp:
        fallback?.timestamp ??
        step.timestamp,
    };
  }
}

export async function analyzeWithClaude(
  frames,
  interval,
  duration,
  originalname,
  finalFrameTimestamp
) {
  if (
    !frames ||
    !frames.length
  ) {
    throw new Error(
      "No video frames available."
    );
  }

  const usage = createUsageTracker();

  const frameObjects =
    makeFrameObjects(
      frames,
      Number(interval),
      finalFrameTimestamp
    );

  const framesToSend = Math.min(
    frameObjects.length,
    MAX_FRAMES_TO_ANALYZE
  );

  console.log(
    `Frames extracted: ${frameObjects.length} ` +
      `Frames sent: ${framesToSend}`
  );

  // PASS 1:
  // Reconstruct the workflow and identify
  // approximate action timestamps.
  const guide =
    await buildGuide(
      frameObjects,
      duration,
      originalname,
      usage
    );

  if (
    !guide ||
    !Array.isArray(
      guide.steps
    ) ||
    !guide.steps.length
  ) {
    throw new Error(
      "Claude did not produce any guide steps."
    );
  }

  // PASS 2:
  // Only show Claude a small temporal window
  // around each action.
  const refinedSteps = [];

  for (
    const step of guide.steps
  ) {
    const refined =
      await refineStepEvidence(
        step,
        frameObjects,
        usage
      );

    refinedSteps.push(
      refined
    );
  }

  return {
    ...guide,
    steps:
      refinedSteps,
    usage: usage.summary(),
    framesAnalyzed: framesToSend
  };
}
