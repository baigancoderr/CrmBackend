const Task = require("./task.model");
const TaskDependency = require("./taskDependency.model");
const TaskAttachment = require("./taskAttachment.model");
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
  ACTIVE_TASK_STATUSES,
  TASK_STATUSES,
} = require("../project.constants");

const TASK_POPULATE = [
  { path: "assignedTo", select: USER_POPULATE },
  { path: "assignedBy", select: USER_POPULATE },
  { path: "reviewedBy", select: USER_POPULATE },
  { path: "projectAreaId", select: "title teamLead projectLead status" },
  { path: "dependsOn", select: "title status" },
];

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
  const tasks = await Task.find({ projectAreaId, isArchived: false }).select("status").lean();
  if (!tasks.length) return;

  const allDone = tasks.every((t) => ["COMPLETED", "ARCHIVED"].includes(t.status));
  const anyStarted = tasks.some((t) =>
    ["IN_PROGRESS", "UNDER_REVIEW", "PAUSED", "BLOCKED", "ACCEPTED"].includes(t.status)
  );

  const update = {};
  if (allDone) update.status = "COMPLETED";
  else if (anyStarted) update.status = "IN_PROGRESS";

  if (Object.keys(update).length) {
    await ProjectArea.findByIdAndUpdate(projectAreaId, update);
  }
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
    status: { $in: ACTIVE_TASK_STATUSES },
    isArchived: false,
  });

  if (!activeTask) return null;

  const oldStatus = activeTask.status;
  activeTask.status = "PAUSED";
  activeTask.pauseReason = reason;
  await activeTask.save();

  await taskSessionService.endOpenSession(activeTask._id, employeeId);
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

  const [records, totalRecords] = await Promise.all([
    Task.find(filter).sort(sort).skip(skip).limit(limit).populate(TASK_POPULATE).lean(),
    Task.countDocuments(filter),
  ]);

  return buildPaginatedResult(records, totalRecords, page, limit);
};

const getTaskById = async (projectId, taskId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  const task = await Task.findOne({ _id: taskId, projectId }).populate(TASK_POPULATE);
  if (!task) throw createAppError("Task not found.", 404);

  const attachments = await TaskAttachment.find({ projectId, taskId: task._id }).sort({ createdAt: -1 }).lean();
  return { ...task.toObject(), attachments };
};

const updateTask = async (projectId, taskId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  if (payload.status === "COMPLETED" && user.role === "EMPLOYEE") {
    throw createAppError("Employees cannot mark tasks as completed. Submit for review instead.", 403);
  }

  await assertCanManageArea(projectId, task.projectAreaId, user);

  const oldValue = task.toObject();
  const allowed = ["title", "description", "priority", "estimatedHours", "deadline", "sprintId", "kanbanOrder"];

  for (const key of allowed) {
    if (payload[key] !== undefined) task[key] = payload[key];
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
  task.status = "ARCHIVED";
  task.isArchived = true;
  await task.save();

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
  task.assignedTo = assigneeId;
  task.assignedToNameSnapshot = assignee.name;
  task.assignedBy = user.id;
  task.assignedByNameSnapshot = user.name;
  task.assignedAt = new Date();
  task.status = task.status === "CREATED" || task.status === "REOPENED" ? "ASSIGNED" : task.status;

  if (task.dependsOn?.length) await checkDependenciesForTask(task);
  else if (task.status === "WAITING") task.status = "ASSIGNED";

  await task.save();

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
  if (["WAITING", "UNDER_REVIEW", "COMPLETED", "ARCHIVED"].includes(task.status)) {
    throw createAppError(`Task cannot be started from status ${task.status}.`, 422);
  }

  if (task.dependsOn?.length) {
    const deps = await Task.find({ _id: { $in: task.dependsOn } }).select("status");
    const incomplete = deps.some((d) => !["COMPLETED", "ARCHIVED"].includes(d.status));
    if (incomplete) throw createAppError("Cannot start task until dependencies are completed.", 422);
  }

  const otherActive = await Task.findOne({
    _id: { $ne: task._id },
    assignedTo: user.id,
    status: { $in: ["IN_PROGRESS", "ACCEPTED"] },
    isArchived: false,
  });

  if (otherActive) {
    await pauseActiveTaskForEmployee(user.id, user, "Started another task");
  }

  const oldStatus = task.status;
  task.status = "IN_PROGRESS";
  task.startedAt = task.startedAt || new Date();
  await task.save();

  await taskSessionService.endOpenSession(task._id, user.id);
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
  if (!["IN_PROGRESS", "BLOCKED"].includes(task.status)) {
    throw createAppError(`Task cannot be paused from status ${task.status}.`, 422);
  }

  const reason = String(payload.reason || "Paused").trim();
  const oldStatus = task.status;
  task.status = "PAUSED";
  task.pauseReason = reason;
  await task.save();

  await taskSessionService.endOpenSession(task._id, task.assignedTo);
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

  await taskSessionService.endOpenSession(task._id, user.id);
  await taskSessionService.syncTimeLogForTask(task._id, user.id);

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
    await refreshAreaProgress(task.projectAreaId);
    await projectService.refreshProjectMetrics(projectId);
  }

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
    task.urgentRequestStatus = "APPROVED";
    task.urgentApprovedBy = user.id;

    if (task.assignedTo) {
      await pauseActiveTaskForEmployee(
        task.assignedTo,
        { id: task.assignedTo, name: task.assignedToNameSnapshot, role: "EMPLOYEE" },
        `Urgent task approved: ${task.title}`
      );
    }

    if (["ASSIGNED", "ACCEPTED", "PAUSED", "REOPENED", "WAITING"].includes(task.status)) {
      task.status = "IN_PROGRESS";
      task.startedAt = new Date();
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
  const TaskSession = require("./taskSession.model");

  // All WORKING sessions for this task by this employee
  const sessions = await TaskSession.find({
    taskId,
    employeeId: user.id,
    type: "WORKING",
  }).sort({ startedAt: 1 }).lean();

  // Sum up all completed sessions (endedAt set)
  let totalSeconds = 0;
  let activeStartedAt = null;

  for (const s of sessions) {
    if (s.endedAt) {
      // completed session — use stored duration (minutes) converted to seconds
      totalSeconds += (s.duration || 0) * 60;
    } else {
      // open/active session — track its start so frontend can add live delta
      activeStartedAt = s.startedAt;
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
  return Task.findOne({
    assignedTo: userId,
    status: { $in: ["IN_PROGRESS", "ACCEPTED"] },
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
