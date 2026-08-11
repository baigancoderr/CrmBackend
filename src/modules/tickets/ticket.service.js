const Ticket = require("./ticket.model");
const TicketActivity = require("./ticketActivity.model");
const User = require("../user/user.model");
const storageService = require("../../services/storage.service");
const { isValidTicketCategory } = require("./ticket.constants");

// ── Role constants ────────────────────────────────────────────────────────────
const MANAGER_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];
// Roles that can act on an escalated ticket (TL can escalate but cannot resolve after escalation)
const SENIOR_ROLES  = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER"];
const ALL_STAFF_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT", "EMPLOYEE"];

// ── Helpers ───────────────────────────────────────────────────────────────────
const createAppError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const logActivity = async (ticketId, action, performedBy, description = "", oldValue = null, newValue = null) => {
  await TicketActivity.create({
    ticket: ticketId,
    action,
    performedBy: performedBy.id,
    performedByNameSnapshot: performedBy.name || "",
    performedByRoleSnapshot: performedBy.role || "",
    description,
    oldValue,
    newValue,
  });
};

// ── Ticket number generator ───────────────────────────────────────────────────
const generateTicketNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;
  const lastTicket = await Ticket.findOne(
    { ticketNumber: { $regex: `^${prefix}` } },
    { ticketNumber: 1 }
  ).sort({ ticketNumber: -1 });

  let seq = 1;
  if (lastTicket && lastTicket.ticketNumber) {
    const parts = lastTicket.ticketNumber.split("-");
    seq = (parseInt(parts[parts.length - 1], 10) || 0) + 1;
  }
  return `${prefix}${String(seq).padStart(6, "0")}`;
};

// ── Create ticket ─────────────────────────────────────────────────────────────
const createTicket = async (userId, userRole, userName, employeeId, payload, files = []) => {
  const subject = String(payload.subject || "").trim();
  const description = String(payload.description || "").trim();
  const category = String(payload.category || "").trim();
  const priority = String(payload.priority || "MEDIUM").trim().toUpperCase();
  const department = String(payload.department || "").trim();
  const relatedProject = String(payload.relatedProject || "").trim();
  const mentionedUsers = Array.isArray(payload.mentionedUsers) ? payload.mentionedUsers : [];
  const watcherIds = Array.isArray(payload.watchers) ? payload.watchers : [];

  if (!subject) throw createAppError("Subject is required.", 422);
  if (!description) throw createAppError("Description is required.", 422);
  if (!category) throw createAppError("Category is required.", 422);
  if (!isValidTicketCategory(category)) throw createAppError("Invalid category.", 422);

  const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT", "CRITICAL"];
  if (!VALID_PRIORITIES.includes(priority)) throw createAppError("Invalid priority.", 422);

  const ticketNumber = await generateTicketNumber();

  const attachments = [];

  for (const file of files) {
    attachments.push({
      fileName: file.originalname,
      fileUrl: await storageService.persistUploadedFile(file, "tickets"),
      fileSize: file.size,
      mimeType: file.mimetype,
      uploadedBy: userId,
      uploadedBySnapshot: userName,
      uploadedAt: new Date(),
    });
  }

  const ticketData = {
    ticketNumber,
    subject,
    description,
    category,
    priority,
    department,
    relatedProject,
    attachments,
    mentionedUsers,
    watchers: [...new Set([String(userId), ...watcherIds])],
    createdBy: userId,
    createdByNameSnapshot: userName,
    createdByIdSnapshot: employeeId || "",
    status: "OPEN",
  };

  const ticket = await Ticket.create(ticketData);
  await logActivity(ticket._id, "TICKET_CREATED", { id: userId, name: userName, role: userRole },
    `Ticket ${ticketNumber} created.`);

  return Ticket.findById(ticket._id)
    .populate("createdBy", "name employeeId role")
    .populate("assignedTo", "name employeeId role");
};

// ── Assign ticket ─────────────────────────────────────────────────────────────
const assignTicket = async (ticketId, actor, payload) => {
  const assignToId = String(payload.assignedTo || "").trim();
  const note = String(payload.note || "").trim();

  if (!assignToId) throw createAppError("Assignee is required.", 422);

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  const CLOSED_STATUSES = ["CLOSED", "REJECTED"];
  if (CLOSED_STATUSES.includes(ticket.status))
    throw createAppError("Cannot assign a closed or rejected ticket.", 422);

  const assignee = await User.findOne({ _id: assignToId, isActive: true }).select("name employeeId role");
  if (!assignee) throw createAppError("Assignee not found or inactive.", 404);

  // ── Role check: assignee must be a staff-level role (not EMPLOYEE) ────────
  const ASSIGNABLE_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT"];
  if (!ASSIGNABLE_ROLES.includes(assignee.role)) {
    throw createAppError(
      `Cannot assign ticket to ${assignee.name} — role '${assignee.role}' is not allowed as an assignee. Only ${ASSIGNABLE_ROLES.join(", ")} can be assigned tickets.`,
      422
    );
  }

  const oldAssignee = ticket.assignedToNameSnapshot || "Unassigned";

  ticket.assignedTo = assignee._id;
  ticket.assignedToNameSnapshot = assignee.name;
  ticket.assignedBy = actor.id;
  ticket.assignedByNameSnapshot = actor.name;
  ticket.assignedAt = new Date();
  ticket.status = "ASSIGNED";
  if (!ticket.watchers.map(String).includes(String(assignee._id))) {
    ticket.watchers.push(assignee._id);
  }
  await ticket.save();

  await logActivity(ticket._id, "TICKET_ASSIGNED", actor,
    `Ticket assigned to ${assignee.name}${note ? `: ${note}` : ""}`,
    { assignedTo: oldAssignee }, { assignedTo: assignee.name });

  return Ticket.findById(ticket._id)
    .populate("createdBy", "name employeeId role")
    .populate("assignedTo", "name employeeId role")
;
};

// ── Accept ticket (assignee picks it up) ──────────────────────────────────────
const acceptTicket = async (ticketId, actor) => {
  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (String(ticket.assignedTo) !== String(actor.id))
    throw createAppError("You are not the assigned user for this ticket.", 403);

  if (!["ASSIGNED", "ESCALATED"].includes(ticket.status))
    throw createAppError("Only ASSIGNED or ESCALATED tickets can be accepted.", 422);

  ticket.status = "IN_PROGRESS";
  await ticket.save();

  await logActivity(ticket._id, "TICKET_ACCEPTED", actor, "Ticket accepted and work started.");
  return Ticket.findById(ticket._id).populate("assignedTo", "name employeeId role");
};

// ── Transfer ticket ───────────────────────────────────────────────────────────
const transferTicket = async (ticketId, actor, payload) => {
  const newAssigneeId = String(payload.assignedTo || "").trim();
  const reason = String(payload.reason || "").trim();

  if (!newAssigneeId) throw createAppError("Transfer target is required.", 422);

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (!["ASSIGNED", "IN_PROGRESS", "ESCALATED"].includes(ticket.status))
    throw createAppError("Ticket cannot be transferred in its current status.", 422);

  const newAssignee = await User.findOne({ _id: newAssigneeId, isActive: true }).select("name employeeId role");
  if (!newAssignee) throw createAppError("Target user not found or inactive.", 404);

  const ASSIGNABLE_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT"];
  if (!ASSIGNABLE_ROLES.includes(newAssignee.role)) {
    throw createAppError(
      `Cannot transfer ticket to ${newAssignee.name} — role '${newAssignee.role}' is not allowed as an assignee.`,
      422
    );
  }

  const oldAssignee = ticket.assignedToNameSnapshot || "";
  ticket.assignedTo = newAssignee._id;
  ticket.assignedToNameSnapshot = newAssignee.name;
  ticket.assignedBy = actor.id;
  ticket.assignedByNameSnapshot = actor.name;
  ticket.assignedAt = new Date();
  ticket.status = "ASSIGNED";
  await ticket.save();

  await logActivity(ticket._id, "TICKET_REASSIGNED", actor,
    `Ticket transferred from ${oldAssignee} to ${newAssignee.name}. ${reason}`,
    { assignedTo: oldAssignee }, { assignedTo: newAssignee.name });

  return Ticket.findById(ticket._id).populate("assignedTo", "name employeeId role");
};

// ── Change status ─────────────────────────────────────────────────────────────
const changeStatus = async (ticketId, actor, payload) => {
  const newStatus = String(payload.status || "").trim().toUpperCase();
  const note = String(payload.note || "").trim();

  const VALID_STATUSES = [
    "IN_PROGRESS", "WAITING_FOR_RESPONSE", "ON_HOLD",
    "RESOLVED", "CLOSED", "REOPENED",
  ];
  if (!VALID_STATUSES.includes(newStatus))
    throw createAppError(`Status '${newStatus}' cannot be set directly via this endpoint.`, 422);

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  const isCreator = String(ticket.createdBy) === String(actor.id);
  const isAssignee = String(ticket.assignedTo) === String(actor.id);
  const isManager = MANAGER_ROLES.includes(actor.role);
  const isSenior  = SENIOR_ROLES.includes(actor.role);  // can act on escalated tickets

  // Guard: only creator can CLOSE or REOPEN; only assignee/manager can RESOLVE / move to IN_PROGRESS
  if (newStatus === "CLOSED" && !isCreator && !isManager)
    throw createAppError("Only the ticket creator or a manager can close a ticket.", 403);
  if (newStatus === "REOPENED" && !isCreator && !isManager)
    throw createAppError("Only the ticket creator or a manager can reopen a ticket.", 403);
  if (newStatus === "RESOLVED" && !isAssignee && !isManager)
    throw createAppError("Only the assignee or a manager can resolve a ticket.", 403);

  // Guard: if escalated, only SENIOR roles (SUPER_ADMIN, HR, PROJECT_MANAGER) can change working status.
  // TL can escalate tickets but cannot resolve/resume/hold them after escalation.
  if (ticket.isEscalated && !isSenior && ["RESOLVED", "IN_PROGRESS", "WAITING_FOR_RESPONSE", "ON_HOLD"].includes(newStatus))
    throw createAppError("This ticket has been escalated. Only senior management can change its status now.", 403);

  if (newStatus === "REOPENED") {
    const reopenReason = String(payload.reopenReason || "").trim();
    if (!reopenReason) throw createAppError("Reopen reason is required.", 422);
    ticket.reopenedBy = actor.id;
    ticket.reopenedAt = new Date();
    ticket.reopenReason = reopenReason;
    ticket.reopenCount = (ticket.reopenCount || 0) + 1;
  }

  if (newStatus === "RESOLVED") {
    ticket.resolvedBy = actor.id;
    ticket.resolvedByNameSnapshot = actor.name;
    ticket.resolvedAt = new Date();
    ticket.resolutionNote = String(payload.resolutionNote || "").trim();
    ticket.resolutionSummary = String(payload.resolutionSummary || "").trim();
    ticket.timeSpentMinutes = Number(payload.timeSpentMinutes || 0);
  }

  if (newStatus === "CLOSED") {
    ticket.closedBy = actor.id;
    ticket.closedAt = new Date();
  }

  const oldStatus = ticket.status;
  ticket.status = newStatus;
  await ticket.save();

  const actionMap = {
    RESOLVED: "RESOLVED", CLOSED: "CLOSED", REOPENED: "REOPENED",
    WAITING_FOR_RESPONSE: "WAITING_FOR_RESPONSE", ON_HOLD: "ON_HOLD",
    IN_PROGRESS: "STATUS_CHANGED",
  };

  await logActivity(ticket._id, actionMap[newStatus] || "STATUS_CHANGED", actor,
    `Status changed${note ? `: ${note}` : ""}`, { status: oldStatus }, { status: newStatus });

  return Ticket.findById(ticket._id)
    .populate("createdBy", "name employeeId role")
    .populate("assignedTo", "name employeeId role")
;
};

// ── Change priority ───────────────────────────────────────────────────────────
const changePriority = async (ticketId, actor, payload) => {
  const newPriority = String(payload.priority || "").trim().toUpperCase();
  const VALID_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT", "CRITICAL"];
  if (!VALID_PRIORITIES.includes(newPriority)) throw createAppError("Invalid priority.", 422);

  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (["CLOSED", "REJECTED"].includes(ticket.status))
    throw createAppError("Cannot change priority of a closed ticket.", 422);

  const oldPriority = ticket.priority;
  ticket.priority = newPriority;
  await ticket.save();

  await logActivity(ticket._id, "PRIORITY_CHANGED", actor,
    `Priority changed from ${oldPriority} to ${newPriority}`,
    { priority: oldPriority }, { priority: newPriority });

  return Ticket.findById(ticket._id).populate("assignedTo", "name employeeId role");
};

// ── Add watcher ───────────────────────────────────────────────────────────────
const addWatcher = async (ticketId, actor, userId) => {
  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (ticket.watchers.map(String).includes(String(userId)))
    throw createAppError("User is already a watcher.", 422);

  const user = await User.findOne({ _id: userId, isActive: true }).select("name");
  if (!user) throw createAppError("User not found.", 404);

  ticket.watchers.push(userId);
  await ticket.save();

  await logActivity(ticket._id, "WATCHER_ADDED", actor, `${user.name} added as watcher.`);
  return ticket;
};

// ── Remove watcher ────────────────────────────────────────────────────────────
const removeWatcher = async (ticketId, actor, userId) => {
  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  ticket.watchers = ticket.watchers.filter((w) => String(w) !== String(userId));
  await ticket.save();

  await logActivity(ticket._id, "WATCHER_REMOVED", actor, `Watcher removed.`);
  return ticket;
};

// ── Get single ticket ─────────────────────────────────────────────────────────
const getTicketById = async (ticketId, actor) => {
  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false })
    .populate("createdBy", "name employeeId role department")
    .populate("assignedTo", "name employeeId role department")
    .populate("assignedBy", "name employeeId role")
    .populate("resolvedBy", "name employeeId role")
    .populate("closedBy", "name employeeId role")
    .populate("watchers", "name employeeId role")
    .populate("mentionedUsers", "name employeeId role");

  if (!ticket) throw createAppError("Ticket not found.", 404);

  const isCreator = String(ticket.createdBy._id) === String(actor.id);
  const isAssignee = ticket.assignedTo && String(ticket.assignedTo._id) === String(actor.id);
  const isWatcher = ticket.watchers.some((w) => String(w._id) === String(actor.id));
  const isManager = MANAGER_ROLES.includes(actor.role);

  if (!isCreator && !isAssignee && !isWatcher && !isManager)
    throw createAppError("You do not have permission to view this ticket.", 403);

  return ticket;
};

// ── Get my tickets (creator) ──────────────────────────────────────────────────
const getMyTickets = async (userId, query) => {
  const { page = 1, limit = 10, status, priority, category, search } = query;
  const currentPage = Math.max(Number(page) || 1, 1);
  const perPage = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const skip = (currentPage - 1) * perPage;

  const filter = { createdBy: userId, isDeleted: false };
  if (status) filter.status = String(status).trim().toUpperCase();
  if (priority) filter.priority = String(priority).trim().toUpperCase();
  if (category) filter.category = category;
  if (String(search || "").trim()) {
    const regex = new RegExp(String(search).trim(), "i");
    filter.$or = [{ subject: regex }, { ticketNumber: regex }, { description: regex }];
  }

  const totalRecords = await Ticket.countDocuments(filter);
  const data = await Ticket.find(filter)
    .populate("assignedTo", "name employeeId")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(perPage);

  return { page: currentPage, limit: perPage, totalRecords, totalPages: Math.ceil(totalRecords / perPage) || 1, data };
};

// ── Get assigned tickets ──────────────────────────────────────────────────────
const getAssignedTickets = async (userId, query) => {
  const { page = 1, limit = 10, status, priority, search } = query;
  const currentPage = Math.max(Number(page) || 1, 1);
  const perPage = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const skip = (currentPage - 1) * perPage;

  const filter = { assignedTo: userId, isDeleted: false };
  if (status) filter.status = String(status).trim().toUpperCase();
  if (priority) filter.priority = String(priority).trim().toUpperCase();
  if (String(search || "").trim()) {
    const regex = new RegExp(String(search).trim(), "i");
    filter.$or = [{ subject: regex }, { ticketNumber: regex }];
  }

  const totalRecords = await Ticket.countDocuments(filter);
  const data = await Ticket.find(filter)
    .populate("createdBy", "name employeeId department")
    .sort({ priority: -1, createdAt: -1 })
    .skip(skip)
    .limit(perPage);

  return { page: currentPage, limit: perPage, totalRecords, totalPages: Math.ceil(totalRecords / perPage) || 1, data };
};

// ── Get all tickets (managers) ────────────────────────────────────────────────
const getAllTickets = async (actor, query) => {
  const {
    page = 1, limit = 10, status, priority, category, department,
    assignedTo, createdBy, search, ticketNumber,
    fromDate, toDate, sortBy = "createdAt", sortOrder = "desc",
  } = query;

  const currentPage = Math.max(Number(page) || 1, 1);
  const perPage = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const skip = (currentPage - 1) * perPage;

  const filter = { isDeleted: false };

  // TL sees only tickets in their assigned-to scope
  if (actor.role === "TL") filter.assignedTo = actor.id;

  if (status) filter.status = String(status).trim().toUpperCase();
  if (priority) filter.priority = String(priority).trim().toUpperCase();
  if (category) filter.category = category;
  if (department) filter.department = new RegExp(String(department).trim(), "i");
  if (assignedTo) filter.assignedTo = assignedTo;
  if (createdBy) filter.createdBy = createdBy;
  if (ticketNumber) filter.ticketNumber = new RegExp(String(ticketNumber).trim(), "i");

  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const to = new Date(toDate);
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }

  if (String(search || "").trim()) {
    const regex = new RegExp(String(search).trim(), "i");
    filter.$or = [
      { subject: regex }, { ticketNumber: regex },
      { createdByNameSnapshot: regex }, { category: regex },
      { assignedToNameSnapshot: regex }, { department: regex },
    ];
  }

  const sortDir = sortOrder === "asc" ? 1 : -1;
  const allowedSortFields = ["createdAt", "updatedAt", "priority", "status"];
  const sortField = allowedSortFields.includes(sortBy) ? sortBy : "createdAt";

  const totalRecords = await Ticket.countDocuments(filter);
  const data = await Ticket.find(filter)
    .populate("createdBy", "name employeeId department")
    .populate("assignedTo", "name employeeId role")
    .sort({ [sortField]: sortDir })
    .skip(skip)
    .limit(perPage);

  return { page: currentPage, limit: perPage, totalRecords, totalPages: Math.ceil(totalRecords / perPage) || 1, data };
};

// ── Get ticket timeline (activity log) ────────────────────────────────────────
const getTicketTimeline = async (ticketId, actor) => {
  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false }).select("_id createdBy assignedTo");
  if (!ticket) throw createAppError("Ticket not found.", 404);

  const isCreator = String(ticket.createdBy) === String(actor.id);
  const isAssignee = ticket.assignedTo && String(ticket.assignedTo) === String(actor.id);
  const isManager = MANAGER_ROLES.includes(actor.role);
  if (!isCreator && !isAssignee && !isManager)
    throw createAppError("Access denied.", 403);

  return TicketActivity.find({ ticket: ticketId })
    .populate("performedBy", "name employeeId role")
    .sort({ createdAt: 1 });
};

// ── Rate ticket (after closure) ───────────────────────────────────────────────
const rateTicket = async (ticketId, actor, payload) => {
  const ticket = await Ticket.findOne({ _id: ticketId, isDeleted: false });
  if (!ticket) throw createAppError("Ticket not found.", 404);

  if (!["CLOSED", "RESOLVED"].includes(ticket.status))
    throw createAppError("Only resolved or closed tickets can be rated.", 422);
  if (String(ticket.createdBy) !== String(actor.id))
    throw createAppError("Only the ticket creator can rate this ticket.", 403);
  if (ticket.rating) throw createAppError("This ticket has already been rated.", 422);

  const rating = Number(payload.rating);
  if (!rating || rating < 1 || rating > 5) throw createAppError("Rating must be between 1 and 5.", 422);

  ticket.rating = rating;
  ticket.ratingFeedback = String(payload.feedback || "").trim();
  ticket.ratedAt = new Date();
  ticket.ratedBy = actor.id;
  await ticket.save();

  await logActivity(ticket._id, "RATING_ADDED", actor, `Ticket rated ${rating}/5.`);
  return { rating, feedback: ticket.ratingFeedback, ratedAt: ticket.ratedAt };
};

module.exports = {
  createTicket, assignTicket, acceptTicket, transferTicket,
  changeStatus, changePriority, addWatcher, removeWatcher,
  getTicketById, getMyTickets, getAssignedTickets, getAllTickets,
  getTicketTimeline, rateTicket, logActivity,
};
