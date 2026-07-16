const extraWorkService = require("./extraWork.service");

const requestExtraWork = async (req, res) => {
  try {
    const result = await extraWorkService.requestExtraWork(
      req.user.id,
      req.body.reason
    );

    return res.status(201).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

const approveExtraWork = async (req, res) => {
  try {
    const result = await extraWorkService.approveExtraWork(
      req.params.id,
      req.user.id,
      req.body.action
    );

    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

const extraClockIn = async (req, res) => {
  try {
    const result = await extraWorkService.extraClockIn(
      req.user.id
    );

    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

const extraClockOut = async (req, res) => {
  try {
    const result = await extraWorkService.extraClockOut(
      req.user.id
    );

    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyRequestStatus = async (req, res) => {
  try {
    const result = await extraWorkService.getMyRequestStatus(
      req.user.id
    );

    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyActivity = async (req, res) => {
  try {
    const result = await extraWorkService.getMyActivity(
      req.user.id
    );

    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllRequests = async (req, res) => {
  try {
    const result = await extraWorkService.getAllRequests(
      req.query.page,
      req.query.limit,
      req.query.status
    );

    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 400;
    return res.status(statusCode).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  requestExtraWork,
  approveExtraWork,
  extraClockIn,
  extraClockOut,
  getMyRequestStatus,
  getMyActivity,
  getAllRequests,
};