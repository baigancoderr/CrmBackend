const express = require("express");
const authMiddleware = require("../../middleware/auth.middleware");
const areaDocumentUpload = require("../../middleware/areaDocument.upload.middleware");
const { validateCreateArea, validateUpdateArea } = require("./projectArea.validation");
const {
  createArea,
  listAreas,
  getAreaById,
  updateArea,
  assignTeamLead,
  deleteArea,
  uploadAreaDocuments,
  listAreaDocuments,
  deleteAreaDocument,
} = require("./projectArea.controller");

const router = express.Router({ mergeParams: true });

router.post("/", authMiddleware, areaDocumentUpload.array("documents", 10), validateCreateArea, createArea);
router.get("/", authMiddleware, listAreas);
router.get("/:areaId", authMiddleware, getAreaById);
router.patch("/:areaId", authMiddleware, validateUpdateArea, updateArea);
router.post("/:areaId/assign-lead", authMiddleware, assignTeamLead);
router.delete("/:areaId", authMiddleware, deleteArea);
router.post("/:areaId/documents", authMiddleware, areaDocumentUpload.array("documents", 10), uploadAreaDocuments);
router.get("/:areaId/documents", authMiddleware, listAreaDocuments);
router.delete("/:areaId/documents/:docId", authMiddleware, deleteAreaDocument);

module.exports = router;
