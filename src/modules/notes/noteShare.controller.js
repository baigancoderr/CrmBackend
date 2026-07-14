const notesService = require("./notes.service");
const sendResponse = require("../../utils/response");

const shareNote = async (req, res, next) => {
  try {
    const { sharedWith, permission } = req.body;
    const share = await notesService.shareNote(
      req.user.id,
      req.params.id,
      sharedWith,
      permission
    );
    return sendResponse(res, 200, true, "Note shared successfully", share);
  } catch (error) {
    return next(error);
  }
};

const removeShare = async (req, res, next) => {
  try {
    const result = await notesService.removeShare(
      req.user.id,
      req.params.id,
      req.params.userId
    );
    return sendResponse(res, 200, true, result.message, null);
  } catch (error) {
    return next(error);
  }
};

const getSharedUsers = async (req, res, next) => {
  try {
    const shares = await notesService.getSharedUsers(
      req.user.id,
      req.params.id
    );
    return sendResponse(res, 200, true, "Shared users retrieved successfully", shares);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  shareNote,
  removeShare,
  getSharedUsers,
};
