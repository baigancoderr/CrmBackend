const jwt = require("jsonwebtoken");
const { redisClient } = require("../config/redis");
const User = require("../modules/user/user.model");

const storageAccessAuth = async (req, res, next) => {
  try {
    const headerToken = req.headers.authorization?.split(" ")[1];
    const queryToken = typeof req.query.token === "string" ? req.query.token : "";
    const token = headerToken || queryToken;

    if (!token) {
      return res.status(401).json({ message: "Token Required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const sessionId = await redisClient.get(`session:${decoded.id}`);

    if (!sessionId || decoded.sessionId !== sessionId) {
      return res.status(401).json({ message: "Session invalidated. Please login again." });
    }

    const currentUser = await User.findById(decoded.id)
      .select("role isActive name")
      .lean();

    if (!currentUser?.isActive) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    req.user = {
      ...decoded,
      role: currentUser.role,
      name: currentUser.name,
    };

    next();
  } catch (_error) {
    return res.status(401).json({ message: "Invalid Token" });
  }
};

module.exports = storageAccessAuth;
