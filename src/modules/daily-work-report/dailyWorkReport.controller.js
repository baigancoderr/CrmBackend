const dailyWorkReportService = require("./dailyWorkReport.service");

const getPrefillDetails = async (req, res) => {
  try {
    const data = await dailyWorkReportService.getMyPrefillDetails(req.user.id);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const submitReport = async (req, res) => {
  try {
    const data = await dailyWorkReportService.submitDailyWorkReport(req.user.id, req.body);

    return res.status(201).json({
      success: true,
      message: "Daily work report submitted successfully.",
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const updateMyReport = async (req, res) => {
  try {
    const data = await dailyWorkReportService.updateMyDailyWorkReport(
      req.user.id,
      req.params.id,
      req.body
    );

    return res.status(200).json({
      success: true,
      message: "Daily work report updated successfully.",
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyReports = async (req, res) => {
  try {
    const data = await dailyWorkReportService.getMyDailyWorkReports(req.user.id, req.query);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllReports = async (req, res) => {
  try {
    const data = await dailyWorkReportService.getAllDailyWorkReports(
      req.query,
      req.user
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const getReportStats = async (req, res) => {
  try {
    const data = await dailyWorkReportService.getDailyWorkReportStats(
      req.query,
      req.user
    );

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const reviewReport = async (req, res) => {
  try {
    const data = await dailyWorkReportService.reviewDailyWorkReport(
      req.params.id,
      req.user,
      req.body
    );

    return res.status(200).json({
      success: true,
      message: "Daily work report reviewed successfully.",
      data,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getPrefillDetails,
  submitReport,
  updateMyReport,
  getMyReports,
  getAllReports,
  getReportStats,
  reviewReport,
};
