const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },

    allocatedLeaves: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    usedLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },

    history: [
  {
    leaveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leave",
    },

    fromDate: String,

    toDate: String,

    days: Number,

    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    approvedAt: Date,
  },
],

    remainingLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },

    extraLeaves: {
      type: Number,
      default: 0,
      min: 0,
    },

    year: {
      type: Number,
      required: true,
      default: new Date().getFullYear(),
    },

   salaryHistory: [
  {
    leaveId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Leave",
    },

    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    fromDate: String,

    toDate: String,

    salaryDeductionDays: Number,

    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    processedAt: {
      type: Date,
      default: null,
    },
  },
],

    lastUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// leaveBalanceSchema.index({
//   employeeId: 1,
// });

leaveBalanceSchema.index({
  year: 1,
});

module.exports = mongoose.model(
  "LeaveBalance",
  leaveBalanceSchema
);