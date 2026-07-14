const mongoose = require("mongoose");

const folderSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Folder name is required"],
      trim: true,
      maxlength: [100, "Folder name cannot exceed 100 characters"],
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Folder owner is required"],
    },
  },
  {
    timestamps: true,
  }
);

// Unique folder name per owner
folderSchema.index({ name: 1, owner: 1 }, { unique: true });

module.exports = mongoose.model("Folder", folderSchema);
