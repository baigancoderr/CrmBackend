// const jwt = require("jsonwebtoken");

// const authMiddleware = (req, res, next) => {
//   try {
//     const authHeader = req.headers.authorization;

//     if (!authHeader) {
//       return res.status(401).json({
//         message: "Token Required",
//       });
//     }

//     const token = authHeader.split(" ")[1];
//     const decoded = jwt.verify(token,process.env.JWT_SECRET);

//     req.user = decoded;

//     next();
//   } catch (error) {
//     return res.status(401).json({
//       message: "Invalid Token",
//     });
//   }
// };

// module.exports = authMiddleware;


const jwt = require("jsonwebtoken");
const { redisClient } = require("../config/redis");
const User = require("../modules/user/user.model");

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Token Required",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const sessionId = await redisClient.get(
      `session:${decoded.id}`
    );

    if (!sessionId) {
      return res.status(401).json({
        message: "Session invalidated. Please login again.",
      });
    }

    if (decoded.sessionId !== sessionId) {
      return res.status(401).json({
        message: "Token invalidated. Please login again.",
      });
    }

    const currentUser = await User.findById(decoded.id)
      .select("role isActive name")
      .lean();

    if (!currentUser) {
      return res.status(401).json({
        message: "User not found",
      });
    }

    if (!currentUser.isActive) {
      return res.status(401).json({
        message: "Your account is inactive. Contact administrator.",
      });
    }

    // Always use latest role from DB so role changes apply immediately.
    req.user = {
      ...decoded,
      role: currentUser.role,
      name: currentUser.name,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid Token",
    });
  }
};

module.exports = authMiddleware;