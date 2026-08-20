const Ticket = require("./ticket.model");
const TicketEscalation = require("./ticketEscalation.model");
const User = require("../user/user.model");
const notificationService = require("../notifications/notification.service");
const { logActivity } = require("./ticket.service");

const createAppError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const escalateTicket = async (ticketId, actor, payload) => {
  const reason = String(payload.reason || "").trim();
  const escalateToId = String(payload.escalateTo || "").trim();

  if (!reason) throw createAppError("Escalation reason is required.", 422);

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (["CLOSED", "REJECTED", "RESOLVED"].includes(ticket.status))
    throw createAppError("Cannot escalate a closed or resolved ticket.", 422);

  // TL can escalate once; after escalation, only SENIOR_ROLES can further escalate
  const SENIOR_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER"];
  if (ticket.isEscalated && !SENIOR_ROLES.includes(actor.role))
    throw createAppError("This ticket is already escalated. Only senior management can escalate it further.", 403);

  let escalateTo = null;
  if (escalateToId) {
    escalateTo = await User.findOne({ _id: escalateToId, isActive: true }).select("name employeeId role");
    if (!escalateTo) throw createAppError("Escalation target user not found.", 404);
  }

  const oldStatus = ticket.status;
  ticket.status = "ESCALATED";
  ticket.isEscalated = true;
  ticket.escalationLevel = (ticket.escalationLevel || 0) + 1;

  if (escalateTo) {
    ticket.assignedTo = escalateTo._id;
    ticket.assignedToNameSnapshot = escalateTo.name;
    ticket.assignedBy = actor.id;
    ticket.assignedByNameSnapshot = actor.name;
    ticket.assignedAt = new Date();
  }

  await ticket.save();

  await TicketEscalation.create({
    ticket: ticketId,
    escalatedBy: actor.id,
    escalatedByNameSnapshot: actor.name || "",
    escalatedByRoleSnapshot: actor.role || "",
    escalatedTo: escalateTo ? escalateTo._id : null,
    escalatedToNameSnapshot: escalateTo ? escalateTo.name : "",
    escalatedToRoleSnapshot: escalateTo ? escalateTo.role : "",
    escalationType: "MANUAL",
    escalationLevel: ticket.escalationLevel,
    reason,
    escalatedAt: new Date(),
  });

  await logActivity(
    ticketId,
    "ESCALATED",
    actor,
    `Manually escalated: ${reason}`,
    { status: oldStatus },
    { status: "ESCALATED" }
  );

  const populatedTicket = await Ticket.findById(ticket._id)
    .populate("assignedTo", "name employeeId role")
    .populate("createdBy", "name employeeId role");

  await notificationService.createNotificationsForRecipients({
    recipientIds: [
      String(ticket.createdBy),
      ticket.assignedTo ? String(ticket.assignedTo) : null,
      ...(ticket.watchers || []).map(String),
    ].filter(Boolean),
    actorId: actor.id,
    type: "TICKET_ESCALATED",
    title: "Ticket escalated",
    message: `Ticket ${ticket.ticketNumber} has been escalated for review.`,
    status: "INFO",
    entityType: "TICKET",
    entityId: ticket._id,
    link: `/tickets/detail/${ticket._id}`,
    meta: {
      ticketId: String(ticket._id),
      ticketNumber: ticket.ticketNumber,
      oldStatus,
      escalatedTo: escalatedTo ? escalatedTo.name : "",
      reason,
    },
  });

  return populatedTicket;
};

const getEscalationLog = async (ticketId) => {
  return TicketEscalation.find({ ticket: ticketId })
    .populate("escalatedBy", "name employeeId role")
    .populate("escalatedTo", "name employeeId role")
    .sort({ escalatedAt: 1 });
};

module.exports = { escalateTicket, getEscalationLog };
