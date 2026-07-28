const mongoose = require("mongoose");

const taskCommentSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorNameSnapshot: { type: String, default: "", trim: true },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    mentionedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
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
    isInternal: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TaskComment", taskCommentSchema);
