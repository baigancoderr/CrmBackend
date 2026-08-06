const mongoose = require("mongoose");
const Task = require("./task.model");
const TaskDependency = require("./taskDependency.model");
const TaskAttachment = require("./taskAttachment.model");
const TaskSession = require("./taskSession.model");
const ProjectArea = require("../projectArea.model");
const Project = require("../project.model");
const User = require("../../user/user.model");
const projectService = require("../project.service");
const taskSessionService = require("./taskSession.service");
const {
  createAppError,
  parsePagination,
  buildPaginatedResult,
  logProjectActivity,
  logTaskHistory,
  calcDurationMinutes,
  calcProjectProgress,
  isTeamLeadRole,
  USER_POPULATE,
} = require("../project.helper");
const {
  notifyTaskAssigned,
  notifyTaskSubmittedForReview,
  notifyTaskReviewDecision,
  notifyDependencyResolved,
  notifyUrgentTaskRequest,
} = require("../notifications/projectNotification.service");
const {
  PM_ROLES,
  TL_ROLES,
  TASK_STATUSES,
  TASK_PRIORITIES,
} = require("../project.constants");

const TASK_POPULATE = [
  { path: "assignedTo", select: USER_POPULATE },
  { path: "assignedBy", select: USER_POPULATE },
  { path: "reviewedBy", select: USER_POPULATE },
  { path: "projectAreaId", select: "title teamLead projectLead status" },
  { path: "dependsOn", select: "title status" },
];

/** Employees only ever see tasks assigned to them; leads and above see the whole project. */
const isSelfScopedTaskViewer = (role) => role === "EMPLOYEE";

const assertCanManageArea = async (projectId, areaId, user) => {
  const area = await ProjectArea.findOne({ _id: areaId, projectId });
  if (!area) throw createAppError("Work area not found.", 404);

  const isPM = PM_ROLES.includes(user.role);
  const isAreaTL = String(area.teamLead) === String(user.id);
  const isProjectLead = String(area.projectLead) === String(user.id);
  if (!isPM && !isAreaTL && !isProjectLead) {
    throw createAppError("Only Team Lead, Project Lead, or Project Manager can manage tasks in this area.", 403);
  }
  return area;
};

const refreshAreaProgress = async (projectAreaId) => {
  if (!projectAreaId) return;

  const [tasks, area] = await Promise.all([
    Task.find({ projectAreaId, isArchived: false }).select("status").lean(),
    ProjectArea.findById(projectAreaId).select("status").lean(),
  ]);
  if (!area) return;

  const update = { progress: calcProjectProgress(tasks) };

  const allDone = tasks.length > 0 && tasks.every((t) => ["COMPLETED", "ARCHIVED"].includes(t.status));
  const anyStarted = tasks.some((t) =>
    ["IN_PROGRESS", "UNDER_REVIEW", "PAUSED", "BLOCKED", "ACCEPTED"].includes(t.status)
  );

  if (allDone) update.status = "COMPLETED";
  else if (anyStarted) update.status = "IN_PROGRESS";
  else if (!tasks.length) {
    // Every task was removed, so an auto-set IN_PROGRESS/COMPLETED must not stick.
    if (["IN_PROGRESS", "COMPLETED"].includes(area.status)) update.status = "NOT_STARTED";
  } else if (area.status === "COMPLETED") {
    // A finished area got fresh or reopened work, so it is no longer complete.
    update.status = "IN_PROGRESS";
  }

  await ProjectArea.findByIdAndUpdate(projectAreaId, update);
};

const checkDependenciesForTask = async (task) => {
  if (!task.dependsOn?.length) return task;

  const deps = await Task.find({ _id: { $in: task.dependsOn } }).select("status title").lean();
  const incomplete = deps.filter((d) => !["COMPLETED", "ARCHIVED"].includes(d.status));

  if (incomplete.length > 0) {
    if (task.status !== "WAITING" && !["COMPLETED", "ARCHIVED", "UNDER_REVIEW"].includes(task.status)) {
      task.status = "WAITING";
      await task.save();
    }
    return task;
  }

  if (task.status === "WAITING") {
    task.status = task.assignedTo ? "ASSIGNED" : "CREATED";
    await task.save();
  }
  return task;
};

const resolveDependenciesOnComplete = async (completedTask, user) => {
  const dependents = await Task.find({
    dependsOn: completedTask._id,
    status: "WAITING",
    isArchived: false,
  });

  for (const dependent of dependents) {
    const deps = await Task.find({ _id: { $in: dependent.dependsOn } }).select("status").lean();
    const allComplete = deps.every((d) => ["COMPLETED", "ARCHIVED"].includes(d.status));
    if (!allComplete) continue;

    const oldStatus = dependent.status;
    dependent.status = dependent.assignedTo ? "ASSIGNED" : "CREATED";
    await dependent.save();

    await TaskDependency.updateMany(
      { taskId: dependent._id, dependsOnTaskId: completedTask._id },
      { isResolved: true, resolvedAt: new Date() }
    );

    if (dependent.assignedTo) {
      await notifyDependencyResolved({
        recipientId: dependent.assignedTo,
        actorId: user.id,
        task: dependent,
        dependencyTask: completedTask,
      });
    }

    await logTaskHistory({
      taskId: dependent._id,
      projectId: dependent.projectId,
      user,
      action: "TASK_DEPENDENCY_RESOLVED",
      oldValue: { status: oldStatus },
      newValue: { status: dependent.status },
      description: `Dependency "${completedTask.title}" completed.`,
    });
  }
};

const pauseActiveTaskForEmployee = async (employeeId, user, reason = "Switched to another task") => {
  const activeTask = await Task.findOne({
    assignedTo: employeeId,
    status: "IN_PROGRESS",
    isArchived: false,
  });

  if (!activeTask) return null;

  const oldStatus = activeTask.status;
  activeTask.status = "PAUSED";
  activeTask.pauseReason = reason;
  await activeTask.save();

  const closedSession = await taskSessionService.endOpenSession(activeTask._id, employeeId);
  if (closedSession) {
    await taskSessionService.syncTimeLogForSessions([closedSession]);
  }
  await taskSessionService.createSession({
    taskId: activeTask._id,
    projectId: activeTask.projectId,
    employeeId,
    employeeName: user.name,
    type: "PAUSED",
    reason,
  });

  await logTaskHistory({
    taskId: activeTask._id,
    projectId: activeTask.projectId,
    user,
    action: "TASK_PAUSED",
    oldValue: { status: oldStatus },
    newValue: { status: "PAUSED" },
    reason,
  });

  return activeTask;
};

const createTask = async (projectId, user, payload) => {
  const project = await projectService.assertProjectAccess(projectId, user, { write: true });
  // If project does not include weekends, prevent task deadlines on weekends
  if (!project.includeWeekends && payload.deadline) {
    const dl = new Date(payload.deadline);
    const day = dl.getDay();
    if (day === 0 || day === 6) throw createAppError("Project does not include weekends; task deadline cannot be on weekend.", 422);
  }
  if (project.status !== "ACTIVE") {
    throw createAppError("Tasks can only be created when the project status is ACTIVE.", 403);
  }
  const area = await assertCanManageArea(projectId, payload.projectAreaId, user);

  const title = String(payload.title || "").trim();
  if (!title) throw createAppError("Task title is required.", 422);

  const task = await Task.create({
    title,
    description: String(payload.description || "").trim(),
    projectId,
    projectAreaId: area._id,
    assignedTo: payload.assignedTo || null,
    assignedBy: payload.assignedTo ? user.id : null,
    assignedByNameSnapshot: payload.assignedTo ? user.name : "",
    assignedToNameSnapshot: "",
    assignedAt: payload.assignedTo ? new Date() : null,
    priority: payload.priority || "MEDIUM",
    status: payload.assignedTo ? "ASSIGNED" : "CREATED",
    estimatedHours: payload.estimatedHours || 0,
    deadline: payload.deadline || null,
    dependsOn: Array.isArray(payload.dependsOn) ? payload.dependsOn : [],
    sprintId: payload.sprintId || "",
    kanbanOrder: payload.kanbanOrder || 0,
    createdBy: user.id,
  });

  if (payload.assignedTo) {
    const assignee = await User.findById(payload.assignedTo).select("name");
    task.assignedToNameSnapshot = assignee?.name || "";
    await task.save();
    if (assignee) {
      await projectService.ensureAssignedUserProjectMembership({
        projectId,
        userId: assignee._id,
        userName: assignee.name,
        role: "MEMBER",
        projectAreaId: area._id,
        addedBy: user.id,
      });
    }
  }

  if (payload.dependsOn?.length) {
    for (const depId of payload.dependsOn) {
      await TaskDependency.create({
        taskId: task._id,
        dependsOnTaskId: depId,
        projectId,
        createdBy: user.id,
      });
    }
    await checkDependenciesForTask(task);
  }

  if (area.status === "NOT_STARTED") {
    area.status = "IN_PROGRESS";
    await area.save();
  }

  await logProjectActivity({
    projectId,
    user,
    action: "TASK_CREATED",
    module: "TASK",
    entityType: "Task",
    entityId: task._id,
    newValue: { title, areaId: area._id },
  });

  if (payload.assignedTo) {
    const project = await Project.findById(projectId).select("projectName");
    await notifyTaskAssigned({ recipientId: payload.assignedTo, actorId: user.id, task, project });
    await logProjectActivity({
      projectId,
      user,
      action: "TASK_ASSIGNED",
      module: "TASK",
      entityType: "Task",
      entityId: task._id,
      newValue: { assignedTo: payload.assignedTo },
    });
  }

  await projectService.refreshProjectMetrics(projectId);
  return Task.findById(task._id).populate(TASK_POPULATE);
};

const listTasks = async (projectId, user, query = {}) => {
  await projectService.assertProjectAccess(projectId, user);
  const { page, limit, skip, sort } = parsePagination(query);

  const filter = { projectId, isArchived: query.archived === "true" };
  if (query.status) filter.status = query.status;
  if (query.projectAreaId) filter.projectAreaId = query.projectAreaId;
  if (query.assignedTo) filter.assignedTo = query.assignedTo;
  if (query.priority) filter.priority = query.priority;
  if (query.search) filter.title = { $regex: query.search, $options: "i" };

  if (query.mine === "true") filter.assignedTo = user.id;

  // Applied last so no query param can widen an employee's scope.
  if (isSelfScopedTaskViewer(user.role)) filter.assignedTo = user.id;

  const [records, totalRecords] = await Promise.all([
    Task.find(filter).sort(sort).skip(skip).limit(limit).populate(TASK_POPULATE).lean(),
    Task.countDocuments(filter),
  ]);

  return buildPaginatedResult(records, totalRecords, page, limit);
};

const WORKING_TASK_STATUSES = [
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "PAUSED",
  "BLOCKED",
  "WAITING",
  "REOPENED",
  "UNDER_REVIEW",
];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const listMyWorkingTasks = async (userId, query = {}) => {
  const employeeId = new mongoose.Types.ObjectId(userId);
  const { page, limit, skip } = parsePagination(query);
  const status = String(query.status || "").trim().toUpperCase();
  const priority = String(query.priority || "").trim().toUpperCase();
  const search = String(query.search || "").trim().slice(0, 100);
  const allowedSortFields = new Set(["updatedAt", "createdAt", "deadline", "title", "status", "priority"]);
  const sortBy = allowedSortFields.has(String(query.sortBy)) ? String(query.sortBy) : "updatedAt";
  const sortOrder = String(query.sortOrder || "desc").toLowerCase() === "asc" ? 1 : -1;

  if (status && !TASK_STATUSES.includes(status)) {
    throw createAppError("Invalid task status.", 422);
  }
  if (priority && !TASK_PRIORITIES.includes(priority)) {
    throw createAppError("Invalid task priority.", 422);
  }

  const openSessions = await TaskSession.find({
    employeeId: userId,
    type: "WORKING",
    endedAt: null,
  })
    .sort({ startedAt: -1 })
    .select("taskId")
    .lean();

  let currentTaskId = null;
  if (openSessions.length) {
    const openTaskIds = openSessions.map((session) => session.taskId);
    const validRunningTasks = await Task.find({
      _id: { $in: openTaskIds },
      assignedTo: userId,
      status: "IN_PROGRESS",
      isArchived: false,
    })
      .select("_id")
      .lean();
    const validIds = new Set(validRunningTasks.map((task) => String(task._id)));
    currentTaskId =
      openSessions.find((session) => validIds.has(String(session.taskId)))?.taskId || null;
  }

  const filter = {
    assignedTo: employeeId,
    isArchived: false,
    status: status || { $in: WORKING_TASK_STATUSES },
  };
  if (priority) filter.priority = priority;
  if (search) {
    const searchRegex = { $regex: escapeRegex(search), $options: "i" };
    filter.$or = [{ title: searchRegex }, { description: searchRegex }];
  }

  const sort = { __isCurrent: -1, [sortBy]: sortOrder };
  if (sortBy !== "updatedAt") sort.updatedAt = -1;
  sort._id = -1;

  const currentIdExpression = currentTaskId || null;
  const [records, totalRecords, currentTask] = await Promise.all([
    Task.aggregate([
      { $match: filter },
      {
        $addFields: {
          __isCurrent: currentTaskId
            ? { $cond: [{ $eq: ["$_id", currentIdExpression] }, 1, 0] }
            : 0,
        },
      },
      { $sort: sort },
      { $skip: skip },
      { $limit: limit },
      { $project: { __isCurrent: 0 } },
    ]),
    Task.countDocuments(filter),
    currentTaskId
      ? Task.findById(currentTaskId)
          .populate("projectId", "_id projectName projectCode")
          .populate("projectAreaId", "_id title")
          .populate("assignedTo", USER_POPULATE)
          .lean()
      : null,
  ]);

  await Task.populate(records, [
    { path: "projectId", select: "_id projectName projectCode" },
    { path: "projectAreaId", select: "_id title" },
    { path: "assignedTo", select: USER_POPULATE },
  ]);

  return {
    ...buildPaginatedResult(records, totalRecords, page, limit),
    currentTaskId,
    currentTask,
  };
};

const getTaskById = async (projectId, taskId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  const task = await Task.findOne({ _id: taskId, projectId }).populate(TASK_POPULATE);
  if (!task) throw createAppError("Task not found.", 404);

  if (isSelfScopedTaskViewer(user.role)) {
    const assigneeId = task.assignedTo?._id || task.assignedTo;
    if (String(assigneeId) !== String(user.id)) throw createAppError("Access denied.", 403);
  }

  const attachments = await TaskAttachment.find({ projectId, taskId: task._id }).sort({ createdAt: -1 }).lean();
  return { ...task.toObject(), attachments };
};

const updateTask = async (projectId, taskId, user, payload) => {
  const project = await projectService.assertProjectAccess(projectId, user, { write: true });
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  if (payload.status === "COMPLETED" && user.role === "EMPLOYEE") {
    throw createAppError("Employees cannot mark tasks as completed. Submit for review instead.", 403);
  }

  await assertCanManageArea(projectId, task.projectAreaId, user);

  const oldValue = task.toObject();
  const allowed = ["title", "description", "priority", "estimatedHours", "deadline", "sprintId", "kanbanOrder"];
  let assignmentChanged = false;

  for (const key of allowed) {
    if (payload[key] !== undefined) task[key] = payload[key];
  }

  // Validate deadline against project weekend rule
  if (payload.deadline !== undefined) {
    const newDeadline = payload.deadline ? new Date(payload.deadline) : null;
    if (newDeadline && !project.includeWeekends) {
      const day = newDeadline.getDay();
      if (day === 0 || day === 6) throw createAppError("Project does not include weekends; task deadline cannot be on weekend.", 422);
    }
    task.deadline = newDeadline;
  }

  if (payload.assignedTo !== undefined) {
    if (payload.assignedTo) {
      const assignee = await User.findOne({ _id: payload.assignedTo, isActive: true }).select("name");
      if (!assignee) throw createAppError("Assignee not found.", 404);

      if (String(task.assignedTo) !== String(assignee._id)) {
        const oldStatus = task.status;
        task.assignedTo = assignee._id;
        task.assignedToNameSnapshot = assignee.name;
        task.assignedBy = user.id;
        task.assignedByNameSnapshot = user.name;
        task.assignedAt = new Date();
        // A running task handed to someone else goes back to ASSIGNED so the new
        // assignee starts their own timer instead of inheriting a stale one.
        if (["CREATED", "REOPENED", "IN_PROGRESS"].includes(task.status)) task.status = "ASSIGNED";
        if (task.dependsOn?.length) await checkDependenciesForTask(task);
        else if (task.status === "WAITING") task.status = "ASSIGNED";
        assignmentChanged = true;
      }
    } else if (task.assignedTo) {
      task.assignedTo = null;
      task.assignedToNameSnapshot = "";
      task.assignedBy = null;
      task.assignedByNameSnapshot = "";
      task.assignedAt = null;
      assignmentChanged = true;
    }
  }

  if (payload.deadline !== undefined && String(oldValue.deadline) !== String(task.deadline)) {
    await logTaskHistory({
      taskId: task._id,
      projectId,
      user,
      action: "TASK_DEADLINE_CHANGED",
      oldValue: { deadline: oldValue.deadline },
      newValue: { deadline: task.deadline },
      reason: payload.reason || "",
    });
  }

  if (payload.priority !== undefined && oldValue.priority !== task.priority) {
    await logTaskHistory({
      taskId: task._id,
      projectId,
      user,
      action: "TASK_PRIORITY_CHANGED",
      oldValue: { priority: oldValue.priority },
      newValue: { priority: task.priority },
      reason: payload.reason || "",
    });
  }

  if (assignmentChanged) {
    const oldAssignedTo = oldValue.assignedTo;
    // The previous assignee must not keep a running session on a task they no longer own.
    if (oldAssignedTo) {
      const closedSession = await taskSessionService.endOpenSession(task._id, oldAssignedTo);
      if (closedSession) await taskSessionService.syncTimeLogForSessions([closedSession]);
    }

    await projectService.ensureAssignedUserProjectMembership({
      projectId,
      userId: task.assignedTo,
      userName: task.assignedToNameSnapshot,
      role: "MEMBER",
      projectAreaId: task.projectAreaId,
      addedBy: user.id,
    });

    if (task.assignedTo) {
      const project = await Project.findById(projectId).select("projectName");
      await notifyTaskAssigned({ recipientId: task.assignedTo, actorId: user.id, task, project });
    }

    await logTaskHistory({
      taskId: task._id,
      projectId,
      user,
      action: "TASK_ASSIGNED",
      oldValue: { assignedTo: oldAssignedTo, status: oldValue.status },
      newValue: { assignedTo: task.assignedTo, status: task.status },
    });
  }

  await task.save();
  await projectService.refreshProjectMetrics(projectId);
  return Task.findById(task._id).populate(TASK_POPULATE);
};

const deleteTask = async (projectId, taskId, user) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const task = await Task.findOne({ _id: taskId, projectId, isArchived: false });
  if (!task) throw createAppError("Task not found.", 404);
  await assertCanManageArea(projectId, task.projectAreaId, user);

  const oldStatus = task.status;
  const openSessions = await TaskSession.find({ taskId: task._id, endedAt: null });
  const endedAt = new Date();
  for (const session of openSessions) {
    session.endedAt = endedAt;
    session.duration = calcDurationMinutes(session.startedAt, endedAt);
    await session.save();
  }

  task.status = "ARCHIVED";
  task.isArchived = true;
  await task.save();

  // Time already spent stays on record even though the task is archived.
  if (openSessions.length) {
    await taskSessionService.syncTimeLogForSessions(openSessions);
  }

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: "TASK_ARCHIVED",
    oldValue: { status: oldStatus },
    newValue: { status: task.status },
    description: "Task deleted.",
  });

  await logProjectActivity({
    projectId,
    user,
    action: "TASK_ARCHIVED",
    module: "TASK",
    entityType: "Task",
    entityId: task._id,
    oldValue: { status: oldStatus },
    newValue: { status: task.status },
    description: "Task deleted.",
  });

  await refreshAreaProgress(task.projectAreaId);
  await projectService.refreshProjectMetrics(projectId);
  return Task.findById(task._id).populate(TASK_POPULATE);
};

const assignTask = async (projectId, taskId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  await assertCanManageArea(projectId, task.projectAreaId, user);

  const assigneeId = payload.assignedTo;
  const assignee = await User.findOne({ _id: assigneeId, isActive: true }).select("name");
  if (!assignee) throw createAppError("Assignee not found.", 404);

  const oldStatus = task.status;
  const oldAssignedTo = task.assignedTo;
  const isReassignment = oldAssignedTo && String(oldAssignedTo) !== String(assigneeId);

  task.assignedTo = assigneeId;
  task.assignedToNameSnapshot = assignee.name;
  task.assignedBy = user.id;
  task.assignedByNameSnapshot = user.name;
  task.assignedAt = new Date();
  if (["CREATED", "REOPENED"].includes(task.status) || (isReassignment && task.status === "IN_PROGRESS")) {
    task.status = "ASSIGNED";
  }

  if (task.dependsOn?.length) await checkDependenciesForTask(task);
  else if (task.status === "WAITING") task.status = "ASSIGNED";

  await task.save();

  if (isReassignment) {
    const closedSession = await taskSessionService.endOpenSession(task._id, oldAssignedTo);
    if (closedSession) await taskSessionService.syncTimeLogForSessions([closedSession]);
  }

  await projectService.ensureAssignedUserProjectMembership({
    projectId,
    userId: assignee._id,
    userName: assignee.name,
    role: "MEMBER",
    projectAreaId: task.projectAreaId,
    addedBy: user.id,
  });

  const project = await Project.findById(projectId).select("projectName");
  await notifyTaskAssigned({ recipientId: assigneeId, actorId: user.id, task, project });

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: "TASK_ASSIGNED",
    oldValue: { assignedTo: oldAssignedTo, status: oldStatus },
    newValue: { assignedTo: assigneeId, status: task.status },
  });

  return Task.findById(task._id).populate(TASK_POPULATE);
};

const acceptTask = async (projectId, taskId, user) => {
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);
  if (String(task.assignedTo) !== String(user.id)) {
    throw createAppError("Only the assignee can accept this task.", 403);
  }
  if (!["ASSIGNED", "REOPENED"].includes(task.status)) {
    throw createAppError(`Task cannot be accepted from status ${task.status}.`, 422);
  }

  const oldStatus = task.status;
  task.status = "ACCEPTED";
  await task.save();

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: "TASK_ACCEPTED",
    oldValue: { status: oldStatus },
    newValue: { status: "ACCEPTED" },
  });

  return Task.findById(task._id).populate(TASK_POPULATE);
};

const startTask = async (projectId, taskId, user) => {
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);
  if (String(task.assignedTo) !== String(user.id)) {
    throw createAppError("Only the assignee can start this task.", 403);
  }
  if (task.status === "BLOCKED") {
    throw createAppError("Task is blocked. The blocker must be resolved before working on it again.", 422);
  }
  if (["WAITING", "UNDER_REVIEW", "COMPLETED", "ARCHIVED"].includes(task.status)) {
    throw createAppError(`Task cannot be started from status ${task.status}.`, 422);
  }

  if (task.dependsOn?.length) {
    const deps = await Task.find({ _id: { $in: task.dependsOn } }).select("status");
    const incomplete = deps.some((d) => !["COMPLETED", "ARCHIVED"].includes(d.status));
    if (incomplete) throw createAppError("Cannot start task until dependencies are completed.", 422);
  }

  const openWorkingSessions = await TaskSession.find({
    employeeId: user.id,
    type: "WORKING",
    endedAt: null,
  })
    .sort({ startedAt: -1 })
    .populate("taskId", "title status assignedTo isArchived");

  const validWorkingSessions = [];
  const staleSessions = [];
  const staleSessionEndedAt = new Date();
  for (const session of openWorkingSessions) {
    const sessionTask = session.taskId;
    const isValid =
      sessionTask &&
      sessionTask.status === "IN_PROGRESS" &&
      !sessionTask.isArchived &&
      String(sessionTask.assignedTo) === String(user.id);

    if (isValid) {
      validWorkingSessions.push(session);
    } else {
      session.endedAt = staleSessionEndedAt;
      session.duration = calcDurationMinutes(session.startedAt, staleSessionEndedAt);
      await session.save();
      staleSessions.push({
        taskId: session.taskId?._id || session.taskId,
        employeeId: session.employeeId,
        startedAt: session.startedAt,
      });
    }
  }

  if (staleSessions.length) {
    await taskSessionService.syncTimeLogForSessions(staleSessions);
  }

  const otherWorkingSession = validWorkingSessions.find(
    (session) => String(session.taskId?._id || session.taskId) !== String(task._id)
  );
  if (otherWorkingSession) {
    const runningTaskTitle = otherWorkingSession.taskId?.title
      ? ` "${otherWorkingSession.taskId.title}"`
      : "";
    throw createAppError(
      `Another task${runningTaskTitle} is currently running. Please pause the other task first.`,
      409
    );
  }

  if (validWorkingSessions.length) {
    return Task.findById(task._id).populate(TASK_POPULATE);
  }

  const oldStatus = task.status;
  task.status = "IN_PROGRESS";
  task.startedAt = task.startedAt || new Date();
  await task.save();

  const previousSession = await taskSessionService.endOpenSession(task._id, user.id);
  if (previousSession) {
    await taskSessionService.syncTimeLogForSessions([previousSession]);
  }
  await taskSessionService.createSession({
    taskId: task._id,
    projectId,
    employeeId: user.id,
    employeeName: user.name,
    type: "WORKING",
  });

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: "TASK_STARTED",
    oldValue: { status: oldStatus },
    newValue: { status: "IN_PROGRESS" },
  });

  return Task.findById(task._id).populate(TASK_POPULATE);
};

const pauseTask = async (projectId, taskId, user, payload = {}) => {
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);
  if (String(task.assignedTo) !== String(user.id) && !isTeamLeadRole(user.role)) {
    throw createAppError("Access denied.", 403);
  }
  if (task.status === "BLOCKED") {
    throw createAppError("Task is blocked. Resolve the blocker instead of pausing.", 422);
  }
  if (task.status !== "IN_PROGRESS") {
    throw createAppError(`Task cannot be paused from status ${task.status}.`, 422);
  }

  const reason = String(payload.reason || "Paused").trim();
  const oldStatus = task.status;
  task.status = "PAUSED";
  task.pauseReason = reason;
  await task.save();

  const closedSession = await taskSessionService.endOpenSession(task._id, task.assignedTo);
  if (closedSession) {
    await taskSessionService.syncTimeLogForSessions([closedSession]);
  }
  await taskSessionService.createSession({
    taskId: task._id,
    projectId,
    employeeId: task.assignedTo,
    employeeName: task.assignedToNameSnapshot,
    type: "PAUSED",
    reason,
  });

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: "TASK_PAUSED",
    oldValue: { status: oldStatus },
    newValue: { status: "PAUSED" },
    reason,
  });

  return Task.findById(task._id).populate(TASK_POPULATE);
};

const submitForReview = async (projectId, taskId, user, payload = {}, files = []) => {
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);
  if (String(task.assignedTo) !== String(user.id)) {
    throw createAppError("Only the assignee can submit for review.", 403);
  }
  if (!["IN_PROGRESS", "PAUSED", "REOPENED", "ACCEPTED"].includes(task.status)) {
    throw createAppError(`Task cannot be submitted from status ${task.status}.`, 422);
  }

  const oldStatus = task.status;
  task.status = "UNDER_REVIEW";
  task.reviewNotes = String(payload.notes || "").trim();
  await task.save();

  if (files.length) {
    const TaskAttachment = require("./taskAttachment.model");
    const attachments = files.map((file) => ({
      taskId: task._id,
      projectId,
      fileName: file.originalname,
      fileUrl: `/uploads/tickets/${file.filename}`,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: user.id,
      uploadedByNameSnapshot: user.name,
    }));
    await TaskAttachment.insertMany(attachments);
  }

  const closedSession = await taskSessionService.endOpenSession(task._id, user.id);
  if (closedSession) {
    await taskSessionService.syncTimeLogForSessions([closedSession]);
  } else {
    await taskSessionService.syncTimeLogForTask(task._id, user.id);
  }

  const area = await ProjectArea.findById(task.projectAreaId).select("teamLead");
  if (area?.teamLead) {
    await notifyTaskSubmittedForReview({
      recipientId: area.teamLead,
      actorId: user.id,
      task,
    });
  }

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: "TASK_SUBMITTED_FOR_REVIEW",
    oldValue: { status: oldStatus },
    newValue: { status: "UNDER_REVIEW" },
    description: payload.notes || "",
  });

  await logProjectActivity({
    projectId,
    user,
    action: "TASK_SUBMITTED_FOR_REVIEW",
    module: "TASK",
    entityType: "Task",
    entityId: task._id,
  });

  const updatedTask = await Task.findById(task._id).populate(TASK_POPULATE);
  if (!updatedTask) throw createAppError("Task not found after update.", 404);
  const attachments = await TaskAttachment.find({ projectId, taskId: task._id }).sort({ createdAt: -1 }).lean();
  return { ...updatedTask.toObject(), attachments };
};

const reviewTask = async (projectId, taskId, user, payload, files = []) => {
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  const area = await assertCanManageArea(projectId, task.projectAreaId, user);
  const canReview = String(area.teamLead) === String(user.id) || String(area.projectLead) === String(user.id) || PM_ROLES.includes(user.role);
  if (!canReview) {
    throw createAppError("Only the Team Lead or Project Lead can review this task.", 403);
  }

  const action = String(payload.action || "").toUpperCase();
  if (!["APPROVE", "REJECT", "REOPEN"].includes(action)) {
    throw createAppError("Invalid review action. Use APPROVE, REJECT, or REOPEN.", 422);
  }

  const oldStatus = task.status;
  const reason = String(payload.reason || "").trim();

  if (action === "APPROVE") {
    if (!["UNDER_REVIEW"].includes(task.status)) {
      throw createAppError("Only tasks under review can be approved.", 422);
    }
    task.status = "COMPLETED";
    task.completedAt = new Date();
    task.reviewedBy = user.id;
    task.reviewedByNameSnapshot = user.name;
    task.reviewedAt = new Date();
    task.rejectionReason = "";
  } else if (action === "REJECT") {
    if (!["UNDER_REVIEW"].includes(task.status)) {
      throw createAppError("Only tasks under review can be rejected.", 422);
    }
    task.status = "REOPENED";
    task.reopenedReason = reason;
    task.rejectionReason = reason;
    task.reviewedBy = user.id;
    task.reviewedByNameSnapshot = user.name;
    task.reviewedAt = new Date();
  } else if (action === "REOPEN") {
    if (!["COMPLETED"].includes(task.status)) {
      throw createAppError("Only completed tasks can be reopened.", 422);
    }
    task.status = "REOPENED";
    task.reopenedReason = reason;
    task.completedAt = null;
    task.reviewedBy = user.id;
    task.reviewedByNameSnapshot = user.name;
    task.reviewedAt = new Date();
  }

  if (reason) {
    task.reviewComment = reason;
  }

  await task.save();

  if (files.length) {
    const TaskAttachment = require("./taskAttachment.model");
    const attachments = files.map((file) => ({
      taskId: task._id,
      projectId,
      fileName: file.originalname,
      fileUrl: `/uploads/tickets/${file.filename}`,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: user.id,
      uploadedByNameSnapshot: user.name,
    }));
    await TaskAttachment.insertMany(attachments);
  }

  if (task.assignedTo) {
    await notifyTaskReviewDecision({
      recipientId: task.assignedTo,
      actorId: user.id,
      task,
      approved: action === "APPROVE",
      reason,
    });
  }

  const historyAction =
    action === "APPROVE" ? "TASK_APPROVED" : action === "REJECT" ? "TASK_REJECTED" : "TASK_REOPENED";

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: historyAction,
    oldValue: { status: oldStatus },
    newValue: { status: task.status },
    reason,
  });

  await logProjectActivity({
    projectId,
    user,
    action: historyAction,
    module: "TASK",
    entityType: "Task",
    entityId: task._id,
    reason,
  });

  if (action === "APPROVE") {
    await resolveDependenciesOnComplete(task, user);
  }

  // Reject/Reopen also change the completed-task count, so metrics refresh either way.
  await refreshAreaProgress(task.projectAreaId);
  await projectService.refreshProjectMetrics(projectId);

  const updatedTask = await Task.findById(task._id).populate(TASK_POPULATE);
  if (!updatedTask) throw createAppError("Task not found after review.", 404);
  const attachments = await TaskAttachment.find({ projectId, taskId: task._id }).sort({ createdAt: -1 }).lean();
  return { ...updatedTask.toObject(), attachments };
};

const addDependency = async (projectId, taskId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  await assertCanManageArea(projectId, task.projectAreaId, user);

  const dependsOnTaskId = payload.dependsOnTaskId;
  if (String(dependsOnTaskId) === String(taskId)) {
    throw createAppError("A task cannot depend on itself.", 422);
  }

  const depTask = await Task.findOne({ _id: dependsOnTaskId, projectId });
  if (!depTask) throw createAppError("Dependency task not found.", 404);

  if (!task.dependsOn.map(String).includes(String(dependsOnTaskId))) {
    task.dependsOn.push(dependsOnTaskId);
    await task.save();
  }

  await TaskDependency.findOneAndUpdate(
    { taskId: task._id, dependsOnTaskId },
    { taskId: task._id, dependsOnTaskId, projectId, createdBy: user.id, isResolved: false },
    { upsert: true, new: true }
  );

  await checkDependenciesForTask(task);

  await logTaskHistory({
    taskId: task._id,
    projectId,
    user,
    action: "TASK_DEPENDENCY_ADDED",
    newValue: { dependsOnTaskId },
  });

  return Task.findById(task._id).populate(TASK_POPULATE);
};

const requestUrgentTask = async (projectId, taskId, user) => {
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);
  if (String(task.assignedTo) !== String(user.id)) {
    throw createAppError("Only the assignee can request urgent work.", 403);
  }

  task.isUrgent = true;
  task.urgentRequestStatus = "PENDING";
  task.urgentRequestedBy = user.id;
  task.urgentRequestedAt = new Date();
  await task.save();

  const area = await ProjectArea.findById(task.projectAreaId).select("teamLead");
  if (area?.teamLead) {
    await notifyUrgentTaskRequest({
      recipientId: area.teamLead,
      actorId: user.id,
      task,
      employeeName: user.name,
    });
  }

  await logProjectActivity({
    projectId,
    user,
    action: "URGENT_TASK_REQUESTED",
    module: "TASK",
    entityType: "Task",
    entityId: task._id,
  });

  return Task.findById(task._id).populate(TASK_POPULATE);
};

const handleUrgentRequest = async (projectId, taskId, user, payload) => {
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  const area = await assertCanManageArea(projectId, task.projectAreaId, user);
  if (String(area.teamLead) !== String(user.id) && !PM_ROLES.includes(user.role)) {
    throw createAppError("Only Team Lead can handle urgent requests.", 403);
  }

  const decision = String(payload.decision || "").toUpperCase();
  if (!["APPROVE", "QUEUE", "REJECT"].includes(decision)) {
    throw createAppError("Invalid decision. Use APPROVE, QUEUE, or REJECT.", 422);
  }

  if (decision === "APPROVE") {
    if (task.assignedTo) {
      const openWorkingSession = await TaskSession.findOne({
        employeeId: task.assignedTo,
        type: "WORKING",
        endedAt: null,
        taskId: { $ne: task._id },
      })
        .sort({ startedAt: -1 })
        .populate("taskId", "title");

      if (openWorkingSession) {
        const runningTaskTitle = openWorkingSession.taskId?.title
          ? ` "${openWorkingSession.taskId.title}"`
          : "";
        throw createAppError(
          `Another task${runningTaskTitle} is currently running. Please ask the employee to pause the other task first.`,
          409
        );
      }
    }

    task.urgentRequestStatus = "APPROVED";
    task.urgentApprovedBy = user.id;

    // WAITING is left out on purpose: its dependencies are still incomplete.
    if (["ASSIGNED", "ACCEPTED", "PAUSED", "REOPENED"].includes(task.status)) {
      task.status = "IN_PROGRESS";
      task.startedAt = task.startedAt || new Date();
      const previousSession = await taskSessionService.endOpenSession(task._id, task.assignedTo);
      if (previousSession) {
        await taskSessionService.syncTimeLogForSessions([previousSession]);
      }
      await taskSessionService.createSession({
        taskId: task._id,
        projectId,
        employeeId: task.assignedTo,
        employeeName: task.assignedToNameSnapshot,
        type: "WORKING",
      });
    }

    await logProjectActivity({
      projectId,
      user,
      action: "URGENT_TASK_APPROVED",
      module: "TASK",
      entityType: "Task",
      entityId: task._id,
    });
  } else if (decision === "QUEUE") {
    task.urgentRequestStatus = "QUEUED";
  } else {
    task.urgentRequestStatus = "REJECTED";
    task.isUrgent = false;
    await logProjectActivity({
      projectId,
      user,
      action: "URGENT_TASK_REJECTED",
      module: "TASK",
      entityType: "Task",
      entityId: task._id,
      reason: payload.reason || "",
    });
  }

  await task.save();
  return Task.findById(task._id).populate(TASK_POPULATE);
};

const getElapsedTime = async (projectId, taskId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  const task = await Task.findOne({ _id: taskId, projectId })
    .select("status assignedTo isArchived")
    .lean();
  if (!task) throw createAppError("Task not found.", 404);
  const canBeRunning =
    task.status === "IN_PROGRESS" &&
    !task.isArchived &&
    String(task.assignedTo) === String(user.id);

  // All WORKING sessions for this task by this employee
  const sessions = await TaskSession.find({
    taskId,
    employeeId: user.id,
    type: "WORKING",
  }).sort({ startedAt: 1 });

  // Sum up all completed sessions (endedAt set)
  let totalSeconds = 0;
  let activeStartedAt = null;

  // Seconds come from the raw timestamps; s.duration is minute-rounded and would
  // drop up to 30s per session from the displayed timer.
  const sessionSeconds = (startedAt, endedAt) =>
    Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));

  for (const s of sessions) {
    if (s.endedAt) {
      totalSeconds += sessionSeconds(s.startedAt, s.endedAt);
    } else if (canBeRunning) {
      // open/active session — track its start so frontend can add live delta
      activeStartedAt = s.startedAt;
    } else {
      const endedAt = new Date();
      s.endedAt = endedAt;
      s.duration = calcDurationMinutes(s.startedAt, endedAt);
      await s.save();
      totalSeconds += sessionSeconds(s.startedAt, endedAt);
    }
  }

  // If there is an open session, add elapsed seconds since it started
  if (activeStartedAt) {
    totalSeconds += Math.floor((Date.now() - new Date(activeStartedAt).getTime()) / 1000);
  }

  return {
    totalSeconds,
    isRunning: activeStartedAt !== null,
    activeStartedAt,
  };
};

const getActiveTaskForEmployee = async (userId) => {
  const openSession = await TaskSession.findOne({
    employeeId: userId,
    type: "WORKING",
    endedAt: null,
  }).sort({ startedAt: -1 }).lean();
  if (!openSession) return null;

  return Task.findOne({
    _id: openSession.taskId,
    assignedTo: userId,
    status: "IN_PROGRESS",
    isArchived: false,
  })
    .populate("projectId", "projectName projectCode")
    .populate("projectAreaId", "title")
    .lean();
};

const getTaskHistory = async (projectId, taskId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  const TaskHistory = require("./taskHistory.model");
  return TaskHistory.find({ taskId, projectId }).sort({ createdAt: -1 }).limit(100).lean();
};

const getKanbanBoard = async (projectId, user, query = {}) => {
  await projectService.assertProjectAccess(projectId, user);
  const filter = { projectId, isArchived: false };
  if (query.projectAreaId) filter.projectAreaId = query.projectAreaId;
  if (isSelfScopedTaskViewer(user.role)) filter.assignedTo = user.id;

  const tasks = await Task.find(filter)
    .sort({ kanbanOrder: 1, createdAt: 1 })
    .populate(TASK_POPULATE)
    .lean();

  const columns = {};
  for (const status of TASK_STATUSES) {
    if (status !== "ARCHIVED") columns[status] = [];
  }

  for (const task of tasks) {
    if (columns[task.status]) columns[task.status].push(task);
  }

  return columns;
};

module.exports = {
  createTask,
  listTasks,
  listMyWorkingTasks,
  getTaskById,
  updateTask,
  deleteTask,
  assignTask,
  acceptTask,
  startTask,
  pauseTask,
  submitForReview,
  reviewTask,
  addDependency,
  requestUrgentTask,
  handleUrgentRequest,
  getActiveTaskForEmployee,
  getElapsedTime,
  getTaskHistory,
  getKanbanBoard,
  checkDependenciesForTask,
  pauseActiveTaskForEmployee,
};
