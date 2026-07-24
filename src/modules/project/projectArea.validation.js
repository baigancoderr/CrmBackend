const { AREA_STATUSES } = require("./project.constants");

const validateCreateArea = (req, res, next) => {
  const { title } = req.body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(422).json({ success: false, message: "Work area title is required." });
  }

  next();
};

const validateUpdateArea = (req, res, next) => {
  const { status } = req.body;

  if (status && !AREA_STATUSES.includes(status)) {
    return res.status(422).json({ success: false, message: "Invalid area status." });
  }

  next();
};

module.exports = { validateCreateArea, validateUpdateArea };
