const mongoose = require("mongoose");

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    date: {
      type: String,
      required: true,
      index: true,
    },

    clockIn: {
      type: Date,
      default: null,
    },

    clockOut: {
      type: Date,
      default: null,
    },

    workingMinutes: {
      type: Number,
      default: 0,
    },

    lateMinutes: {
      type: Number,
      default: 0,
    },

    overtimeMinutes: {
      type: Number,
      default: 0,
    },

    shortfallMinutes: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: [
        "PRESENT",
        "LATE",
        "HALF_DAY",
        "ABSENT",
        "WEEK_OFF",
        "LEAVE",
      ],
      default: "PRESENT",
    },

    updatedBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User",
  default: null,
},

updateReason: {
  type: String,
  default: "",
},

isManuallyUpdated: {
  type: Boolean,
  default: false,
},

    remarks: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

attendanceSchema.index(
  {
    employee: 1,
    date: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  "Attendance",
  attendanceSchema
);