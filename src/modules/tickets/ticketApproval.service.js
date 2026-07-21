const Ticket = require("./ticket.model");
const TicketApproval = require("./ticketApproval.model");
const { logActivity } = require("./ticket.service");

const createAppError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

// ── Get approval chain for a ticket ──────────────────────────────────────────
const getApprovals = async (ticketId) => {
  return TicketApproval.find({ ticket: ticketId })
    .populate("approver", "name employeeId role")
    .sort({ stepIndex: 1 });
};

// ── Approve a step ────────────────────────────────────────────────────────────
const approveTicket = async (ticketId, actor, payload) => {
  const remarks = String(payload.remarks || "").trim();

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (ticket.status !== "PENDING_APPROVAL")
    throw createAppError("Ticket is not pending approval.", 422);

  // Find the current pending step
  const currentStep = await TicketApproval.findOne({
    ticket: ticketId,
    status: "PENDING",
  }).sort({ stepIndex: 1 });

  if (!currentStep)
    throw createAppError("No pending approval step found.", 404);

  // Verify role matches required approver role
  if (currentStep.approverRole !== actor.role)
    throw createAppError(`This step requires a ${currentStep.approverRole} to approve.`, 403);

  currentStep.approver = actor.id;
  currentStep.approverNameSnapshot = actor.name || "";
  currentStep.status = "APPROVED";
  currentStep.remarks = remarks;
  currentStep.approvedAt = new Date();
  await currentStep.save();

  await logActivity(ticketId, "APPROVAL_GRANTED", actor,
    `Step ${currentStep.stepIndex + 1} approved by ${actor.name}${remarks ? `: ${remarks}` : ""}.`);

  // Check if there are more steps pending
  const nextStep = await TicketApproval.findOne({
    ticket: ticketId,
    status: "PENDING",
  }).sort({ stepIndex: 1 });

  if (nextStep) {
    // Still more approvers needed — stay in PENDING_APPROVAL
    ticket.approvalStep = nextStep.stepIndex;
    await ticket.save();
  } else {
    // All steps approved — move ticket forward
    ticket.status = "APPROVED";
    ticket.approvalStep = 0;
    await ticket.save();
    await logActivity(ticketId, "APPROVAL_GRANTED", actor,
      "All approval steps completed. Ticket approved.");
  }

  return getApprovals(ticketId);
};

// ── Reject a step ─────────────────────────────────────────────────────────────
const rejectTicket = async (ticketId, actor, payload) => {
  const remarks = String(payload.remarks || "").trim();
  if (!remarks) throw createAppError("Rejection remarks are required.", 422);

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (ticket.status !== "PENDING_APPROVAL")
    throw createAppError("Ticket is not pending approval.", 422);

  const currentStep = await TicketApproval.findOne({
    ticket: ticketId,
    status: "PENDING",
  }).sort({ stepIndex: 1 });

  if (!currentStep)
    throw createAppError("No pending approval step found.", 404);

  if (currentStep.approverRole !== actor.role)
    throw createAppError(`This step requires a ${currentStep.approverRole} to reject.`, 403);

  currentStep.approver = actor.id;
  currentStep.approverNameSnapshot = actor.name || "";
  currentStep.status = "REJECTED";
  currentStep.remarks = remarks;
  currentStep.rejectedAt = new Date();
  await currentStep.save();

  ticket.status = "REJECTED";
  await ticket.save();

  await logActivity(ticketId, "APPROVAL_REJECTED", actor,
    `Ticket rejected at step ${currentStep.stepIndex + 1}: ${remarks}`);

  return getApprovals(ticketId);
};

module.exports = { getApprovals, approveTicket, rejectTicket };
