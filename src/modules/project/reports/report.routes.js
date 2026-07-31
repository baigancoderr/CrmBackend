const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const {
  getProjectReport,
  generateProjectReport,
  getEmployeeReport,
  getMyOverallReport,
  getTeamLeadReport,
  getPMDashboard,
  getTLDashboard,
  getEmployeeDashboard,
  getEmployeesWorkStatus,
} = require("./report.controller");

const router = express.Router({ mergeParams: true });

// Dashboard routes
router.get("/dashboard/pm", authMiddleware, getPMDashboard);
router.get("/dashboard/tl", authMiddleware, getTLDashboard);
router.get("/dashboard/employee", authMiddleware, getEmployeeDashboard);
router.get("/employees-status", authMiddleware, getEmployeesWorkStatus);

// Report routes
router.get("/reports/employee", authMiddleware, getEmployeeReport);
router.get("/reports/my-overall", authMiddleware, getMyOverallReport);
router.get("/reports/team-lead", authMiddleware, getTeamLeadReport);
router.get("/:id/report", authMiddleware, getProjectReport);
router.post("/:id/report/generate", authMiddleware, generateProjectReport);

module.exports = router;
