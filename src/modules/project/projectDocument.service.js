const ProjectDocument = require("./projectDocument.model");
const TaskAttachment = require("./task/taskAttachment.model");
const projectService = require("./project.service");
const { createAppError, parsePagination, buildPaginatedResult, logProjectActivity } = require("./project.helper");
const { PM_ROLES } = require("./project.constants");

const saveUploadedFile = (file) => ({
  fileName: file.originalname,
  fileUrl: `/uploads/projects/${file.filename}`,
  fileSize: file.size,
  mimeType: file.mimetype,
});

const uploadProjectDocument = async (projectId, user, payload, files = []) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });

  if (!files.length) throw createAppError("At least one file is required.", 422);

  const docs = [];
  for (const file of files) {
    const fileMeta = saveUploadedFile(file);
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

const uploadTaskAttachment = async (projectId, taskId, user, files = []) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });
  if (!files.length) throw createAppError("At least one file is required.", 422);

  const attachments = [];
  for (const file of files) {
    const fileMeta = saveUploadedFile(file);
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
  uploadTaskAttachment,
  listTaskAttachments,
};
