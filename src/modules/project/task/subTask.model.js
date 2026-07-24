const mongoose = require("mongoose");
const { TASK_STATUSES } = require("../project.constants");

const subTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    status: { type: String, enum: TASK_STATUSES, default: "CREATED" },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sortOrder: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SubTask", subTaskSchema);
