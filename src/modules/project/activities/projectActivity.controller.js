const ProjectActivity = require("./projectActivity.model");
const projectService = require("../project.service");
const { parsePagination, buildPaginatedResult } = require("../project.helper");

const listProjectActivities = async (req, res) => {
  try {
    await projectService.assertProjectAccess(req.params.id, req.user);
    const { page, limit, skip, sort } = parsePagination(req.query);
    
    const filter = { projectId: req.params.id };
    if (req.query.module) filter.module = req.query.module;
    if (req.query.action) filter.action = req.query.action;

    const [records, totalRecords] = await Promise.all([
      ProjectActivity.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .populate("user", "name role profilePhoto")
        .lean(),
      ProjectActivity.countDocuments(filter),
    ]);

    const result = buildPaginatedResult(records, totalRecords, page, limit);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

module.exports = { listProjectActivities };
