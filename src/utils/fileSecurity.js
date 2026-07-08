const fs = require("fs/promises");
const { exec } = require("child_process");
const { promisify } = require("util");
const {
  fileTypeFromFile,
} = require("file-type");

const execAsync = promisify(exec);

const SIGNATURE_MIME_MAP = {
  "image/jpeg": ["image/jpeg"],
  "image/png": ["image/png"],
  "image/webp": ["image/webp"],
  "application/pdf": ["application/pdf"],
  "application/zip": [
    "application/zip",
    "application/x-zip-compressed",
  ],
  "application/x-zip-compressed": [
    "application/zip",
    "application/x-zip-compressed",
  ],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ["application/zip", "application/x-zip-compressed"],
};

const isExpectedSignature = (uploadMimeType, detectedMime) => {
  const allowedSignatures = SIGNATURE_MIME_MAP[uploadMimeType];

  if (!allowedSignatures) {
    return false;
  }

  return allowedSignatures.includes(detectedMime);
};

const validateFileSignature = async (filePath, uploadMimeType) => {
  const detected = await fileTypeFromFile(filePath);

  if (!detected?.mime) {
    throw new Error("Unable to detect file signature");
  }

  const isValid = isExpectedSignature(
    uploadMimeType,
    detected.mime
  );

  if (!isValid) {
    throw new Error("File signature does not match mime type");
  }
};

const runVirusScanIfEnabled = async (filePath) => {
  const scanCommandTemplate =
    process.env.CHAT_VIRUS_SCAN_COMMAND;

  if (!scanCommandTemplate) {
    return;
  }

  const timeoutMs = Number(
    process.env.CHAT_VIRUS_SCAN_TIMEOUT_MS || 15000
  );
  const escapedPath = filePath.replace(/"/g, '\\"');
  const command = scanCommandTemplate.includes("{file}")
    ? scanCommandTemplate.replace("{file}", `"${escapedPath}"`)
    : `${scanCommandTemplate} "${escapedPath}"`;

  await execAsync(command, {
    timeout: timeoutMs,
  });
};

const removeFileSilently = async (filePath) => {
  try {
    await fs.unlink(filePath);
  } catch (_error) {
    // No-op for cleanup fallback.
  }
};

module.exports = {
  validateFileSignature,
  runVirusScanIfEnabled,
  removeFileSilently,
};
