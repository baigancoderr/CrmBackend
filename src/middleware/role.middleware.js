const roleMiddleware = (...allowedRoles) => {
  return (req,res,next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message:"Unauthorized",
        });
      }

      if (!allowedRoles.includes(
          req.user.role
        )
      ) {
        return res.status(403).json({
          success: false,
          message:"Access Denied",
        });
      }

      next();
    } catch (error) {
      return res.status(500).json({
        success: false,
        message:error.message,
      });
    }
  };
};

module.exports =roleMiddleware;