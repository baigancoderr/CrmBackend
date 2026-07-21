const mongoose = require("mongoose");

const ticketRatingSchema = new mongoose.Schema(
  {
    ticket: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ticket",
      required: true,
      unique: true,
      index: true,
    },
    ratedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ratedByNameSnapshot: { type: String, default: "", trim: true },

    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    feedback: {
      type: String,
      default: "",
      trim: true,
      maxlength: 1000,
    },
    ratedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TicketRating", ticketRatingSchema);
