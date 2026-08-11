const express = require("express");
const router = express.Router();

const notesController = require("./notes.controller");
const noteShareController = require("./noteShare.controller");
const auth = require("../../middleware/auth.middleware");
const notesUpload = require("../../middleware/notesUpload.middleware");
const validateRequest = require("../../middleware/validate.middleware");
const { UPLOAD_MAX_FILES } = require("../../constants/uploadLimits");
const {
  noteIdParamSchema,
  createNoteSchema,
  updateNoteSchema,
  shareNoteSchema,
  removeShareParamSchema,
  searchNoteQuerySchema,
  paginationQuerySchema,
} = require("./notes.validation");

// All notes routes require authentication
router.use(auth);

// --- STATIC SUB-ROUTES (Must be defined BEFORE /:id to prevent matching as id parameter) ---

router.get(
  "/archive",
  validateRequest({ query: paginationQuerySchema }),
  notesController.getArchivedNotes
);

router.get(
  "/trash",
  validateRequest({ query: paginationQuerySchema }),
  notesController.getTrashNotes
);

router.get(
  "/search",
  validateRequest({ query: searchNoteQuerySchema }),
  notesController.searchNotes
);

// --- BASE & ID ROUTES ---

router.post(
  "/",
  notesUpload.array("attachments", UPLOAD_MAX_FILES.NOTES),
  validateRequest({ body: createNoteSchema }),
  notesController.createNote
);

router.get(
  "/",
  validateRequest({ query: paginationQuerySchema }),
  notesController.getMyNotes
);

router.get(
  "/:id",
  validateRequest({ params: noteIdParamSchema }),
  notesController.getSingleNote
);

router.patch(
  "/:id",
  notesUpload.array("attachments", UPLOAD_MAX_FILES.NOTES),
  validateRequest({
    params: noteIdParamSchema,
    body: updateNoteSchema,
  }),
  notesController.updateNote
);

router.delete(
  "/:id",
  validateRequest({ params: noteIdParamSchema }),
  notesController.softDeleteNote
);

router.patch(
  "/:id/restore",
  validateRequest({ params: noteIdParamSchema }),
  notesController.restoreNote
);

router.delete(
  "/:id/permanent",
  validateRequest({ params: noteIdParamSchema }),
  notesController.permanentDeleteNote
);

router.patch(
  "/:id/pin",
  validateRequest({ params: noteIdParamSchema }),
  notesController.pinNote
);

router.patch(
  "/:id/favorite",
  validateRequest({ params: noteIdParamSchema }),
  notesController.favoriteNote
);

router.patch(
  "/:id/archive",
  validateRequest({ params: noteIdParamSchema }),
  notesController.archiveNote
);

// --- SHARING ROUTES ---

router.post(
  "/:id/share",
  validateRequest({
    params: noteIdParamSchema,
    body: shareNoteSchema,
  }),
  noteShareController.shareNote
);

router.delete(
  "/:id/share/:userId",
  validateRequest({ params: removeShareParamSchema }),
  noteShareController.removeShare
);

router.get(
  "/:id/share",
  validateRequest({ params: noteIdParamSchema }),
  noteShareController.getSharedUsers
);

module.exports = router;
