const express = require("express");

const router = express.Router();

const leaveController = require("./leave.controller");

const auth = require("../../middleware/auth.middleware");

// Employee
router.post("/apply",auth,leaveController.applyLeave);



router.patch("/cancel/:id",auth,leaveController.cancelLeave);

// HR / Manager / Super Admin
router.get("/",auth,leaveController.getAllLeaves);

router.patch("/approve/:id",auth,leaveController.approveLeave);

router.patch("/reject/:id",auth,leaveController.rejectLeave);

// Leave Balance
router.get("/balance/:employeeId",auth,leaveController.getLeaveBalance);

router.patch("/balance/:employeeId",auth,leaveController.allocateLeaves);

router.get("/my",auth,leaveController.getMyLeaves);

router.get("/:id",auth,leaveController.getLeaveById);

router.patch("/complete",auth,leaveController.completeLeave);

module.exports = router;