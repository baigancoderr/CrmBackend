const authService = require("./auth.service");

const login = async (req, res) => {
  try {
    const result =
      await authService.login(req.body);

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      message: error.message,
    });
  }
};

const changePassword = async (req, res) => {
  try {
    console.log("HEADERS =>", req.headers);
    console.log("BODY =>", req.body);

    const result = await authService.changePassword(
      req.user.id,
      req.body
    );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      message: error.message,
    });
  }
};

const requestPasswordReset = async (req, res) => {
  try {
    const result = await authService.requestPasswordReset(
      req.user.id,
      req.body
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getPasswordResetRequests = async (req, res) => {
  try {
    const result = await authService.getPasswordResetRequests();

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const rejectPasswordReset = async (req, res) => {
  try {
    const result = await authService.rejectPasswordReset(
      req.params.id,
      req.user.id,
      req.body
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const resetPassword = async (req, res) => {
  try {
    const result = await authService.resetPassword(
      req.params.id,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const refreshToken = async (req, res) => {
  try {
    const result = await authService.refreshAccessToken(
      req.body.refreshToken
    );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(401).json({
      message: error.message,
    });
  }
};
const logout = async (req, res) => {
  try {
    const result = await authService.logout(req.user.id);

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  login,
  changePassword,
  resetPassword,
  requestPasswordReset,
  getPasswordResetRequests,
  rejectPasswordReset,
  refreshToken,
  logout
};