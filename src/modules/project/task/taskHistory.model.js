const mongoose = require("mongoose");
const { PROJECT_ACTIVITY_ACTIONS } = require("../project.constants");

const taskHistorySchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    userNameSnapshot: { type: String, default: "", trim: true },
    userRoleSnapshot: { type: String, default: "", trim: true },
    action: { type: String, enum: PROJECT_ACTIVITY_ACTIONS, required: true, index: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    reason: { type: String, default: "", trim: true, maxlength: 2000 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
  },
  { timestamps: true }
);

taskHistorySchema.index({ taskId: 1, createdAt: -1 });

module.exports = mongoose.model("TaskHistory", taskHistorySchema);
