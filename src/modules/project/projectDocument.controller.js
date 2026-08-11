const projectDocumentService = require("./projectDocument.service");

const uploadProjectDocuments = async (req, res) => {
  try {
    const docs = await projectDocumentService.uploadProjectDocument(
      req.params.id,
      req.user,
      req.body || {},
      req.files || []
    );
    return res.status(201).json({
      success: true,
      message: "Document(s) uploaded successfully.",
      data: docs,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listProjectDocuments = async (req, res) => {
  try {
    const result = await projectDocumentService.listProjectDocuments(
      req.params.id,
      req.user,
      req.query
    );
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const updateProjectDocument = async (req, res) => {
  try {
    const doc = await projectDocumentService.updateProjectDocument(
      req.params.id,
      req.params.docId,
      req.user,
      req.body || {}
    );
    return res.status(200).json({
      success: true,
      message: "Document updated successfully.",
      data: doc,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const deleteProjectDocument = async (req, res) => {
  try {
    const doc = await projectDocumentService.deleteProjectDocument(
      req.params.id,
      req.params.docId,
      req.user
    );
    return res.status(200).json({
      success: true,
      message: "Document deleted successfully.",
      data: doc,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = {
  uploadProjectDocuments,
  listProjectDocuments,
  updateProjectDocument,
  deleteProjectDocument,
};
