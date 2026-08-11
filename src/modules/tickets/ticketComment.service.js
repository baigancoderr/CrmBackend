const Ticket = require("./ticket.model");
const TicketComment = require("./ticketComment.model");
const storageService = require("../../services/storage.service");
const { logActivity } = require("./ticket.service");

const INTERNAL_VISIBLE_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT"];

const createAppError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

// ── Add comment / internal note ───────────────────────────────────────────────
const addComment = async (ticketId, actor, payload, files = []) => {
  const message = String(payload.message || "").trim();
  const isInternal = payload.isInternal === true || payload.isInternal === "true";

  if (!message) throw createAppError("Message is required.", 422);

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (["CLOSED", "REJECTED"].includes(ticket.status))
    throw createAppError("Cannot comment on a closed or rejected ticket.", 422);

  // Only privileged roles can post internal notes
  if (isInternal && !INTERNAL_VISIBLE_ROLES.includes(actor.role))
    throw createAppError("You are not authorised to post internal notes.", 403);

  // Employee can only see/post on their own tickets
  if (actor.role === "EMPLOYEE" && String(ticket.createdBy) !== String(actor.id))
    throw createAppError("You can only comment on your own tickets.", 403);

  const mentionedUsers = Array.isArray(payload.mentionedUsers) ? payload.mentionedUsers : [];

  const attachments = [];

  for (const file of files) {
    attachments.push({
      fileName: file.originalname,
      fileUrl: await storageService.persistUploadedFile(file, "tickets"),
      fileSize: file.size,
      mimeType: file.mimetype,
    });
  }

  const comment = await TicketComment.create({
    ticket: ticketId,
    message,
    sender: actor.id,
    senderNameSnapshot: actor.name || "",
    senderRoleSnapshot: actor.role || "",
    isInternal,
    attachments,
    mentionedUsers,
  });

  // If employee responds while waiting, flip status back to IN_PROGRESS
  if (
    !isInternal &&
    actor.role === "EMPLOYEE" &&
    ticket.status === "WAITING_FOR_RESPONSE"
  ) {
    ticket.status = "IN_PROGRESS";
    await ticket.save();
    await logActivity(ticketId, "RESPONSE_RECEIVED", actor,
      "Employee replied — status moved back to IN_PROGRESS.",
      { status: "WAITING_FOR_RESPONSE" }, { status: "IN_PROGRESS" });
  }

  const action = isInternal ? "INTERNAL_NOTE_ADDED" : "COMMENT_ADDED";
  await logActivity(ticketId, action, actor,
    isInternal ? "Internal note added." : "Comment added.");

  if (mentionedUsers.length > 0) {
    await logActivity(ticketId, "MENTION_ADDED", actor,
      `${mentionedUsers.length} user(s) mentioned.`);
  }

  return TicketComment.findById(comment._id)
    .populate("sender", "name employeeId role")
    .populate("mentionedUsers", "name employeeId");
};

// ── Get comments for a ticket ─────────────────────────────────────────────────
const getComments = async (ticketId, actor) => {
  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false })
    .select("createdBy assignedTo watchers");
  if (!ticket) throw createAppError("Ticket not found.", 404);

  const isCreator = String(ticket.createdBy) === String(actor.id);
  const isAssignee = ticket.assignedTo && String(ticket.assignedTo) === String(actor.id);
  const isWatcher = ticket.watchers.map(String).includes(String(actor.id));
  const isPrivileged = INTERNAL_VISIBLE_ROLES.includes(actor.role);

  if (!isCreator && !isAssignee && !isWatcher && !isPrivileged)
    throw createAppError("Access denied.", 403);

  // EMPLOYEE only sees public comments
  const filter = { ticket: ticketId, isDeleted: false };
  if (!isPrivileged) filter.isInternal = false;

  return TicketComment.find(filter)
    .populate("sender", "name employeeId role")
    .populate("mentionedUsers", "name employeeId")
    .sort({ createdAt: 1 });
};

// ── Delete own comment (soft) ─────────────────────────────────────────────────
const deleteComment = async (commentId, actor) => {
  const comment = await TicketComment.findById(commentId);
  if (!comment || comment.isDeleted) throw createAppError("Comment not found.", 404);

  const isOwner = String(comment.sender) === String(actor.id);
  const isManager = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER"].includes(actor.role);

  if (!isOwner && !isManager)
    throw createAppError("You cannot delete this comment.", 403);

  comment.isDeleted = true;
  await comment.save();
  return { success: true };
};

module.exports = { addComment, getComments, deleteComment };
