// Shared by browser validation and server import routes; no server-only imports.
const MiB = 1024 * 1024;
export const LIMITS = {
  upload: 100 * MiB,
  total: 256 * MiB,
  file: 64 * MiB,
  files: 5000,
  // Projects contain base64 assets and JSON-escaped source, plus exact patches.
  request: 512 * MiB,
};
export const UPLOAD_SIZE_LABEL = "100 MB";
export const EXTRACTION_LIMIT_LABEL = "64 MB per file, 256 MB total";
