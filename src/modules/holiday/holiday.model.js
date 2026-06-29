const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },

    holidayType: {
      type: String,
      enum: ["COMPANY", "FESTIVAL", "OPTIONAL"],
      default: "COMPANY",
    },

    fromDate: {
  type: String,
  required: true,
},

toDate: {
  type: String,
  required: true,
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

holidaySchema.index({
  title: "text",
});

holidaySchema.index({
  fromDate: 1,
  toDate: 1,
});

module.exports = mongoose.model("Holiday", holidaySchema);