export function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSeconds(seconds) {
  if (seconds == null) return "--:--";

  const value = Math.max(0, Math.round(Number(seconds)));

  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(
    value % 60
  ).padStart(2, "0")}`;
}
