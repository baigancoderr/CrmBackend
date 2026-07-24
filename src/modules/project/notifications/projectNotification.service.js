const {
  createNotification,
  createNotificationsForRecipients,
} = require("../../notifications/notification.service");

const notifyProjectAssigned = async ({ recipientIds, actorId, project, message = "" }) => {
  return createNotificationsForRecipients({
    recipientIds,
    actorId,
    type: "PROJECT_ASSIGNED",
    title: "Project assigned",
    message: message || `You have been added to project "${project.projectName}".`,
    status: "INFO",
    entityType: "PROJECT",
    entityId: project._id,
    link: `/projects/${project._id}`,
    meta: { projectCode: project.projectCode, projectName: project.projectName },
  });
};

const notifyTaskAssigned = async ({ recipientId, actorId, task, project }) => {
  return createNotification({
    recipientId,
    actorId,
    type: "TASK_ASSIGNED",
    title: "Task assigned",
    message: `You have been assigned task "${task.title}" on ${project?.projectName || "a project"}.`,
    status: "INFO",
    entityType: "TASK",
    entityId: task._id,
    link: `/projects/${task.projectId}/tasks/${task._id}`,
    meta: { taskTitle: task.title, projectId: task.projectId },
  });
};

const notifyTaskSubmittedForReview = async ({ recipientId, actorId, task }) => {
  return createNotification({
    recipientId,
    actorId,
    type: "TASK_SUBMITTED_FOR_REVIEW",
    title: "Task submitted for review",
    message: `Task "${task.title}" has been submitted for your review.`,
    status: "PENDING",
    entityType: "TASK",
    entityId: task._id,
    link: `/projects/${task.projectId}/tasks/${task._id}`,
  });
};

const notifyTaskReviewDecision = async ({ recipientId, actorId, task, approved, reason = "" }) => {
  return createNotification({
    recipientId,
    actorId,
    type: approved ? "TASK_APPROVED" : "TASK_REJECTED",
    title: approved ? "Task approved" : "Task rejected",
    message: approved
      ? `Your task "${task.title}" has been approved and marked complete.`
      : `Your task "${task.title}" was rejected.${reason ? ` Reason: ${reason}` : ""}`,
    status: approved ? "APPROVED" : "REJECTED",
    entityType: "TASK",
    entityId: task._id,
    link: `/projects/${task.projectId}/tasks/${task._id}`,
    meta: { reason },
  });
};

const notifyBlockerRaised = async ({ recipientIds, actorId, blocker, task }) => {
  return createNotificationsForRecipients({
    recipientIds,
    actorId,
    type: "BLOCKER_RAISED",
    title: "Blocker raised",
    message: `Blocker on task "${task.title}": ${blocker.reason}`,
    status: "PENDING",
    entityType: "BLOCKER",
    entityId: blocker._id,
    link: `/projects/${task.projectId}/tasks/${task._id}`,
  });
};

const notifyDependencyResolved = async ({ recipientId, actorId, task, dependencyTask }) => {
  return createNotification({
    recipientId,
    actorId,
    type: "DEPENDENCY_RESOLVED",
    title: "Task dependency resolved",
    message: `Dependency "${dependencyTask.title}" is complete. Task "${task.title}" is now ready.`,
    status: "INFO",
    entityType: "TASK",
    entityId: task._id,
    link: `/projects/${task.projectId}/tasks/${task._id}`,
  });
};

const notifyProjectClosed = async ({ recipientIds, actorId, project }) => {
  return createNotificationsForRecipients({
    recipientIds,
    actorId,
    type: "PROJECT_CLOSED",
    title: "Project closed",
    message: `Project "${project.projectName}" has been closed and archived.`,
    status: "INFO",
    entityType: "PROJECT",
    entityId: project._id,
    link: `/projects/${project._id}`,
  });
};

const notifyDeadlineApproaching = async ({ recipientId, task, daysLeft }) => {
  return createNotification({
    recipientId,
    type: "DEADLINE_APPROACHING",
    title: "Deadline approaching",
    message: `Task "${task.title}" is due in ${daysLeft} day(s).`,
    status: "INFO",
    entityType: "TASK",
    entityId: task._id,
    link: `/projects/${task.projectId}/tasks/${task._id}`,
  });
};

const notifyUrgentTaskRequest = async ({ recipientId, actorId, task, employeeName }) => {
  return createNotification({
    recipientId,
    actorId,
    type: "URGENT_TASK_REQUEST",
    title: "Urgent task request",
    message: `${employeeName} requested urgent work on "${task.title}".`,
    status: "PENDING",
    entityType: "TASK",
    entityId: task._id,
    link: `/projects/${task.projectId}/tasks/${task._id}`,
  });
};

module.exports = {
  notifyProjectAssigned,
  notifyTaskAssigned,
  notifyTaskSubmittedForReview,
  notifyTaskReviewDecision,
  notifyBlockerRaised,
  notifyDependencyResolved,
  notifyProjectClosed,
  notifyDeadlineApproaching,
  notifyUrgentTaskRequest,
};
