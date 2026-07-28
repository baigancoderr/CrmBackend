const mongoose = require("mongoose");
const { BLOCKER_STATUSES } = require("../project.constants");

const blockerSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    projectAreaId: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectArea", default: null },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    employeeNameSnapshot: { type: String, default: "", trim: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    status: { type: String, enum: BLOCKER_STATUSES, default: "OPEN", index: true },
    raisedAt: { type: Date, default: Date.now },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedByNameSnapshot: { type: String, default: "", trim: true },
    resolutionNotes: { type: String, default: "", trim: true, maxlength: 2000 },
    attachments: {
      type: [
        {
          fileName: { type: String, required: true, trim: true },
          fileUrl: { type: String, required: true, trim: true },
          fileSize: { type: Number, required: true, min: 1 },
          mimeType: { type: String, required: true, trim: true },
        }
      ],
      default: [],
    },
  },
  { timestamps: true }
);

blockerSchema.index({ projectId: 1, status: 1 });

module.exports = mongoose.model("Blocker", blockerSchema);
