import Anthropic from "@anthropic-ai/sdk";
import { imageData } from "./video.js";

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const MODEL =
  process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

function parseJson(text) {
  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(
          cleaned.slice(start, end + 1)
        );
      } catch {}
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
  interval
) {
  return files.map((file, index) => ({
    file,
    index,
    timestamp: index * interval,
  }));
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

async function callClaude(
  content,
  maxTokens = 12000
) {
  const response =
    await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content,
        },
      ],
    });

  const inputTokens =
    response.usage?.input_tokens || 0;

  const outputTokens =
    response.usage?.output_tokens || 0;

  const inputCost =
    (inputTokens / 1_000_000) * 2;

  const outputCost =
    (outputTokens / 1_000_000) * 10;

  const totalCost =
    inputCost + outputCost;

  console.log(
    `Claude API: ` +
      `input=${inputTokens} ` +
      `output=${outputTokens} ` +
      `cost=$${totalCost.toFixed(4)}`
  );

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
  originalname
) {
  const selectedFrames = frames;

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

CORRECTIONS:

If a value is changed multiple times, use the final value that is actually committed in the successful state.

Do not recommend abandoned values.

DEFAULTS:

If a setting starts enabled by default and the recording leaves it unchanged, do not make it a step.

If the user explicitly changes a setting, include it.

DROPDOWNS:

For a dropdown/select action, the preferred timestamp MUST correspond to a frame where:

- the dropdown is OPEN;
- the intended option is visibly present;
- the cursor is on or clearly associated with the intended option.

Do not use a later closed dropdown merely because the selected value is visible.

If no frame clearly captures the dropdown interaction, use the clearest available frame showing the final selected value and explicitly state that the exact dropdown interaction was not clearly captured.

SCREENSHOTS:

The screenshot for each step must visually support the ACTION described by the step.

The screenshot and evidence note must refer to the SAME exact frame.

For text entry:

- prefer a frame where the cursor is directly inside or clearly over the relevant input field;
- the intended value should also be visible if possible.

For checkbox/toggle:

- prefer a frame where the cursor is directly on or clearly touching the control.

For buttons:

- prefer a frame immediately before/during the click with the cursor directly on the button.

For Create New Table:

- prefer the original screen with the cursor on Create new table;
- NEVER use the already-open modal as evidence for the click that opened the modal.

IMPORTANT:

Do not choose a later result frame merely because the final value is clearer.

The selected frame must represent the action described by the instruction.

Return ONLY valid JSON.

Use exactly:

{
  "title": "How to ...",
  "summary": "One short sentence.",
  "steps": [
    {
      "step": 1,
      "instruction": "Click ...",
      "timestamp": 12.5,
      "frame": 25,
      "evidence": "The Create new table control is visible with the cursor on it."
    }
  ],
  "warnings": []
}

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

  const raw =
    await callClaude(content);

  return parseJson(raw);
}

async function refineStepEvidence(
  step,
  frames
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
        3000
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
  originalname
) {
  if (
    !frames ||
    !frames.length
  ) {
    throw new Error(
      "No video frames available."
    );
  }

  const frameObjects =
    makeFrameObjects(
      frames,
      Number(interval)
    );

  console.log(
    `Frames extracted: ${frameObjects.length} ` +
      `Frames sent: ${frameObjects.length}`
  );

  // PASS 1:
  // Reconstruct the workflow and identify
  // approximate action timestamps.
  const guide =
    await buildGuide(
      frameObjects,
      duration,
      originalname
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
        frameObjects
      );

    refinedSteps.push(
      refined
    );
  }

  return {
    ...guide,
    steps:
      refinedSteps,
  };
}