const mongoose = require("mongoose");

const projectDocumentSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    fileName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true, trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedByNameSnapshot: { type: String, default: "", trim: true },
    isClientVisible: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProjectDocument", projectDocumentSchema);
