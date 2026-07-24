const { TASK_STATUSES, TASK_PRIORITIES, REVIEW_ACTIONS } = require("../project.constants");

const validateCreateTask = (req, res, next) => {
  const { title, projectAreaId } = req.body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(422).json({ success: false, message: "Task title is required." });
  }

  if (!projectAreaId) {
    return res.status(422).json({ success: false, message: "Project area ID is required." });
  }

  next();
};

const validateUpdateTask = (req, res, next) => {
  const { status, priority } = req.body;

  if (status && !TASK_STATUSES.includes(status)) {
    return res.status(422).json({ success: false, message: "Invalid task status." });
  }

  if (priority && !TASK_PRIORITIES.includes(priority)) {
    return res.status(422).json({ success: false, message: "Invalid task priority." });
  }

  next();
};

const validateAssignTask = (req, res, next) => {
  const { assignedTo } = req.body;

  if (!assignedTo) {
    return res.status(422).json({ success: false, message: "Assignee ID is required." });
  }

  next();
};

const validateReviewTask = (req, res, next) => {
  const { action } = req.body;

  if (!action || !REVIEW_ACTIONS.includes(action.toUpperCase())) {
    return res.status(422).json({ success: false, message: "Invalid review action. Use APPROVE, REJECT, or REOPEN." });
  }

  next();
};

module.exports = {
  validateCreateTask,
  validateUpdateTask,
  validateAssignTask,
  validateReviewTask,
};
