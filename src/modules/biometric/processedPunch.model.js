const mongoose = require("mongoose");

const processedPunchSchema = new mongoose.Schema(
  {
    punchId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    empcode: {
      type: String,
      required: true,
    },
    punchDate: {
      type: Date,
      required: true,
    },
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "ProcessedBiometricPunch",
  processedPunchSchema
);
