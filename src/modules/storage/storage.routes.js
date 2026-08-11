const router = require("express").Router();
const storageAccessAuth = require("../../middleware/storageAccessAuth.middleware");
const storageController = require("./storage.controller");

router.get("/access", storageAccessAuth, storageController.accessStoredFile);
router.get("/signed-url", storageAccessAuth, storageController.getSignedUrlForRef);

module.exports = router;
