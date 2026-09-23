import React from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  FileVideo,
  UploadCloud,
  X
} from "lucide-react";
import { formatBytes } from "../utils";

export default function UploadWorkspace({
  file,
  dragging,
  setDragging,
  inputRef,
  choose,
  error,
  canAnalyze,
  status,
  progress,
  onAnalyze,
  onRemove
}) {
  return (
    <section className="workspace">
      <div
        className={`dropzone ${dragging ? "dragging" : ""} ${
          file ? "has-file" : ""
        }`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          choose(event.dataTransfer.files?.[0]);
        }}
        onClick={() => !file && inputRef.current?.click()}
      >
        {!file ? (
          <>
            <div className="upload-icon">
              <UploadCloud size={22} strokeWidth={1.6} />
            </div>

            <div className="drop-title">Drop your recording here</div>

            <div className="drop-subtitle">
              or choose an MP4 from your computer
            </div>

            <button
              className="upload-button"
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current?.click();
              }}
            >
              Choose video
            </button>

            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,.mp4"
              onChange={(event) => choose(event.target.files?.[0])}
            />

            <div className="limit">MP4 · up to 2 minutes · 200 MB</div>
          </>
        ) : (
          <div
            className="selected-file"
            onClick={(event) => event.stopPropagation()}
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
              onClick={onRemove}
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
          onClick={onAnalyze}
        >
          {status === "idle" ? (
            <>
              Analyze recording <ArrowUpRight size={17} />
            </>
          ) : (
            <>
              <span className="spinner" />
              {progress || "Analyzing…"}
            </>
          )}
        </button>
      )}
    </section>
  );
}
