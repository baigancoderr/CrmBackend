const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const ticketUpload = require("../../../middleware/ticketUpload.middleware");
const {
  validateCreateTask,
  validateUpdateTask,
  validateAssignTask,
  validateReviewTask,
} = require("./task.validation");
const {
  createTask,
  listTasks,
  getTaskById,
  updateTask,
  deleteTask,
  assignTask,
  acceptTask,
  startTask,
  pauseTask,
  submitForReview,
  reviewTask,
  addDependency,
  getActiveTask,
  getElapsedTime,
} = require("./task.controller");

const router = express.Router({ mergeParams: true });

router.post("/", authMiddleware, validateCreateTask, createTask);
router.get("/", authMiddleware, listTasks);
router.get("/active", authMiddleware, getActiveTask);
router.get("/:taskId", authMiddleware, getTaskById);
router.patch("/:taskId", authMiddleware, validateUpdateTask, updateTask);
router.delete("/:taskId", authMiddleware, deleteTask);
router.post("/:taskId/assign", authMiddleware, validateAssignTask, assignTask);
router.post("/:taskId/accept", authMiddleware, acceptTask);
router.post("/:taskId/start", authMiddleware, startTask);
router.post("/:taskId/pause", authMiddleware, pauseTask);
router.post(
  "/:taskId/submit",
  authMiddleware,
  ticketUpload.array("attachments", 5),
  submitForReview
);
router.post(
  "/:taskId/review",
  authMiddleware,
  ticketUpload.array("attachments", 5),
  validateReviewTask,
  reviewTask
);
router.post("/:taskId/dependency", authMiddleware, addDependency);
router.get("/:taskId/elapsed", authMiddleware, getElapsedTime);

module.exports = router;
