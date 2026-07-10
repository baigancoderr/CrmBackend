const notesService = require("./notes.service");
const sendResponse = require("../../utils/response");

const createNote = async (req, res, next) => {
  try {
    const note = await notesService.createNote(req.user.id, req.body, req.files);
    return sendResponse(res, 201, true, "Note created successfully", note);
  } catch (error) {
    return next(error);
  }
};

const getMyNotes = async (req, res, next) => {
  try {
    const result = await notesService.getMyNotes(req.user.id, req.query);
    return sendResponse(res, 200, true, "Notes retrieved successfully", result);
  } catch (error) {
    return next(error);
  }
};

const getSingleNote = async (req, res, next) => {
  try {
    const note = await notesService.getSingleNote(req.user.id, req.params.id);
    return sendResponse(res, 200, true, "Note retrieved successfully", note);
  } catch (error) {
    return next(error);
  }
};

const updateNote = async (req, res, next) => {
  try {
    const note = await notesService.updateNote(
      req.user.id,
      req.params.id,
      req.body,
      req.files
    );
    return sendResponse(res, 200, true, "Note updated successfully", note);
  } catch (error) {
    return next(error);
  }
};

const softDeleteNote = async (req, res, next) => {
  try {
    const result = await notesService.softDeleteNote(req.user.id, req.params.id);
    return sendResponse(res, 200, true, result.message, { noteId: result.noteId });
  } catch (error) {
    return next(error);
  }
};

const restoreNote = async (req, res, next) => {
  try {
    const note = await notesService.restoreNote(req.user.id, req.params.id);
    return sendResponse(res, 200, true, "Note restored successfully", note);
  } catch (error) {
    return next(error);
  }
};

const permanentDeleteNote = async (req, res, next) => {
  try {
    const result = await notesService.permanentDeleteNote(req.user.id, req.params.id);
    return sendResponse(res, 200, true, result.message, { noteId: result.noteId });
  } catch (error) {
    return next(error);
  }
};

const pinNote = async (req, res, next) => {
  try {
    const result = await notesService.togglePin(req.user.id, req.params.id);
    return sendResponse(res, 200, true, result.message, { isPinned: result.isPinned });
  } catch (error) {
    return next(error);
  }
};

const favoriteNote = async (req, res, next) => {
  try {
    const result = await notesService.toggleFavorite(req.user.id, req.params.id);
    return sendResponse(res, 200, true, result.message, { isFavorite: result.isFavorite });
  } catch (error) {
    return next(error);
  }
};

const archiveNote = async (req, res, next) => {
  try {
    const result = await notesService.toggleArchive(req.user.id, req.params.id);
    return sendResponse(res, 200, true, result.message, { isArchived: result.isArchived });
  } catch (error) {
    return next(error);
  }
};

const getArchivedNotes = async (req, res, next) => {
  try {
    const result = await notesService.getArchivedNotes(req.user.id, req.query);
    return sendResponse(res, 200, true, "Archived notes retrieved successfully", result);
  } catch (error) {
    return next(error);
  }
};

const getTrashNotes = async (req, res, next) => {
  try {
    const result = await notesService.getTrashNotes(req.user.id, req.query);
    return sendResponse(res, 200, true, "Trash notes retrieved successfully", result);
  } catch (error) {
    return next(error);
  }
};

const searchNotes = async (req, res, next) => {
  try {
    const result = await notesService.searchNotes(req.user.id, req.query);
    return sendResponse(res, 200, true, "Search results retrieved successfully", result);
  } catch (error) {
    return next(error);
  }
};

module.exports = {
  createNote,
  getMyNotes,
  getSingleNote,
  updateNote,
  softDeleteNote,
  restoreNote,
  permanentDeleteNote,
  pinNote,
  favoriteNote,
  archiveNote,
  getArchivedNotes,
  getTrashNotes,
  searchNotes,
};
