const {
  validateFileSignature,
  runVirusScanIfEnabled,
  removeFileSilently,
} = require("../utils/fileSecurity");
const {
  emitAbuseAlert,
  incrementMetric,
} = require("../utils/observability");

const chatFileSecurity = async (req, res, next) => {
  try {
    if (!req.file) {
      return next();
    }

    await validateFileSignature(
      req.file.path,
      req.file.mimetype,
      req.file.originalname
    );
    await runVirusScanIfEnabled(req.file.path);

    return next();
  } catch (error) {
    if (req.file?.path) {
      await removeFileSilently(req.file.path);
    }

    const userId = req.user?.id?.toString() || "unknown";

    await incrementMetric("chat_upload_rejected", {
      userId,
    });
    await emitAbuseAlert("chat_upload_rejected", {
      userId,
      reason: error.message,
    });

    return res.status(400).json({
      success: false,
      message: "Invalid or unsafe file upload",
    });
  }
};

module.exports = chatFileSecurity;
