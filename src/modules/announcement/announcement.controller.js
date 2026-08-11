const sendResponse = require("../../utils/response");
const announcementService = require("./announcement.service");

const createAnnouncement = async (req, res, next) => {
  try {
    const announcement = await announcementService.createAnnouncement(req.user, req.body);
    return sendResponse(res, 201, true, "Announcement created successfully", announcement);
  } catch (error) {
    next(error);
  }
};

const updateAnnouncement = async (req, res, next) => {
  try {
    const announcement = await announcementService.updateAnnouncement(
      req.params.id,
      req.user,
      req.body
    );
    return sendResponse(res, 200, true, "Announcement updated successfully", announcement);
  } catch (error) {
    next(error);
  }
};

const publishAnnouncement = async (req, res, next) => {
  try {
    const announcement = await announcementService.publishAnnouncement(
      req.params.id,
      req.user
    );
    return sendResponse(res, 200, true, "Announcement published successfully", announcement);
  } catch (error) {
    next(error);
  }
};

const archiveAnnouncement = async (req, res, next) => {
  try {
    const announcement = await announcementService.archiveAnnouncement(
      req.params.id,
      req.user
    );
    return sendResponse(res, 200, true, "Announcement archived successfully", announcement);
  } catch (error) {
    next(error);
  }
};

const deleteAnnouncement = async (req, res, next) => {
  try {
    const result = await announcementService.softDeleteAnnouncement(
      req.params.id,
      req.user
    );
    return sendResponse(res, 200, true, result.message);
  } catch (error) {
    next(error);
  }
};

const duplicateAnnouncement = async (req, res, next) => {
  try {
    const announcement = await announcementService.duplicateAnnouncement(
      req.params.id,
      req.user
    );
    return sendResponse(res, 201, true, "Announcement duplicated successfully", announcement);
  } catch (error) {
    next(error);
  }
};

const getAdminAnnouncements = async (req, res, next) => {
  try {
    const result = await announcementService.getAdminAnnouncements(req.user, req.query);
    return sendResponse(res, 200, true, "Announcements retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

const getEmployeeAnnouncements = async (req, res, next) => {
  try {
    const result = await announcementService.getEmployeeAnnouncements(req.user, req.query);
    return sendResponse(res, 200, true, "My announcements retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

const getUnreadAnnouncementsCount = async (req, res, next) => {
  try {
    const result = await announcementService.getUnreadAnnouncementsCount(req.user);
    return sendResponse(res, 200, true, "Unread count retrieved", result);
  } catch (error) {
    next(error);
  }
};

const getAnnouncementById = async (req, res, next) => {
  try {
    const announcement = await announcementService.getAnnouncementById(
      req.params.id,
      req.user
    );
    return sendResponse(res, 200, true, "Announcement details retrieved", announcement);
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const result = await announcementService.markAsRead(req.params.id, userId);
    return sendResponse(res, 200, true, "Announcement marked as read", result);
  } catch (error) {
    next(error);
  }
};

const acknowledgeAnnouncement = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user._id;
    const response = (req.body?.response || "").toString().toUpperCase();
    const result = await announcementService.acknowledgeAnnouncement(
      req.params.id,
      userId,
      response
    );
    const message =
      response === "YES"
        ? "Announcement acknowledged as Yes"
        : response === "NO"
        ? "Announcement acknowledged as No"
        : "Acknowledgement recorded";
    return sendResponse(res, 200, true, message, result);
  } catch (error) {
    next(error);
  }
};

const getAnnouncementAnalytics = async (req, res, next) => {
  try {
    const analytics = await announcementService.getAnnouncementAnalytics(
      req.params.id,
      req.user
    );
    return sendResponse(res, 200, true, "Analytics retrieved successfully", analytics);
  } catch (error) {
    next(error);
  }
};

const getAnnouncementReaders = async (req, res, next) => {
  try {
    const result = await announcementService.getAnnouncementReaders(
      req.params.id,
      req.query,
      req.user
    );
    return sendResponse(res, 200, true, "Readers list retrieved successfully", result);
  } catch (error) {
    next(error);
  }
};

const uploadAttachments = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return sendResponse(res, 400, false, "No files uploaded");
    }

    const attachments = req.files.map((file) => {
      let fileType = "document";
      if (file.mimetype.startsWith("image/")) {
        fileType = "image";
      } else if (file.mimetype.startsWith("video/")) {
        fileType = "video";
      } else if (file.mimetype.includes("pdf")) {
        fileType = "pdf";
      } else if (file.mimetype.includes("excel") || file.mimetype.includes("sheet")) {
        fileType = "spreadsheet";
      }

      return {
        name: file.originalname,
        url: `/uploads/announcements/${file.filename}`,
        type: fileType,
        size: file.size,
      };
    });

    return sendResponse(res, 200, true, "Files uploaded successfully", { attachments });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAnnouncement,
  updateAnnouncement,
  publishAnnouncement,
  archiveAnnouncement,
  deleteAnnouncement,
  duplicateAnnouncement,
  getAdminAnnouncements,
  getEmployeeAnnouncements,
  getUnreadAnnouncementsCount,
  getAnnouncementById,
  markAsRead,
  acknowledgeAnnouncement,
  getAnnouncementAnalytics,
  getAnnouncementReaders,
  uploadAttachments,
};
