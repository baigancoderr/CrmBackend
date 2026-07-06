const express = require("express");

const router = express.Router();

const leaveController = require("./leave.controller");

const auth = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");

const ADMIN_ROLES = ["SUPER_ADMIN", "HR"];
const APPROVER_ROLES = [
  "SUPER_ADMIN",
  "HR",
  "PROJECT_MANAGER",
];

// Employee
router.post("/apply",auth,leaveController.applyLeave);



router.patch("/cancel/:id",auth,leaveController.cancelLeave);

// HR / Project Manager / Super Admin
router.get(
  "/",
  auth,
  roleMiddleware(...APPROVER_ROLES),
  leaveController.getAllLeaves
);

router.patch(
  "/approve/:id",
  auth,
  roleMiddleware(...APPROVER_ROLES),
  leaveController.approveLeave
);

router.patch(
  "/reject/:id",
  auth,
  roleMiddleware(...APPROVER_ROLES),
  leaveController.rejectLeave
);

// Leave Balance
router.get("/balance/:employeeId",auth,leaveController.getLeaveBalance);

router.patch(
  "/balance/:employeeId",
  auth,
  roleMiddleware(...ADMIN_ROLES),
  leaveController.allocateLeaves
);

router.get("/my",auth,leaveController.getMyLeaves);

router.get("/:id",auth,leaveController.getLeaveById);

router.patch(
  "/complete",
  auth,
  roleMiddleware(...ADMIN_ROLES),
  leaveController.completeLeave
);

module.exports = router;