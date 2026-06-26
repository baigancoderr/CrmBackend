const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const generateAccessToken = (user, sessionId) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      sessionId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "15m",
    }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
    },
    process.env.JWT_REFRESH_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

const createSessionId = () => crypto.randomBytes(16).toString("hex");

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  createSessionId,
};