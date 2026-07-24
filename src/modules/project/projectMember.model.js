const mongoose = require("mongoose");
const { MEMBER_ROLES } = require("./project.constants");

const projectMemberSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userNameSnapshot: { type: String, default: "", trim: true },
    role: { type: String, enum: MEMBER_ROLES, default: "MEMBER", index: true },
    projectAreaId: { type: mongoose.Schema.Types.ObjectId, ref: "ProjectArea", default: null },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

projectMemberSchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("ProjectMember", projectMemberSchema);
