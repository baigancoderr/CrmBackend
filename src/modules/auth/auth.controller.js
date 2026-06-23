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

module.exports = {
  login,
  changePassword,
};