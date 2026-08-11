const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const ticketUpload = require("../../../middleware/ticketUpload.middleware");
const { UPLOAD_MAX_FILES } = require("../../../constants/uploadLimits");
const { raiseBlocker, resolveBlocker, listBlockers } = require("./blocker.controller");

const router = express.Router({ mergeParams: true });

router.post("/tasks/:taskId/blockers", authMiddleware, ticketUpload.array("attachments", UPLOAD_MAX_FILES.TASK_ATTACHMENTS), raiseBlocker);
router.post("/blockers/:blockerId/resolve", authMiddleware, resolveBlocker);
router.get("/blockers", authMiddleware, listBlockers);

module.exports = router;
