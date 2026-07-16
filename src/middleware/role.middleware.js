const ROLE_ALIASES = {
  PM: "PROJECT_MANAGER",
  "PROJECT MANAGER": "PROJECT_MANAGER",
  TEAM_LEADER: "TL",
  "TEAM LEADER": "TL",
};

const normalizeRole = (role) => {
  const normalized = String(role || "")
    .trim()
    .toUpperCase();

  if (!normalized) {
    return "";
  }

  return ROLE_ALIASES[normalized] || normalized;
};

const roleMiddleware = (...allowedRoles) => {
  const normalizedAllowedRoles = allowedRoles
    .map((role) => normalizeRole(role))
    .filter(Boolean);

  return (req,res,next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message:"Unauthorized",
        });
      }

      const normalizedUserRole = normalizeRole(req.user.role);
      req.user.role = normalizedUserRole;

      if (!normalizedAllowedRoles.includes(normalizedUserRole)) {
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