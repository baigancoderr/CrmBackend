const Task = require("../task/task.model");
const Blocker = require("../blocker/blocker.model");
const TimeLog = require("./timeLog.model");
const ProjectReport = require("./projectReport.model");
const Project = require("../project.model");
const ProjectArea = require("../projectArea.model");
const TaskHistory = require("../task/taskHistory.model");
const projectService = require("../project.service");
const { createAppError, isManagerRole, isTeamLeadRole } = require("../project.helper");

const buildProjectMetrics = async (projectId) => {
  const now = new Date();
  const [tasks, openBlockers, timeLogs, project] = await Promise.all([
    Task.find({ projectId, isArchived: false }).select("status deadline actualHours").lean(),
    Blocker.countDocuments({ projectId, status: { $in: ["OPEN", "IN_PROGRESS"] } }),
    TimeLog.find({ projectId }).select("workingMinutes").lean(),
    Project.findById(projectId).select("progress health projectName expectedEndDate startDate"),
  ]);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === "COMPLETED").length;
  const delayedTasks = tasks.filter(
    (t) => t.deadline && new Date(t.deadline) < now && !["COMPLETED", "ARCHIVED"].includes(t.status)
  ).length;
  const blockedTasks = tasks.filter((t) => t.status === "BLOCKED").length;

  const reopenedTasks = await TaskHistory.countDocuments({
    projectId,
    action: "TASK_REOPENED",
  });

  const totalMinutes = timeLogs.reduce((sum, l) => sum + (l.workingMinutes || 0), 0);

  return {
    project,
    metrics: {
      totalTasks,
      completedTasks,
      delayedTasks,
      blockedTasks,
      reopenedTasks,
      openBlockers,
      totalHours: Math.round((totalMinutes / 60) * 100) / 100,
      progress: project?.progress || 0,
      health: project?.health || "ON_TRACK",
    },
  };
};

const getProjectReport = async (projectId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  const { project, metrics } = await buildProjectMetrics(projectId);

  const durationDays =
    project?.startDate && project?.expectedEndDate
      ? Math.ceil((new Date(project.expectedEndDate) - new Date(project.startDate)) / 86400000)
      : null;

  return {
    project: {
      id: project._id,
      name: project.projectName,
      durationDays,
    },
    ...metrics,
  };
};

const generateProjectReportSnapshot = async (projectId, user, payload = {}) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  if (!isManagerRole(user.role)) {
    throw createAppError("Only managers can generate project reports.", 403);
  }

  const { metrics } = await buildProjectMetrics(projectId);

  return ProjectReport.create({
    projectId,
    reportType: payload.reportType || "SNAPSHOT",
    generatedBy: user.id,
    generatedByNameSnapshot: user.name,
    periodStart: payload.periodStart || null,
    periodEnd: payload.periodEnd || null,
    metrics,
    summary: payload.summary || "",
  });
};

const getEmployeeReport = async (user, query = {}) => {
  const employeeId = query.employeeId || user.id;
  if (String(employeeId) !== String(user.id) && !isTeamLeadRole(user.role)) {
    throw createAppError("Access denied.", 403);
  }

  const dateFilter = {};
  if (query.from) dateFilter.$gte = query.from;
  if (query.to) dateFilter.$lte = query.to;

  const logFilter = { employeeId };
  if (Object.keys(dateFilter).length) logFilter.date = dateFilter;

  const [timeLogs, tasks] = await Promise.all([
    TimeLog.find(logFilter).lean(),
    Task.find({ assignedTo: employeeId, isArchived: false }).select("status").lean(),
  ]);

  const workingMinutes = timeLogs.reduce((s, l) => s + (l.workingMinutes || 0), 0);
  const pausedMinutes = timeLogs.reduce((s, l) => s + (l.pausedMinutes || 0), 0);
  const blockedMinutes = timeLogs.reduce((s, l) => s + (l.blockedMinutes || 0), 0);
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;

  return {
    employeeId,
    workingHours: Math.round((workingMinutes / 60) * 100) / 100,
    pausedHours: Math.round((pausedMinutes / 60) * 100) / 100,
    blockedHours: Math.round((blockedMinutes / 60) * 100) / 100,
    taskCount: tasks.length,
    completionRate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0,
  };
};

const getTeamLeadReport = async (user, query = {}) => {
  if (!isTeamLeadRole(user.role)) throw createAppError("Access denied.", 403);

  const areas = await ProjectArea.find({ teamLead: user.id }).select("_id projectId title").lean();
  const areaIds = areas.map((a) => a._id);

  const now = new Date();
  const [pendingReviews, delayedTasks, openBlockers, teamTasks] = await Promise.all([
    Task.countDocuments({ projectAreaId: { $in: areaIds }, status: "UNDER_REVIEW" }),
    Task.countDocuments({
      projectAreaId: { $in: areaIds },
      deadline: { $lt: now },
      status: { $nin: ["COMPLETED", "ARCHIVED"] },
    }),
    Blocker.countDocuments({
      projectAreaId: { $in: areaIds },
      status: { $in: ["OPEN", "IN_PROGRESS"] },
    }),
    Task.find({ projectAreaId: { $in: areaIds }, isArchived: false }).select("status").lean(),
  ]);

  const completed = teamTasks.filter((t) => t.status === "COMPLETED").length;

  return {
    workAreas: areas.length,
    pendingReviews,
    delayedTasks,
    openBlockers,
    teamProductivity: teamTasks.length ? Math.round((completed / teamTasks.length) * 100) : 0,
  };
};

module.exports = {
  getProjectReport,
  generateProjectReportSnapshot,
  getEmployeeReport,
  getTeamLeadReport,
  buildProjectMetrics,
};
