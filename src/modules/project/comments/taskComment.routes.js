const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const ticketUpload = require("../../../middleware/ticketUpload.middleware");
const { addComment, listComments } = require("./taskComment.controller");

const router = express.Router({ mergeParams: true });

router.post("/tasks/:taskId/comments", authMiddleware, ticketUpload.array("attachments", 5), addComment);
router.get("/tasks/:taskId/comments", authMiddleware, listComments);

module.exports = router;
