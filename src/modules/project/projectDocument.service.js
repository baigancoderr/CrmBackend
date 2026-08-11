const ProjectDocument = require("./projectDocument.model");
const TaskAttachment = require("./task/taskAttachment.model");
const projectService = require("./project.service");
const storageService = require("../../services/storage.service");
const { createAppError, parsePagination, buildPaginatedResult, logProjectActivity } = require("./project.helper");
const { TL_ROLES } = require("./project.constants");

const assertCanManageProjectDocuments = (user) => {
  if (!TL_ROLES.includes(user.role)) {
    throw createAppError(
      "Only Super Admin, HR, Project Manager, or Team Lead can manage project documents.",
      403
    );
  }
};

const saveUploadedFile = async (file) => ({
  fileName: file.originalname,
  fileUrl: await storageService.persistUploadedFile(file, "projects"),
  fileSize: file.size,
  mimeType: file.mimetype,
});

const uploadProjectDocument = async (projectId, user, payload, files = []) => {
  await projectService.assertProjectAccess(projectId, user);
  assertCanManageProjectDocuments(user);

  if (!files.length) throw createAppError("At least one file is required.", 422);

  const docs = [];
  for (const file of files) {
    const fileMeta = await saveUploadedFile(file);
    const doc = await ProjectDocument.create({
      projectId,
      title: payload.title || file.originalname,
      description: String(payload.description || "").trim(),
      ...fileMeta,
      uploadedBy: user.id,
      uploadedByNameSnapshot: user.name,
      isClientVisible: payload.isClientVisible === true,
    });
    docs.push(doc);

    await logProjectActivity({
      projectId,
      user,
      action: "DOCUMENT_UPLOADED",
      module: "DOCUMENT",
      entityType: "ProjectDocument",
      entityId: doc._id,
    });
  }

  return docs;
};

const listProjectDocuments = async (projectId, user, query = {}) => {
  await projectService.assertProjectAccess(projectId, user);
  const filter = { projectId };
  if (user.role === "CLIENT") filter.isClientVisible = true;

  const { page, limit, skip, sort } = parsePagination(query);
  const [records, totalRecords] = await Promise.all([
    ProjectDocument.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    ProjectDocument.countDocuments(filter),
  ]);

  return buildPaginatedResult(records, totalRecords, page, limit);
};

const updateProjectDocument = async (projectId, docId, user, payload = {}) => {
  await projectService.assertProjectAccess(projectId, user);
  assertCanManageProjectDocuments(user);

  const document = await ProjectDocument.findOne({ _id: docId, projectId });
  if (!document) throw createAppError("Document not found.", 404);

  if (payload.title !== undefined) {
    const title = String(payload.title || "").trim();
    if (!title) throw createAppError("Document title is required.", 422);
    document.title = title;
  }

  if (payload.description !== undefined) {
    document.description = String(payload.description || "").trim();
  }

  if (payload.isClientVisible !== undefined) {
    document.isClientVisible = payload.isClientVisible === true;
  }

  await document.save();
  return document.toObject();
};

const deleteProjectDocument = async (projectId, docId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  assertCanManageProjectDocuments(user);

  const document = await ProjectDocument.findOne({ _id: docId, projectId });
  if (!document) throw createAppError("Document not found.", 404);

  await ProjectDocument.deleteOne({ _id: docId });
  await storageService.deleteStoredFile(document.fileUrl);

  return document.toObject();
};

const uploadTaskAttachment = async (projectId, taskId, user, files = []) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  if (!files.length) throw createAppError("At least one file is required.", 422);

  const attachments = [];
  for (const file of files) {
    const fileMeta = await saveUploadedFile(file);
    const attachment = await TaskAttachment.create({
      taskId,
      projectId,
      ...fileMeta,
      uploadedBy: user.id,
      uploadedByNameSnapshot: user.name,
    });
    attachments.push(attachment);
  }

  return attachments;
};

const listTaskAttachments = async (projectId, taskId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  return TaskAttachment.find({ projectId, taskId }).sort({ createdAt: -1 }).lean();
};

module.exports = {
  uploadProjectDocument,
  listProjectDocuments,
  updateProjectDocument,
  deleteProjectDocument,
  uploadTaskAttachment,
  listTaskAttachments,
};
