const mongoose = require("mongoose");
const { AREA_STATUSES } = require("./project.constants");

const projectAreaSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 3000 },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    teamLead: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    teamLeadNameSnapshot: { type: String, default: "", trim: true },
    startDate: { type: Date, default: null },
    estimatedEndDate: { type: Date, default: null },
    projectLead: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    projectLeadNameSnapshot: { type: String, default: "", trim: true },
    status: { type: String, enum: AREA_STATUSES, default: "NOT_STARTED", index: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    sortOrder: { type: Number, default: 0 },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

projectAreaSchema.index({ projectId: 1, status: 1 });

module.exports = mongoose.model("ProjectArea", projectAreaSchema);
