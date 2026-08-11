/**
 * Central upload limits for the CRM backend.
 * Change values here only — middleware, routes, and services read from this file.
 *
 * Keep in sync with: crm-frontend/src/core/constants/uploadLimits.ts
 */

const MB = 1024 * 1024;
const KB = 1024;

const UPLOAD_LIMITS = {
  /** Profile photo (employees) */
  PROFILE_PHOTO_MAX_BYTES: 2 * MB,

  /** Chat, tickets, notes, projects, tasks, blockers, area documents */
  ATTACHMENT_MAX_BYTES: 100 * MB,

  /** Daily work report base64 attachments */
  DAILY_WORK_REPORT_ATTACHMENT_MAX_BYTES: 5 * MB,

  /** Express JSON parser limit (DWR sends base64 in JSON) */
  EXPRESS_JSON_BODY_LIMIT: "8mb",
};

const UPLOAD_MAX_FILES = {
  TICKET: 5,
  TICKET_COMMENT: 3,
  NOTES: 10,
  AREA_DOCUMENTS: 10,
  PROJECT_DOCUMENTS: 10,
  TASK_ATTACHMENTS: 5,
  CHAT: 1,
  PROFILE: 1,
};

const formatUploadMaxSize = (bytes) => {
  if (bytes >= MB && bytes % MB === 0) {
    return `${bytes / MB} MB`;
  }

  if (bytes >= MB) {
    return `${(bytes / MB).toFixed(1)} MB`;
  }

  if (bytes >= KB) {
    return `${Math.round(bytes / KB)} KB`;
  }

  return `${bytes} bytes`;
};

const attachmentTooLargeMessage = (bytes = UPLOAD_LIMITS.ATTACHMENT_MAX_BYTES) =>
  `File is too large. Max size allowed is ${formatUploadMaxSize(bytes)}.`;

const profilePhotoTooLargeMessage = () =>
  `Profile photo is too large. Max size allowed is ${formatUploadMaxSize(UPLOAD_LIMITS.PROFILE_PHOTO_MAX_BYTES)}.`;

const dailyWorkReportAttachmentTooLargeMessage = () =>
  `Attachment is too large. Max size allowed is ${formatUploadMaxSize(UPLOAD_LIMITS.DAILY_WORK_REPORT_ATTACHMENT_MAX_BYTES)}.`;

module.exports = {
  MB,
  KB,
  UPLOAD_LIMITS,
  UPLOAD_MAX_FILES,
  formatUploadMaxSize,
  attachmentTooLargeMessage,
  profilePhotoTooLargeMessage,
  dailyWorkReportAttachmentTooLargeMessage,
};
