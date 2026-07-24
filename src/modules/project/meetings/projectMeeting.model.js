const mongoose = require("mongoose");
const { MEETING_STATUSES } = require("../project.constants");

const projectMeetingSchema = new mongoose.Schema(
  {
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", trim: true, maxlength: 3000 },
    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 60, min: 15 },
    status: { type: String, enum: MEETING_STATUSES, default: "SCHEDULED", index: true },
    attendees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    meetingLink: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true, maxlength: 5000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ProjectMeeting", projectMeetingSchema);
