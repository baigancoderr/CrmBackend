const notesService = require("./notes.service");
const sendResponse = require("../../utils/response");

const createFolder = async (req, res, next) => {
  try {
    const folder = await notesService.createFolder(req.user.id, req.body);
    return sendResponse(res, 201, true, "Folder created successfully", folder);
  } catch (error) {
    return next(error);
  }
};

const getMyFolders = async (req, res, next) => {
  try {
    const folders = await notesService.getMyFolders(req.user.id);
    return sendResponse(res, 200, true, "Folders retrieved successfully", folders);
  } catch (error) {
    return next(error);
  }
};

const updateFolder = async (req, res, next) => {
  try {
    const folder = await notesService.updateFolder(req.user.id, req.params.id, req.body);
    return sendResponse(res, 200, true, "Folder updated successfully", folder);
  } catch (error) {
    return next(error);
  }
};

const deleteFolder = async (req, res, next) => {
  try {
    const result = await notesService.deleteFolder(req.user.id, req.params.id);
    return sendResponse(res, 200, true, result.message, null);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createFolder,
  getMyFolders,
  updateFolder,
  deleteFolder,
};
