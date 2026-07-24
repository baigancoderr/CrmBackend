const express = require("express");
const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const { validateCreateProject, validateUpdateProject } = require("./project.validation");
const {
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  closeProject,
} = require("./project.controller");

const router = express.Router();

router.post("/", authMiddleware, roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER"), validateCreateProject, createProject);
router.get("/", authMiddleware, listProjects);
router.get("/:id", authMiddleware, getProjectById);
router.patch("/:id", authMiddleware, validateUpdateProject, updateProject);
router.post("/:id/close", authMiddleware, closeProject);

module.exports = router;
