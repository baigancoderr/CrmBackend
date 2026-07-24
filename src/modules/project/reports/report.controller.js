const reportService = require("./report.service");
const dashboardService = require("./dashboard.service");

const getProjectReport = async (req, res) => {
  try {
    const report = await reportService.getProjectReport(req.params.id, req.user);
    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const generateProjectReport = async (req, res) => {
  try {
    const report = await reportService.generateProjectReportSnapshot(req.params.id, req.user, req.body);
    return res.status(201).json({ success: true, message: "Report generated successfully.", data: report });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getEmployeeReport = async (req, res) => {
  try {
    const report = await reportService.getEmployeeReport(req.user, req.query);
    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getTeamLeadReport = async (req, res) => {
  try {
    const report = await reportService.getTeamLeadReport(req.user, req.query);
    return res.status(200).json({ success: true, data: report });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getPMDashboard = async (req, res) => {
  try {
    const dashboard = await dashboardService.getPMDashboard(req.user);
    return res.status(200).json({ success: true, data: dashboard });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getTLDashboard = async (req, res) => {
  try {
    const dashboard = await dashboardService.getTLDashboard(req.user);
    return res.status(200).json({ success: true, data: dashboard });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getEmployeeDashboard = async (req, res) => {
  try {
    const dashboard = await dashboardService.getEmployeeDashboard(req.user);
    return res.status(200).json({ success: true, data: dashboard });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getProjectReport,
  generateProjectReport,
  getEmployeeReport,
  getTeamLeadReport,
  getPMDashboard,
  getTLDashboard,
  getEmployeeDashboard,
};
