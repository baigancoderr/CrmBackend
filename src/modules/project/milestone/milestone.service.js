const Milestone = require("./milestone.model");
const projectService = require("../project.service");
const { createAppError, parsePagination, buildPaginatedResult, logProjectActivity } = require("../project.helper");
const { PM_ROLES, MILESTONE_STATUSES } = require("../project.constants");

const createMilestone = async (projectId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  if (!PM_ROLES.includes(user.role)) {
    const project = await projectService.getProjectById(projectId, user);
    if (String(project.projectManager) !== String(user.id)) {
      throw createAppError("Only Project Manager can create milestones.", 403);
    }
  }

  const title = String(payload.title || "").trim();
  if (!title) throw createAppError("Milestone title is required.", 422);

  const milestone = await Milestone.create({
    title,
    description: String(payload.description || "").trim(),
    projectId,
    dueDate: payload.dueDate || null,
    status: payload.status || "PENDING",
    createdBy: user.id,
  });

  await logProjectActivity({
    projectId,
    user,
    action: "MILESTONE_CREATED",
    module: "MILESTONE",
    entityType: "Milestone",
    entityId: milestone._id,
    newValue: { title },
  });

  return milestone;
};

const listMilestones = async (projectId, user, query = {}) => {
  await projectService.assertProjectAccess(projectId, user);
  const filter = { projectId };
  if (query.status) filter.status = query.status;

  return Milestone.find(filter).sort({ dueDate: 1, createdAt: 1 }).lean();
};

const updateMilestone = async (projectId, milestoneId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const milestone = await Milestone.findOne({ _id: milestoneId, projectId });
  if (!milestone) throw createAppError("Milestone not found.", 404);

  if (payload.title !== undefined) milestone.title = String(payload.title).trim();
  if (payload.description !== undefined) milestone.description = String(payload.description).trim();
  if (payload.dueDate !== undefined) milestone.dueDate = payload.dueDate;

  if (payload.status !== undefined) {
    if (!MILESTONE_STATUSES.includes(payload.status)) throw createAppError("Invalid status.", 422);
    milestone.status = payload.status;
    if (payload.status === "COMPLETED") {
      milestone.completedAt = new Date();
      milestone.completedBy = user.id;
      await logProjectActivity({
        projectId,
        user,
        action: "MILESTONE_COMPLETED",
        module: "MILESTONE",
        entityType: "Milestone",
        entityId: milestone._id,
      });
    }
  }

  await milestone.save();
  return milestone;
};

module.exports = { createMilestone, listMilestones, updateMilestone };
