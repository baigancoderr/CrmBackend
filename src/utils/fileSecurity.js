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

const DANGEROUS_DETECTED_MIME_TYPES = new Set([
  "application/x-msdownload",
  "application/x-executable",
  "application/x-dosexec",
  "application/javascript",
  "text/javascript",
  "text/html",
  "application/x-httpd-php",
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

  let detectedMime = "";

  try {
    const detected = await fileTypeFromFile(filePath);
    detectedMime = detected?.mime || "";
  } catch (error) {
    console.warn(
      "[chatFileSecurity] file-type detection failed:",
      error?.message || error
    );

    // Allowed extensions still pass when sniffing fails (common on some hosts).
    if (CHAT_ALLOWED_EXTENSIONS.has(extension)) {
      return;
    }

    throw new Error("Unable to detect file signature");
  }

  if (!detectedMime) {
    if (CHAT_ALLOWED_EXTENSIONS.has(extension)) {
      return;
    }

    throw new Error("Unable to detect file signature");
  }

  if (DANGEROUS_DETECTED_MIME_TYPES.has(detectedMime)) {
    throw new Error("File type not allowed");
  }

  if (isAllowedOfficeFile(extension, detectedMime)) {
    return;
  }

  if (CHAT_ALLOWED_DETECTED_MIME_TYPES.has(detectedMime)) {
    return;
  }

  // Extension allow-list is source of truth when sniffing is ambiguous
  // (e.g. some audio/video containers report uncommon mime strings).
  if (CHAT_ALLOWED_EXTENSIONS.has(extension)) {
    return;
  }

  throw new Error("File type not allowed");
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
