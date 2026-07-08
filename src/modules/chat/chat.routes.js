const express = require("express");

const router = express.Router();

const chatController = require("./chat.controller");
const auth = require("../../middleware/auth.middleware");
const chatUpload = require("../../middleware/chatUpload.middleware");

router.get(
  "/unread-count",
  auth,
  chatController.getUnreadCount
);

router.post(
  "/conversations",
  auth,
  chatController.createConversation
);

router.get(
  "/conversations",
  auth,
  chatController.getMyConversations
);

router.get(
  "/conversations/:id",
  auth,
  chatController.getConversationById
);

router.patch(
  "/conversations/:id",
  auth,
  chatController.updateConversation
);

router.delete(
  "/conversations/:id",
  auth,
  chatController.deleteConversation
);

router.post(
  "/conversations/:id/leave",
  auth,
  chatController.leaveConversation
);

router.get(
  "/conversations/:id/members",
  auth,
  chatController.getConversationMembers
);

router.post(
  "/conversations/:id/members",
  auth,
  chatController.addMembers
);

router.delete(
  "/conversations/:id/members/:userId",
  auth,
  chatController.removeMember
);

router.get(
  "/conversations/:id/messages",
  auth,
  chatController.getMessages
);

router.post(
  "/conversations/:id/messages",
  auth,
  chatController.sendMessage
);

router.post(
  "/conversations/:id/upload",
  auth,
  chatUpload.single("file"),
  chatController.uploadMessageFile
);

router.post(
  "/conversations/:id/read",
  auth,
  chatController.markConversationAsRead
);

router.patch(
  "/messages/:messageId",
  auth,
  chatController.editMessage
);

router.delete(
  "/messages/:messageId",
  auth,
  chatController.deleteMessage
);

module.exports = router;
