const router = require("express").Router();
const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const validateMiddleware = require("../../middleware/validate.middleware");
const announcementUpload = require("../../middleware/announcementUpload.middleware");
const controller = require("./announcement.controller");
const {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  queryAnnouncementsSchema,
} = require("./announcement.validation");

router.use(authMiddleware);

// Employee feeds & actions (Must be declared before /:id)
router.get("/my", controller.getEmployeeAnnouncements);
router.get("/my/unread", controller.getUnreadAnnouncementsCount);

// Admin / Management endpoints
router.post(
  "/",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  validateMiddleware(createAnnouncementSchema),
  controller.createAnnouncement
);

router.get(
  "/",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  validateMiddleware(queryAnnouncementsSchema, "query"),
  controller.getAdminAnnouncements
);

router.post(
  "/upload",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  announcementUpload.array("files", 5),
  controller.uploadAttachments
);

router.patch(
  "/:id",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  validateMiddleware(updateAnnouncementSchema),
  controller.updateAnnouncement
);

router.delete(
  "/:id",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  controller.deleteAnnouncement
);

router.post(
  "/:id/publish",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  controller.publishAnnouncement
);

router.post(
  "/:id/archive",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  controller.archiveAnnouncement
);

router.post(
  "/:id/duplicate",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  controller.duplicateAnnouncement
);

router.get(
  "/:id/analytics",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  controller.getAnnouncementAnalytics
);

router.get(
  "/:id/readers",
  roleMiddleware("SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"),
  controller.getAnnouncementReaders
);

// Individual announcement detail & actions
router.get("/:id", controller.getAnnouncementById);
router.post("/:id/read", controller.markAsRead);
router.post("/:id/acknowledge", controller.acknowledgeAnnouncement);

module.exports = router;
