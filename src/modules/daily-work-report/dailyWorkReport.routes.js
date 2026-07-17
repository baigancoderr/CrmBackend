const express = require("express");

const router = express.Router();

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const dailyWorkReportController = require("./dailyWorkReport.controller");

const SUBMITTER_ROLES = ["EMPLOYEE", "HR", "TL", "PROJECT_MANAGER"];
const REVIEWER_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];

router.get(
  "/prefill",
  authMiddleware,
  roleMiddleware(...SUBMITTER_ROLES),
  dailyWorkReportController.getPrefillDetails
);

router.post(
  "/submit",
  authMiddleware,
  roleMiddleware(...SUBMITTER_ROLES),
  dailyWorkReportController.submitReport
);

router.patch(
  "/update/:id",
  authMiddleware,
  roleMiddleware(...SUBMITTER_ROLES),
  dailyWorkReportController.updateMyReport
);

router.get(
  "/my",
  authMiddleware,
  roleMiddleware(...SUBMITTER_ROLES),
  dailyWorkReportController.getMyReports
);

router.get(
  "/all",
  authMiddleware,
  roleMiddleware(...REVIEWER_ROLES),
  dailyWorkReportController.getAllReports
);

router.patch(
  "/review/:id",
  authMiddleware,
  roleMiddleware(...REVIEWER_ROLES),
  dailyWorkReportController.reviewReport
);

module.exports = router;
