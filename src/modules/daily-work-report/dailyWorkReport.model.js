const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 1,
    },
    dataUrl: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const dailyWorkReportSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    employeeNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },
    employeeIdSnapshot: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    reportingManagerSnapshot: {
      type: String,
      default: "",
      trim: true,
    },
    reportingManager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    projectName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    reportDate: {
      type: String,
      required: true,
      index: true,
    },
    workDescription: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },
    workStatus: {
      type: String,
      enum: ["COMPLETED", "IN_PROGRESS", "BLOCKED", "ON_HOLD"],
      required: true,
    },
    blockers: {
      type: String,
      default: "",
      trim: true,
      maxlength: 3000,
    },
    attachment: {
      type: attachmentSchema,
      default: null,
    },
    reviewStatus: {
      type: String,
      enum: ["PENDING", "REVIEWED"],
      default: "PENDING",
      index: true,
    },
    reviewComment: {
      type: String,
      default: "",
      trim: true,
      maxlength: 3000,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedByNameSnapshot: {
      type: String,
      default: "",
      trim: true,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

dailyWorkReportSchema.index({
  employee: 1,
  createdAt: -1,
});

module.exports = mongoose.model("DailyWorkReport", dailyWorkReportSchema);
