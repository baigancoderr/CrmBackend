const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const ticketUpload = require("../../../middleware/ticketUpload.middleware");
const { UPLOAD_MAX_FILES } = require("../../../constants/uploadLimits");
const { addComment, listComments } = require("./taskComment.controller");

const router = express.Router({ mergeParams: true });

router.post("/tasks/:taskId/comments", authMiddleware, ticketUpload.array("attachments", UPLOAD_MAX_FILES.TASK_ATTACHMENTS), addComment);
router.get("/tasks/:taskId/comments", authMiddleware, listComments);

module.exports = router;
