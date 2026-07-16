const mongoose = require("mongoose");

const noteShareSchema = new mongoose.Schema(
  {
    noteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Notes",
      required: [true, "Note reference is required"],
    },
    sharedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Shared by user reference is required"],
    },
    sharedWith: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Shared with user reference is required"],
    },
    permission: {
      type: String,
      enum: {
        values: ["View", "Edit"],
        message: "Permission must be either View or Edit",
      },
      required: [true, "Permission level is required"],
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Ensure a user can share a single note with another user only once
noteShareSchema.index({ noteId: 1, sharedWith: 1 }, { unique: true });
noteShareSchema.index({ sharedWith: 1 });

module.exports = mongoose.model("NoteShare", noteShareSchema);
