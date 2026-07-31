const Counter = require("../counter/counter.model");
const ProjectActivity = require("./activities/projectActivity.model");
const TaskHistory = require("./task/taskHistory.model");

const createAppError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const parsePagination = (query = {}) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;
  const sortBy = String(query.sortBy || "createdAt");
  const sortOrder = String(query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;
  return { page, limit, skip, sort: { [sortBy]: sortOrder } };
};

const buildPaginatedResult = (records, totalRecords, page, limit) => ({
  page,
  limit,
  totalRecords,
  totalPages: Math.ceil(totalRecords / limit) || 1,
  data: records,
});

const generateProjectCode = async () => {
  const year = new Date().getFullYear();
  const key = `project_code_${year}`;
  const counter = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  return `PRJ-${year}-${String(counter.seq).padStart(4, "0")}`;
};

const logProjectActivity = async ({
  projectId,
  user,
  action,
  module = "PROJECT",
  oldValue = null,
  newValue = null,
  reason = "",
  entityType = null,
  entityId = null,
  description = "",
}) => {
  return ProjectActivity.create({
    projectId,
    user: user.id || user._id,
    userNameSnapshot: user.name || "",
    userRoleSnapshot: user.role || "",
    action,
    module,
    oldValue,
    newValue,
    reason,
    entityType,
    entityId,
    description,
  });
};

const logTaskHistory = async ({
  taskId,
  projectId,
  user,
  action,
  oldValue = null,
  newValue = null,
  reason = "",
  description = "",
}) => {
  return TaskHistory.create({
    taskId,
    projectId,
    user: user.id || user._id,
    userNameSnapshot: user.name || "",
    userRoleSnapshot: user.role || "",
    action,
    oldValue,
    newValue,
    reason,
    description,
  });
};

const calcDurationMinutes = (startedAt, endedAt = new Date()) => {
  if (!startedAt) return 0;
  const end = endedAt || new Date();
  return Math.max(0, Math.round((end - new Date(startedAt)) / 60000));
};

const calcProjectHealth = ({ progress, delayedTasks = 0, openBlockers = 0, daysToDeadline = null }) => {
  if (openBlockers >= 5 || delayedTasks >= 10) return "CRITICAL";
  if (delayedTasks >= 5 || (daysToDeadline !== null && daysToDeadline < 0)) return "DELAYED";
  if (delayedTasks >= 2 || openBlockers >= 2 || (daysToDeadline !== null && daysToDeadline <= 7)) {
    return "AT_RISK";
  }
  // return progress >= 80 ? "ON_TRACK" : progress >= 40 ? "ON_TRACK" : "AT_RISK";
  return progress >= 50 ? "ON_TRACK" : "ON_TRACK";
};

const calcProjectProgress = (tasks = []) => {
  if (!tasks.length) return 0;
  const completed = tasks.filter((t) => t.status === "COMPLETED" || t.status === "ARCHIVED").length;
  return Math.round((completed / tasks.length) * 100);
};

/** Project % = equal-weight average of each work area's %. Empty areas count as 0%. */
const calcProjectProgressFromAreas = (tasksByArea = {}) => {
  const areaIds = Object.keys(tasksByArea);
  if (!areaIds.length) return 0;
  const sum = areaIds.reduce((acc, id) => acc + calcProjectProgress(tasksByArea[id] || []), 0);
  return Math.round(sum / areaIds.length);
};

const isManagerRole = (role) => ["SUPER_ADMIN", "HR", "PROJECT_MANAGER"].includes(role);
const isTeamLeadRole = (role) => isManagerRole(role) || role === "TL";
const isClientRole = (role) => role === "CLIENT";

const USER_POPULATE = "name employeeId role email profilePhoto department designation";

module.exports = {
  createAppError,
  parsePagination,
  buildPaginatedResult,
  generateProjectCode,
  logProjectActivity,
  logTaskHistory,
  calcDurationMinutes,
  calcProjectHealth,
  calcProjectProgress,
  calcProjectProgressFromAreas,
  isManagerRole,
  isTeamLeadRole,
  isClientRole,
  USER_POPULATE,
};
