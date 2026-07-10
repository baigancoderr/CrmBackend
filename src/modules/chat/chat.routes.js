const express = require("express");

const router = express.Router();

const chatController = require("./chat.controller");
const auth = require("../../middleware/auth.middleware");
const chatUpload = require("../../middleware/chatUpload.middleware");
const validateRequest = require("../../middleware/validate.middleware");
const {
  chatSendRateLimit,
  chatUploadRateLimit,
} = require("../../middleware/chatRateLimit.middleware");
const chatFileSecurity = require("../../middleware/chatFileSecurity.middleware");
const observeChatHttp = require("../../middleware/chatObservability.middleware");
const {
  paginationQuerySchema,
  createConversationSchema,
  conversationIdParamSchema,
  messageIdParamSchema,
  removeMemberParamSchema,
  fileNameParamSchema,
  updateConversationSchema,
  addMembersSchema,
  sendMessageSchema,
  getMessagesQuerySchema,
  editMessageSchema,
  deleteMessageQuerySchema,
  forwardMessageSchema,
  presenceQuerySchema,
} = require("./chat.validation");

router.use(auth, observeChatHttp);

router.get(
  "/unread-count",
  chatController.getUnreadCount
);

router.get(
  "/presence",
  validateRequest({
    query: presenceQuerySchema,
  }),
  chatController.getUsersPresence
);

router.post(
  "/conversations",
  validateRequest({
    body: createConversationSchema,
  }),
  chatController.createConversation
);

router.get(
  "/conversations",
  validateRequest({
    query: paginationQuerySchema,
  }),
  chatController.getMyConversations
);

router.get(
  "/conversations/:id",
  validateRequest({
    params: conversationIdParamSchema,
  }),
  chatController.getConversationById
);

router.patch(
  "/conversations/:id",
  validateRequest({
    params: conversationIdParamSchema,
    body: updateConversationSchema,
  }),
  chatController.updateConversation
);

router.delete(
  "/conversations/:id",
  validateRequest({
    params: conversationIdParamSchema,
  }),
  chatController.deleteConversation
);

router.post(
  "/conversations/:id/leave",
  validateRequest({
    params: conversationIdParamSchema,
  }),
  chatController.leaveConversation
);

router.get(
  "/conversations/:id/members",
  validateRequest({
    params: conversationIdParamSchema,
  }),
  chatController.getConversationMembers
);

router.post(
  "/conversations/:id/members",
  validateRequest({
    params: conversationIdParamSchema,
    body: addMembersSchema,
  }),
  chatController.addMembers
);

router.delete(
  "/conversations/:id/members/:userId",
  validateRequest({
    params: removeMemberParamSchema,
  }),
  chatController.removeMember
);

router.get(
  "/conversations/:id/messages",
  validateRequest({
    params: conversationIdParamSchema,
    query: getMessagesQuerySchema,
  }),
  chatController.getMessages
);

router.post(
  "/conversations/:id/messages",
  chatSendRateLimit,
  validateRequest({
    params: conversationIdParamSchema,
    body: sendMessageSchema,
  }),
  chatController.sendMessage
);

router.post(
  "/conversations/:id/upload",
  chatUploadRateLimit,
  validateRequest({
    params: conversationIdParamSchema,
  }),
  chatUpload.single("file"),
  chatFileSecurity,
  chatController.uploadMessageFile
);

router.post(
  "/conversations/:id/read",
  validateRequest({
    params: conversationIdParamSchema,
  }),
  chatController.markConversationAsRead
);

router.patch(
  "/messages/:messageId",
  validateRequest({
    params: messageIdParamSchema,
    body: editMessageSchema,
  }),
  chatController.editMessage
);

router.delete(
  "/messages/:messageId",
  validateRequest({
    params: messageIdParamSchema,
    query: deleteMessageQuerySchema,
  }),
  chatController.deleteMessage
);

router.post(
  "/messages/:messageId/forward",
  validateRequest({
    params: messageIdParamSchema,
    body: forwardMessageSchema,
  }),
  chatController.forwardMessage
);

router.get(
  "/files/:fileName",
  validateRequest({
    params: fileNameParamSchema,
  }),
  chatController.getChatFile
);

module.exports = router;
