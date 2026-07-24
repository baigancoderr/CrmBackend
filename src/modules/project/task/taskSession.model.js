const mongoose = require("mongoose");
const { SESSION_TYPES } = require("../project.constants");

const taskSessionSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employeeNameSnapshot: { type: String, default: "", trim: true },
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: 0, min: 0 },
    type: { type: String, enum: SESSION_TYPES, required: true, index: true },
    reason: { type: String, default: "", trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

taskSessionSchema.index({ employeeId: 1, startedAt: -1 });
taskSessionSchema.index({ taskId: 1, startedAt: 1 });

module.exports = mongoose.model("TaskSession", taskSessionSchema);
