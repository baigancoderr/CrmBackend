const leaveService = require("./leave.service");

const applyLeave = async (req, res) => {
  try {
    const leave = await leaveService.createLeave(
      req.body,
      req.user.id
    );

    return res.status(201).json({
      success: true,
      message: "Leave applied successfully.",
      data: leave,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyLeaves = async (req, res) => {
  try {
    const leaves = await leaveService.getMyLeaves(
      req.user.id,
      req.query
    );

    return res.status(200).json({
      success: true,
      data: leaves,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getLeaveById = async (req, res) => {
  try {
    const leave = await leaveService.getLeaveById(
      req.params.id,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      data: leave,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllLeaves = async (req, res) => {
  try {
    const leaves = await leaveService.getAllLeaves(
      req.query,
      req.user
    );

    return res.status(200).json({
      success: true,
      data: leaves,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const approveLeave = async (req, res) => {
  try {
    const leave = await leaveService.approveLeave(
      req.params.id,
      req.user
    );

    return res.status(200).json({
      success: true,
      message: "Leave approved successfully.",
      data: leave,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const rejectLeave = async (req, res) => {
  try {
    const leave = await leaveService.rejectLeave(
      req.params.id,
      req.body.reason,
      req.user
    );

    return res.status(200).json({
      success: true,
      message: "Leave rejected successfully.",
      data: leave,
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const cancelLeave = async (req, res) => {
  try {
    const result = await leaveService.cancelLeave(
      req.params.id,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const allocateLeaves = async (req, res) => {
  try {
    const balance =
      await leaveService.allocateLeaveBalance(
        req.params.employeeId,
        req.body.allocatedLeaves,
        req.body.extraLeaves,
        req.body.usedLeaves,
        req.user
      );

    return res.status(200).json({
      success: true,
      message:
        "Leave balance updated successfully.",
      data: balance,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getLeaveBalance = async (req, res) => {
  try {
    const balance =
      await leaveService.getLeaveBalance(
        req.params.employeeId,
        req.user
      );

    return res.status(200).json({
      success: true,
      data: balance,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const completeLeave = async (req, res) => {
  try {
    const result =
      await leaveService.completeLeave();

    return res.status(200).json({
      success: true,
      message: "Leave status updated.",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  applyLeave,
  getMyLeaves,
  getLeaveById,
  getAllLeaves,
  approveLeave,
  rejectLeave,
  cancelLeave,
  allocateLeaves,
  getLeaveBalance,
  completeLeave,
};