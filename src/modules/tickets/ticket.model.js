const mongoose = require("mongoose");
const { TICKET_CATEGORIES } = require("./ticket.constants");

const attachmentSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true },
    fileUrl: { type: String, required: true, trim: true },
    fileSize: { type: Number, required: true, min: 1 },
    mimeType: { type: String, required: true, trim: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    uploadedBySnapshot: { type: String, default: "", trim: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ticketSchema = new mongoose.Schema(
  {
    // ── Unique ticket number ──────────────────────────────────────────────────
    ticketNumber: {
      type: String,
      unique: true,
      index: true,
      trim: true,
    },

    // ── Basic info ────────────────────────────────────────────────────────────
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 5000,
    },

    // ── Category ──────────────────────────────────────────────────────────────
    category: {
      type: String,
      enum: TICKET_CATEGORIES,
      required: true,
      index: true,
      trim: true,
    },

    // ── Priority & Status ─────────────────────────────────────────────────────
    priority: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "URGENT", "CRITICAL"],
      default: "MEDIUM",
      index: true,
    },
    status: {
      type: String,
      enum: [
        "OPEN",
        "ASSIGNED",
        "IN_PROGRESS",
        "WAITING_FOR_RESPONSE",
        "PENDING_APPROVAL",
        "APPROVED",
        "REJECTED",
        "ESCALATED",
        "RESOLVED",
        "CLOSED",
        "REOPENED",
        "ON_HOLD",
      ],
      default: "OPEN",
      index: true,
    },

    // ── Creator ───────────────────────────────────────────────────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    createdByNameSnapshot: { type: String, default: "", trim: true },
    createdByIdSnapshot: { type: String, default: "", trim: true },

    // ── Department ────────────────────────────────────────────────────────────
    department: {
      type: String,
      default: "",
      trim: true,
      maxlength: 100,
      index: true,
    },

    // ── Related project (optional) ────────────────────────────────────────────
    relatedProject: {
      type: String,
      default: "",
      trim: true,
      maxlength: 200,
    },

    // ── Assignment ────────────────────────────────────────────────────────────
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    assignedToNameSnapshot: { type: String, default: "", trim: true },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    assignedByNameSnapshot: { type: String, default: "", trim: true },
    assignedAt: { type: Date, default: null },

    // ── Attachments ───────────────────────────────────────────────────────────
    attachments: {
      type: [attachmentSchema],
      default: [],
    },

    // ── Mentions ──────────────────────────────────────────────────────────────
    mentionedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ── Watchers / followers ──────────────────────────────────────────────────
    watchers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // ── Resolution ────────────────────────────────────────────────────────────
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedByNameSnapshot: { type: String, default: "", trim: true },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: "", trim: true, maxlength: 3000 },
    resolutionSummary: { type: String, default: "", trim: true, maxlength: 1000 },
    timeSpentMinutes: { type: Number, default: 0 },

    // ── Closure ───────────────────────────────────────────────────────────────
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },

    // ── Reopen ────────────────────────────────────────────────────────────────
    reopenedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reopenedAt: { type: Date, default: null },
    reopenReason: { type: String, default: "", trim: true, maxlength: 1000 },
    reopenCount: { type: Number, default: 0 },

    // ── Escalation ────────────────────────────────────────────────────────────
    isEscalated: { type: Boolean, default: false, index: true },
    escalationLevel: { type: Number, default: 0 },

    // ── Customer satisfaction ─────────────────────────────────────────────────
    rating: { type: Number, default: null, min: 1, max: 5 },
    ratingFeedback: { type: String, default: "", trim: true, maxlength: 1000 },
    ratedAt: { type: Date, default: null },
    ratedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    // ── Soft delete ───────────────────────────────────────────────────────────
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Compound indexes for common query patterns
ticketSchema.index({ createdBy: 1, status: 1 });
ticketSchema.index({ assignedTo: 1, status: 1 });
ticketSchema.index({ category: 1, status: 1 });
ticketSchema.index({ priority: 1, status: 1 });
ticketSchema.index({ department: 1, status: 1 });
ticketSchema.index({ isDeleted: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Ticket", ticketSchema);
