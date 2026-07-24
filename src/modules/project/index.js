const express = require("express");
const projectRoutes = require("./project.routes");
const projectAreaRoutes = require("./projectArea.routes");
const taskRoutes = require("./task/task.routes");
const blockerRoutes = require("./blocker/blocker.routes");
const commentRoutes = require("./comments/taskComment.routes");
const milestoneRoutes = require("./milestone/milestone.routes");
const activityRoutes = require("./activities/projectActivity.routes");
const reportRoutes = require("./reports/report.routes");

const router = express.Router();

// Dashboard and reports (no :id prefix)
router.use("/projects", reportRoutes);

// Core project routes
router.use("/projects", projectRoutes);

// Nested routes under /projects/:id
router.use("/projects/:id/areas", projectAreaRoutes);
router.use("/projects/:id/tasks", taskRoutes);
router.use("/projects/:id/milestones", milestoneRoutes);
router.use("/projects/:id/activities", activityRoutes);

// Blocker and comment routes (nested under project)
router.use("/projects/:id", blockerRoutes);
router.use("/projects/:id", commentRoutes);

module.exports = router;
