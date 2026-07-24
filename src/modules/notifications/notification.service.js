const AppNotification = require("./notification.model");
const User = require("../user/user.model");
const pushService = require("../push/push.service");

const USER_FIELDS = "name employeeId role profilePhoto";

const formatNotification = (notification) => {
  if (!notification) {
    return null;
  }

  const actor =
    notification.actor && typeof notification.actor === "object"
      ? {
          _id: notification.actor._id,
          name: notification.actor.name || "",
          employeeId: notification.actor.employeeId || "",
          role: notification.actor.role || "",
          profilePhoto: notification.actor.profilePhoto || "",
        }
      : null;

  return {
    _id: notification._id,
    type: notification.type,
    title: notification.title,
    message: notification.message || "",
    status: notification.status || "INFO",
    entityType: notification.entityType || null,
    entityId: notification.entityId || null,
    link: notification.link || "",
    meta: notification.meta || {},
    isRead: Boolean(notification.isRead),
    readAt: notification.readAt || null,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
    actor,
  };
};

const getSocketIo = () => {
  try {
    const chatService = require("../chat/chat.service");
    return typeof chatService.getSocketIo === "function"
      ? chatService.getSocketIo()
      : null;
  } catch (_error) {
    return null;
  }
};

const getUnreadCount = async (userId) => {
  return AppNotification.countDocuments({
    recipient: userId,
    isRead: false,
  });
};

const emitUnreadCount = async (userId) => {
  const io = getSocketIo();
  if (!io || !userId) {
    return;
  }

  const unreadCount = await getUnreadCount(userId);
  io.to(`user:${userId.toString()}`).emit("app:notification:unread-count", {
    unreadCount,
  });
};

const emitNewNotification = async (userId, notification) => {
  const io = getSocketIo();
  if (!io || !userId || !notification) {
    return;
  }

  io.to(`user:${userId.toString()}`).emit("app:notification:new", {
    notification: formatNotification(notification),
  });
  await emitUnreadCount(userId);
};

const buildWebPushPayload = (notification = {}) => {
  const link =
    typeof notification.link === "string" && notification.link.trim()
      ? notification.link.trim()
      : "/index";

  return {
    title: notification.title || "Digital One Box CRM",
    body: notification.message || "You have a new update.",
    url: link,
    tag: `app-${notification.type || "info"}-${notification.entityId || "general"}`,
    data: {
      type: notification.type || "INFO",
      entityType: notification.entityType || null,
      entityId: notification.entityId || null,
      link,
      meta: notification.meta || {},
    },
  };
};

const createNotification = async ({
  recipientId,
  actorId = null,
  type,
  title,
  message = "",
  status = "INFO",
  entityType = null,
  entityId = null,
  link = "",
  meta = {},
}) => {
  if (!recipientId || !type || !title) {
    return null;
  }

  const created = await AppNotification.create({
    recipient: recipientId,
    actor: actorId || null,
    type,
    title,
    message,
    status,
    entityType,
    entityId,
    link,
    meta,
  });

  const populated = await AppNotification.findById(created._id)
    .populate("actor", USER_FIELDS)
    .lean();

  await emitNewNotification(recipientId, populated);

  await pushService.sendPushToUsers(
    [recipientId],
    buildWebPushPayload(populated)
  );

  return formatNotification(populated);
};

const createNotificationsForRecipients = async ({
  recipientIds = [],
  actorId = null,
  type,
  title,
  message = "",
  status = "INFO",
  entityType = null,
  entityId = null,
  link = "",
  meta = {},
}) => {
  const uniqueIds = [
    ...new Set(
      recipientIds
        .map((id) => (id ? id.toString() : ""))
        .filter((id) => id && id !== String(actorId || ""))
    ),
  ];

  if (!uniqueIds.length) {
    return [];
  }

  const docs = uniqueIds.map((recipientId) => ({
    recipient: recipientId,
    actor: actorId || null,
    type,
    title,
    message,
    status,
    entityType,
    entityId,
    link,
    meta,
  }));

  const created = await AppNotification.insertMany(docs, { ordered: false });
  const createdIds = created.map((item) => item._id);

  const populated = await AppNotification.find({ _id: { $in: createdIds } })
    .populate("actor", USER_FIELDS)
    .lean();

  await Promise.all(
    populated.map((item) => emitNewNotification(item.recipient, item))
  );

  const payloadByRecipient = new Map();
  populated.forEach((item) => {
    payloadByRecipient.set(String(item.recipient), buildWebPushPayload(item));
  });

  await Promise.all(
    [...payloadByRecipient.entries()].map(([recipientId, payload]) =>
      pushService.sendPushToUsers([recipientId], payload)
    )
  );

  return populated.map(formatNotification).filter(Boolean);
};

const getMyNotifications = async (userId, query = {}) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
  const skip = (page - 1) * limit;

  const filter = { recipient: userId };

  const [records, totalRecords, unreadCount] = await Promise.all([
    AppNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("actor", USER_FIELDS)
      .lean(),
    AppNotification.countDocuments(filter),
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

const markNotificationAsRead = async (notificationId, userId) => {
  const notification = await AppNotification.findOne({
    _id: notificationId,
    recipient: userId,
  });

  if (!notification) {
    const error = new Error("Notification not found");
    error.statusCode = 404;
    throw error;
  }

  if (!notification.isRead) {
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();
    await emitUnreadCount(userId);
  }

  const populated = await AppNotification.findById(notification._id)
    .populate("actor", USER_FIELDS)
    .lean();

  return formatNotification(populated);
};

const markAllNotificationsAsRead = async (userId) => {
  const result = await AppNotification.updateMany(
    { recipient: userId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );

  await emitUnreadCount(userId);

  return {
    modifiedCount: result.modifiedCount || 0,
  };
};

const notifyExtraWorkRequested = async ({ request, employee }) => {
  const hrUsers = await User.find({
    role: { $in: ["HR", "SUPER_ADMIN"] },
    isActive: true,
  })
    .select("_id")
    .lean();

  const employeeName = employee?.name || "An employee";
  const reason = request?.requestReason || "No reason provided";

  return createNotificationsForRecipients({
    recipientIds: hrUsers.map((user) => user._id),
    actorId: request?.employee || employee?._id,
    type: "EXTRA_WORK_REQUESTED",
    title: "Extra work request",
    message: `${employeeName} requested extra work: ${reason}`,
    status: "PENDING",
    entityType: "EXTRA_WORK",
    entityId: request?._id,
    link: "/extra-work",
    meta: {
      employeeName,
      reason,
    },
  });
};

const notifyExtraWorkDecision = async ({ request, action, actorId }) => {
  const employeeId = request?.employee;
  if (!employeeId) {
    return null;
  }

  const isApproved = action === "APPROVED";

  return createNotification({
    recipientId: employeeId,
    actorId,
    type: isApproved ? "EXTRA_WORK_APPROVED" : "EXTRA_WORK_REJECTED",
    title: isApproved ? "Extra work approved" : "Extra work rejected",
    message: isApproved
      ? "Your extra work request has been approved."
      : "Your extra work request has been rejected.",
    status: isApproved ? "APPROVED" : "REJECTED",
    entityType: "EXTRA_WORK",
    entityId: request?._id,
    link: "/attendance-employee",
  });
};

const notifyLeaveRequested = async ({ leave, employee, reportingManagerId }) => {
  const recipientIds = new Set();

  if (reportingManagerId) {
    recipientIds.add(String(reportingManagerId));
  }

  const hrUsers = await User.find({
    role: { $in: ["HR", "SUPER_ADMIN"] },
    isActive: true,
  })
    .select("_id")
    .lean();

  hrUsers.forEach((user) => recipientIds.add(String(user._id)));

  const employeeName = employee?.name || "An employee";
  const reason = leave?.reason || "No reason provided";

  return createNotificationsForRecipients({
    recipientIds: [...recipientIds],
    actorId: leave?.employeeId || employee?._id,
    type: "LEAVE_REQUESTED",
    title: "Leave request",
    message: `${employeeName} requested leave: ${reason}`,
    status: "PENDING",
    entityType: "LEAVE",
    entityId: leave?._id,
    link: "/leaves",
    meta: {
      employeeName,
      reason,
      fromDate: leave?.fromDate,
      toDate: leave?.toDate,
    },
  });
};

const notifyLeaveDecision = async ({ leave, action, actorId, reason = "" }) => {
  const employeeId = leave?.employeeId;
  if (!employeeId) {
    return null;
  }

  const isApproved = action === "APPROVED";
  const rejectReason = reason?.trim();

  return createNotification({
    recipientId: employeeId,
    actorId,
    type: isApproved ? "LEAVE_APPROVED" : "LEAVE_REJECTED",
    title: isApproved ? "Leave approved" : "Leave rejected",
    message: isApproved
      ? "Your leave request has been approved."
      : rejectReason
        ? `Your leave request has been rejected. Reason: ${rejectReason}`
        : "Your leave request has been rejected.",
    status: isApproved ? "APPROVED" : "REJECTED",
    entityType: "LEAVE",
    entityId: leave?._id,
    link: "/leaves-employee",
    meta: {
      rejectReason: rejectReason || "",
      fromDate: leave?.fromDate,
      toDate: leave?.toDate,
    },
  });
};

const notifyDailyWorkReportReminder = async ({
  recipientId,
  reportDate,
  reminderDate,
}) => {
  if (!recipientId || !reportDate || !reminderDate) {
    return null;
  }

  const existingReminder = await AppNotification.findOne({
    recipient: recipientId,
    type: "DAILY_WORK_REPORT_REMINDER",
    "meta.reportDate": reportDate,
    "meta.reminderDate": reminderDate,
  })
    .select("_id")
    .lean();

  if (existingReminder?._id) {
    return null;
  }

  return createNotification({
    recipientId,
    type: "DAILY_WORK_REPORT_REMINDER",
    title: "Daily work reminder",
    message: "Please update yesterday's daily work.",
    status: "INFO",
    entityType: "DAILY_WORK_REPORT",
    link: "/daily-work-report",
    meta: {
      reportDate,
      reminderDate,
    },
  });
};

module.exports = {
  createNotification,
  createNotificationsForRecipients,
  getMyNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  notifyExtraWorkRequested,
  notifyExtraWorkDecision,
  notifyLeaveRequested,
  notifyLeaveDecision,
  notifyDailyWorkReportReminder,
  formatNotification,
};
