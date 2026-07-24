const mongoose = require("mongoose");

const timeLogSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employeeNameSnapshot: { type: String, default: "", trim: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null, index: true },
    date: { type: String, required: true, index: true },
    startTime: { type: Date, default: null },
    endTime: { type: Date, default: null },
    workingMinutes: { type: Number, default: 0, min: 0 },
    pausedMinutes: { type: Number, default: 0, min: 0 },
    blockedMinutes: { type: Number, default: 0, min: 0 },
    idleMinutes: { type: Number, default: 0, min: 0 },
    totalMinutes: { type: Number, default: 0, min: 0 },
    description: { type: String, default: "", trim: true, maxlength: 3000 },
    dailyWorkReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DailyWorkReport",
      default: null,
    },
  },
  { timestamps: true }
);

timeLogSchema.index({ employeeId: 1, date: 1 });
timeLogSchema.index({ projectId: 1, date: 1 });

module.exports = mongoose.model("TimeLog", timeLogSchema);
