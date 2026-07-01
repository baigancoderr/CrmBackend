const mongoose = require("mongoose");

const leaveSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    fromDate: {
      type: String,
      required: true,
    },

    toDate: {
      type: String,
      required: true,
    },

    category: {
      type: String,
      enum: ["FULL_DAY", "HALF_DAY"],
      default: "FULL_DAY",
    },

    totalCalendarDays: {
      type: Number,
      default: 0,
    },

    totalLeaveDays: {
      type: Number,
      default: 0,
    },

    skippedWeekendDays: {
      type: Number,
      default: 0,
    },

    skippedHolidayDays: {
      type: Number,
      default: 0,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },

    attachment: {
  type: String,
  default: "",
},

    mentions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    status: {
      type: String,
      enum: [
        "PENDING",
        "APPROVED",
        "REJECTED",
        "CANCELLED",
        "COMPLETED",
      ],
      default: "PENDING",
    },


   
salaryDeductionApproved: {
    type: Boolean,
    default: false,
},

leaveDeductionType: {
  type: String,
  enum: [
    "LEAVE_BALANCE",
    "SALARY",
    "BOTH",
  ],
  required: true,
},

leaveBalanceDays: {
  type: Number,
  default: 0,
},

salaryDeductionDays: {
  type: Number,
  default: 0,
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

    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    rejectedAt: {
      type: Date,
      default: null,
    },

    rejectReason: {
      type: String,
      default: "",
      trim: true,
    },

    completedAt: {
      type: Date,
      default: null,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

leaveSchema.index({
  employeeId: 1,
  status: 1,
});

leaveSchema.index({
  fromDate: 1,
  toDate: 1,
});

leaveSchema.index({
  isDeleted: 1,
});

module.exports = mongoose.model(
  "Leave",
  leaveSchema
);