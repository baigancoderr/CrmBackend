const mongoose = require("mongoose");
const {
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_STATUSES,
  AUDIENCE_TYPES,
} = require("./announcement.constants");

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    type: { type: String, default: "document" },
    size: { type: Number, default: 0 },
  },
  { _id: true }
);

const announcementSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    summary: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },
    content: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ANNOUNCEMENT_TYPES,
      default: "GENERAL",
      index: true,
    },
    priority: {
      type: String,
      enum: ANNOUNCEMENT_PRIORITIES,
      default: "NORMAL",
      index: true,
    },
    audienceType: {
      type: String,
      enum: AUDIENCE_TYPES,
      default: "ALL",
      index: true,
    },
    targetRoles: [
      {
        type: String,
        trim: true,
      },
    ],
    targetEmployees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    attachments: [attachmentSchema],
    status: {
      type: String,
      enum: ANNOUNCEMENT_STATUSES,
      default: "DRAFT",
      index: true,
    },
    publishAt: {
      type: Date,
      default: null,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    requiresAcknowledgement: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    publishedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

announcementSchema.index({ status: 1, publishAt: 1 });
announcementSchema.index({ status: 1, expiresAt: 1 });
announcementSchema.index({ isDeleted: 1, status: 1, isPinned: -1, createdAt: -1 });

module.exports = mongoose.model("Announcement", announcementSchema);
