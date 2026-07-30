const path = require("path");
const fs = require("fs");
const fsPromises = require("fs/promises");
const ProjectArea = require("./projectArea.model");
const Project = require("./project.model");
const Task = require("./task/task.model");
const User = require("../user/user.model");
const AreaDocument = require("./areaDocument.model");
const projectService = require("./project.service");
const {
  createAppError,
  logProjectActivity,
  calcProjectProgress,
  USER_POPULATE,
} = require("./project.helper");
const { PM_ROLES, AREA_STATUSES } = require("./project.constants");

const buildAreaDocumentMeta = (file) => ({
  fileName: file.originalname,
  fileUrl: `/api/uploads/areas/${file.filename}`,
  fileSize: file.size,
  mimeType: file.mimetype,
});

const saveAreaDocuments = async (projectId, areaId, user, files = []) => {
  if (!files?.length) return [];
  const docs = [];
  for (const file of files) {
    const doc = await AreaDocument.create({
      areaId,
      projectId,
      title: file.originalname,
      ...buildAreaDocumentMeta(file),
      uploadedBy: user.id,
      uploadedByNameSnapshot: user.name,
    });
    docs.push(doc);
  }
  return docs;
};

const createArea = async (projectId, user, payload, files = []) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  if (!PM_ROLES.includes(user.role)) {
    const project = await projectService.getProjectById(projectId, user);
    if (String(project.projectManager) !== String(user.id)) {
      throw createAppError("Only Project Manager can create work areas.", 403);
    }
  }

  const title = String(payload.title || "").trim();
  if (!title) throw createAppError("Work area title is required.", 422);

  let teamLeadNameSnapshot = "";
  if (payload.teamLead) {
    const tl = await User.findById(payload.teamLead).select("name");
    if (!tl) throw createAppError("Team Lead not found.", 404);
    teamLeadNameSnapshot = tl.name;
  }

  let projectLeadNameSnapshot = "";
  if (payload.projectLead) {
    const lead = await User.findById(payload.projectLead).select("name");
    if (!lead) throw createAppError("Project Lead not found.", 404);
    projectLeadNameSnapshot = lead.name;
  }

  const area = await ProjectArea.create({
    title,
    description: String(payload.description || "").trim(),
    projectId,
    teamLead: payload.teamLead || null,
    teamLeadNameSnapshot,
    startDate: payload.startDate ? new Date(payload.startDate) : null,
    estimatedEndDate: payload.estimatedEndDate ? new Date(payload.estimatedEndDate) : null,
    projectLead: payload.projectLead || null,
    projectLeadNameSnapshot,
    status: payload.status || "NOT_STARTED",
    sortOrder: payload.sortOrder || 0,
    createdBy: user.id,
  });

  if (payload.teamLead) {
    await projectService.ensureAssignedUserProjectMembership({
      projectId,
      userId: payload.teamLead,
      userName: teamLeadNameSnapshot,
      role: "TEAM_LEAD",
      projectAreaId: area._id,
      addedBy: user.id,
    });
  }
  if (payload.projectLead) {
    await projectService.ensureAssignedUserProjectMembership({
      projectId,
      userId: payload.projectLead,
      userName: projectLeadNameSnapshot,
      role: "MEMBER",
      projectAreaId: area._id,
      addedBy: user.id,
    });
  }

  await saveAreaDocuments(projectId, area._id, user, files);

  await logProjectActivity({
    projectId,
    user,
    action: "AREA_CREATED",
    module: "AREA",
    entityType: "ProjectArea",
    entityId: area._id,
    newValue: { title, teamLead: payload.teamLead, projectLead: payload.projectLead },
  });

  // First work area moves project from Planning → Active
  const projectDoc = await Project.findById(projectId);
  if (projectDoc && projectDoc.status === "PLANNING") {
    const previousStatus = projectDoc.status;
    projectDoc.status = "ACTIVE";
    await projectDoc.save();
    await logProjectActivity({
      projectId,
      user,
      action: "PROJECT_STATUS_CHANGED",
      module: "PROJECT",
      entityType: "Project",
      entityId: projectId,
      oldValue: { status: previousStatus },
      newValue: { status: "ACTIVE", reason: "Auto-activated when first work area was created" },
    });
  }

  const createdArea = await ProjectArea.findById(area._id)
    .populate("teamLead", USER_POPULATE)
    .populate("projectLead", USER_POPULATE)
    .lean();
  const documents = await AreaDocument.find({ areaId: area._id }).sort({ createdAt: -1 }).lean();
  return { ...createdArea, documents, projectStatus: projectDoc?.status || "ACTIVE" };
};

const listAreas = async (projectId, user, query = {}) => {
  await projectService.assertProjectAccess(projectId, user);
  const filter = { projectId };
  if (query.status) filter.status = query.status;

  if (user.role === "TL") {
    const assignedAreaIds = await Task.distinct("projectAreaId", {
      projectId,
      assignedTo: user.id,
      isArchived: false,
    });

    filter.$or = [
      { teamLead: user.id },
      { projectLead: user.id },
      { _id: { $in: assignedAreaIds } },
    ];
  }

  const areas = await ProjectArea.find(filter)
    .sort({ sortOrder: 1, createdAt: 1 })
    .populate("teamLead", USER_POPULATE)
    .populate("projectLead", USER_POPULATE)
    .lean();

  const areaIds = areas.map((a) => a._id);
  const [tasks, documents] = await Promise.all([
    Task.find({ projectAreaId: { $in: areaIds }, isArchived: false })
      .select("projectAreaId status")
      .lean(),
    AreaDocument.find({ areaId: { $in: areaIds } }).sort({ createdAt: -1 }).lean(),
  ]);

  const documentsByArea = documents.reduce((acc, doc) => {
    const key = String(doc.areaId);
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {});

  return areas.map((area) => {
    const areaTasks = tasks.filter((t) => String(t.projectAreaId) === String(area._id));
    return {
      ...area,
      progress: calcProjectProgress(areaTasks),
      taskCount: areaTasks.length,
      documents: documentsByArea[String(area._id)] || [],
    };
  });
};

const updateArea = async (projectId, areaId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  const area = await ProjectArea.findOne({ _id: areaId, projectId });
  if (!area) throw createAppError("Work area not found.", 404);

  const isPM = PM_ROLES.includes(user.role);
  const isAreaTL = String(area.teamLead) === String(user.id);
  if (!isPM && !isAreaTL) throw createAppError("Access denied.", 403);

  const oldValue = area.toObject();

  if (payload.title !== undefined) area.title = String(payload.title).trim();
  if (payload.description !== undefined) area.description = String(payload.description).trim();
  if (payload.status !== undefined) {
    if (!AREA_STATUSES.includes(payload.status)) throw createAppError("Invalid status.", 422);
    area.status = payload.status;
  }
  if (payload.teamLead !== undefined && isPM) {
    area.teamLead = payload.teamLead || null;
    if (payload.teamLead) {
      const tl = await User.findById(payload.teamLead).select("name");
      area.teamLeadNameSnapshot = tl?.name || "";
    }
  }
  if (payload.startDate !== undefined) area.startDate = payload.startDate ? new Date(payload.startDate) : null;
  if (payload.estimatedEndDate !== undefined) area.estimatedEndDate = payload.estimatedEndDate ? new Date(payload.estimatedEndDate) : null;
  if (payload.projectLead !== undefined && isPM) {
    area.projectLead = payload.projectLead || null;
    if (payload.projectLead) {
      const lead = await User.findById(payload.projectLead).select("name");
      area.projectLeadNameSnapshot = lead?.name || "";
    }
  }

  await area.save();

  if (payload.teamLead) {
    await projectService.ensureAssignedUserProjectMembership({
      projectId,
      userId: area.teamLead,
      userName: area.teamLeadNameSnapshot,
      role: "TEAM_LEAD",
      projectAreaId: area._id,
      addedBy: user.id,
    });
  }
  if (payload.projectLead) {
    await projectService.ensureAssignedUserProjectMembership({
      projectId,
      userId: area.projectLead,
      userName: area.projectLeadNameSnapshot,
      role: "MEMBER",
      projectAreaId: area._id,
      addedBy: user.id,
    });
  }

  await logProjectActivity({
    projectId,
    user,
    action: payload.status ? "AREA_STATUS_CHANGED" : "AREA_UPDATED",
    module: "AREA",
    entityType: "ProjectArea",
    entityId: area._id,
    oldValue: { status: oldValue.status, title: oldValue.title },
    newValue: { status: area.status, title: area.title },
    reason: payload.reason || "",
  });

  return ProjectArea.findById(area._id).populate("teamLead", USER_POPULATE).populate("projectLead", USER_POPULATE);
};

const assignTeamLead = async (projectId, areaId, user, payload) => {
  if (!PM_ROLES.includes(user.role)) {
    const project = await projectService.getProjectById(projectId, user);
    if (String(project.projectManager) !== String(user.id)) {
      throw createAppError("Only Project Manager can assign Team Lead.", 403);
    }
  }

  const area = await ProjectArea.findOne({ _id: areaId, projectId });
  if (!area) throw createAppError("Work area not found.", 404);

  const teamLeadId = payload.teamLead;
  const tl = await User.findOne({ _id: teamLeadId, isActive: true, role: { $in: ["TL", "PROJECT_MANAGER"] } });
  if (!tl) throw createAppError("Valid Team Lead not found.", 404);

  area.teamLead = tl._id;
  area.teamLeadNameSnapshot = tl.name;
  if (area.status === "NOT_STARTED") area.status = "IN_PROGRESS";
  await area.save();

  await projectService.ensureAssignedUserProjectMembership({
    projectId,
    userId: tl._id,
    userName: tl.name,
    role: "TEAM_LEAD",
    projectAreaId: area._id,
    addedBy: user.id,
  });

  await logProjectActivity({
    projectId,
    user,
    action: "AREA_TEAM_LEAD_ASSIGNED",
    module: "AREA",
    entityType: "ProjectArea",
    entityId: area._id,
    newValue: { teamLead: tl._id, name: tl.name },
  });

  return ProjectArea.findById(area._id).populate("teamLead", USER_POPULATE).populate("projectLead", USER_POPULATE);
};

const uploadAreaDocuments = async (projectId, areaId, user, files = []) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  if (!PM_ROLES.includes(user.role)) {
    throw createAppError("Only Project Manager, HR, or Super Admin can add work area documents.", 403);
  }
  const area = await ProjectArea.findOne({ _id: areaId, projectId });
  if (!area) throw createAppError("Work area not found.", 404);
  return saveAreaDocuments(projectId, area._id, user, files);
};

const deleteAreaDocument = async (projectId, areaId, docId, user) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  if (!PM_ROLES.includes(user.role)) {
    throw createAppError("Only Project Manager, HR, or Super Admin can remove work area documents.", 403);
  }
  const area = await ProjectArea.findOne({ _id: areaId, projectId });
  if (!area) throw createAppError("Work area not found.", 404);

  const document = await AreaDocument.findOne({ _id: docId, projectId, areaId });
  if (!document) throw createAppError("Document not found.", 404);

  await AreaDocument.deleteOne({ _id: docId });

  const fileName = path.basename(document.fileUrl || "");
  if (fileName) {
    const fullPath = path.join(__dirname, "../../uploads/areas", fileName);
    await fsPromises.unlink(fullPath).catch(() => undefined);
  }

  return document;
};

const listAreaDocuments = async (projectId, areaId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  const area = await ProjectArea.findOne({ _id: areaId, projectId });
  if (!area) throw createAppError("Work area not found.", 404);
  return AreaDocument.find({ projectId, areaId }).sort({ createdAt: -1 }).lean();
};

module.exports = {
  createArea,
  listAreas,
  updateArea,
  assignTeamLead,
  uploadAreaDocuments,
  deleteAreaDocument,
  listAreaDocuments,
};
