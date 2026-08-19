const ROLE_ALIASES = {
  PM: "PROJECT_MANAGER",
  "PROJECT MANAGER": "PROJECT_MANAGER",
  MANAGER: "PROJECT_MANAGER",
  TEAM_LEADER: "TL",
  "TEAM LEADER": "TL",
  ADMIN: "SUPER_ADMIN",
  "SUPER ADMIN": "SUPER_ADMIN",
};

const normalizeRole = (role) => {
  const normalized = String(role || "")
    .trim()
    .toUpperCase();
  if (!normalized) return "";
  return ROLE_ALIASES[normalized] || normalized;
};

const MANAGER_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER"];
const WORKFORCE_VIEW_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];

const isManagerRole = (role) => MANAGER_ROLES.includes(normalizeRole(role));
const isTeamLeadRole = (role) => isManagerRole(role) || normalizeRole(role) === "TL";
const canViewWorkforceStatus = (role) => WORKFORCE_VIEW_ROLES.includes(normalizeRole(role));

module.exports = {
  normalizeRole,
  isManagerRole,
  isTeamLeadRole,
  canViewWorkforceStatus,
  MANAGER_ROLES,
  WORKFORCE_VIEW_ROLES,
};
