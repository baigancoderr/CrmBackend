const mongoose = require("mongoose");

const taskDependencySchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    dependsOnTaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Task",
      required: true,
      index: true,
    },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    isResolved: { type: Boolean, default: false, index: true },
    resolvedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

taskDependencySchema.index({ taskId: 1, dependsOnTaskId: 1 }, { unique: true });

module.exports = mongoose.model("TaskDependency", taskDependencySchema);
