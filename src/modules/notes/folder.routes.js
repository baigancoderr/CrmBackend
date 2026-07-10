const express = require("express");
const router = express.Router();

const folderController = require("./folder.controller");
const auth = require("../../middleware/auth.middleware");
const validateRequest = require("../../middleware/validate.middleware");
const {
  createFolderSchema,
  updateFolderSchema,
  folderIdParamSchema,
} = require("./notes.validation");

// All folders routes require authentication
router.use(auth);

router.post(
  "/",
  validateRequest({ body: createFolderSchema }),
  folderController.createFolder
);

router.get("/", folderController.getMyFolders);

router.patch(
  "/:id",
  validateRequest({
    params: folderIdParamSchema,
    body: updateFolderSchema,
  }),
  folderController.updateFolder
);

router.delete(
  "/:id",
  validateRequest({ params: folderIdParamSchema }),
  folderController.deleteFolder
);

module.exports = router;
