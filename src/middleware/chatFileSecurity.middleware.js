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

    if (process.env.CHAT_DISABLE_FILE_SECURITY === "true") {
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

    const isProduction =
      process.env.NODE_ENV === "production";
    const fallbackMessage =
      "Invalid or unsafe file upload";

    return res.status(400).json({
      success: false,
      message: isProduction
        ? fallbackMessage
        : error.message || fallbackMessage,
    });
  }
};

module.exports = chatFileSecurity;
