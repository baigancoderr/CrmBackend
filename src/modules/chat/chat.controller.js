const chatService = require("./chat.service");
const chatNotificationService = require("./chatNotification.service");

const getIo = () => chatService.getSocketIo();

const createConversation = async (req, res) => {
  try {
    const conversation = await chatService.createConversation(
      req.body,
      req.user
    );

    return res.status(201).json({
      success: true,
      message: "Conversation created successfully",
      data: conversation,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getOrCreateProjectConversation = async (req, res) => {
  try {
    const conversation = await chatService.getOrCreateProjectConversation(
      req.params.projectId,
      req.user
    );

    return res.status(200).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    const status = error.statusCode || 400;
    return res.status(status).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyConversations = async (req, res) => {
  try {
    const conversations = await chatService.getMyConversations(
      req.user.id,
      req.query,
      req.user.role
    );

    return res.status(200).json({
      success: true,
      data: conversations,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getConversationById = async (req, res) => {
  try {
    const conversation = await chatService.getConversationById(
      req.params.id,
      req.user.id,
      req.user.role
    );

    return res.status(200).json({
      success: true,
      data: conversation,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const updateConversation = async (req, res) => {
  try {
    const conversation = await chatService.updateConversation(
      req.params.id,
      req.body,
      req.user
    );

    const io = getIo();

    if (io) {
      io.to(`conversation:${req.params.id}`).emit(
        "conversation:updated",
        {
          conversationId: req.params.id,
          conversation,
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: "Conversation updated successfully",
      data: conversation,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteConversation = async (req, res) => {
  try {
    const result = await chatService.deleteConversation(
      req.params.id,
      req.user,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Group deleted successfully",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const leaveConversation = async (req, res) => {
  try {
    const result = await chatService.leaveConversation(
      req.params.id,
      req.user.id,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "You left the group",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getConversationMembers = async (req, res) => {
  try {
    const members = await chatService.getConversationMembers(
      req.params.id,
      req.user.id,
      req.user.role
    );

    return res.status(200).json({
      success: true,
      data: members,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const addMembers = async (req, res) => {
  try {
    const members = await chatService.addMembers(
      req.params.id,
      req.body.userIds || [],
      req.user,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Members added successfully",
      data: members,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const removeMember = async (req, res) => {
  try {
    const members = await chatService.removeMember(
      req.params.id,
      req.params.userId,
      req.user,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Member removed successfully",
      data: members,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMessages = async (req, res) => {
  try {
    const messages = await chatService.getMessages(
      req.params.id,
      req.user.id,
      req.query,
      req.user.role
    );

    return res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const sendMessage = async (req, res) => {
  try {
    const message = await chatService.sendMessage(
      req.params.id,
      req.body,
      req.user,
      getIo()
    );

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const uploadMessageFile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "File is required",
      });
    }

    const replyTo = typeof req.body.replyTo === "string" ? req.body.replyTo : null;
    const message = await chatService.sendFileMessage(
      req.params.id,
      req.file,
      req.user,
      getIo(),
      replyTo
    );

    return res.status(201).json({
      success: true,
      message: "File sent successfully",
      data: message,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const editMessage = async (req, res) => {
  try {
    const message = await chatService.editMessage(
      req.params.messageId,
      req.body.content,
      req.user.id,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Message updated successfully",
      data: message,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const scope = req.query.scope === "all" ? "all" : "me";
    const result = await chatService.deleteMessage(
      req.params.messageId,
      scope,
      req.user,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const reactToMessage = async (req, res) => {
  try {
    const message = await chatService.reactToMessage(
      req.params.messageId,
      req.body.emoji,
      req.user.id,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Message reaction updated successfully",
      data: message,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const updateGroupPhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Photo file is required",
      });
    }

    const conversation = await chatService.updateGroupPhoto(
      req.params.id,
      req.file,
      req.user,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Group photo updated successfully",
      data: conversation,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const markConversationAsRead = async (req, res) => {
  try {
    const result = await chatService.markConversationAsRead(
      req.params.id,
      req.user.id,
      getIo(),
      req.user.role
    );

    return res.status(200).json({
      success: true,
      message: "Conversation marked as read",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const result = await chatService.getUnreadCount(
      req.user.id
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyNotifications = async (req, res) => {
  try {
    const data = await chatNotificationService.getMyNotifications(
      req.user.id,
      req.query
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getNotificationUnreadCount = async (req, res) => {
  try {
    const unreadCount = await chatNotificationService.getUnreadCount(
      req.user.id
    );

    return res.status(200).json({
      success: true,
      data: {
        unreadCount,
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const data = await chatNotificationService.markNotificationAsRead(
      req.params.notificationId,
      req.user.id,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const markAllNotificationsAsRead = async (req, res) => {
  try {
    const data = await chatNotificationService.markAllNotificationsAsRead(
      req.user.id,
      getIo()
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getChatFile = async (req, res) => {
  try {
    const filePath =
      await chatService.getChatFilePathForUser(
        req.params.fileName,
        req.user.id
      );

    return res.sendFile(filePath);
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

const getUsersPresence = async (req, res) => {
  try {
    await chatService.touchUserPresence(req.user.id);

    const userIds = String(req.query.userIds || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const presence = await chatService.getUsersPresence(userIds);

    res.set("Cache-Control", "no-store");

    return res.status(200).json({
      success: true,
      data: presence,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const forwardMessage = async (req, res) => {
  try {
    const messages = await chatService.forwardMessage(
      req.params.messageId,
      req.body.targetConversationIds || [],
      req.user,
      getIo()
    );

    return res.status(201).json({
      success: true,
      message: "Message forwarded successfully",
      data: messages,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getConversationDrawerInfo = async (req, res) => {
  try {
    const data = await chatService.getConversationDrawerInfo(
      req.params.id,
      req.user.id,
      req.user.role
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getConversationAttachments = async (req, res) => {
  try {
    const data = await chatService.getConversationAttachments(
      req.params.id,
      req.user.id,
      req.user.role,
      req.query
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createConversation,
  getOrCreateProjectConversation,
  getMyConversations,
  getConversationById,
  updateConversation,
  updateGroupPhoto,
  deleteConversation,
  leaveConversation,
  getConversationMembers,
  addMembers,
  removeMember,
  getMessages,
  sendMessage,
  uploadMessageFile,
  editMessage,
  deleteMessage,
  reactToMessage,
  markConversationAsRead,
  getUnreadCount,
  getMyNotifications,
  getNotificationUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getChatFile,
  getUsersPresence,
  forwardMessage,
  getConversationDrawerInfo,
  getConversationAttachments,
};
