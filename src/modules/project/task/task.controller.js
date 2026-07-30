const taskService = require("./task.service");

const createTask = async (req, res) => {
  try {
    const task = await taskService.createTask(req.params.id, req.user, req.body);
    return res.status(201).json({ success: true, message: "Task created successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listTasks = async (req, res) => {
  try {
    const result = await taskService.listTasks(req.params.id, req.user, req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listMyWorkingTasks = async (req, res) => {
  try {
    const result = await taskService.listMyWorkingTasks(req.user.id, req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getTaskById = async (req, res) => {
  try {
    const task = await taskService.getTaskById(req.params.id, req.params.taskId, req.user);
    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const updateTask = async (req, res) => {
  try {
    const task = await taskService.updateTask(req.params.id, req.params.taskId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Task updated successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const deleteTask = async (req, res) => {
  try {
    const task = await taskService.deleteTask(req.params.id, req.params.taskId, req.user);
    return res.status(200).json({ success: true, message: "Task deleted successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const assignTask = async (req, res) => {
  try {
    const task = await taskService.assignTask(req.params.id, req.params.taskId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Task assigned successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const acceptTask = async (req, res) => {
  try {
    const task = await taskService.acceptTask(req.params.id, req.params.taskId, req.user);
    return res.status(200).json({ success: true, message: "Task accepted successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const startTask = async (req, res) => {
  try {
    const task = await taskService.startTask(req.params.id, req.params.taskId, req.user);
    return res.status(200).json({ success: true, message: "Task started successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const pauseTask = async (req, res) => {
  try {
    const task = await taskService.pauseTask(req.params.id, req.params.taskId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Task paused successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const submitForReview = async (req, res) => {
  try {
    const task = await taskService.submitForReview(req.params.id, req.params.taskId, req.user, req.body, req.files || []);
    return res.status(200).json({ success: true, message: "Task submitted for review.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const reviewTask = async (req, res) => {
  try {
    const task = await taskService.reviewTask(req.params.id, req.params.taskId, req.user, req.body, req.files || []);
    return res.status(200).json({ success: true, message: "Task reviewed successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const addDependency = async (req, res) => {
  try {
    const task = await taskService.addDependency(req.params.id, req.params.taskId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Dependency added successfully.", data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getActiveTask = async (req, res) => {
  try {
    const task = await taskService.getActiveTaskForEmployee(req.user.id);
    return res.status(200).json({ success: true, data: task });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const getElapsedTime = async (req, res) => {
  try {
    const result = await taskService.getElapsedTime(req.params.id, req.params.taskId, req.user);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createTask,
  listTasks,
  listMyWorkingTasks,
  getTaskById,
  updateTask,
  deleteTask,
  assignTask,
  acceptTask,
  startTask,
  pauseTask,
  submitForReview,
  reviewTask,
  addDependency,
  getActiveTask,
  getElapsedTime,
};
