const milestoneService = require("./milestone.service");

const createMilestone = async (req, res) => {
  try {
    const milestone = await milestoneService.createMilestone(req.params.id, req.user, req.body);
    return res.status(201).json({ success: true, message: "Milestone created successfully.", data: milestone });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const listMilestones = async (req, res) => {
  try {
    const milestones = await milestoneService.listMilestones(req.params.id, req.user, req.query);
    return res.status(200).json({ success: true, data: milestones });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

const updateMilestone = async (req, res) => {
  try {
    const milestone = await milestoneService.updateMilestone(req.params.id, req.params.milestoneId, req.user, req.body);
    return res.status(200).json({ success: true, message: "Milestone updated successfully.", data: milestone });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = { createMilestone, listMilestones, updateMilestone };
