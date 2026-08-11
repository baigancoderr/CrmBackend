const Blocker = require("./blocker.model");
const Task = require("../task/task.model");
const Project = require("../project.model");
const ProjectArea = require("../projectArea.model");
const projectService = require("../project.service");
const taskSessionService = require("../task/taskSession.service");
const storageService = require("../../../services/storage.service");
const {
  createAppError,
  parsePagination,
  buildPaginatedResult,
  logProjectActivity,
  logTaskHistory,
  isAreaLead,
  USER_POPULATE,
} = require("../project.helper");
const { notifyBlockerRaised } = require("../notifications/projectNotification.service");
const { PM_ROLES } = require("../project.constants");

const raiseBlocker = async (projectId, taskId, user, payload, files = []) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const task = await Task.findOne({ _id: taskId, projectId });
  if (!task) throw createAppError("Task not found.", 404);

  if (String(task.assignedTo) !== String(user.id)) {
    throw createAppError("Only the assignee can raise a blocker.", 403);
  }
  if (task.isArchived || ["COMPLETED", "ARCHIVED"].includes(task.status)) {
    throw createAppError("A blocker cannot be raised on a closed task.", 422);
  }
  if (task.status === "UNDER_REVIEW") {
    throw createAppError("This task is under review. A blocker cannot be raised right now.", 422);
  }
  if (task.status === "BLOCKED") {
    throw createAppError("This task is already blocked. The open blocker must be resolved first.", 422);
  }

  const reason = String(payload.reason || "").trim();
  if (!reason) throw createAppError("Blocker reason is required.", 422);

  const attachments = [];

  for (const file of files) {
    attachments.push({
      fileName: file.originalname,
      fileUrl: await storageService.persistUploadedFile(file, "tickets"),
      fileSize: file.size,
      mimeType: file.mimetype,
    });
  }

  const blocker = await Blocker.create({
    taskId,
    projectId,
    projectAreaId: task.projectAreaId,
    employee: user.id,
    employeeNameSnapshot: user.name,
    reason,
    status: "OPEN",
    raisedAt: new Date(),
    attachments,
  });

  const oldStatus = task.status;
  task.status = "BLOCKED";
  task.blockedReason = reason;
  await task.save();

  const closedSession = await taskSessionService.endOpenSession(taskId, user.id);
  if (closedSession) {
    await taskSessionService.syncTimeLogForSessions([closedSession]);
  }
  await taskSessionService.createSession({
    taskId,
    projectId,
    employeeId: user.id,
    employeeName: user.name,
    type: "BLOCKED",
    reason,
  });

  // Ids are read unpopulated: notification recipients must be raw ObjectIds.
  const [area, project] = await Promise.all([
    ProjectArea.findById(task.projectAreaId).select("teamLead projectLead").lean(),
    Project.findById(projectId).select("projectManager").lean(),
  ]);

  const recipientIds = [];
  if (area?.teamLead) recipientIds.push(area.teamLead);
  if (area?.projectLead) recipientIds.push(area.projectLead);
  if (project?.projectManager) recipientIds.push(project.projectManager);

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
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const blocker = await Blocker.findOne({ _id: blockerId, projectId });
  if (!blocker) throw createAppError("Blocker not found.", 404);

  const area = await ProjectArea.findById(blocker.projectAreaId).select("projectLead teamLead");
  const canResolve = PM_ROLES.includes(user.role) || isAreaLead(area, user.id);
  if (!canResolve) {
    throw createAppError("Only Team Lead, Project Lead, or managers can resolve blockers.", 403);
  }

  if (["RESOLVED", "CLOSED"].includes(blocker.status)) {
    throw createAppError("Blocker is already resolved.", 422);
  }

  blocker.status = "RESOLVED";
  blocker.resolvedAt = new Date();
  blocker.resolvedBy = user.id;
  blocker.resolvedByNameSnapshot = user.name;
  blocker.resolutionNotes = String(payload.resolutionNotes || "").trim();
  await blocker.save();

  // A task can carry more than one blocker; it stays blocked until the last one is cleared.
  const remainingOpen = await Blocker.countDocuments({
    taskId: blocker.taskId,
    status: { $in: ["OPEN", "IN_PROGRESS"] },
  });

  const task = await Task.findById(blocker.taskId);
  if (task && task.status === "BLOCKED" && !remainingOpen) {
    task.status = "PAUSED";
    task.blockedReason = "";
    task.pauseReason = "Blocker resolved — waiting to resume";
    await task.save();

    const closedSession = await taskSessionService.endOpenSession(task._id, task.assignedTo);
    if (closedSession) {
      await taskSessionService.syncTimeLogForSessions([closedSession]);
    }
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
