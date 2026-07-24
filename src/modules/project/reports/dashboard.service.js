const Project = require("../project.model");
const ProjectArea = require("../projectArea.model");
const Task = require("../task/task.model");
const Blocker = require("../blocker/blocker.model");
const ProjectActivity = require("../activities/projectActivity.model");
const taskService = require("../task/task.service");
const taskSessionService = require("../task/taskSession.service");
const TimeLog = require("../reports/timeLog.model");
const { isManagerRole, isTeamLeadRole } = require("../project.helper");

const getPMDashboard = async (user) => {
  if (!isManagerRole(user.role) && user.role !== "PROJECT_MANAGER") {
    if (user.role !== "SUPER_ADMIN" && user.role !== "HR" && user.role !== "PROJECT_MANAGER") {
      // PM dashboard for PM roles only
    }
  }

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400000);

  const pmFilter =
    user.role === "PROJECT_MANAGER"
      ? { projectManager: user.id, isArchived: false }
      : { isArchived: false };

  const [runningProjects, delayedProjects, upcomingDeadlines, pendingReviews, projects] =
    await Promise.all([
      Project.countDocuments({ ...pmFilter, status: "ACTIVE" }),
      Project.countDocuments({ ...pmFilter, health: { $in: ["DELAYED", "CRITICAL"] } }),
      Task.find({
        deadline: { $gte: now, $lte: weekAhead },
        status: { $nin: ["COMPLETED", "ARCHIVED"] },
        ...(user.role === "PROJECT_MANAGER"
          ? { projectId: { $in: await Project.find({ projectManager: user.id }).distinct("_id") } }
          : {}),
      })
        .sort({ deadline: 1 })
        .limit(10)
        .populate("projectId", "projectName projectCode")
        .select("title deadline projectId assignedTo")
        .lean(),
      Task.countDocuments({ status: "UNDER_REVIEW" }),
      Project.find(pmFilter).select("_id teamMembers progress health status projectName").lean(),
    ]);

  const memberIds = new Set();
  projects.forEach((p) => p.teamMembers?.forEach((m) => memberIds.add(String(m))));

  const activeTasks = await Task.countDocuments({
    assignedTo: { $in: [...memberIds] },
    status: { $in: ["IN_PROGRESS", "ACCEPTED"] },
  });

  const teamUtilization =
    memberIds.size > 0 ? Math.round((activeTasks / memberIds.size) * 100) : 0;

  return {
    runningProjects,
    delayedProjects,
    upcomingDeadlines,
    pendingReviews,
    teamUtilization,
  };
};

const getTLDashboard = async (user) => {
  if (!isTeamLeadRole(user.role)) return { workAreas: [], pendingApprovals: 0, blockers: 0 };

  const areas = await ProjectArea.find({ teamLead: user.id })
    .populate("projectId", "projectName projectCode status")
    .lean();

  const areaIds = areas.map((a) => a._id);

  const [pendingApprovals, blockers, assignedTasks] = await Promise.all([
    Task.countDocuments({ projectAreaId: { $in: areaIds }, status: "UNDER_REVIEW" }),
    Blocker.countDocuments({
      projectAreaId: { $in: areaIds },
      status: { $in: ["OPEN", "IN_PROGRESS"] },
    }),
    Task.countDocuments({ projectAreaId: { $in: areaIds }, status: { $ne: "ARCHIVED" } }),
  ]);

  return {
    workAreas: areas,
    assignedTasks,
    pendingApprovals,
    blockers,
  };
};

const getEmployeeDashboard = async (user) => {
  const today = new Date().toISOString().slice(0, 10);

  const [activeTask, timeLogs, upcomingDeadlines, recentActivities] = await Promise.all([
    taskService.getActiveTaskForEmployee(user.id),
    TimeLog.find({ employeeId: user.id, date: today }).lean(),
    Task.find({
      assignedTo: user.id,
      deadline: { $gte: new Date() },
      status: { $nin: ["COMPLETED", "ARCHIVED"] },
    })
      .sort({ deadline: 1 })
      .limit(5)
      .populate("projectId", "projectName")
      .select("title deadline projectId status")
      .lean(),
    ProjectActivity.find({ user: user.id }).sort({ createdAt: -1 }).limit(10).lean(),
  ]);

  const workingMinutes = timeLogs.reduce((s, l) => s + (l.workingMinutes || 0), 0);
  const pausedMinutes = timeLogs.reduce((s, l) => s + (l.pausedMinutes || 0), 0);

  const timeline = await taskSessionService.getEmployeeTimeline(user.id, { date: today });

  return {
    activeTask,
    timeWorkedMinutes: workingMinutes,
    pausedMinutes,
    upcomingDeadlines,
    recentActivities,
    timeline,
  };
};

module.exports = { getPMDashboard, getTLDashboard, getEmployeeDashboard };
