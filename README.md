# Guider

Guider turns a short MP4 screen recording into an evidence-backed how-to guide.

It analyzes the visible workflow, reconstructs the minimal reproducible sequence, and attaches each instruction to the video frame that best supports the action.

## Project status

**Working prototype / take-home assignment**

The core flow is implemented end-to-end:

**Upload → video processing → AI workflow reconstruction → evidence validation → guide → PDF export**

The prototype is intentionally focused on one browser workflow rather than being a general-purpose video editor or documentation platform.

## Architecture overview

```text
Browser
  │
  │ MP4 upload
  ▼
Express API
  │
  ├── FFmpeg
  │     └── frame extraction
  │
  ├── Claude — workflow reconstruction
  │
  ├── Claude — evidence selection
  │     └── local frame windows around each action
  │
  └── Structured guide
        ├── instructions
        ├── timestamps
        ├── evidence frames
        └── warnings
  │
  ▼
React / Vite UI
  │
  ├── Guide viewer
  └── PDF export
```

## Features

* MP4 screen recordings up to 2 minutes
* Automatic workflow reconstruction
* Evidence-backed instructions with screenshots and timestamps
* Detection of abandoned or corrected intermediate values
* Visual evidence validation for each step
* Warnings when important actions are not sufficiently supported
* PDF export

## How it works

1. Upload a screen recording.
2. FFmpeg extracts chronological frames.
3. Claude analyzes the frames and reconstructs the workflow.
4. A second analysis pass verifies the evidence for each step using a local frame window around the action.
5. The strongest supporting frame is selected for each instruction.
6. The generated guide is displayed in the browser and can be exported as a PDF.

The system prioritizes visible evidence and does not intentionally invent actions that are not supported by the recording.

## Setup

### Requirements

* Node.js 18+
* FFmpeg
* Anthropic API key

### Install

```bash
npm install
```

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Add your API key:

```env
ANTHROPIC_API_KEY=your_real_key_here
ANTHROPIC_MODEL=claude-sonnet-5
PORT=8787
FFMPEG_PATH=/path/to/ffmpeg
FFPROBE_PATH=/path/to/ffprobe
```

### Run

```bash
npm run dev
```

The application runs at:

```text
http://localhost:5173
```

The API runs at:

```text
http://localhost:8787
```

## Input limits

* MP4 only
* Maximum duration: 2 minutes
* Maximum file size: 200 MB

## Test workflow

The prototype was tested with a Supabase Table Editor workflow:

**Create a new table → configure settings and columns → save → verify the final state**

The recording contains visible actions, configuration changes, corrections, and a final successful state.

A second recording with a changed configuration can be used to verify that the generated guide adapts to the new final state.

## Evidence selection

Guider uses a two-pass analysis approach.

The first pass reconstructs the workflow and identifies approximate action timestamps.

The second pass evaluates only the frames surrounding each action and selects the frame that most directly supports that instruction.

This helps distinguish an actual interaction from a later resulting state, particularly for controls such as buttons, fields, checkboxes, and dropdowns.

## Known limitations

Guider relies primarily on visual evidence from the recording.

If an important action is not sufficiently visible, the system can flag the limitation instead of inferring an unsupported action.

The prototype focuses on a single browser workflow and does not include accounts, payments, integrations, or native applications.
