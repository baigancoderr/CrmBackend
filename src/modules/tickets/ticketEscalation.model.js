const mongoose = require("mongoose");

const ticketEscalationSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    escalatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    escalatedByNameSnapshot: { type: String, default: "", trim: true },
    escalatedByRoleSnapshot: { type: String, default: "", trim: true },

    escalatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    escalatedToNameSnapshot: { type: String, default: "", trim: true },
    escalatedToRoleSnapshot: { type: String, default: "", trim: true },

    // SYSTEM = auto-triggered by SLA breach, MANUAL = user initiated
    escalationType: {
      type: String,
      enum: ["SYSTEM", "MANUAL"],
      default: "MANUAL",
    },
    escalationLevel: {
      type: Number,
      default: 1,
    },
    reason: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    escalatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

ticketEscalationSchema.index({ ticket: 1, escalatedAt: -1 });

module.exports = mongoose.model("TicketEscalation", ticketEscalationSchema);
