const router = require("express").Router();

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");

const attendanceController = require("./attendance.controller");

const ALL_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "EMPLOYEE"];
const MANAGEMENT_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];
const ADMIN_ROLES = ["SUPER_ADMIN", "HR"];

router.post("/clock-in", authMiddleware, roleMiddleware(...ALL_ROLES), attendanceController.clockIn);

router.post("/clock-out", authMiddleware, roleMiddleware(...ALL_ROLES), attendanceController.clockOut);

router.get("/today", authMiddleware, roleMiddleware(...ALL_ROLES), attendanceController.getTodayAttendance);

router.get("/my-history", authMiddleware, roleMiddleware(...ALL_ROLES), attendanceController.getMyHistory);

router.get("/my-monthly", authMiddleware, roleMiddleware(...ALL_ROLES), attendanceController.getMyMonthlyAttendance);

router.get("/dashboard", authMiddleware, roleMiddleware(...ADMIN_ROLES), attendanceController.getDashboard);

router.get("/employee/:employeeId", authMiddleware, roleMiddleware(...MANAGEMENT_ROLES), attendanceController.getEmployeeAttendance);

router.patch("/manual-update/:id", authMiddleware, roleMiddleware(...ADMIN_ROLES), attendanceController.manualUpdateAttendance);

module.exports = router;