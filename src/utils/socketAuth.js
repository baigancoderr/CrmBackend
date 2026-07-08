const jwt = require("jsonwebtoken");
const { redisClient } = require("../config/redis");
const User = require("../modules/user/user.model");

const authenticateSocket = async (token) => {
  if (!token) {
    throw new Error("Token Required");
  }

  const decoded = jwt.verify(
    token,
    process.env.JWT_SECRET
  );

  const sessionId = await redisClient.get(
    `session:${decoded.id}`
  );

  if (!sessionId || decoded.sessionId !== sessionId) {
    throw new Error("Session invalidated. Please login again.");
  }

  const currentUser = await User.findById(decoded.id)
    .select("role isActive name profilePhoto")
    .lean();

  if (!currentUser) {
    throw new Error("User not found");
  }

  if (!currentUser.isActive) {
    throw new Error("Your account is inactive. Contact administrator.");
  }

  return {
    id: decoded.id,
    role: currentUser.role,
    name: currentUser.name,
    profilePhoto: currentUser.profilePhoto,
    sessionId: decoded.sessionId,
  };
};

module.exports = {
  authenticateSocket,
};
