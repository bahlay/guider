import React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Clock3,
  Image as ImageIcon,
  ShieldCheck
} from "lucide-react";
import { formatSeconds } from "../utils";

export default function GuideResult({
  API,
  file,
  result,
  onBack,
  onNewRecording,
  onDownloadPdf
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onBack();
          }}
        >
          <span className="brand-mark">G</span>
          <span>Guider</span>
        </a>

        <button className="new-button" onClick={onNewRecording}>
          New recording
        </button>
      </header>

      <main className="result-main">
        <div className="result-head">
          <button className="back-link" onClick={onBack}>
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
                (step) => step.evidence?.supported !== false
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
            <strong>
              Download a clean PDF instruction with just the steps and
              screenshots.
            </strong>
          </div>

          <button className="pdf-button" onClick={onDownloadPdf}>
            Download PDF
            <ArrowUpRight size={16} />
          </button>
        </div>

        {result.warnings?.length > 0 && (
          <div className="warning-box">
            <AlertTriangle size={18} />

            <div>
              <strong>Evidence notes</strong>

              {result.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </div>
          </div>
        )}

        <section className="guide">
          {(result.steps || []).map((step, index) => (
            <article className="guide-step" key={index}>
              <div className="step-number">
                {String(index + 1).padStart(2, "0")}
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
                      alt={`Evidence for step ${index + 1}`}
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
                  <div className="evidence-note">{step.evidence.note}</div>
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
