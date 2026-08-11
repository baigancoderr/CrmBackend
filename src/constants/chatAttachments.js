const { UPLOAD_LIMITS } = require("./uploadLimits");

const CHAT_MAX_ATTACHMENT_SIZE_BYTES = UPLOAD_LIMITS.ATTACHMENT_MAX_BYTES;

const CHAT_ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
  ".heic",
  ".heif",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".3gp",
  ".mp3",
  ".wav",
  ".ogg",
  ".aac",
  ".m4a",
  ".amr",
  ".wma",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
  ".zip",
  ".rar",
  ".7z",
]);

const CHAT_ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/jpg",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/3gpp",
  "video/x-matroska",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/aac",
  "audio/mp4",
  "audio/amr",
  "audio/x-ms-wma",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/csv",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/octet-stream",
]);

const CHAT_OFFICE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
]);

const CHAT_TEXT_EXTENSIONS = new Set([".txt", ".csv"]);

const CHAT_ALLOWED_DETECTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  "video/3gpp",
  "video/x-matroska",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/aac",
  "audio/mp4",
  "audio/amr",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/x-cfb",
  "application/zip",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/x-7z-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const getFileExtension = (fileName = "") => {
  const dotIndex = fileName.lastIndexOf(".");

  if (dotIndex === -1) {
    return "";
  }

  return fileName.slice(dotIndex).toLowerCase();
};

const isChatAttachmentAllowed = (fileName, mimeType = "") => {
  const extension = getFileExtension(fileName);
  const normalizedMime = (mimeType || "").toLowerCase().trim();

  if (extension && CHAT_ALLOWED_EXTENSIONS.has(extension)) {
    return true;
  }

  if (normalizedMime && CHAT_ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return true;
  }

  return false;
};

const CHAT_UNSUPPORTED_FILE_MESSAGE =
  "This file type is not supported. Please share images, videos, audio, documents, or archives.";

module.exports = {
  CHAT_MAX_ATTACHMENT_SIZE_BYTES,
  CHAT_ALLOWED_EXTENSIONS,
  CHAT_ALLOWED_MIME_TYPES,
  CHAT_TEXT_EXTENSIONS,
  CHAT_OFFICE_EXTENSIONS,
  CHAT_ALLOWED_DETECTED_MIME_TYPES,
  CHAT_UNSUPPORTED_FILE_MESSAGE,
  getFileExtension,
  isChatAttachmentAllowed,
};
