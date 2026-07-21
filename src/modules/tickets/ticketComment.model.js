const mongoose = require("mongoose");

const commentAttachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true, trim: true },
  },
  { _id: true }
);

const ticketCommentSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    senderNameSnapshot: { type: String, default: "", trim: true },
    senderRoleSnapshot: { type: String, default: "", trim: true },

    // Internal notes are invisible to EMPLOYEE role
    isInternal: {
      type: Boolean,
      default: false,
      index: true,
    },

    attachments: {
      type: [commentAttachmentSchema],
      default: [],
    },

    // Mentions inside the comment body
    mentionedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

ticketCommentSchema.index({ ticket: 1, createdAt: 1 });
ticketCommentSchema.index({ ticket: 1, isInternal: 1, isDeleted: 1 });

module.exports = mongoose.model("TicketComment", ticketCommentSchema);
