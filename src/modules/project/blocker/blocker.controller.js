const blockerService = require("./blocker.service");

const raiseBlocker = async (req, res) => {
  try {
    const blocker = await blockerService.raiseBlocker(req.params.id, req.params.taskId, req.user, req.body);
    return res.status(201).json({ success: true, message: "Blocker raised successfully.", data: blocker });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const resolveBlocker = async (req, res) => {
  try {
    const blocker = await blockerService.resolveBlocker(req.params.id, req.params.blockerId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Blocker resolved successfully.", data: blocker });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listBlockers = async (req, res) => {
  try {
    const result = await blockerService.listBlockers(req.params.id, req.user, req.query);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = { raiseBlocker, resolveBlocker, listBlockers };
