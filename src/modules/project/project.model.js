const mongoose = require("mongoose");
const {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_HEALTH,
} = require("./project.constants");

const projectSchema = new mongoose.Schema(
  {
    projectName: { type: String, required: true, trim: true, maxlength: 200, index: true },
    projectCode: { type: String, required: true, unique: true, trim: true, index: true },
    client: { type: String, default: "", trim: true, maxlength: 200 },
    clientUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    description: { type: String, default: "", trim: true, maxlength: 5000 },
    priority: { type: String, enum: PROJECT_PRIORITIES, default: "MEDIUM", index: true },
    status: { type: String, enum: PROJECT_STATUSES, default: "PLANNING", index: true },
    startDate: { type: Date, default: null },
    expectedEndDate: { type: Date, default: null, index: true },
    includeWeekends: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    cancelReason: { type: String, default: "", trim: true, maxlength: 2000 },
    projectManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    projectManagerNameSnapshot: { type: String, default: "", trim: true },
    teamMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    progress: { type: Number, default: 0, min: 0, max: 100 },
    health: { type: String, enum: PROJECT_HEALTH, default: "ON_TRACK", index: true },
    budget: { type: Number, default: 0, min: 0 },
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdByNameSnapshot: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

projectSchema.index({ projectManager: 1, status: 1 });
projectSchema.index({ isArchived: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Project", projectSchema);
