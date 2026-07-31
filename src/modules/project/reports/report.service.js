const mongoose = require("mongoose");
const Task = require("../task/task.model");
const TaskSession = require("../task/taskSession.model");
const Blocker = require("../blocker/blocker.model");
const TimeLog = require("./timeLog.model");
const ProjectReport = require("./projectReport.model");
const Project = require("../project.model");
const ProjectArea = require("../projectArea.model");
const TaskHistory = require("../task/taskHistory.model");
const projectService = require("../project.service");
const {
  createAppError,
  calcDurationMinutes,
  isManagerRole,
  isTeamLeadRole,
} = require("../project.helper");
const { getTodayDateKey, getIstDayBounds } = require("../../../utils/istDateTime");

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

/**
 * Own report is always allowed. PM/HR/Super Admin can read anyone.
 * A Team Lead is limited to people who hold work in an area they lead.
 */
const resolveReportEmployeeId = async (user, requestedEmployeeId) => {
  if (!requestedEmployeeId) return user.id;

  if (!mongoose.isValidObjectId(requestedEmployeeId)) {
    throw createAppError("Invalid employee id.", 422);
  }
  if (String(requestedEmployeeId) === String(user.id)) return user.id;
  if (isManagerRole(user.role)) return requestedEmployeeId;
  if (user.role !== "TL") throw createAppError("Access denied.", 403);

  const areaIds = await ProjectArea.find({
    $or: [{ teamLead: user.id }, { projectLead: user.id }],
    isArchived: false,
  }).distinct("_id");

  const inTeam = areaIds.length
    ? await Task.exists({
        projectAreaId: { $in: areaIds },
        assignedTo: requestedEmployeeId,
      })
    : null;

  if (!inTeam) throw createAppError("Access denied.", 403);
  return requestedEmployeeId;
};

const getEmployeeReport = async (user, query = {}) => {
  const employeeId = await resolveReportEmployeeId(user, query.employeeId);

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

const OPEN_STATUSES = [
  "CREATED",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "PAUSED",
  "WAITING",
  "BLOCKED",
  "UNDER_REVIEW",
  "REOPENED",
];

const round2 = (value) => Math.round(value * 100) / 100;
const toHours = (minutes) => round2((minutes || 0) / 60);
const pad2 = (value) => String(value).padStart(2, "0");

const resolveMonthRange = (month) => {
  const [currentYear, currentMonth] = getTodayDateKey().split("-").map(Number);
  let year = currentYear;
  let monthIndex = currentMonth - 1;

  if (/^\d{4}-\d{2}$/.test(String(month || ""))) {
    const [parsedYear, parsedMonth] = String(month).split("-").map(Number);
    if (parsedMonth >= 1 && parsedMonth <= 12) {
      year = parsedYear;
      monthIndex = parsedMonth - 1;
    }
  }

  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const monthKey = `${year}-${pad2(monthIndex + 1)}`;
  const from = `${monthKey}-01`;
  const to = `${monthKey}-${pad2(daysInMonth)}`;

  return {
    monthKey,
    label: new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }),
    from,
    to,
    // Session/blocker timestamps are compared against IST day edges so the month
    // boundary matches the date keys used by TimeLog.
    start: getIstDayBounds(from).start,
    end: getIstDayBounds(to).end,
    daysInMonth,
  };
};

const sessionMinutes = (session) =>
  session.duration || calcDurationMinutes(session.startedAt, session.endedAt);

const buildTimeBreakdown = (timeLogs) => {
  const totals = timeLogs.reduce(
    (acc, log) => {
      acc.working += log.workingMinutes || 0;
      acc.paused += log.pausedMinutes || 0;
      acc.blocked += log.blockedMinutes || 0;
      return acc;
    },
    { working: 0, paused: 0, blocked: 0 }
  );

  const tracked = totals.working + totals.paused + totals.blocked;

  return {
    workingMinutes: totals.working,
    pausedMinutes: totals.paused,
    blockedMinutes: totals.blocked,
    trackedMinutes: tracked,
    workingHours: toHours(totals.working),
    pausedHours: toHours(totals.paused),
    blockedHours: toHours(totals.blocked),
    trackedHours: toHours(tracked),
    efficiency: tracked ? Math.round((totals.working / tracked) * 100) : 0,
  };
};

const buildDailyTrend = (timeLogs) => {
  const byDate = new Map();
  for (const log of timeLogs) {
    const entry = byDate.get(log.date) || {
      date: log.date,
      workingMinutes: 0,
      pausedMinutes: 0,
      blockedMinutes: 0,
    };
    entry.workingMinutes += log.workingMinutes || 0;
    entry.pausedMinutes += log.pausedMinutes || 0;
    entry.blockedMinutes += log.blockedMinutes || 0;
    byDate.set(log.date, entry);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
};

const buildPauseAnalysis = (sessions) => {
  const pauseSessions = sessions.filter((s) => s.type === "PAUSED" || s.type === "BREAK");

  let totalMinutes = 0;
  let longest = null;
  const reasonMap = new Map();

  for (const session of pauseSessions) {
    const minutes = sessionMinutes(session);
    totalMinutes += minutes;

    if (!longest || minutes > longest.minutes) {
      longest = {
        minutes,
        reason: session.reason || "Not specified",
        taskTitle: session.taskId?.title || "",
        startedAt: session.startedAt,
      };
    }

    const reason = (session.reason || "").trim() || "Not specified";
    const entry = reasonMap.get(reason) || { reason, count: 0, minutes: 0 };
    entry.count += 1;
    entry.minutes += minutes;
    reasonMap.set(reason, entry);
  }

  const topReasons = [...reasonMap.values()]
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 5);

  return {
    count: pauseSessions.length,
    totalMinutes,
    totalHours: toHours(totalMinutes),
    avgMinutes: pauseSessions.length ? Math.round(totalMinutes / pauseSessions.length) : 0,
    longest,
    topReasons,
  };
};

const buildBlockerAnalysis = (blockers) => {
  const resolvedList = blockers.filter(
    (b) => ["RESOLVED", "CLOSED"].includes(b.status) && b.resolvedAt
  );

  const resolutionHours = resolvedList.map((b) =>
    (new Date(b.resolvedAt) - new Date(b.raisedAt)) / 3600000
  );

  const avgResolutionHours = resolutionHours.length
    ? round2(resolutionHours.reduce((sum, h) => sum + h, 0) / resolutionHours.length)
    : 0;

  return {
    raised: blockers.length,
    resolved: resolvedList.length,
    open: blockers.filter((b) => ["OPEN", "IN_PROGRESS"].includes(b.status)).length,
    avgResolutionHours,
    recent: blockers.slice(0, 6).map((b) => ({
      _id: b._id,
      reason: b.reason,
      status: b.status,
      raisedAt: b.raisedAt,
      resolvedAt: b.resolvedAt || null,
      taskTitle: b.taskId?.title || "",
      projectName: b.projectId?.projectName || "",
    })),
  };
};

const getMyOverallReport = async (user, query = {}) => {
  const employeeId = await resolveReportEmployeeId(user, query.employeeId);

  const period = resolveMonthRange(query.month);
  const now = new Date();

  const [timeLogs, sessions, blockers, tasks] = await Promise.all([
    TimeLog.find({ employeeId, date: { $gte: period.from, $lte: period.to } })
      .select("date workingMinutes pausedMinutes blockedMinutes projectId taskId")
      .populate("projectId", "projectName projectCode")
      .lean(),
    TaskSession.find({ employeeId, startedAt: { $gte: period.start, $lte: period.end } })
      .select("type duration startedAt endedAt reason taskId")
      .populate("taskId", "title")
      .lean(),
    Blocker.find({ employee: employeeId, raisedAt: { $gte: period.start, $lte: period.end } })
      .select("reason status raisedAt resolvedAt taskId projectId")
      .populate("taskId", "title")
      .populate("projectId", "projectName projectCode")
      .sort({ raisedAt: -1 })
      .lean(),
    Task.find({ assignedTo: employeeId, isArchived: false })
      .select(
        "title status priority deadline completedAt assignedAt actualHours estimatedHours projectId projectAreaId"
      )
      .populate("projectId", "projectName projectCode")
      .populate("projectAreaId", "title")
      .lean(),
  ]);

  const taskIds = tasks.map((t) => t._id);
  const history = taskIds.length
    ? await TaskHistory.find({
        taskId: { $in: taskIds },
        createdAt: { $gte: period.start, $lte: period.end },
      })
        .select("action")
        .lean()
    : [];

  const time = buildTimeBreakdown(timeLogs);
  const dailyTrend = buildDailyTrend(timeLogs);
  const activeDays = dailyTrend.filter((d) => d.workingMinutes > 0).length;
  const bestDay = dailyTrend.reduce(
    (best, day) => (!best || day.workingMinutes > best.workingMinutes ? day : best),
    null
  );

  const openTasks = tasks.filter((t) => OPEN_STATUSES.includes(t.status));
  const completedInMonth = tasks.filter(
    (t) =>
      t.status === "COMPLETED" &&
      t.completedAt &&
      new Date(t.completedAt) >= period.start &&
      new Date(t.completedAt) <= period.end
  );
  const onTimeCompleted = completedInMonth.filter(
    (t) => !t.deadline || new Date(t.completedAt) <= new Date(t.deadline)
  ).length;

  const statusCounts = tasks.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  const estimatedHours = round2(
    completedInMonth.reduce((sum, t) => sum + (t.estimatedHours || 0), 0)
  );
  const actualHours = round2(
    completedInMonth.reduce((sum, t) => sum + (t.actualHours || 0), 0)
  );

  const minutesByTask = new Map();
  const minutesByProject = new Map();
  for (const log of timeLogs) {
    if (log.taskId) {
      const key = String(log.taskId);
      minutesByTask.set(key, (minutesByTask.get(key) || 0) + (log.workingMinutes || 0));
    }
    const projectKey = String(log.projectId?._id || log.projectId || "");
    if (!projectKey) continue;
    const entry = minutesByProject.get(projectKey) || {
      projectId: projectKey,
      projectName: log.projectId?.projectName || "",
      projectCode: log.projectId?.projectCode || "",
      workingMinutes: 0,
      pausedMinutes: 0,
      blockedMinutes: 0,
    };
    entry.workingMinutes += log.workingMinutes || 0;
    entry.pausedMinutes += log.pausedMinutes || 0;
    entry.blockedMinutes += log.blockedMinutes || 0;
    minutesByProject.set(projectKey, entry);
  }

  const projectBreakdown = [...minutesByProject.values()]
    .map((entry) => {
      const projectTasks = tasks.filter(
        (t) => String(t.projectId?._id || t.projectId) === entry.projectId
      );
      return {
        ...entry,
        workingHours: toHours(entry.workingMinutes),
        taskCount: projectTasks.length,
        completedTasks: projectTasks.filter((t) => t.status === "COMPLETED").length,
      };
    })
    .sort((a, b) => b.workingMinutes - a.workingMinutes);

  const relevantTasks = [...openTasks, ...completedInMonth];
  const taskDetails = relevantTasks
    .map((t) => {
      const minutes = minutesByTask.get(String(t._id)) || 0;
      const isCompleted = t.status === "COMPLETED";
      return {
        _id: t._id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        deadline: t.deadline || null,
        completedAt: t.completedAt || null,
        projectName: t.projectId?.projectName || "",
        projectCode: t.projectId?.projectCode || "",
        areaTitle: t.projectAreaId?.title || "",
        estimatedHours: t.estimatedHours || 0,
        actualHours: t.actualHours || 0,
        monthWorkingHours: toHours(minutes),
        isOverdue: Boolean(
          !isCompleted && t.deadline && new Date(t.deadline) < now
        ),
        onTime: isCompleted
          ? !t.deadline || new Date(t.completedAt) <= new Date(t.deadline)
          : null,
      };
    })
    .sort((a, b) => b.monthWorkingHours - a.monthWorkingHours);

  const countAction = (action) => history.filter((h) => h.action === action).length;

  return {
    period: {
      month: period.monthKey,
      label: period.label,
      from: period.from,
      to: period.to,
      daysInMonth: period.daysInMonth,
    },
    time: {
      ...time,
      activeDays,
      avgWorkingMinutesPerActiveDay: activeDays
        ? Math.round(time.workingMinutes / activeDays)
        : 0,
      bestDay,
    },
    tasks: {
      totalAssigned: tasks.length,
      open: openTasks.length,
      completedInMonth: completedInMonth.length,
      completedAllTime: tasks.filter((t) => t.status === "COMPLETED").length,
      onTimeCompleted,
      lateCompleted: completedInMonth.length - onTimeCompleted,
      onTimeRate: completedInMonth.length
        ? Math.round((onTimeCompleted / completedInMonth.length) * 100)
        : 0,
      overdueOpen: openTasks.filter((t) => t.deadline && new Date(t.deadline) < now).length,
      statusCounts,
      estimatedHours,
      actualHours,
      estimateAccuracy:
        estimatedHours > 0 ? Math.round((estimatedHours / Math.max(actualHours, 0.01)) * 100) : 0,
    },
    pauses: buildPauseAnalysis(sessions),
    blockers: buildBlockerAnalysis(blockers),
    reviews: {
      submitted: countAction("TASK_SUBMITTED_FOR_REVIEW"),
      approved: countAction("TASK_APPROVED"),
      rejected: countAction("TASK_REJECTED"),
      reopened: countAction("TASK_REOPENED"),
      completed: countAction("TASK_COMPLETED"),
    },
    dailyTrend,
    projectBreakdown,
    taskDetails,
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
  getMyOverallReport,
  getTeamLeadReport,
  buildProjectMetrics,
};
