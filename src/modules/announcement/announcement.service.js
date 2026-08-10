const Announcement = require("./announcement.model");
const AnnouncementRead = require("./announcementRead.model");
const User = require("../user/user.model");
const Project = require("../project/project.model");
const { createNotificationsForRecipients } = require("../notifications/notification.service");

// Simple HTML sanitizer to strip dangerous XSS scripts & inline handlers
const sanitizeHtmlContent = (htmlString = "") => {
  if (!htmlString || typeof htmlString !== "string") {
    return "";
  }
  return htmlString
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son\w+\s*=\s*[^>\s]+/gi, "")
    .replace(/href\s*=\s*(['"])\s*javascript:[^'"]*\1/gi, 'href="#"');
};

const resolveEligibleRecipientIds = async (announcement) => {
  if (!announcement) return [];

  const { audienceType } = announcement;
  let filter = { isActive: true };

  switch (audienceType) {
    case "ALL":
      break;

    case "ROLE":
      if (!announcement.targetRoles || !announcement.targetRoles.length) return [];
      filter.role = { $in: announcement.targetRoles };
      break;

    case "INDIVIDUAL":
      if (!announcement.targetEmployees || !announcement.targetEmployees.length) return [];
      filter._id = { $in: announcement.targetEmployees };
      break;

    default:
      break;
  }

  const users = await User.find(filter).select("_id").lean();
  return users.map((u) => u._id.toString());
};

const triggerAnnouncementNotification = async (announcement, actorId) => {
  try {
    const recipientIds = await resolveEligibleRecipientIds(announcement);
    if (!recipientIds.length) return;

    await createNotificationsForRecipients({
      recipientIds,
      actorId,
      type: "ANNOUNCEMENT_PUBLISHED",
      title: `📢 ${announcement.title}`,
      message: announcement.summary || "A new announcement has been published.",
      status: "INFO",
      entityType: "ANNOUNCEMENT",
      entityId: announcement._id,
      link: `/announcements/${announcement._id}`,
      meta: {
        announcementId: announcement._id,
        type: announcement.type,
        priority: announcement.priority,
      },
    });
  } catch (error) {
    console.error("[Announcement Notification Error]:", error);
  }
};

const buildEmployeeAudienceFilter = async (user) => {
  const userId = user._id || user.id;
  const audienceConditions = [{ audienceType: "ALL" }];

  if (user.role) {
    audienceConditions.push({
      audienceType: "ROLE",
      targetRoles: user.role,
    });
  }

  audienceConditions.push({
    audienceType: "INDIVIDUAL",
    targetEmployees: userId,
  });

  return { $or: audienceConditions };
};

const createAnnouncement = async (currentUser, data) => {
  const sanitizedContent = sanitizeHtmlContent(data.content);
  const isPublishNow = Boolean(data.publishNow);
  const now = new Date();

  let status = "DRAFT";
  let publishAt = data.publishAt ? new Date(data.publishAt) : null;
  let publishedBy = null;
  let publishedAt = null;

  if (isPublishNow) {
    status = "PUBLISHED";
    publishAt = now;
    publishedBy = currentUser.id || currentUser._id;
    publishedAt = now;
  } else if (publishAt && publishAt > now) {
    status = "SCHEDULED";
  }

  const announcement = await Announcement.create({
    ...data,
    content: sanitizedContent,
    status,
    publishAt,
    publishedBy,
    publishedAt,
    createdBy: currentUser.id || currentUser._id,
  });

  if (status === "PUBLISHED") {
    await triggerAnnouncementNotification(announcement, currentUser.id || currentUser._id);
  }

  return announcement;
};

const updateAnnouncement = async (id, currentUser, data) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false });
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  if (currentUser.role === "PROJECT_MANAGER" || currentUser.role === "TL") {
    if (announcement.audienceType !== "ROLE" && announcement.audienceType !== "INDIVIDUAL") {
      const error = new Error("Only role or individual announcements can be updated by this role");
      error.statusCode = 403;
      throw error;
    }
  }

  if (data.content) {
    data.content = sanitizeHtmlContent(data.content);
  }

  const wasPublished = announcement.status === "PUBLISHED";

  Object.assign(announcement, data);

  if (data.publishNow && announcement.status !== "PUBLISHED") {
    announcement.status = "PUBLISHED";
    announcement.publishAt = new Date();
    announcement.publishedBy = currentUser.id || currentUser._id;
    announcement.publishedAt = new Date();
  }

  await announcement.save();

  if (!wasPublished && announcement.status === "PUBLISHED") {
    await triggerAnnouncementNotification(announcement, currentUser.id || currentUser._id);
  }

  return announcement;
};

const publishAnnouncement = async (id, currentUser) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false });
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  if (announcement.status === "PUBLISHED") {
    const error = new Error("Announcement is already published");
    error.statusCode = 400;
    throw error;
  }

  if (announcement.status === "EXPIRED" || announcement.status === "ARCHIVED") {
    const error = new Error(`Cannot publish announcement from status ${announcement.status}`);
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();
  announcement.status = "PUBLISHED";
  announcement.publishedBy = currentUser.id || currentUser._id;
  announcement.publishedAt = now;
  announcement.publishAt = announcement.publishAt || now;

  await announcement.save();

  await triggerAnnouncementNotification(announcement, currentUser.id || currentUser._id);

  return announcement;
};

const archiveAnnouncement = async (id, currentUser) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false });
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  announcement.status = "ARCHIVED";
  await announcement.save();

  return announcement;
};

const softDeleteAnnouncement = async (id, currentUser) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false });
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  announcement.isDeleted = true;
  announcement.deletedAt = new Date();
  announcement.deletedBy = currentUser.id || currentUser._id;

  await announcement.save();

  return { message: "Announcement deleted successfully" };
};

const duplicateAnnouncement = async (id, currentUser) => {
  const original = await Announcement.findOne({ _id: id, isDeleted: false }).lean();
  if (!original) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  delete original._id;
  delete original.createdAt;
  delete original.updatedAt;
  delete original.publishedAt;
  delete original.publishedBy;
  delete original.deletedAt;
  delete original.deletedBy;

  original.title = `Copy of ${original.title}`.substring(0, 200);
  original.status = "DRAFT";
  original.publishAt = null;
  original.createdBy = currentUser.id || currentUser._id;

  const copy = await Announcement.create(original);
  return copy;
};

const getAdminAnnouncements = async (currentUser, query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const filter = { isDeleted: query.includeDeleted === "true" ? { $in: [true, false] } : false };

  if (query.search) {
    filter.$or = [
      { title: { $regex: query.search, $options: "i" } },
      { summary: { $regex: query.search, $options: "i" } },
    ];
  }

  if (query.type) filter.type = query.type;
  if (query.priority) filter.priority = query.priority;
  if (query.status) filter.status = query.status;
  if (query.audienceType) filter.audienceType = query.audienceType;

  // Project Managers and TLs can only see announcements they created or ones targeting their role
  if (currentUser.role === "PROJECT_MANAGER" || currentUser.role === "TL") {
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [{ createdBy: currentUser.id }],
    });
  }

  const [records, totalRecords, statsAggregate] = await Promise.all([
    Announcement.find(filter)
      .sort({ isPinned: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "name employeeId role profilePhoto")
      .populate("publishedBy", "name employeeId role")
      .lean(),
    Announcement.countDocuments(filter),
    Announcement.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const stats = {
    TOTAL: 0,
    PUBLISHED: 0,
    SCHEDULED: 0,
    DRAFT: 0,
    EXPIRED: 0,
    ARCHIVED: 0,
  };

  statsAggregate.forEach((item) => {
    if (stats[item._id] !== undefined) {
      stats[item._id] = item.count;
      stats.TOTAL += item.count;
    }
  });

  return {
    data: records,
    pagination: {
      page,
      limit,
      total: totalRecords,
      totalPages: Math.ceil(totalRecords / limit) || 1,
    },
    stats,
  };
};

const getEmployeeAnnouncements = async (user, query) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 50);
  const skip = (page - 1) * limit;

  const now = new Date();
  const audienceFilter = await buildEmployeeAudienceFilter(user);

  const filter = {
    isDeleted: false,
    status: "PUBLISHED",
    $and: [
      audienceFilter,
      {
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
    ],
  };

  if (query.search) {
    filter.$and.push({
      $or: [
        { title: { $regex: query.search, $options: "i" } },
        { summary: { $regex: query.search, $options: "i" } },
      ],
    });
  }

  if (query.type) filter.type = query.type;
  if (query.priority) filter.priority = query.priority;

  const [announcements, totalRecords] = await Promise.all([
    Announcement.find(filter)
      .sort({ isPinned: -1, publishedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "name employeeId role profilePhoto")
      .lean(),
    Announcement.countDocuments(filter),
  ]);

  const announcementIds = announcements.map((a) => a._id);
  const userId = user._id || user.id;

  const readRecords = await AnnouncementRead.find({
    announcementId: { $in: announcementIds },
    employeeId: userId,
  }).lean();

  const readMap = new Map();
  readRecords.forEach((r) => {
    readMap.set(r.announcementId.toString(), r);
  });

  const enrichedData = announcements.map((a) => {
    const readInfo = readMap.get(a._id.toString());
    return {
      ...a,
      isRead: Boolean(readInfo?.readAt),
      readAt: readInfo?.readAt || null,
      isAcknowledged: Boolean(readInfo?.acknowledged),
      acknowledgedAt: readInfo?.acknowledgedAt || null,
      acknowledgeResponse: readInfo?.acknowledgeResponse || null,
    };
  });

  // Handle unread filter in memory if explicitly passed
  let filteredData = enrichedData;
  if (query.unreadOnly === "true") {
    filteredData = enrichedData.filter((item) => !item.isRead);
  }

  return {
    data: filteredData,
    pagination: {
      page,
      limit,
      total: totalRecords,
      totalPages: Math.ceil(totalRecords / limit) || 1,
    },
  };
};

const getUnreadAnnouncementsCount = async (user) => {
  const now = new Date();
  const audienceFilter = await buildEmployeeAudienceFilter(user);
  const userId = user._id || user.id;

  const filter = {
    isDeleted: false,
    status: "PUBLISHED",
    $and: [
      audienceFilter,
      {
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
    ],
  };

  const eligibleAnnouncements = await Announcement.find(filter).select("_id").lean();
  const announcementIds = eligibleAnnouncements.map((a) => a._id);

  if (!announcementIds.length) {
    return { unreadCount: 0 };
  }

  const readCount = await AnnouncementRead.countDocuments({
    announcementId: { $in: announcementIds },
    employeeId: userId,
  });

  return {
    unreadCount: Math.max(announcementIds.length - readCount, 0),
  };
};

const getAnnouncementById = async (id, user) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false })
    .populate("createdBy", "name employeeId role profilePhoto department designation")
    .populate("publishedBy", "name employeeId role")
    .lean();

  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  const userId = user._id || user.id;

  // Auto mark read if user is logged in employee
  let readInfo = await AnnouncementRead.findOne({
    announcementId: id,
    employeeId: userId,
  }).lean();

  if (!readInfo && announcement.status === "PUBLISHED") {
    readInfo = await AnnouncementRead.create({
      announcementId: id,
      employeeId: userId,
      readAt: new Date(),
    });
  }

  return {
    ...announcement,
    isRead: true,
    readAt: readInfo?.readAt || new Date(),
    isAcknowledged: Boolean(readInfo?.acknowledged),
    acknowledgedAt: readInfo?.acknowledgedAt || null,
    acknowledgeResponse: readInfo?.acknowledgeResponse || null,
  };
};

const markAsRead = async (id, userId) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false });
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  const readRecord = await AnnouncementRead.findOneAndUpdate(
    { announcementId: id, employeeId: userId },
    { $setOnInsert: { readAt: new Date() } },
    { upsert: true, new: true }
  );

  return readRecord;
};

// response: "YES" | "NO"  (employee's explicit Yes/No answer)
const acknowledgeAnnouncement = async (id, userId, response) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false });
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  if (!announcement.requiresAcknowledgement) {
    const error = new Error("This announcement does not require acknowledgement");
    error.statusCode = 400;
    throw error;
  }

  if (announcement.status !== "PUBLISHED") {
    const error = new Error("Only published announcements can be acknowledged");
    error.statusCode = 400;
    throw error;
  }

  if (announcement.expiresAt && announcement.expiresAt <= new Date()) {
    const error = new Error("Cannot acknowledge an expired announcement");
    error.statusCode = 400;
    throw error;
  }

  // Validate that response is YES or NO
  const normalizedResponse = (response || "").toString().toUpperCase();
  if (normalizedResponse !== "YES" && normalizedResponse !== "NO") {
    const error = new Error("Acknowledgement response must be YES or NO");
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();
  const existingRecord = await AnnouncementRead.findOne({ announcementId: id, employeeId: userId });

  if (existingRecord) {
    // Response already submitted — do not allow changes
    if (existingRecord.acknowledged) {
      const error = new Error("You have already submitted your response for this announcement");
      error.statusCode = 400;
      throw error;
    }
    // First time responding (record exists but not yet acknowledged)
    existingRecord.acknowledged = true;
    existingRecord.acknowledgedAt = now;
    existingRecord.acknowledgeResponse = normalizedResponse;
    await existingRecord.save();
    return existingRecord;
  }

  const readRecord = await AnnouncementRead.create({
    announcementId: id,
    employeeId: userId,
    readAt: now,
    acknowledged: true,
    acknowledgedAt: now,
    acknowledgeResponse: normalizedResponse,
  });

  return readRecord;
};

const getAnnouncementAnalytics = async (id, currentUser) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false }).lean();
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  const recipientIds = await resolveEligibleRecipientIds(announcement);
  const totalRecipients = recipientIds.length;

  const readRecords = await AnnouncementRead.find({
    announcementId: id,
    employeeId: { $in: recipientIds },
  }).lean();

  const totalRead = readRecords.length;
  const totalUnread = Math.max(totalRecipients - totalRead, 0);
  const totalAcknowledged = readRecords.filter((r) => r.acknowledged).length;
  const totalAcknowledgedYes = readRecords.filter((r) => r.acknowledgeResponse === "YES").length;
  const totalAcknowledgedNo = readRecords.filter((r) => r.acknowledgeResponse === "NO").length;
  const totalPendingAcknowledgement = announcement.requiresAcknowledgement
    ? Math.max(totalRecipients - totalAcknowledged, 0)
    : 0;

  const readPercentage = totalRecipients > 0 ? Math.round((totalRead / totalRecipients) * 100) : 0;
  const acknowledgementPercentage =
    totalRecipients > 0 ? Math.round((totalAcknowledged / totalRecipients) * 100) : 0;

  return {
    announcementId: id,
    title: announcement.title,
    requiresAcknowledgement: announcement.requiresAcknowledgement,
    totalRecipients,
    totalRead,
    totalUnread,
    totalAcknowledged,
    totalAcknowledgedYes,
    totalAcknowledgedNo,
    totalPendingAcknowledgement,
    readPercentage,
    acknowledgementPercentage,
  };
};

const getAnnouncementReaders = async (id, query, currentUser) => {
  const announcement = await Announcement.findOne({ _id: id, isDeleted: false }).lean();
  if (!announcement) {
    const error = new Error("Announcement not found");
    error.statusCode = 404;
    throw error;
  }

  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const skip = (page - 1) * limit;

  const recipientIds = await resolveEligibleRecipientIds(announcement);

  const [recipients, totalRecipients] = await Promise.all([
    User.find({ _id: { $in: recipientIds } })
      .select("name employeeId role department profilePhoto")
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments({ _id: { $in: recipientIds } }),
  ]);

  const pagedUserIds = recipients.map((r) => r._id);
  const readRecords = await AnnouncementRead.find({
    announcementId: id,
    employeeId: { $in: pagedUserIds },
  }).lean();

  const readMap = new Map();
  readRecords.forEach((r) => {
    readMap.set(r.employeeId.toString(), r);
  });

  const readerData = recipients.map((emp) => {
    const readInfo = readMap.get(emp._id.toString());
    return {
      employee: emp,
      isRead: Boolean(readInfo?.readAt),
      readAt: readInfo?.readAt || null,
      isAcknowledged: Boolean(readInfo?.acknowledged),
      acknowledgedAt: readInfo?.acknowledgedAt || null,
      acknowledgeResponse: readInfo?.acknowledgeResponse || null,
    };
  });

  return {
    data: readerData,
    pagination: {
      page,
      limit,
      total: totalRecipients,
      totalPages: Math.ceil(totalRecipients / limit) || 1,
    },
  };
};

module.exports = {
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
  softDeleteAnnouncement,
  duplicateAnnouncement,
  getAdminAnnouncements,
  getEmployeeAnnouncements,
  getUnreadAnnouncementsCount,
  getAnnouncementById,
  markAsRead,
  acknowledgeAnnouncement,
  getAnnouncementAnalytics,
  getAnnouncementReaders,
  resolveEligibleRecipientIds,
  triggerAnnouncementNotification,
};
