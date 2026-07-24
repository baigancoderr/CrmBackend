const ChatNotification = require("./chatNotification.model");
const pushService = require("../push/push.service");

const USER_FIELDS = "name profilePhoto employeeId";
const CONVERSATION_FIELDS = "type name photo";

const buildPreview = (message = {}) => {
  if (message.type === "IMAGE") {
    return "Sent an image";
  }

  if (message.type === "FILE") {
    const fileName = message.fileMeta?.name?.trim();
    return fileName ? `Sent a file: ${fileName}` : "Sent a file";
  }

  if (message.type === "SYSTEM") {
    return message.content || "System notification";
  }

  const content = typeof message.content === "string" ? message.content.trim() : "";
  return content || "Sent a message";
};

const formatNotification = (notification) => {
  if (!notification) {
    return null;
  }

  const conversationId = notification.conversation?._id || notification.conversation;
  const sender = notification.sender && typeof notification.sender === "object"
    ? {
        _id: notification.sender._id,
        name: notification.sender.name || "",
        profilePhoto: notification.sender.profilePhoto || "",
        employeeId: notification.sender.employeeId || "",
      }
    : null;

  const conversation = notification.conversation && typeof notification.conversation === "object"
    ? {
        _id: notification.conversation._id,
        type: notification.conversation.type || "DM",
        name: notification.conversation.name || "",
        photo: notification.conversation.photo || "",
      }
    : {
        _id: conversationId,
        type: "DM",
        name: "",
        photo: "",
      };

  return {
    _id: notification._id,
    type: notification.type,
    title: notification.title || "New message",
    preview: notification.preview || "",
    messageType: notification.messageType || "TEXT",
    recipient: notification.recipient,
    sender,
    conversation,
    messageId: notification.message,
    isRead: Boolean(notification.isRead),
    readAt: notification.readAt || null,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
};

const getUnreadCount = async (userId) => {
  const unreadCount = await ChatNotification.countDocuments({
    recipient: userId,
    isRead: false,
  });

  return unreadCount;
};

const emitUnreadCount = async (io, userId) => {
  if (!io) {
    return;
  }

  const unreadCount = await getUnreadCount(userId);
  io.to(`user:${userId}`).emit("chat:notification:unread-count", {
    unreadCount,
  });
};

const createMessageNotifications = async ({
  io,
  conversation,
  message,
  sender,
  recipientIds = [],
}) => {
  const conversationId = conversation?._id?.toString() || "";
  const senderId = sender?.id?.toString() || sender?._id?.toString() || "";
  const cleanRecipients = [...new Set(recipientIds.map((id) => id.toString()))].filter(
    (recipientId) => recipientId && recipientId !== senderId
  );

  if (!conversationId || !message?._id || cleanRecipients.length === 0) {
    return;
  }

  const preview = buildPreview(message);
  const title =
    conversation?.type === "GROUP"
      ? `${sender?.name || "Someone"} in ${conversation?.name || "group"}`
      : sender?.name || "New message";
  const webPushPayload = {
    title,
    body: preview || "You have a new message.",
    url: `/application/chat?conversation=${conversationId}`,
    tag: `chat-${conversationId}`,
    data: {
      type: "CHAT_MESSAGE",
      conversationId,
      messageId: message._id?.toString() || "",
      senderId,
    },
  };

  const docs = cleanRecipients.map((recipientId) => ({
    recipient: recipientId,
    conversation: conversationId,
    message: message._id,
    sender: senderId || null,
    type: "CHAT_MESSAGE",
    title,
    preview,
    messageType: message.type || "TEXT",
  }));

  const created = await ChatNotification.insertMany(docs, { ordered: false });

  if (!io || !created?.length) {
    return;
  }

  for (const item of created) {
    const populated = await ChatNotification.findById(item._id)
      .populate("sender", USER_FIELDS)
      .populate("conversation", CONVERSATION_FIELDS)
      .lean();

    const unreadCount = await getUnreadCount(item.recipient);
    io.to(`user:${item.recipient.toString()}`).emit("chat:notification:new", {
      notification: formatNotification(populated),
      unreadCount,
    });
  }

  await pushService.sendPushToUsers(cleanRecipients, webPushPayload);
};

const getMyNotifications = async (userId, query = {}) => {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 50);
  const skip = (page - 1) * limit;
  const unreadOnly = String(query.unreadOnly || "").toLowerCase() === "true";

  const filter = {
    recipient: userId,
  };

  if (unreadOnly) {
    filter.isRead = false;
  }

  const [records, totalRecords, unreadCount] = await Promise.all([
    ChatNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("sender", USER_FIELDS)
      .populate("conversation", CONVERSATION_FIELDS)
      .lean(),
    ChatNotification.countDocuments(filter),
    getUnreadCount(userId),
  ]);

  return {
    page,
    limit,
    totalRecords,
    totalPages: Math.ceil(totalRecords / limit) || 1,
    unreadCount,
    data: records.map(formatNotification).filter(Boolean),
  };
};

const markNotificationAsRead = async (notificationId, userId, io) => {
  const notification = await ChatNotification.findOne({
    _id: notificationId,
    recipient: userId,
  });

  if (!notification) {
    throw new Error("Notification not found");
  }

  if (!notification.isRead) {
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();
  }

  if (io) {
    const unreadCount = await getUnreadCount(userId);
    io.to(`user:${userId}`).emit("chat:notification:read", {
      notificationId: notification._id,
      conversationId: notification.conversation,
      unreadCount,
    });
  }

  return {
    notificationId: notification._id,
    readAt: notification.readAt,
  };
};

const markConversationNotificationsAsRead = async (conversationId, userId, io) => {
  const now = new Date();
  const result = await ChatNotification.updateMany(
    {
      recipient: userId,
      conversation: conversationId,
      isRead: false,
    },
    {
      $set: {
        isRead: true,
        readAt: now,
      },
    }
  );

  if (io && result.modifiedCount > 0) {
    const unreadCount = await getUnreadCount(userId);
    io.to(`user:${userId}`).emit("chat:notification:conversation-read", {
      conversationId,
      unreadCount,
    });
  }

  return {
    conversationId,
    updatedCount: result.modifiedCount || 0,
  };
};

const markAllNotificationsAsRead = async (userId, io) => {
  const now = new Date();
  const result = await ChatNotification.updateMany(
    {
      recipient: userId,
      isRead: false,
    },
    {
      $set: {
        isRead: true,
        readAt: now,
      },
    }
  );

  if (io) {
    io.to(`user:${userId}`).emit("chat:notification:all-read", {
      updatedCount: result.modifiedCount || 0,
      unreadCount: 0,
    });
  }

  return {
    updatedCount: result.modifiedCount || 0,
  };
};

module.exports = {
  createMessageNotifications,
  getMyNotifications,
  getUnreadCount,
  emitUnreadCount,
  markNotificationAsRead,
  markConversationNotificationsAsRead,
  markAllNotificationsAsRead,
  formatNotification,
};
