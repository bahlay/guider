import React, { useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock3,
  FileVideo,
  Image as ImageIcon,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  X,
  AlertTriangle
} from "lucide-react";
import "./styles.css";

const API = "";

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSeconds(s) {
  if (s == null) return "--:--";
  const n = Math.max(0, Math.round(Number(s)));
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

function App() {
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const canAnalyze = useMemo(() => file && status === "idle", [file, status]);

  function choose(f) {
    if (!f) return;

    setError("");

    if (
      f.type !== "video/mp4" &&
      !f.name.toLowerCase().endsWith(".mp4")
    ) {
      setError("Please choose an MP4 video.");
      return;
    }

    if (f.size > 200 * 1024 * 1024) {
      setError("The prototype accepts MP4 files up to 200 MB.");
      return;
    }

    const url = URL.createObjectURL(f);
    const video = document.createElement("video");

    video.preload = "metadata";

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);

      if (!video.duration || !isFinite(video.duration)) {
        setError("This file is not a valid video.");
        return;
      }

      if (video.duration > 120) {
        setError("The recording must be 2 minutes or shorter.");
        return;
      }

      setFile(f);
      setResult(null);
      setStatus("idle");
      setProgress(0);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      setError("This file is not a valid MP4 video.");
    };

    video.src = url;
  }

  async function analyze() {
    if (!file) return;

    setStatus("processing");
    setProgress(5);
    setError("");

    const form = new FormData();
    form.append("video", file);

    let ticker;

    try {
      ticker = setInterval(() => {
        setProgress((current) => {
          if (current >= 90) return current;

          return Math.min(90, current + 1);
        });
      }, 900);

      const response = await fetch(`${API}/api/analyze`, {
        method: "POST",
        body: form
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          data.error || `Server returned ${response.status}`
        );
      }

      const data = await response.json();

      clearInterval(ticker);
      setProgress(100);

      setTimeout(() => {
        setResult(data);
        setStatus("done");
      }, 250);
    } catch (e) {
      clearInterval(ticker);
      setStatus("idle");
      setProgress(0);
      setError(e.message || "Processing failed.");
    }
  }

  async function downloadPdf() {
    if (!result) return;

    try {
      const response = await fetch(`${API}/api/pdf`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: result.title,
          summary: result.summary,
          steps: result.steps || []
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not generate PDF.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${(result.title || "guider-guide")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()}.pdf`;

      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message || "Could not generate PDF.");
    }
  }

  if (result) {
    return (
      <div className="app-shell">
        <header className="topbar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setResult(null);
            }}
          >
            <span className="brand-mark">G</span>
            <span>Guider</span>
          </a>

          <button
            className="new-button"
            onClick={() => {
              setResult(null);
              setFile(null);
              setStatus("idle");
            }}
          >
            New recording
          </button>
        </header>

        <main className="result-main">
          <div className="result-head">
            <button className="back-link" onClick={() => setResult(null)}>
              <ArrowLeft size={15} /> Back
            </button>

            <div className="result-kicker">GENERATED GUIDE</div>

            <div className="result-title-row">
              <div>
                <h1>{result.title || "Your guide"}</h1>
                <p>
                  {result.summary ||
                    "A concise, evidence-backed walkthrough reconstructed from the recording."}
                </p>
              </div>
            </div>
          </div>

          <div className="result-meta">
            <div>
              <span>Recording</span>
              <strong>{file?.name}</strong>
            </div>

            <div>
              <span>Steps</span>
              <strong>{result.steps?.length || 0}</strong>
            </div>

            <div>
              <span>Evidence</span>
              <strong>
                {result.steps?.filter(
                  (s) => s.evidence?.supported !== false
                ).length || 0}
                /{result.steps?.length || 0} supported
              </strong>
            </div>

            <div>
              <span>Analysis</span>
              <strong>
                {result.metrics?.totalSeconds
                  ? `${result.metrics.totalSeconds.toFixed(1)}s`
                  : "—"}
              </strong>
            </div>
          </div>

          <div className="pdf-cta">
            <div className="pdf-cta-copy">
              <strong>Download a clean PDF instruction with just the steps and screenshots.</strong>
            </div>

            <button
              className="pdf-button"
              onClick={downloadPdf}
            >
              Download PDF
              <ArrowUpRight size={16} />
            </button>
          </div>        

          {result.warnings?.length > 0 && (
            <div className="warning-box">
              <AlertTriangle size={18} />

              <div>
                <strong>Evidence notes</strong>

                {result.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          )}

          <section className="guide">
            {(result.steps || []).map((step, i) => (
              <article className="guide-step" key={i}>
                <div className="step-number">
                  {String(i + 1).padStart(2, "0")}
                </div>

                <div className="step-content">
                  <div className="step-title-row">
                    <h2>{step.title}</h2>

                    {step.evidence?.supported !== false ? (
                      <span className="supported">
                        <Check size={13} />
                        Supported
                      </span>
                    ) : (
                      <span className="unsupported">
                        <AlertTriangle size={13} />
                        Needs review
                      </span>
                    )}
                  </div>

                  <p className="instruction">{step.instruction}</p>

                  {step.imageUrl && (
                    <div className="evidence-image">
                      <img
                        src={`${API}${step.imageUrl}`}
                        alt={`Evidence for step ${i + 1}`}
                      />
                    </div>
                  )}

                  <div className="evidence-row">
                    <span className="timestamp">
                      <Clock3 size={14} />
                      {formatSeconds(step.timestamp)}
                    </span>

                    <span className="evidence-type">
                      <ImageIcon size={14} />
                      Frame evidence
                    </span>
                  </div>

                  {step.evidence?.note && (
                    <div className="evidence-note">
                      {step.evidence.note}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>

          <div className="verification-card">
            <div className="verification-icon">
              <ShieldCheck size={19} />
            </div>

            <div>
              <strong>Evidence-first result</strong>

              <p>
                {result.verification ||
                  "The guide was generated only from observed evidence. Unsupported transitions are called out rather than invented."}
              </p>
            </div>
          </div>

          <details className="raw-details">
            <summary>Analysis details</summary>
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </details>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#">
          <span className="brand-mark">G</span>
          <span>Guider</span>
        </a>
      </header>

      <main className="main">
        <section className="hero">
          <div className="eyebrow">VIDEO → HOW-TO</div>

          <h1>
            Turn a screen recording
            <br />
            into a guide someone can follow.
          </h1>

          <p className="hero-copy">
            Upload one operation. Get ordered steps, screenshots and
            timestamps — with an honest flag anywhere the footage doesn't
            fully support a claim.
          </p>
        </section>

        <section className="workspace">
          <div
            className={`dropzone ${dragging ? "dragging" : ""} ${
              file ? "has-file" : ""
            }`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              choose(e.dataTransfer.files?.[0]);
            }}
            onClick={() => !file && inputRef.current?.click()}
          >
            {!file ? (
              <>
                <div className="upload-icon">
                  <UploadCloud size={22} strokeWidth={1.6} />
                </div>

                <div className="drop-title">
                  Drop your recording here
                </div>

                <div className="drop-subtitle">
                  or choose an MP4 from your computer
                </div>

                <button
                  className="upload-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  Choose video
                </button>

                <input
                  ref={inputRef}
                  type="file"
                  accept="video/mp4,.mp4"
                  onChange={(e) => choose(e.target.files?.[0])}
                />

                <div className="limit">
                  MP4 · up to 2 minutes · 200 MB
                </div>
              </>
            ) : (
              <div
                className="selected-file"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="file-leading">
                  <div className="upload-icon small">
                    <FileVideo size={19} strokeWidth={1.6} />
                  </div>

                  <div>
                    <div className="file-name">{file.name}</div>

                    <div className="file-meta">
                      {formatBytes(file.size)} · ready to analyze
                    </div>
                  </div>
                </div>

                <button
                  className="remove"
                  onClick={() => {
                    setFile(null);
                    setError("");
                  }}
                  aria-label="Remove video"
                >
                  <X size={18} />
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="error-box">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}

          {file && (
            <button
              className="analyze-button"
              disabled={!canAnalyze}
              onClick={analyze}
            >
              {status === "idle" ? (
                <>
                  Turn into Guide <ArrowUpRight size={17} />
                </>
              ) : (
                <>
                  <span className="spinner" />
                  {status === "uploading"
                    ? "Uploading video…"
                    : `Processing video… ${progress}%`}
                </>
              )}
            </button>
          )}
        </section>

        <section className="method">
          <div className="method-label">
            <Sparkles size={14} /> HOW GUIDER THINKS
          </div>

          <div className="method-flow">
            <span>Observe footage</span>
            <ChevronRight size={15} />
            <span>Reconstruct actions</span>
            <ChevronRight size={15} />
            <span>Resolve corrections</span>
            <ChevronRight size={15} />
            <span>Attach evidence</span>
            <ChevronRight size={15} />
            <span>Generate guide</span>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Guider</span>
        <span>Evidence before explanation.</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);