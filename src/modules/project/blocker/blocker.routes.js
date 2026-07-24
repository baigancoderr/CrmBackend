const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const { raiseBlocker, resolveBlocker, listBlockers } = require("./blocker.controller");

const router = express.Router({ mergeParams: true });

router.post("/tasks/:taskId/blockers", authMiddleware, raiseBlocker);
router.post("/blockers/:blockerId/resolve", authMiddleware, resolveBlocker);
router.get("/blockers", authMiddleware, listBlockers);

module.exports = router;
