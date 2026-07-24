const TaskComment = require("./taskComment.model");
const projectService = require("../project.service");
const { createAppError, logProjectActivity } = require("../project.helper");
const User = require("../../user/user.model");

const addComment = async (projectId, taskId, user, payload) => {
  await projectService.assertProjectAccess(projectId, user, { write: true });

  const content = String(payload.content || "").trim();
  if (!content) throw createAppError("Comment content is required.", 422);

  const mentionPattern = /@\[([a-fA-F0-9]{24})\]/g;
  const mentionedIds = [];
  let match;
  while ((match = mentionPattern.exec(content)) !== null) {
    mentionedIds.push(match[1]);
  }

  if (payload.mentionedUsers?.length) {
    mentionedIds.push(...payload.mentionedUsers);
  }

  const comment = await TaskComment.create({
    taskId,
    projectId,
    author: user.id,
    authorNameSnapshot: user.name,
    content,
    mentionedUsers: [...new Set(mentionedIds)],
    isInternal: payload.isInternal === true,
  });

  await logProjectActivity({
    projectId,
    user,
    action: "COMMENT_ADDED",
    module: "TASK",
    entityType: "TaskComment",
    entityId: comment._id,
  });

  return TaskComment.findById(comment._id).populate("author", "name role profilePhoto");
};

const listComments = async (projectId, taskId, user) => {
  await projectService.assertProjectAccess(projectId, user);
  return TaskComment.find({ taskId, projectId })
    .sort({ createdAt: 1 })
    .populate("author", "name role profilePhoto")
    .populate("mentionedUsers", "name email")
    .lean();
};

module.exports = { addComment, listComments };
