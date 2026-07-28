const Project = require("./project.model");
const ProjectMember = require("./projectMember.model");
const ProjectArea = require("./projectArea.model");
const Task = require("./task/task.model");
const Blocker = require("./blocker/blocker.model");
const User = require("../user/user.model");
const {
  createAppError,
  parsePagination,
  buildPaginatedResult,
  generateProjectCode,
  logProjectActivity,
  calcProjectHealth,
  calcProjectProgress,
  isManagerRole,
  isClientRole,
  USER_POPULATE,
} = require("./project.helper");
const { notifyProjectAssigned, notifyProjectClosed } = require("./notifications/projectNotification.service");
const { PM_ROLES } = require("./project.constants");

const assertProjectAccess = async (projectId, user, { write = false } = {}) => {
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

  const isMember =
    String(project.projectManager) === String(user.id) ||
    project.teamMembers.some((id) => String(id) === String(user.id)) ||
    (await ProjectMember.findOne({ projectId, userId: user.id, isActive: true }));

  const isAreaLead = await ProjectArea.findOne({ projectId, teamLead: user.id });

  if (!isMember && !isAreaLead && user.role !== "TL") {
    const assignedTask = await Task.findOne({ projectId, assignedTo: user.id });
    if (!assignedTask) throw createAppError("Access denied.", 403);
  }

  return project;
};

const refreshProjectMetrics = async (projectId) => {
  const [tasks, openBlockers, project] = await Promise.all([
    Task.find({ projectId, isArchived: false }).select("status deadline").lean(),
    Blocker.countDocuments({ projectId, status: { $in: ["OPEN", "IN_PROGRESS"] } }),
    Project.findById(projectId),
  ]);

  if (!project) return null;

  const now = new Date();
  const delayedTasks = tasks.filter(
    (t) => t.deadline && new Date(t.deadline) < now && !["COMPLETED", "ARCHIVED"].includes(t.status)
  ).length;

  const daysToDeadline = project.expectedEndDate
    ? Math.ceil((new Date(project.expectedEndDate) - now) / 86400000)
    : null;

  project.progress = calcProjectProgress(tasks);
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
    } else {
      const [memberships, managedAreas, assignedTasks] = await Promise.all([
        ProjectMember.find({ userId: user.id, isActive: true }).select("projectId"),
        ProjectArea.find({ teamLead: user.id }).select("projectId"),
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

const addProjectMembers = async (projectId, user, payload) => {
  const project = await assertProjectAccess(projectId, user, { write: true });
  if (String(project.projectManager) !== String(user.id) && !PM_ROLES.includes(user.role)) {
    throw createAppError("Only the Project Manager can add members.", 403);
  }

  const memberIds = Array.isArray(payload.members) ? payload.members : [];
  const newIds = [];

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

    if (!project.teamMembers.map(String).includes(String(memberId))) {
      project.teamMembers.push(memberId);
      newIds.push(memberId);
    }

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

module.exports = {
  assertProjectAccess,
  refreshProjectMetrics,
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  closeProject,
  addProjectMembers,
};
