const Blocker = require("./blocker.model");
const Task = require("../task/task.model");
const ProjectArea = require("../projectArea.model");
const projectService = require("../project.service");
const taskSessionService = require("../task/taskSession.service");
const {
  createAppError,
  parsePagination,
  buildPaginatedResult,
  logProjectActivity,
  logTaskHistory,
  USER_POPULATE,
} = require("../project.helper");
const { notifyBlockerRaised } = require("../notifications/projectNotification.service");
const { TL_ROLES } = require("../project.constants");

const raiseBlocker = async (projectId, taskId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  if (String(task.assignedTo) !== String(user.id)) {
    throw createAppError("Only the assignee can raise a blocker.", 403);
  }

  const reason = String(payload.reason || "").trim();
  if (!reason) throw createAppError("Blocker reason is required.", 422);

  const blocker = await Blocker.create({
    taskId,
    projectId,
    projectAreaId: task.projectAreaId,
    employee: user.id,
    employeeNameSnapshot: user.name,
    reason,
    status: "OPEN",
    raisedAt: new Date(),
  });

  const oldStatus = task.status;
  task.status = "BLOCKED";
  task.blockedReason = reason;
  await task.save();

  await taskSessionService.endOpenSession(taskId, user.id);
  await taskSessionService.createSession({
    taskId,
    projectId,
    employeeId: user.id,
    employeeName: user.name,
    type: "BLOCKED",
    reason,
  });

  const area = await ProjectArea.findById(task.projectAreaId).select("teamLead projectLead");
  const recipientIds = [];
  if (area?.teamLead) recipientIds.push(area.teamLead);
  if (area?.projectLead) recipientIds.push(area.projectLead);

  const project = await projectService.getProjectById(projectId, user);
  if (project.projectManager) recipientIds.push(project.projectManager);

  if (recipientIds.length) {
    await notifyBlockerRaised({
      recipientIds: [...new Set(recipientIds.map(String))],
      actorId: user.id,
      blocker,
      task,
    });
  }

  await logTaskHistory({
    taskId,
    projectId,
    user,
    action: "TASK_BLOCKED",
    oldValue: { status: oldStatus },
    newValue: { status: "BLOCKED" },
    reason,
  });

  await logProjectActivity({
    projectId,
    user,
    action: "BLOCKER_RAISED",
    module: "BLOCKER",
    entityType: "Blocker",
    entityId: blocker._id,
    reason,
  });

  await projectService.refreshProjectMetrics(projectId);
  return Blocker.findById(blocker._id).populate("employee", USER_POPULATE);
};

const resolveBlocker = async (projectId, blockerId, user, payload) => {
  const blocker = await Blocker.findOne({ _id: blockerId, projectId });
  if (!blocker) throw createAppError("Blocker not found.", 404);

  const area = await ProjectArea.findById(blocker.projectAreaId).select("projectLead teamLead");
  const canResolve = TL_ROLES.includes(user.role) || String(area?.projectLead) === String(user.id);
  if (!canResolve) {
    throw createAppError("Only Team Lead or managers can resolve blockers.", 403);
  }
  if (!blocker) throw createAppError("Blocker not found.", 404);

  if (["RESOLVED", "CLOSED"].includes(blocker.status)) {
    throw createAppError("Blocker is already resolved.", 422);
  }

  blocker.status = "RESOLVED";
  blocker.resolvedAt = new Date();
  blocker.resolvedBy = user.id;
  blocker.resolvedByNameSnapshot = user.name;
  blocker.resolutionNotes = String(payload.resolutionNotes || "").trim();
  await blocker.save();

  const task = await Task.findById(blocker.taskId);
  if (task && task.status === "BLOCKED") {
    task.status = "PAUSED";
    task.blockedReason = "";
    await task.save();

    await taskSessionService.endOpenSession(task._id, task.assignedTo);
  }

  await logProjectActivity({
    projectId,
    user,
    action: "BLOCKER_RESOLVED",
    module: "BLOCKER",
    entityType: "Blocker",
    entityId: blocker._id,
    reason: payload.resolutionNotes || "",
  });

  await projectService.refreshProjectMetrics(projectId);
  return Blocker.findById(blocker._id).populate("resolvedBy", USER_POPULATE);
};

const listBlockers = async (projectId, user, query = {}) => {
  await projectService.assertProjectAccess(projectId, user);
  const { page, limit, skip, sort } = parsePagination(query);

  const filter = { projectId };
  if (query.status) filter.status = query.status;
  if (query.taskId) filter.taskId = query.taskId;

  const [records, totalRecords] = await Promise.all([
    Blocker.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("employee", USER_POPULATE)
      .populate("taskId", "title status")
      .lean(),
    Blocker.countDocuments(filter),
  ]);

  return buildPaginatedResult(records, totalRecords, page, limit);
};

module.exports = { raiseBlocker, resolveBlocker, listBlockers };
