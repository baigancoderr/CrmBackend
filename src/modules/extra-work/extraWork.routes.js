const router = require("express").Router();

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");

const extraWorkController = require("./extraWork.controller");

const EMPLOYEE_ROLES = [
  "SUPER_ADMIN",
  "HR",
  "PROJECT_MANAGER",
  "TL",
  "EMPLOYEE",
];

const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "HR",
];

router.post(
  "/request",
  authMiddleware,
  roleMiddleware(...EMPLOYEE_ROLES),
  extraWorkController.requestExtraWork
);

router.patch(
  "/approve/:id",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  extraWorkController.approveExtraWork
);

router.post(
  "/clock-in",
  authMiddleware,
  roleMiddleware(...EMPLOYEE_ROLES),
  extraWorkController.extraClockIn
);

router.post(
  "/clock-out",
  authMiddleware,
  roleMiddleware(...EMPLOYEE_ROLES),
  extraWorkController.extraClockOut
);

router.get(
  "/my-status",
  authMiddleware,
  roleMiddleware(...EMPLOYEE_ROLES),
  extraWorkController.getMyRequestStatus
);

router.get(
  "/my-activity",
  authMiddleware,
  roleMiddleware(...EMPLOYEE_ROLES),
  extraWorkController.getMyActivity
);

router.get(
  "/all-requests",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  extraWorkController.getAllRequests
);

module.exports = router;