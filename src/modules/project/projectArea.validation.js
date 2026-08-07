const validateCreateArea = (req, res, next) => {
  const { title } = req.body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return res.status(422).json({ success: false, message: "Work area title is required." });
  }

  next();
};

const validateUpdateArea = (req, res, next) => {
  if (req.body?.status !== undefined) {
    return res.status(422).json({
      success: false,
      message: "Work area status is automatic based on task progress and cannot be changed manually.",
    });
  }

  next();
};

module.exports = { validateCreateArea, validateUpdateArea };
