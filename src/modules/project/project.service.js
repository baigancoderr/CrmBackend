const mongoose = require("mongoose");
const Project = require("./project.model");
const ProjectMember = require("./projectMember.model");
const ProjectArea = require("./projectArea.model");
const Task = require("./task/task.model");
const TaskSession = require("./task/taskSession.model");
const Blocker = require("./blocker/blocker.model");
const User = require("../user/user.model");
const taskSessionService = require("./task/taskSession.service");
const {
  createAppError,
  parsePagination,
  buildPaginatedResult,
  generateProjectCode,
  logProjectActivity,
  calcDurationMinutes,
  calcProjectHealth,
  calcProjectProgressFromAreas,
  isManagerRole,
  isClientRole,
  normalizeRole,
  USER_POPULATE,
} = require("./project.helper");
const {
  notifyProjectAssigned,
  notifyProjectClosed,
  notifyProjectCancelled,
} = require("./notifications/projectNotification.service");
const { PM_ROLES } = require("./project.constants");

// A TL counts as "added" to a project through any of the assignment paths the UI
// offers: an explicit membership row, the project team list, or leading an area.
const findTlProjectIds = async (userId) => {
  const [memberships, teamProjects, ledAreas] = await Promise.all([
    ProjectMember.find({ userId, isActive: true }).select("projectId").lean(),
    Project.find({ teamMembers: userId }).select("_id").lean(),
    ProjectArea.find({ $or: [{ teamLead: userId }, { projectLead: userId }] })
      .select("projectId")
      .lean(),
  ]);

  return [
    ...new Set([
      ...memberships.map((membership) => String(membership.projectId)),
      ...teamProjects.map((project) => String(project._id)),
      ...ledAreas.map((area) => String(area.projectId)),
    ]),
  ];
};

const assertProjectAccess = async (projectId, user, { write = false } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw createAppError("Project not found.", 404);
  }

  const project = await Project.findById(projectId);
  if (!project) throw createAppError("Project not found.", 404);

  if (isManagerRole(user.role)) return project;

  if (isClientRole(user.role)) {
    const isClient =
      String(project.clientUser) === String(user.id) ||
      (await ProjectMember.findOne({ projectId, userId: user.id, role: "CLIENT", isActive: true }));
    if (!isClient) throw createAppError("Access denied.", 403);
    if (write) throw createAppError("Clients have read-only access.", 403);
    return project;
  }

  if (normalizeRole(user.role) === "TL") {
    const [isActiveMember, isAreaLead] = await Promise.all([
      ProjectMember.exists({ projectId, userId: user.id, isActive: true }),
      ProjectArea.exists({
        projectId,
        $or: [{ teamLead: user.id }, { projectLead: user.id }],
      }),
    ]);
    const isTeamMember = project.teamMembers.some((id) => String(id) === String(user.id));

    if (!isActiveMember && !isAreaLead && !isTeamMember) {
      throw createAppError("Access denied.", 403);
    }
    return project;
  }

  const isMember =
    String(project.projectManager) === String(user.id) ||
    project.teamMembers.some((id) => String(id) === String(user.id)) ||
    (await ProjectMember.findOne({ projectId, userId: user.id, isActive: true }));

  const isAreaLead = await ProjectArea.findOne({
    projectId,
    $or: [{ teamLead: user.id }, { projectLead: user.id }],
  });

  if (!isMember && !isAreaLead) {
    const assignedTask = await Task.findOne({ projectId, assignedTo: user.id });
    if (!assignedTask) throw createAppError("Access denied.", 403);
  }

  return project;
};

const refreshProjectMetrics = async (projectId) => {
  const [tasks, openBlockers, project, areas] = await Promise.all([
    Task.find({ projectId, isArchived: false }).select("status deadline projectAreaId").lean(),
    Blocker.countDocuments({ projectId, status: { $in: ["OPEN", "IN_PROGRESS"] } }),
    Project.findById(projectId),
    ProjectArea.find({ projectId, isArchived: false }).select("_id").lean(),
  ]);

  if (!project) return null;

  const now = new Date();
  const delayedTasks = tasks.filter(
    (t) => t.deadline && new Date(t.deadline) < now && !["COMPLETED", "ARCHIVED"].includes(t.status)
  ).length;

  const daysToDeadline = project.expectedEndDate
    ? Math.ceil((new Date(project.expectedEndDate) - now) / 86400000)
    : null;

  const tasksByArea = {};
  for (const area of areas) {
    tasksByArea[String(area._id)] = [];
  }
  for (const task of tasks) {
    const key = String(task.projectAreaId);
    if (tasksByArea[key]) tasksByArea[key].push(task);
  }

  project.progress = calcProjectProgressFromAreas(tasksByArea);
  project.health = calcProjectHealth({
    progress: project.progress,
    delayedTasks,
    openBlockers,
    daysToDeadline,
  });
  await project.save();
  return project;
};

const createProject = async (user, payload) => {
  if (!PM_ROLES.includes(user.role)) {
    throw createAppError("Only Project Managers can create projects.", 403);
  }

  const projectName = String(payload.projectName || "").trim();
  if (!projectName) throw createAppError("Project name is required.", 422);

  const projectCode = payload.projectCode?.trim() || (await generateProjectCode());
  const existing = await Project.findOne({ projectCode });
  if (existing) throw createAppError("Project code already exists.", 422);

  const teamMemberIds = Array.isArray(payload.teamMembers) ? payload.teamMembers : [];
  const projectManagerId = payload.projectManager || user.id;

  const project = await Project.create({
    projectName,
    projectCode,
    client: String(payload.client || "").trim(),
    clientUser: payload.clientUser || null,
    description: String(payload.description || "").trim(),
    priority: payload.priority || "MEDIUM",
    status: payload.status || "PLANNING",
    startDate: payload.startDate || null,
    expectedEndDate: payload.expectedEndDate || null,
    includeWeekends: Boolean(payload.includeWeekends),
    projectManager: projectManagerId,
    projectManagerNameSnapshot: user.name,
    teamMembers: teamMemberIds,
    budget: payload.budget || 0,
    createdBy: user.id,
    createdByNameSnapshot: user.name,
  });

  await ProjectMember.create({
    projectId: project._id,
    userId: projectManagerId,
    userNameSnapshot: user.name,
    role: "PROJECT_MANAGER",
    addedBy: user.id,
  });

  for (const memberId of teamMemberIds) {
    const member = await User.findById(memberId).select("name role");
    if (!member) continue;
    await ProjectMember.findOneAndUpdate(
      { projectId: project._id, userId: memberId },
      {
        projectId: project._id,
        userId: memberId,
        userNameSnapshot: member.name,
        role: member.role === "TL" ? "TEAM_LEAD" : "MEMBER",
        addedBy: user.id,
        isActive: true,
      },
      { upsert: true, new: true }
    );
  }

  await logProjectActivity({
    projectId: project._id,
    user,
    action: "PROJECT_CREATED",
    newValue: { projectName, projectCode },
    description: `Project ${projectCode} created.`,
  });

  if (teamMemberIds.length) {
    await notifyProjectAssigned({
      recipientIds: teamMemberIds,
      actorId: user.id,
      project,
    });
  }

  return Project.findById(project._id)
    .populate("projectManager", USER_POPULATE)
    .populate("teamMembers", USER_POPULATE)
    .populate("createdBy", USER_POPULATE);
};

const listProjects = async (user, query = {}) => {
  const { page, limit, skip, sort } = parsePagination(query);
  const filter = { isArchived: query.archived === "true" };

  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.search) {
    filter.$or = [
      { projectName: { $regex: query.search, $options: "i" } },
      { projectCode: { $regex: query.search, $options: "i" } },
      { client: { $regex: query.search, $options: "i" } },
    ];
  }

  if (!isManagerRole(user.role)) {
    if (isClientRole(user.role)) {
      const memberships = await ProjectMember.find({ userId: user.id, isActive: true }).select("projectId");
      const clientProjects = await Project.find({ clientUser: user.id }).select("_id");
      const ids = [
        ...memberships.map((m) => m.projectId),
        ...clientProjects.map((p) => p._id),
      ];
      filter._id = { $in: ids };
    } else if (user.role === "TL") {
      filter._id = { $in: await findTlProjectIds(user.id) };
    } else {
      const [memberships, managedAreas, assignedTasks] = await Promise.all([
        ProjectMember.find({ userId: user.id, isActive: true }).select("projectId"),
        ProjectArea.find({
          $or: [{ teamLead: user.id }, { projectLead: user.id }],
        }).select("projectId"),
        Task.find({ assignedTo: user.id }).select("projectId"),
      ]);
      const ids = new Set([
        ...memberships.map((m) => String(m.projectId)),
        ...managedAreas.map((a) => String(a.projectId)),
        ...assignedTasks.map((t) => String(t.projectId)),
      ]);
      const managed = await Project.find({ projectManager: user.id }).select("_id");
      managed.forEach((p) => ids.add(String(p._id)));
      filter._id = { $in: [...ids] };
    }
  }

  const [records, totalRecords] = await Promise.all([
    Project.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate("projectManager", USER_POPULATE)
      .populate("teamMembers", USER_POPULATE)
      .lean(),
    Project.countDocuments(filter),
  ]);

  // Employee list cards show allotted task counts instead of project health.
  if (user.role === "EMPLOYEE" && records.length > 0) {
    const projectIds = records.map((p) => p._id);
    const counts = await Task.aggregate([
      {
        $match: {
          assignedTo: new mongoose.Types.ObjectId(user.id),
          projectId: { $in: projectIds },
          isArchived: false,
        },
      },
      { $group: { _id: "$projectId", count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(counts.map((c) => [String(c._id), c.count]));
    for (const project of records) {
      project.allottedTaskCount = countMap[String(project._id)] || 0;
    }
  }

  return buildPaginatedResult(records, totalRecords, page, limit);
};

const getProjectById = async (projectId, user) => {
  await assertProjectAccess(projectId, user);
  const project = await Project.findById(projectId)
    .populate("projectManager", USER_POPULATE)
    .populate("teamMembers", USER_POPULATE)
    .populate("clientUser", USER_POPULATE)
    .populate("createdBy", USER_POPULATE);

  if (!project) throw createAppError("Project not found.", 404);
  return project;
};

const updateProject = async (projectId, user, payload) => {
  if (payload.status === "CANCELLED") {
    return cancelProject(projectId, user, payload);
  }
  if (payload.status === "COMPLETED") {
    return closeProject(projectId, user, payload);
  }

  const project = await assertProjectAccess(projectId, user, { write: true });

  const canEdit =
    PM_ROLES.includes(user.role) || String(project.projectManager) === String(user.id);
  if (!canEdit) throw createAppError("Only the Project Manager can update this project.", 403);

  const oldValue = project.toObject();
  const allowed = [
    "projectName", "client", "clientUser", "description", "priority",
    "startDate", "expectedEndDate", "includeWeekends", "budget", "status",
  ];

  for (const key of allowed) {
    if (payload[key] !== undefined) project[key] = payload[key];
  }

  if (Array.isArray(payload.teamMembers)) {
    project.teamMembers = payload.teamMembers;
    for (const memberId of payload.teamMembers) {
      const member = await User.findById(memberId).select("name role");
      if (!member) continue;
      await ProjectMember.findOneAndUpdate(
        { projectId: project._id, userId: memberId },
        {
          projectId: project._id,
          userId: memberId,
          userNameSnapshot: member.name,
          role: member.role === "TL" ? "TEAM_LEAD" : "MEMBER",
          addedBy: user.id,
          isActive: true,
        },
        { upsert: true, new: true }
      );
    }
  }

  if (payload.status && !["COMPLETED", "ARCHIVED", "CANCELLED"].includes(payload.status)) {
    project.isArchived = false;
    project.archivedAt = null;
    project.archivedBy = null;
    project.completedAt = null;
    project.closedAt = null;
    project.closedBy = null;
    project.cancelledAt = null;
    project.cancelledBy = null;
    project.cancelReason = null;
    await Task.updateMany({ projectId, status: "ARCHIVED", assignedTo: { $ne: null } }, { status: "ASSIGNED", isArchived: false });
    await Task.updateMany({ projectId, status: "ARCHIVED", assignedTo: null }, { status: "WAITING", isArchived: false });
  }

  await project.save();
  await logProjectActivity({
    projectId: project._id,
    user,
    action: payload.status && payload.status !== oldValue.status ? "PROJECT_STATUS_CHANGED" : "PROJECT_UPDATED",
    oldValue: { status: oldValue.status, priority: oldValue.priority },
    newValue: { status: project.status, priority: project.priority },
    reason: payload.reason || "",
  });

  return getProjectById(projectId, user);
};

const closeProject = async (projectId, user, payload = {}) => {
  const project = await assertProjectAccess(projectId, user, { write: true });
  if (String(project.projectManager) !== String(user.id) && !PM_ROLES.includes(user.role)) {
    throw createAppError("Only the Project Manager can close the project.", 403);
  }

  const incompleteAreas = await ProjectArea.countDocuments({
    projectId,
    status: { $ne: "COMPLETED" },
  });
  if (incompleteAreas > 0 && !payload.force) {
    throw createAppError(`${incompleteAreas} work area(s) are not completed. Use force=true to override.`, 422);
  }

  const oldStatus = project.status;
  project.status = "COMPLETED";
  project.completedAt = new Date();
  project.closedAt = new Date();
  project.closedBy = user.id;
  project.isArchived = true;
  project.archivedAt = new Date();
  project.archivedBy = user.id;
  await project.save();

  await Task.updateMany({ projectId, status: { $ne: "ARCHIVED" } }, { status: "ARCHIVED", isArchived: true });

  await logProjectActivity({
    projectId,
    user,
    action: "PROJECT_CLOSED",
    oldValue: { status: oldStatus },
    newValue: { status: "COMPLETED", isArchived: true },
    reason: payload.reason || "",
    description: "Project closed and archived.",
  });

  const members = await ProjectMember.find({ projectId, isActive: true }).select("userId");
  await notifyProjectClosed({
    recipientIds: members.map((m) => m.userId),
    actorId: user.id,
    project,
  });

  return getProjectById(projectId, user);
};

const cancelProject = async (projectId, user, payload = {}) => {
  const project = await assertProjectAccess(projectId, user, { write: true });
  if (String(project.projectManager) !== String(user.id) && !PM_ROLES.includes(user.role)) {
    throw createAppError("Only the Project Manager can cancel the project.", 403);
  }

  const oldStatus = project.status;
  project.status = "CANCELLED";
  project.cancelledAt = new Date();
  project.cancelledBy = user.id;
  project.cancelReason = payload.reason || "";
  project.isArchived = true;
  project.archivedAt = new Date();
  project.archivedBy = user.id;
  await project.save();

  const openTaskSessions = await TaskSession.find({ projectId, endedAt: null });
  const endedAt = new Date();
  for (const session of openTaskSessions) {
    session.endedAt = endedAt;
    session.duration = session.duration || calcDurationMinutes(session.startedAt, session.endedAt);
    await session.save();
  }
  if (openTaskSessions.length) {
    await taskSessionService.syncTimeLogForSessions(openTaskSessions);
  }

  await Task.updateMany({ projectId, status: { $ne: "ARCHIVED" } }, { status: "ARCHIVED", isArchived: true });

  await logProjectActivity({
    projectId,
    user,
    action: "PROJECT_CANCELLED",
    oldValue: { status: oldStatus },
    newValue: { status: "CANCELLED", isArchived: true },
    reason: payload.reason || "",
    description: "Project cancelled and pending tasks archived.",
  });

  const members = await ProjectMember.find({ projectId, isActive: true }).select("userId");
  const recipientIds = [
    ...new Set([
      ...members.map((m) => String(m.userId)),
      String(project.projectManager),
    ]),
  ].filter(Boolean);

  await notifyProjectCancelled({
    recipientIds,
    actorId: user.id,
    project,
  });

  return getProjectById(projectId, user);
};

const deleteProject = async (projectId, user) => {
  const project = await assertProjectAccess(projectId, user, { write: true });
  if (String(project.projectManager) !== String(user.id) && !PM_ROLES.includes(user.role)) {
    throw createAppError("Only the Project Manager can delete the project.", 403);
  }

  const oldStatus = project.status;
  project.status = "ARCHIVED";
  project.isArchived = true;
  project.archivedAt = new Date();
  project.archivedBy = user.id;
  await project.save();

  await Task.updateMany({ projectId, status: { $ne: "ARCHIVED" } }, { status: "ARCHIVED", isArchived: true });

  await logProjectActivity({
    projectId,
    user,
    action: "PROJECT_ARCHIVED",
    oldValue: { status: oldStatus },
    newValue: { status: "ARCHIVED", isArchived: true },
    description: "Project deleted and archived.",
  });

  return { message: "Project deleted successfully." };
};

const addProjectMembers = async (projectId, user, payload) => {
  const project = await assertProjectAccess(projectId, user, { write: true });
  if (String(project.projectManager) !== String(user.id) && !PM_ROLES.includes(user.role)) {
    throw createAppError("Only the Project Manager can add members.", 403);
  }

  const memberIds = [...new Set((Array.isArray(payload.members) ? payload.members : []).map(String))];
  const newIds = [];
  const projectMemberIds = new Set(project.teamMembers.map(String));
  // Lazy require avoids coupling chat startup to project service startup.
  const chatService = require("../chat/chat.service");

  for (const memberId of memberIds) {
    const member = await User.findOne({ _id: memberId, isActive: true }).select("name role");
    if (!member) continue;

    await ProjectMember.findOneAndUpdate(
      { projectId, userId: memberId },
      {
        projectId,
        userId: memberId,
        userNameSnapshot: member.name,
        role: payload.role || (member.role === "CLIENT" ? "CLIENT" : "MEMBER"),
        addedBy: user.id,
        isActive: true,
      },
      { upsert: true, new: true }
    );

    if (!projectMemberIds.has(memberId)) {
      project.teamMembers.push(memberId);
      projectMemberIds.add(memberId);
      newIds.push(memberId);
    }

    await chatService.ensureProjectChatMember(projectId, memberId, member.name);

    await logProjectActivity({
      projectId,
      user,
      action: "PROJECT_MEMBER_ADDED",
      newValue: { userId: memberId, name: member.name },
    });
  }

  await project.save();

  if (newIds.length) {
    await notifyProjectAssigned({ recipientIds: newIds, actorId: user.id, project });
  }

  return getProjectById(projectId, user);
};

const ensureAssignedUserProjectMembership = async ({
  projectId,
  userId,
  userName,
  role = "MEMBER",
  projectAreaId = null,
  addedBy = null,
}) => {
  if (!userId) return;

  const existing = await ProjectMember.findOne({ projectId, userId });
  const shouldKeepExistingRole =
    existing && ["PROJECT_MANAGER", "TEAM_LEAD"].includes(existing.role);
  const membershipRole = shouldKeepExistingRole ? existing.role : role;

  await ProjectMember.findOneAndUpdate(
    { projectId, userId },
    {
      projectId,
      userId,
      userNameSnapshot: userName || existing?.userNameSnapshot || "",
      role: membershipRole,
      projectAreaId: projectAreaId || existing?.projectAreaId || null,
      addedBy: addedBy || existing?.addedBy || null,
      isActive: true,
    },
    { upsert: true, new: true }
  );

  await Project.findByIdAndUpdate(projectId, {
    $addToSet: { teamMembers: userId },
  });

  // Lazy require avoids coupling chat startup to project service startup.
  const chatService = require("../chat/chat.service");
  await chatService.ensureProjectChatMember(projectId, userId, userName);
};

module.exports = {
  assertProjectAccess,
  refreshProjectMetrics,
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  closeProject,
  deleteProject,
  addProjectMembers,
  ensureAssignedUserProjectMembership,
};
