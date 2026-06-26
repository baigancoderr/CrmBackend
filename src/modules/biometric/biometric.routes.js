const router = require("express").Router();

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const biometricController = require("./biometric.controller");

const ADMIN_ROLES = ["SUPER_ADMIN", "HR"];
const ALL_ROLES = [
  "SUPER_ADMIN",
  "HR",
  "PROJECT_MANAGER",
  "TL",
  "EMPLOYEE",
];
const MANAGEMENT_ROLES = [
  "SUPER_ADMIN",
  "HR",
  "PROJECT_MANAGER",
  "TL",
];

router.get(
  "/in-out-data",
  authMiddleware,
  roleMiddleware(...MANAGEMENT_ROLES),
  biometricController.getInOutData
);

router.get(
  "/my-in-out-data",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  biometricController.getMyInOutData
);

router.post(
  "/sync",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  biometricController.syncPunches
);

router.get(
  "/sync-status",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  biometricController.getSyncStatus
);

module.exports = router;
