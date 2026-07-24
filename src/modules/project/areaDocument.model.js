const mongoose = require("mongoose");

const areaDocumentSchema = new mongoose.Schema(
  {
    areaId: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectArea", required: true, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    title: { type: String, default: "", trim: true, maxlength: 200 },
    fileName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true, trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedByNameSnapshot: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AreaDocument", areaDocumentSchema);
