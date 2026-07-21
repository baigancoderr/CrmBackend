const mongoose = require("mongoose");

const chatNotificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    message: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    type: {
      type: String,
      enum: ["CHAT_MESSAGE"],
      default: "CHAT_MESSAGE",
      required: true,
    },
    title: {
      type: String,
      default: "New message",
      maxlength: 120,
    },
    preview: {
      type: String,
      default: "",
      maxlength: 500,
    },
    messageType: {
      type: String,
      enum: ["TEXT", "IMAGE", "FILE", "SYSTEM"],
      default: "TEXT",
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

chatNotificationSchema.index({
  recipient: 1,
  isRead: 1,
  createdAt: -1,
});

chatNotificationSchema.index({
  recipient: 1,
  conversation: 1,
  isRead: 1,
});

module.exports = mongoose.model(
  "ChatNotification",
  chatNotificationSchema
);
