const express = require("express");
const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const {
  validateCreateProject,
  validateUpdateProject,
  validateAddProjectMembers,
} = require("./project.validation");
const {
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  closeProject,
  deleteProject,
  addProjectMembers,
} = require("./project.controller");
const { listMyWorkingTasks } = require("./task/task.controller");

const router = express.Router();

router.post("/", authMiddleware, roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER"), validateCreateProject, createProject);
router.get("/", authMiddleware, listProjects);
router.get("/tasks/mine", authMiddleware, roleMiddleware("EMPLOYEE"), listMyWorkingTasks);
router.get("/:id", authMiddleware, getProjectById);
router.patch("/:id", authMiddleware, validateUpdateProject, updateProject);
router.post("/:id/members", authMiddleware, validateAddProjectMembers, addProjectMembers);
router.post("/:id/close", authMiddleware, closeProject);
router.delete("/:id", authMiddleware, roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER"), deleteProject);

module.exports = router;
