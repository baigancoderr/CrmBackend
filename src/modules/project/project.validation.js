const { PROJECT_STATUSES, PROJECT_PRIORITIES } = require("./project.constants");

const validateCreateProject = (req, res, next) => {
  const { projectName, projectCode, teamMembers, includeWeekends } = req.body;

  if (!projectName || typeof projectName !== "string" || !projectName.trim()) {
    return res.status(422).json({ success: false, message: "Project name is required." });
  }

  if (projectCode && (typeof projectCode !== "string" || !/^[A-Z0-9_-]+$/i.test(projectCode))) {
    return res.status(422).json({ success: false, message: "Invalid project code format." });
  }

  if (teamMembers !== undefined && !Array.isArray(teamMembers)) {
    return res.status(422).json({ success: false, message: "Team members must be an array." });
  }

  if (includeWeekends !== undefined && typeof includeWeekends !== "boolean") {
    return res.status(422).json({ success: false, message: "includeWeekends must be a boolean." });
  }

  next();
};

const validateUpdateProject = (req, res, next) => {
  const { status, priority } = req.body;

  if (status && !PROJECT_STATUSES.includes(status)) {
    return res.status(422).json({ success: false, message: "Invalid project status." });
  }

  if (priority && !PROJECT_PRIORITIES.includes(priority)) {
    return res.status(422).json({ success: false, message: "Invalid project priority." });
  }

  next();
};

module.exports = { validateCreateProject, validateUpdateProject };
