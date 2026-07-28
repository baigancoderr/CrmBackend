const projectAreaService = require("./projectArea.service");

const createArea = async (req, res) => {
  try {
    const area = await projectAreaService.createArea(req.params.id, req.user, req.body, req.files || []);
    return res.status(201).json({ success: true, message: "Work area created successfully.", data: area });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listAreas = async (req, res) => {
  try {
    const areas = await projectAreaService.listAreas(req.params.id, req.user, req.query);
    return res.status(200).json({ success: true, data: areas });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const updateArea = async (req, res) => {
  try {
    const area = await projectAreaService.updateArea(req.params.id, req.params.areaId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Work area updated successfully.", data: area });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const assignTeamLead = async (req, res) => {
  try {
    const area = await projectAreaService.assignTeamLead(req.params.id, req.params.areaId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Team lead assigned successfully.", data: area });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const uploadAreaDocuments = async (req, res) => {
  try {
    const docs = await projectAreaService.uploadAreaDocuments(req.params.id, req.params.areaId, req.user, req.files || []);
    return res.status(201).json({ success: true, message: "Documents uploaded successfully.", data: docs });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listAreaDocuments = async (req, res) => {
  try {
    const docs = await projectAreaService.listAreaDocuments(req.params.id, req.params.areaId, req.user);
    return res.status(200).json({ success: true, data: docs });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const deleteAreaDocument = async (req, res) => {
  try {
    const doc = await projectAreaService.deleteAreaDocument(
      req.params.id,
      req.params.areaId,
      req.params.docId,
      req.user
    );
    return res.status(200).json({ success: true, message: "Document removed successfully.", data: doc });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = { createArea, listAreas, updateArea, assignTeamLead, uploadAreaDocuments, listAreaDocuments, deleteAreaDocument };
