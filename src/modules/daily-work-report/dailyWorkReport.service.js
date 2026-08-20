const DailyWorkReport = require("./dailyWorkReport.model");
const User = require("../user/user.model");
const notificationService = require("../notifications/notification.service");
const { UPLOAD_LIMITS, dailyWorkReportAttachmentTooLargeMessage } = require("../../constants/uploadLimits");

const REVIEWER_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];
const REPORTING_MANAGER_ROLES = ["PROJECT_MANAGER", "TL", "HR"];
const WORK_STATUS_OPTIONS = ["COMPLETED", "IN_PROGRESS", "BLOCKED", "ON_HOLD"];
const REVIEW_STATUS_OPTIONS = ["PENDING", "REVIEWED"];
const MAX_EDIT_WINDOW_DAYS = 2;
const MAX_ATTACHMENT_SIZE_BYTES = UPLOAD_LIMITS.DAILY_WORK_REPORT_ATTACHMENT_MAX_BYTES;
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

const getRelativeDateString = (offsetDays) => {
  const date = new Date();
  date.setDate(date.getDate() + Number(offsetDays || 0));

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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

const getDateStart = (dateString) => {
  const normalizedDate = normalizeDateString(dateString);
  if (!normalizedDate) {
    return null;
  }
  const [year, month, day] = normalizedDate.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const applyReportDateFilters = (filter, query = {}) => {
  const { reportDate, fromDate, toDate } = query;

  const normalizedFromDate = fromDate ? normalizeDateString(fromDate) : "";
  const normalizedToDate = toDate ? normalizeDateString(toDate) : "";

  if (fromDate && !normalizedFromDate) {
    throw createAppError("Invalid from date filter.", 422);
  }
  if (toDate && !normalizedToDate) {
    throw createAppError("Invalid to date filter.", 422);
  }
  if (normalizedFromDate && normalizedToDate && normalizedFromDate > normalizedToDate) {
    throw createAppError("From date cannot be after To date.", 422);
  }

  // Prefer explicit range filters when either end is provided.
  if (normalizedFromDate || normalizedToDate) {
    filter.reportDate = {};
    if (normalizedFromDate) {
      filter.reportDate.$gte = normalizedFromDate;
    }
    if (normalizedToDate) {
      filter.reportDate.$lte = normalizedToDate;
    }
    return;
  }

  if (reportDate) {
    const normalizedReportDate = normalizeDateString(reportDate);
    if (!normalizedReportDate) {
      throw createAppError("Invalid date filter.", 422);
    }
    filter.reportDate = normalizedReportDate;
  }
};

const isWithinEditableWindow = (reportDate) => {
  const reportDateStart = getDateStart(reportDate);
  if (!reportDateStart) {
    return false;
  }
  const editDeadline = new Date(reportDateStart);
  editDeadline.setDate(editDeadline.getDate() + MAX_EDIT_WINDOW_DAYS);
  editDeadline.setHours(23, 59, 59, 999);
  return Date.now() <= editDeadline.getTime();
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
    throw createAppError(dailyWorkReportAttachmentTooLargeMessage(), 422);
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

const escapeRegex = (value) =>
  String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toManagerOption = (record) => ({
  _id: String(record._id),
  name: record.name || "",
  employeeId: record.employeeId || "",
  role: record.role || "",
});

const getRecordId = (value) => {
  if (!value) {
    return "";
  }
  if (typeof value === "object") {
    return value._id ? String(value._id) : "";
  }
  return String(value);
};

const findActiveManagers = async ({ department, roles, excludeUserId }) => {
  const filter = {
    isActive: true,
    role: { $in: roles },
    _id: { $ne: excludeUserId },
  };

  if (department) {
    filter.department = new RegExp(`^${escapeRegex(department)}$`, "i");
  }

  return User.find(filter)
    .select("name employeeId role department")
    .sort({ name: 1 });
};

const getDepartmentReportingManagerOptions = async (user) => {
  const department = String(user.department || "").trim();
  const userRole = String(user.role || "EMPLOYEE").toUpperCase();
  const excludeUserId = user._id;
  let records = [];

  if (["EMPLOYEE", "ACCOUNTANT"].includes(userRole) && department) {
    records = await findActiveManagers({
      department,
      roles: ["TL"],
      excludeUserId,
    });
  } else if (userRole === "TL") {
    if (department) {
      records = await findActiveManagers({
        department,
        roles: ["PROJECT_MANAGER"],
        excludeUserId,
      });
    }
    if (!records.length) {
      records = await findActiveManagers({
        roles: ["PROJECT_MANAGER"],
        excludeUserId,
      });
    }
  } else if (userRole === "PROJECT_MANAGER") {
    records = await findActiveManagers({
      roles: ["HR"],
      excludeUserId,
    });
  }

  if (!records.length) {
    records = await findActiveManagers({
      roles: ["HR"],
      excludeUserId,
    });
  }

  return records.map(toManagerOption);
};

const getMyPrefillDetails = async (userId) => {
  const user = await User.findById(userId)
    .select("name employeeId manager teamLeader department role")
    .populate("manager", "name employeeId role")
    .populate("teamLeader", "name employeeId role");

  if (!user) {
    throw createAppError("Employee profile not found.", 404);
  }

  const reportingManagers = await getDepartmentReportingManagerOptions(user);
  const assignedManagerIds = [getRecordId(user.manager), getRecordId(user.teamLeader)].filter(
    Boolean
  );
  const selectedManager =
    reportingManagers.find((manager) => assignedManagerIds.includes(manager._id)) ||
    reportingManagers[0] ||
    null;

  const yesterdayDate = getRelativeDateString(-1);
  const hasYesterdayReport = await DailyWorkReport.exists({
    employee: userId,
    reportDate: yesterdayDate,
  });

  if (!hasYesterdayReport) {
    const todayDate = getTodayDateString();

    await notificationService.notifyDailyWorkReportReminder({
      recipientId: userId,
      reportDate: yesterdayDate,
      reminderDate: todayDate,
    });
  }

  return {
    employeeName: user.name || "",
    employeeId: user.employeeId || "",
    department: user.department || "",
    reportingManagerId: selectedManager ? selectedManager._id : "",
    reportingManager: selectedManager ? selectedManager.name || "" : "",
    reportingManagers,
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

const updateMyDailyWorkReport = async (userId, reportId, payload) => {
  const report = await DailyWorkReport.findById(reportId);
  if (!report) {
    throw createAppError("Daily work report not found.", 404);
  }

  if (String(report.employee || "") !== String(userId)) {
    throw createAppError("You can edit only your own report.", 403);
  }

  if (report.reviewStatus === "REVIEWED") {
    throw createAppError("Reviewed report cannot be edited.", 422);
  }

  if (!isWithinEditableWindow(report.reportDate)) {
    throw createAppError("You can edit this report only within 2 days.", 422);
  }

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

  const reportingManager = await User.findOne({
    _id: reportingManagerId,
    role: { $in: REPORTING_MANAGER_ROLES },
    isActive: true,
  }).select("name employeeId role");

  if (!reportingManager) {
    throw createAppError("Please select a valid reporting manager.", 422);
  }

  report.projectName = projectName;
  report.reportDate = reportDate;
  report.workDescription = workDescription;
  report.reportingManager = reportingManager._id;
  report.reportingManagerSnapshot = reportingManager.name || "";
  report.blockers = blockers;
  report.attachment = attachment;

  await report.save();

  const updatedRecord = await DailyWorkReport.findById(report._id)
    .populate("employee", "name employeeId role")
    .populate("reviewedBy", "name employeeId role");

  return updatedRecord;
};

const getMyDailyWorkReports = async (userId, query) => {
  const { page = 1, limit = 10, workStatus, reviewStatus } = query;

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

  applyReportDateFilters(filter, query);

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

const buildDailyWorkReportFilter = (query, reviewer = null) => {
  const {
    search = "",
    workStatus,
    reviewStatus,
    employeeId,
  } = query;

  const filter = {};

  if (reviewer?.role === "TL") {
    filter.reportingManager = String(reviewer.id || "");
  }

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

  applyReportDateFilters(filter, query);

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

  return filter;
};

const getDailyWorkReportStats = async (query, reviewer = null) => {
  const filter = buildDailyWorkReportFilter(query, reviewer);
  const withBlockersFilter = {
    ...filter,
    blockers: { $exists: true, $nin: [null, ""] },
  };

  const [
    total,
    pending,
    reviewed,
    completed,
    inProgress,
    blocked,
    onHold,
    withBlockers,
  ] = await Promise.all([
    DailyWorkReport.countDocuments(filter),
    DailyWorkReport.countDocuments({ ...filter, reviewStatus: "PENDING" }),
    DailyWorkReport.countDocuments({ ...filter, reviewStatus: "REVIEWED" }),
    DailyWorkReport.countDocuments({ ...filter, workStatus: "COMPLETED" }),
    DailyWorkReport.countDocuments({ ...filter, workStatus: "IN_PROGRESS" }),
    DailyWorkReport.countDocuments({ ...filter, workStatus: "BLOCKED" }),
    DailyWorkReport.countDocuments({ ...filter, workStatus: "ON_HOLD" }),
    DailyWorkReport.countDocuments(withBlockersFilter),
  ]);

  return {
    total,
    pending,
    reviewed,
    completed,
    inProgress,
    blocked,
    onHold,
    withBlockers,
  };
};

const getAllDailyWorkReports = async (query, reviewer = null) => {
  const {
    page = 1,
    limit = 10,
  } = query;

  const currentPage = Math.max(Number(page) || 1, 1);
  const perPage = Math.max(Number(limit) || 10, 1);
  const skip = (currentPage - 1) * perPage;

  const filter = buildDailyWorkReportFilter(query, reviewer);

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

  if (
    reviewer.role === "TL" &&
    String(report.reportingManager || "") !== String(reviewer.id)
  ) {
    throw createAppError("You can review only reports assigned to you.", 403);
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
  updateMyDailyWorkReport,
  getMyDailyWorkReports,
  getAllDailyWorkReports,
  getDailyWorkReportStats,
  reviewDailyWorkReport,
};
