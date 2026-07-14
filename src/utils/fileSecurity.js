const fs = require("fs/promises");
const { exec } = require("child_process");
const { promisify } = require("util");
const {
  fromFile: fileTypeFromFile,
} = require("file-type");
const {
  CHAT_ALLOWED_EXTENSIONS,
  CHAT_ALLOWED_DETECTED_MIME_TYPES,
  CHAT_OFFICE_EXTENSIONS,
  CHAT_TEXT_EXTENSIONS,
  getFileExtension,
} = require("../constants/chatAttachments");

const execAsync = promisify(exec);

const OFFICE_DETECTED_MIME_TYPES = new Set([
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/x-cfb",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const isAllowedOfficeFile = (extension, detectedMime) => {
  if (!CHAT_OFFICE_EXTENSIONS.has(extension)) {
    return false;
  }

  if (!detectedMime) {
    return true;
  }

  return OFFICE_DETECTED_MIME_TYPES.has(detectedMime);
};

const validateFileSignature = async (filePath, uploadMimeType, originalName = "") => {
  const extension = getFileExtension(originalName);
  const normalizedMime = (uploadMimeType || "").toLowerCase().trim();

  if (CHAT_TEXT_EXTENSIONS.has(extension)) {
    return;
  }

  if (
    normalizedMime.startsWith("text/") &&
    CHAT_ALLOWED_EXTENSIONS.has(extension)
  ) {
    return;
  }

  const detected = await fileTypeFromFile(filePath);
  const detectedMime = detected?.mime || "";

  if (!detectedMime) {
    if (CHAT_ALLOWED_EXTENSIONS.has(extension)) {
      return;
    }

    throw new Error("Unable to detect file signature");
  }

  if (isAllowedOfficeFile(extension, detectedMime)) {
    return;
  }

  if (!CHAT_ALLOWED_DETECTED_MIME_TYPES.has(detectedMime)) {
    throw new Error("File type not allowed");
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
