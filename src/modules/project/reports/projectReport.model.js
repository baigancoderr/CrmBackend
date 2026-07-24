const mongoose = require("mongoose");

const projectReportSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    reportType: {
      type: String,
      enum: ["SNAPSHOT", "WEEKLY", "MONTHLY", "FINAL"],
      default: "SNAPSHOT",
      index: true,
    },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    generatedByNameSnapshot: { type: String, default: "", trim: true },
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },
    metrics: {
      totalTasks: { type: Number, default: 0 },
      completedTasks: { type: Number, default: 0 },
      delayedTasks: { type: Number, default: 0 },
      blockedTasks: { type: Number, default: 0 },
      reopenedTasks: { type: Number, default: 0 },
      openBlockers: { type: Number, default: 0 },
      totalHours: { type: Number, default: 0 },
      progress: { type: Number, default: 0 },
      health: { type: String, default: "ON_TRACK" },
    },
    summary: { type: String, default: "", trim: true, maxlength: 10000 },
  },
  { timestamps: true }
);

projectReportSchema.index({ projectId: 1, createdAt: -1 });

module.exports = mongoose.model("ProjectReport", projectReportSchema);
