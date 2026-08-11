const storageService = require("../../services/storage.service");

const accessStoredFile = async (req, res) => {
  try {
    const ref = String(req.query.ref || "").trim();

    if (!ref || !storageService.isPrivateStorageRef(ref)) {
      return res.status(400).json({
        success: false,
        message: "Valid private storage reference is required.",
      });
    }

    const signedUrl = await storageService.resolveAccessibleUrl(ref);
    return res.redirect(302, signedUrl);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Unable to access stored file.",
    });
  }
};

const getSignedUrlForRef = async (req, res) => {
  try {
    const ref = String(req.query.ref || "").trim();

    if (!ref || !storageService.isPrivateStorageRef(ref)) {
      return res.status(400).json({
        success: false,
        message: "Valid private storage reference is required.",
      });
    }

    const signedUrl = await storageService.resolveAccessibleUrl(ref);

    return res.status(200).json({
      success: true,
      data: { url: signedUrl },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Unable to generate signed URL.",
    });
  }
};

module.exports = {
  accessStoredFile,
  getSignedUrlForRef,
};
