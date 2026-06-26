const mongoose = require("mongoose");

const biometricSyncStateSchema = new mongoose.Schema(
  {
    lastMaxRecord: {
      type: String,
      default: "",
    },
    lastSyncedAt: {
      type: Date,
      default: null,
    },
    lastSyncStatus: {
      type: String,
      enum: ["SUCCESS", "FAILED", "IDLE"],
      default: "IDLE",
    },
    lastSyncMessage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "BiometricSyncState",
  biometricSyncStateSchema
);
