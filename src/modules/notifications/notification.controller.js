const notificationService = require("./notification.service");

const getMyNotifications = async (req, res) => {
  try {
    const data = await notificationService.getMyNotifications(
      req.user.id,
      req.query
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to load notifications",
    });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await notificationService.getUnreadCount(req.user.id);

    return res.status(200).json({
      success: true,
      data: { unreadCount },
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to load unread count",
    });
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const data = await notificationService.markNotificationAsRead(
      req.params.notificationId,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to mark notification as read",
    });
  }
};

const markAllNotificationsAsRead = async (req, res) => {
  try {
    const data = await notificationService.markAllNotificationsAsRead(
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read",
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to mark notifications as read",
    });
  }
};

module.exports = {
  getMyNotifications,
  getUnreadCount,
  markNotificationAsRead,
  markAllNotificationsAsRead,
};
