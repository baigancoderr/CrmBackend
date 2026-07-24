const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const { createMilestone, listMilestones, updateMilestone } = require("./milestone.controller");

const router = express.Router({ mergeParams: true });

router.post("/", authMiddleware, createMilestone);
router.get("/", authMiddleware, listMilestones);
router.patch("/:milestoneId", authMiddleware, updateMilestone);

module.exports = router;
