const projectService = require("./project.service");

const createProject = async (req, res) => {
  try {
    const project = await projectService.createProject(req.user, req.body);
    return res.status(201).json({ success: true, message: "Project created successfully.", data: project });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listProjects = async (req, res) => {
  try {
    const result = await projectService.listProjects(req.user, req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getProjectById = async (req, res) => {
  try {
    const project = await projectService.getProjectById(req.params.id, req.user);
    return res.status(200).json({ success: true, data: project });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const updateProject = async (req, res) => {
  try {
    const project = await projectService.updateProject(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Project updated successfully.", data: project });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const closeProject = async (req, res) => {
  try {
    const project = await projectService.closeProject(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Project closed successfully.", data: project });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const deleteProject = async (req, res) => {
  try {
    await projectService.deleteProject(req.params.id, req.user);
    return res.status(200).json({ success: true, message: "Project deleted successfully." });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const cancelProject = async (req, res) => {
  try {
    const project = await projectService.cancelProject(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Project cancelled successfully.", data: project });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const addProjectMembers = async (req, res) => {
  try {
    const project = await projectService.addProjectMembers(req.params.id, req.user, req.body);
    return res.status(200).json({
      success: true,
      message: "Project members added successfully.",
      data: project,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  closeProject,
  cancelProject,
  deleteProject,
  addProjectMembers,
};
