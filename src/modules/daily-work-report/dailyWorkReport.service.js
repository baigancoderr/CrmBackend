const DailyWorkReport = require("./dailyWorkReport.model");
const User = require("../user/user.model");

const REVIEWER_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];
const REPORTING_MANAGER_ROLES = ["PROJECT_MANAGER", "TL"];
const WORK_STATUS_OPTIONS = ["COMPLETED", "IN_PROGRESS", "BLOCKED", "ON_HOLD"];
const REVIEW_STATUS_OPTIONS = ["PENDING", "REVIEWED"];
const MAX_ATTACHMENT_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const DATE_STRING_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const createAppError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getTodayDateString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const normalizeDateString = (value) => {
  const normalized = String(value || "").trim();

  if (!DATE_STRING_REGEX.test(normalized)) {
    return "";
  }

  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return "";
  }

  return normalized;
};

const validateAttachment = (attachment) => {
  if (!attachment) {
    return null;
  }

  const fileName = String(attachment.fileName || "").trim();
  const mimeType = String(attachment.mimeType || "").trim().toLowerCase();
  const dataUrl = String(attachment.dataUrl || "").trim();
  const fileSize = Number(attachment.fileSize || 0);

  if (!fileName || !mimeType || !dataUrl || !fileSize) {
    throw createAppError("Attachment details are incomplete.", 422);
  }

  if (!ALLOWED_ATTACHMENT_MIME_TYPES.includes(mimeType)) {
    throw createAppError("Unsupported attachment type.", 422);
  }

  if (fileSize > MAX_ATTACHMENT_SIZE_BYTES) {
    throw createAppError("Attachment size should be less than 5MB.", 422);
  }

  if (!dataUrl.startsWith("data:")) {
    throw createAppError("Attachment content is invalid.", 422);
  }

  return {
    fileName,
    mimeType,
    fileSize,
    dataUrl,
  };
};

const getMyPrefillDetails = async (userId) => {
  const user = await User.findById(userId)
    .select("name employeeId manager")
    .populate("manager", "name employeeId role");

  if (!user) {
    throw createAppError("Employee profile not found.", 404);
  }

  const managerRecord =
    user.manager &&
    typeof user.manager === "object" &&
    REPORTING_MANAGER_ROLES.includes(user.manager.role)
      ? user.manager
      : null;

  return {
    employeeName: user.name || "",
    employeeId: user.employeeId || "",
    reportingManagerId: managerRecord ? String(managerRecord._id) : "",
    reportingManager: managerRecord ? managerRecord.name || "" : "",
  };
};

const submitDailyWorkReport = async (userId, payload) => {
  const projectName = String(payload.projectName || "").trim();
  const reportDate = normalizeDateString(payload.reportDate || "");
  const workDescription = String(payload.workDescription || "").trim();
  const reportingManagerId = String(payload.reportingManagerId || "").trim();
  const blockers = String(payload.blockers || "").trim();
  const attachment = validateAttachment(payload.attachment);

  if (!projectName) {
    throw createAppError("Project name is required.", 422);
  }

  if (!reportDate) {
    throw createAppError("Date is required.", 422);
  }

  if (!workDescription) {
    throw createAppError("Work description is required.", 422);
  }

  if (!reportingManagerId) {
    throw createAppError("Reporting manager is required.", 422);
  }

  const todayDate = getTodayDateString();
  if (reportDate > todayDate) {
    throw createAppError("Future date is not allowed.", 422);
  }

  const user = await User.findById(userId).select("name employeeId");

  if (!user) {
    throw createAppError("Employee profile not found.", 404);
  }

  const reportingManager = await User.findOne({
    _id: reportingManagerId,
    role: { $in: REPORTING_MANAGER_ROLES },
    isActive: true,
  }).select("name employeeId role");

  if (!reportingManager) {
    throw createAppError("Please select a valid reporting manager.", 422);
  }

  const report = await DailyWorkReport.create({
    employee: userId,
    employeeNameSnapshot: user.name || "",
    employeeIdSnapshot: user.employeeId || "",
    reportingManager: reportingManager._id,
    reportingManagerSnapshot: reportingManager.name || "",
    projectName,
    reportDate,
    workDescription,
    blockers,
    attachment,
  });

  const createdRecord = await DailyWorkReport.findById(report._id)
    .populate("employee", "name employeeId role")
    .populate("reviewedBy", "name employeeId role");

  return createdRecord;
};

const getMyDailyWorkReports = async (userId, query) => {
  const { page = 1, limit = 10, workStatus, reviewStatus, reportDate } = query;

  const currentPage = Math.max(Number(page) || 1, 1);
  const perPage = Math.max(Number(limit) || 10, 1);
  const skip = (currentPage - 1) * perPage;

  const filter = {
    employee: userId,
  };

  if (workStatus) {
    const normalizedWorkStatus = String(workStatus).trim().toUpperCase();
    if (!WORK_STATUS_OPTIONS.includes(normalizedWorkStatus)) {
      throw createAppError("Invalid work status filter.", 422);
    }
    filter.workStatus = normalizedWorkStatus;
  }

  if (reviewStatus) {
    const normalizedReviewStatus = String(reviewStatus).trim().toUpperCase();
    if (!REVIEW_STATUS_OPTIONS.includes(normalizedReviewStatus)) {
      throw createAppError("Invalid review status filter.", 422);
    }
    filter.reviewStatus = normalizedReviewStatus;
  }

  if (reportDate) {
    const normalizedReportDate = normalizeDateString(reportDate);
    if (!normalizedReportDate) {
      throw createAppError("Invalid date filter.", 422);
    }
    filter.reportDate = normalizedReportDate;
  }

  const totalRecords = await DailyWorkReport.countDocuments(filter);
  const data = await DailyWorkReport.find(filter)
    .populate("employee", "name employeeId role")
    .populate("reviewedBy", "name employeeId role")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(perPage);

  return {
    page: currentPage,
    limit: perPage,
    totalRecords,
    totalPages: Math.ceil(totalRecords / perPage) || 1,
    data,
  };
};

const getAllDailyWorkReports = async (query) => {
  const {
    page = 1,
    limit = 10,
    search = "",
    workStatus,
    reviewStatus,
    reportDate,
    employeeId,
  } = query;

  const currentPage = Math.max(Number(page) || 1, 1);
  const perPage = Math.max(Number(limit) || 10, 1);
  const skip = (currentPage - 1) * perPage;

  const filter = {};

  if (workStatus) {
    const normalizedWorkStatus = String(workStatus).trim().toUpperCase();
    if (!WORK_STATUS_OPTIONS.includes(normalizedWorkStatus)) {
      throw createAppError("Invalid work status filter.", 422);
    }
    filter.workStatus = normalizedWorkStatus;
  }

  if (reviewStatus) {
    const normalizedReviewStatus = String(reviewStatus).trim().toUpperCase();
    if (!REVIEW_STATUS_OPTIONS.includes(normalizedReviewStatus)) {
      throw createAppError("Invalid review status filter.", 422);
    }
    filter.reviewStatus = normalizedReviewStatus;
  }

  if (reportDate) {
    const normalizedReportDate = normalizeDateString(reportDate);
    if (!normalizedReportDate) {
      throw createAppError("Invalid date filter.", 422);
    }
    filter.reportDate = normalizedReportDate;
  }

  if (employeeId) {
    filter.employee = String(employeeId).trim();
  }

  if (String(search).trim()) {
    const regex = new RegExp(String(search).trim(), "i");
    filter.$or = [
      { employeeNameSnapshot: regex },
      { employeeIdSnapshot: regex },
      { projectName: regex },
    ];
  }

  const totalRecords = await DailyWorkReport.countDocuments(filter);
  const data = await DailyWorkReport.find(filter)
    .populate("employee", "name employeeId role")
    .populate("reviewedBy", "name employeeId role")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(perPage);

  return {
    page: currentPage,
    limit: perPage,
    totalRecords,
    totalPages: Math.ceil(totalRecords / perPage) || 1,
    data,
  };
};

const reviewDailyWorkReport = async (reportId, reviewer, payload) => {
  if (!REVIEWER_ROLES.includes(reviewer.role)) {
    throw createAppError("You are not authorized to review this report.", 403);
  }

  const reviewerUser = await User.findById(reviewer.id).select("name employeeId role");
  if (!reviewerUser) {
    throw createAppError("Reviewer profile not found.", 404);
  }

  const report = await DailyWorkReport.findById(reportId);
  if (!report) {
    throw createAppError("Daily work report not found.", 404);
  }

  const reviewComment = String(payload.comment || "").trim();

  report.reviewStatus = "REVIEWED";
  report.reviewComment = reviewComment;
  report.reviewedBy = reviewerUser._id;
  report.reviewedByNameSnapshot = reviewerUser.name || "";
  report.reviewedAt = new Date();

  await report.save();

  const updatedRecord = await DailyWorkReport.findById(report._id)
    .populate("employee", "name employeeId role")
    .populate("reviewedBy", "name employeeId role");

  return updatedRecord;
};

module.exports = {
  REVIEWER_ROLES,
  getMyPrefillDetails,
  submitDailyWorkReport,
  getMyDailyWorkReports,
  getAllDailyWorkReports,
  reviewDailyWorkReport,
};
