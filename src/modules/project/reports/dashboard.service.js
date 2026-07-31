const Project = require("../project.model");
const ProjectArea = require("../projectArea.model");
const Task = require("../task/task.model");
const TaskSession = require("../task/taskSession.model");
const Blocker = require("../blocker/blocker.model");
const ProjectActivity = require("../activities/projectActivity.model");
const User = require("../../user/user.model");
const taskService = require("../task/task.service");
const taskSessionService = require("../task/taskSession.service");
const TimeLog = require("../reports/timeLog.model");
const { createAppError, isManagerRole, isTeamLeadRole } = require("../project.helper");
const { getTodayDateKey } = require("../../../utils/istDateTime");

const getPMDashboard = async (user) => {
  if (!isManagerRole(user.role)) {
    throw createAppError("Access denied.", 403);
  }

  const now = new Date();
  const weekAhead = new Date(now.getTime() + 7 * 86400000);

  const isScopedManager = user.role === "PROJECT_MANAGER";
  const pmFilter = isScopedManager
    ? { projectManager: user.id, isArchived: false }
    : { isArchived: false };

  // A Project Manager only sees their own projects; reviews and deadlines follow the same scope.
  const scopedProjectIds = isScopedManager
    ? await Project.find({ projectManager: user.id, isArchived: false }).distinct("_id")
    : null;
  const projectScope = scopedProjectIds ? { projectId: { $in: scopedProjectIds } } : {};

  const [runningProjects, delayedProjects, upcomingDeadlines, pendingReviews, projects] =
    await Promise.all([
      Project.countDocuments({ ...pmFilter, status: "ACTIVE" }),
      Project.countDocuments({ ...pmFilter, health: { $in: ["DELAYED", "CRITICAL"] } }),
      Task.find({
        deadline: { $gte: now, $lte: weekAhead },
        status: { $nin: ["COMPLETED", "ARCHIVED"] },
        isArchived: false,
        ...projectScope,
      })
        .sort({ deadline: 1 })
        .limit(10)
        .populate("projectId", "projectName projectCode")
        .select("title deadline projectId assignedTo")
        .lean(),
      Task.countDocuments({ status: "UNDER_REVIEW", isArchived: false, ...projectScope }),
      Project.find(pmFilter).select("_id teamMembers progress health status projectName").lean(),
    ]);

  const memberIds = new Set();
  projects.forEach((p) => p.teamMembers?.forEach((m) => memberIds.add(String(m))));

  const activeTasks = memberIds.size
    ? await Task.countDocuments({
        assignedTo: { $in: [...memberIds] },
        status: { $in: ["IN_PROGRESS", "ACCEPTED"] },
        isArchived: false,
      })
    : 0;

  const teamUtilization = memberIds.size
    ? Math.min(100, Math.round((activeTasks / memberIds.size) * 100))
    : 0;

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

  const areas = await ProjectArea.find({ teamLead: user.id, isArchived: false })
    .populate("projectId", "projectName projectCode status")
    .lean();

  const areaIds = areas.map((a) => a._id);

  const [pendingApprovals, blockers, assignedTasks] = await Promise.all([
    Task.countDocuments({ projectAreaId: { $in: areaIds }, status: "UNDER_REVIEW", isArchived: false }),
    Blocker.countDocuments({
      projectAreaId: { $in: areaIds },
      status: { $in: ["OPEN", "IN_PROGRESS"] },
    }),
    Task.countDocuments({ projectAreaId: { $in: areaIds }, isArchived: false }),
  ]);

  return {
    workAreas: areas,
    assignedTasks,
    pendingApprovals,
    blockers,
  };
};

const getEmployeeDashboard = async (user) => {
  const today = getTodayDateKey();

  const [activeTask, timeLogs, upcomingDeadlines, recentActivities] = await Promise.all([
    taskService.getActiveTaskForEmployee(user.id),
    TimeLog.find({ employeeId: user.id, date: today }).lean(),
    Task.find({
      assignedTo: user.id,
      deadline: { $gte: new Date() },
      status: { $nin: ["COMPLETED", "ARCHIVED"] },
      isArchived: false,
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

const ENGAGED_TASK_STATUSES = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING",
  "BLOCKED",
  "UNDER_REVIEW",
  "REOPENED",
];

const OPEN_TASK_SORT_ORDER = {
  IN_PROGRESS: 0,
  BLOCKED: 1,
  PAUSED: 2,
  UNDER_REVIEW: 3,
  ACCEPTED: 4,
  ASSIGNED: 5,
  REOPENED: 6,
  WAITING: 7,
};

const compareOpenTasks = (a, b) => {
  const orderDiff =
    (OPEN_TASK_SORT_ORDER[a.status] ?? 9) - (OPEN_TASK_SORT_ORDER[b.status] ?? 9);
  if (orderDiff !== 0) return orderDiff;
  const deadlineA = a.deadline ? new Date(a.deadline).getTime() : Infinity;
  const deadlineB = b.deadline ? new Date(b.deadline).getTime() : Infinity;
  return deadlineA - deadlineB;
};

const resolveScopedEmployeeIds = async (user) => {
  if (isManagerRole(user.role)) {
    const employees = await User.find({
      isActive: true,
      role: { $in: ["EMPLOYEE", "QA", "TL", "PROJECT_MANAGER"] },
    })
      .select("_id")
      .lean();
    return employees.map((e) => e._id);
  }

  if (user.role === "TL") {
    const areas = await ProjectArea.find({
      $or: [{ teamLead: user.id }, { projectLead: user.id }],
      isArchived: false,
    })
      .select("_id")
      .lean();

    const areaIds = areas.map((a) => a._id);
    if (!areaIds.length) return [];

    const assignedIds = await Task.distinct("assignedTo", {
      projectAreaId: { $in: areaIds },
      assignedTo: { $ne: null },
      isArchived: false,
    });
    return assignedIds;
  }

  throw createAppError("Access denied.", 403);
};

const getEmployeesWorkStatus = async (user, query = {}) => {
  const employeeIds = await resolveScopedEmployeeIds(user);
  if (!employeeIds.length) {
    return {
      summary: { total: 0, free: 0, engaged: 0, workingNow: 0, blocked: 0 },
      data: [],
    };
  }

  const search = String(query.search || "").trim();
  const availability = String(query.availability || "").toUpperCase();

  const userFilter = {
    _id: { $in: employeeIds },
    isActive: true,
  };
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    userFilter.$or = [
      { name: regex },
      { employeeId: regex },
      { email: regex },
      { department: regex },
      { designation: regex },
    ];
  }

  const [employees, tasks, openSessions] = await Promise.all([
    User.find(userFilter)
      .select("name employeeId email role department designation profilePhoto")
      .sort({ name: 1 })
      .lean(),
    Task.find({
      assignedTo: { $in: employeeIds },
      isArchived: false,
      status: { $in: ENGAGED_TASK_STATUSES },
    })
      .select("title status priority deadline assignedTo projectId projectAreaId")
      .populate("projectId", "projectName projectCode")
      .populate("projectAreaId", "title")
      .lean(),
    TaskSession.find({
      employeeId: { $in: employeeIds },
      type: "WORKING",
      endedAt: null,
    })
      .select("employeeId taskId startedAt")
      .lean(),
  ]);

  const tasksByEmployee = new Map();
  for (const task of tasks) {
    const key = String(task.assignedTo);
    if (!tasksByEmployee.has(key)) tasksByEmployee.set(key, []);
    tasksByEmployee.get(key).push(task);
  }

  const sessionByEmployee = new Map();
  for (const session of openSessions) {
    sessionByEmployee.set(String(session.employeeId), session);
  }

  const rows = employees.map((emp) => {
    const empId = String(emp._id);
    const empTasks = tasksByEmployee.get(empId) || [];
    const activeSession = sessionByEmployee.get(empId) || null;

    const counts = {
      assigned: 0,
      accepted: 0,
      inProgress: 0,
      paused: 0,
      waiting: 0,
      blocked: 0,
      underReview: 0,
      reopened: 0,
    };

    for (const t of empTasks) {
      if (t.status === "ASSIGNED") counts.assigned += 1;
      else if (t.status === "ACCEPTED") counts.accepted += 1;
      else if (t.status === "IN_PROGRESS") counts.inProgress += 1;
      else if (t.status === "PAUSED") counts.paused += 1;
      else if (t.status === "WAITING") counts.waiting += 1;
      else if (t.status === "BLOCKED") counts.blocked += 1;
      else if (t.status === "UNDER_REVIEW") counts.underReview += 1;
      else if (t.status === "REOPENED") counts.reopened += 1;
    }

    // An open session only counts as live work when its task is still IN_PROGRESS,
    // otherwise a leftover session would show a free employee as busy.
    const activeTask =
      (activeSession &&
        empTasks.find(
          (t) => String(t._id) === String(activeSession.taskId) && t.status === "IN_PROGRESS"
        )) ||
      empTasks.find((t) => t.status === "IN_PROGRESS") ||
      null;

    const isWorkingNow = counts.inProgress > 0;
    const isBlocked = counts.blocked > 0 && !isWorkingNow;
    const isEngaged = empTasks.length > 0;
    const availabilityStatus = !isEngaged
      ? "FREE"
      : isWorkingNow
        ? "WORKING"
        : isBlocked
          ? "BLOCKED"
          : "ENGAGED";

    const openTasks = [...empTasks].sort(compareOpenTasks).map((t) => ({
      _id: t._id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      deadline: t.deadline || null,
      projectName:
        typeof t.projectId === "object" && t.projectId
          ? t.projectId.projectName
          : "",
      projectCode:
        typeof t.projectId === "object" && t.projectId
          ? t.projectId.projectCode
          : "",
      areaTitle:
        typeof t.projectAreaId === "object" && t.projectAreaId
          ? t.projectAreaId.title
          : "",
    }));

    return {
      _id: emp._id,
      name: emp.name,
      employeeId: emp.employeeId || "",
      email: emp.email || "",
      role: emp.role,
      department: emp.department || "",
      designation: emp.designation || "",
      profilePhoto: emp.profilePhoto || "",
      availability: availabilityStatus,
      engagedTaskCount: empTasks.length,
      counts,
      activeTask: activeTask
        ? {
            _id: activeTask._id,
            title: activeTask.title,
            status: activeTask.status,
            projectName:
              typeof activeTask.projectId === "object" && activeTask.projectId
                ? activeTask.projectId.projectName
                : "",
            projectCode:
              typeof activeTask.projectId === "object" && activeTask.projectId
                ? activeTask.projectId.projectCode
                : "",
            areaTitle:
              typeof activeTask.projectAreaId === "object" && activeTask.projectAreaId
                ? activeTask.projectAreaId.title
                : "",
            startedAt:
              activeSession && String(activeSession.taskId) === String(activeTask._id)
                ? activeSession.startedAt
                : null,
          }
        : null,
      tasks: openTasks,
    };
  });

  const filtered =
    availability && ["FREE", "ENGAGED", "WORKING", "BLOCKED"].includes(availability)
      ? rows.filter((r) => r.availability === availability)
      : rows;

  const ordered = [...filtered].sort((a, b) => {
    const rank = { FREE: 0, ENGAGED: 1, WORKING: 2, BLOCKED: 3 };
    const ra = rank[a.availability] ?? 9;
    const rb = rank[b.availability] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.engagedTaskCount !== b.engagedTaskCount) {
      return a.engagedTaskCount - b.engagedTaskCount;
    }
    return a.name.localeCompare(b.name);
  });

  const summary = {
    total: ordered.length,
    free: ordered.filter((r) => r.availability === "FREE").length,
    engaged: ordered.filter((r) => r.availability === "ENGAGED").length,
    workingNow: ordered.filter((r) => r.availability === "WORKING").length,
    blocked: ordered.filter((r) => r.availability === "BLOCKED").length,
  };

  return { summary, data: ordered };
};

module.exports = { getPMDashboard, getTLDashboard, getEmployeeDashboard, getEmployeesWorkStatus };
