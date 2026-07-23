const mongoose = require("mongoose");

const NOTIFICATION_TYPES = [
  "EXTRA_WORK_REQUESTED",
  "EXTRA_WORK_APPROVED",
  "EXTRA_WORK_REJECTED",
  "LEAVE_REQUESTED",
  "LEAVE_APPROVED",
  "LEAVE_REJECTED",
  "DAILY_WORK_REPORT_REMINDER",
];

const NOTIFICATION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "INFO"];

const ENTITY_TYPES = ["EXTRA_WORK", "LEAVE", "DAILY_WORK_REPORT"];

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPES,
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      maxlength: 160,
      trim: true,
    },
    message: {
      type: String,
      default: "",
      maxlength: 500,
      trim: true,
    },
    status: {
      type: String,
      enum: NOTIFICATION_STATUSES,
      default: "INFO",
      index: true,
    },
    entityType: {
      type: String,
      enum: [...ENTITY_TYPES, null],
      default: null,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    link: {
      type: String,
      default: "",
      maxlength: 300,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

notificationSchema.index({
  recipient: 1,
  isRead: 1,
  createdAt: -1,
});

notificationSchema.index({
  recipient: 1,
  createdAt: -1,
});

module.exports = mongoose.model("AppNotification", notificationSchema);
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.NOTIFICATION_STATUSES = NOTIFICATION_STATUSES;
module.exports.ENTITY_TYPES = ENTITY_TYPES;
