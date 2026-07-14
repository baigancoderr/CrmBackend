const mongoose = require("mongoose");

const punchEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["CLOCK_IN", "CLOCK_OUT"],
      required: true,
    },
    source: {
      type: String,
      enum: ["MANUAL", "BIOMETRIC"],
      required: true,
    },
    time: {
      type: Date,
      required: true,
    },
    by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const attendanceSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    employeeId: {
      type: String,
      default: "",
      index: true,
    },

    employeeName: {
      type: String,
      default: "",
      trim: true,
    },

    biometricEmpCode: {
      type: String,
      default: "",
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

    clockInSource: {
      type: String,
      enum: ["MANUAL", "BIOMETRIC"],
      default: "MANUAL",
    },

    clockOutSource: {
      type: String,
      enum: ["MANUAL", "BIOMETRIC"],
      default: "MANUAL",
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

    earlyOutMinutes: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: [
        "PRESENT",
        "LATE",
        "HALF_DAY",
        "EARLY_LEAVE",
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

    punchEvents: {
      type: [punchEventSchema],
      default: [],
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