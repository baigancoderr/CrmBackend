const mongoose = require("mongoose");
const { TASK_STATUSES, TASK_PRIORITIES } = require("../project.constants");

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, default: "", trim: true, maxlength: 5000 },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    projectAreaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectArea",
      required: true,
      index: true,
    },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    assignedToNameSnapshot: { type: String, default: "", trim: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    assignedByNameSnapshot: { type: String, default: "", trim: true },
    assignedAt: { type: Date, default: null },
    priority: { type: String, enum: TASK_PRIORITIES, default: "MEDIUM", index: true },
    status: { type: String, enum: TASK_STATUSES, default: "CREATED", index: true },
    estimatedHours: { type: Number, default: 0, min: 0 },
    actualHours: { type: Number, default: 0, min: 0 },
    deadline: { type: Date, default: null, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reviewedByNameSnapshot: { type: String, default: "", trim: true },
    reviewedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    dependsOn: [{ type: mongoose.Schema.Types.ObjectId, ref: "Task" }],
    pauseReason: { type: String, default: "", trim: true, maxlength: 1000 },
    blockedReason: { type: String, default: "", trim: true, maxlength: 1000 },
    reopenedReason: { type: String, default: "", trim: true, maxlength: 1000 },
    rejectionReason: { type: String, default: "", trim: true, maxlength: 1000 },
    reviewNotes: { type: String, default: "", trim: true, maxlength: 2000 },
    isUrgent: { type: Boolean, default: false, index: true },
    urgentRequestStatus: {
      type: String,
      enum: ["PENDING", "QUEUED", "APPROVED", "REJECTED", null],
      default: null,
    },
    urgentRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    urgentRequestedAt: { type: Date, default: null },
    urgentApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    sprintId: { type: String, default: "", trim: true },
    kanbanOrder: { type: Number, default: 0 },
    startedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    isArchived: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

taskSchema.index({ projectId: 1, status: 1 });
taskSchema.index({ assignedTo: 1, status: 1 });
taskSchema.index({ projectAreaId: 1, status: 1 });
taskSchema.index({ deadline: 1, status: 1 });

module.exports = mongoose.model("Task", taskSchema);
