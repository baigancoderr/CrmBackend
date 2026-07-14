const mongoose = require("mongoose");

const readReceiptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  }
);

const fileMetaSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: "",
    },

    size: {
      type: Number,
      default: 0,
    },

    mimeType: {
      type: String,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const messageSchema = new mongoose.Schema(
  {
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },

    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    type: {
      type: String,
      enum: ["TEXT", "IMAGE", "FILE", "SYSTEM"],
      default: "TEXT",
    },

    content: {
      type: String,
      default: "",
      maxlength: 5000,
    },

    fileMeta: fileMetaSchema,

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    forwardedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },

    mentions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    editedAt: {
      type: Date,
      default: null,
    },

    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    isDeletedForAll: {
      type: Boolean,
      default: false,
    },

    readBy: [readReceiptSchema],
  },
  {
    timestamps: true,
  }
);

messageSchema.index({
  conversation: 1,
  createdAt: -1,
});

messageSchema.index({
  conversation: 1,
  isDeletedForAll: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  "Message",
  messageSchema
);
