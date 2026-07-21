const express = require("express");
const router = express.Router();

const authMiddleware = require("../../middleware/auth.middleware");
const notificationController = require("./notification.controller");

router.use(authMiddleware);

router.get("/", notificationController.getMyNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.patch("/read-all", notificationController.markAllNotificationsAsRead);
router.patch(
  "/:notificationId/read",
  notificationController.markNotificationAsRead
);

module.exports = router;
