const mongoose = require("mongoose");

const extraWorkSessionSchema = new mongoose.Schema(
  {
    clockIn: {
      type: Date,
      required: true,
    },
    clockOut: {
      type: Date,
      default: null,
    },
    durationMinutes: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const extraWorkSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    requestReason: {
      type: String,
      required: true,
      trim: true,
    },

    requestDate: {
      type: Date,
      required: true,
      default: Date.now,
    },

    requestExpireAt: {
      type: Date,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "EXPIRED",
      ],
      default: "PENDING",
    },

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    approvedAt: {
      type: Date,
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    validFrom: {
      type: Date,
      default: null,
    },

    validTill: {
      type: Date,
      default: null,
    },

    sessions: [extraWorkSessionSchema],

    totalExtraMinutes: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

extraWorkSchema.index({
  employee: 1,
  requestDate: -1,
});

module.exports = mongoose.model(
  "ExtraWork",
  extraWorkSchema
);