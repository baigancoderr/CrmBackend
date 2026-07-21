const mongoose = require("mongoose");

// Complete audit trail for every ticket state change / action
const ticketActivitySchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "TICKET_CREATED",
        "TICKET_UPDATED",
        "TICKET_ASSIGNED",
        "TICKET_REASSIGNED",
        "TICKET_ACCEPTED",
        "TICKET_TRANSFERRED",
        "TICKET_REJECTED_BY_ASSIGNEE",
        "PRIORITY_CHANGED",
        "STATUS_CHANGED",
        "COMMENT_ADDED",
        "INTERNAL_NOTE_ADDED",
        "ATTACHMENT_UPLOADED",
        "MENTION_ADDED",
        "WATCHER_ADDED",
        "WATCHER_REMOVED",
        "APPROVAL_REQUESTED",
        "APPROVAL_GRANTED",
        "APPROVAL_REJECTED",
        "ESCALATED",
        "DE_ESCALATED",
        "WAITING_FOR_RESPONSE",
        "RESPONSE_RECEIVED",
        "RESOLVED",
        "CLOSED",
        "REOPENED",
        "ON_HOLD",
        "SLA_BREACHED",
        "RATING_ADDED",
      ],
      index: true,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    performedByNameSnapshot: { type: String, default: "", trim: true },
    performedByRoleSnapshot: { type: String, default: "", trim: true },

    // Before/after for auditing changes
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },

    // Human-readable description
    description: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

ticketActivitySchema.index({ ticket: 1, createdAt: 1 });

module.exports = mongoose.model("TicketActivity", ticketActivitySchema);
