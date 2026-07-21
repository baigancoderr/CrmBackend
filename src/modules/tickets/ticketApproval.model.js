const mongoose = require("mongoose");

// One document per approval step per ticket
const ticketApprovalSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    // Step index in the chain (0-based)
    stepIndex: {
      type: Number,
      required: true,
      default: 0,
    },
    // Role required to approve at this step
    approverRole: {
      type: String,
      enum: ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT"],
      required: true,
    },
    // Actual user who acted
    approver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approverNameSnapshot: { type: String, default: "", trim: true },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    remarks: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

ticketApprovalSchema.index({ ticket: 1, stepIndex: 1 });
ticketApprovalSchema.index({ ticket: 1, status: 1 });

module.exports = mongoose.model("TicketApproval", ticketApprovalSchema);
