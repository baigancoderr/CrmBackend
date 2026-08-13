const ticketService = require("./ticket.service");
const ticketCommentService = require("./ticketComment.service");
const ticketApprovalService = require("./ticketApproval.service");
const ticketEscalationService = require("./ticketEscalation.service");
const ticketDashboardService = require("./ticketDashboard.service");

// ── Ticket CRUD ───────────────────────────────────────────────────────────────
const createTicket = async (req, res) => {
  try {
    const data = await ticketService.createTicket(
      req.user.id,
      req.user.role,
      req.user.name,
      req.user.employeeId || "",
      req.body,
      req.files || []
    );
    return res.status(201).json({ success: true, message: "Ticket created successfully.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getMyTickets = async (req, res) => {
  try {
    const data = await ticketService.getMyTickets(req.user.id, req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getAssignedTickets = async (req, res) => {
  try {
    const data = await ticketService.getAssignedTickets(req.user.id, req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getAllTickets = async (req, res) => {
  try {
    const data = await ticketService.getAllTickets(req.user, req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getTicketById = async (req, res) => {
  try {
    const data = await ticketService.getTicketById(req.params.id, req.user);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Assignment & workflow ─────────────────────────────────────────────────────
const assignTicket = async (req, res) => {
  try {
    const data = await ticketService.assignTicket(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Ticket assigned successfully.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const acceptTicket = async (req, res) => {
  try {
    const data = await ticketService.acceptTicket(req.params.id, req.user);
    return res.status(200).json({ success: true, message: "Ticket accepted. Work started.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const transferTicket = async (req, res) => {
  try {
    const data = await ticketService.transferTicket(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Ticket transferred successfully.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const changeStatus = async (req, res) => {
  try {
    const data = await ticketService.changeStatus(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Ticket status updated.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const changePriority = async (req, res) => {
  try {
    const data = await ticketService.changePriority(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Priority updated.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Watchers ──────────────────────────────────────────────────────────────────
const addWatcher = async (req, res) => {
  try {
    const data = await ticketService.addWatcher(req.params.id, req.user, req.body.userId);
    return res.status(200).json({ success: true, message: "Watcher added.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const removeWatcher = async (req, res) => {
  try {
    const data = await ticketService.removeWatcher(req.params.id, req.user, req.params.userId);
    return res.status(200).json({ success: true, message: "Watcher removed.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Timeline & rating ─────────────────────────────────────────────────────────
const getTimeline = async (req, res) => {
  try {
    const data = await ticketService.getTicketTimeline(req.params.id, req.user);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const rateTicket = async (req, res) => {
  try {
    const data = await ticketService.rateTicket(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Rating submitted. Thank you!", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Comments ──────────────────────────────────────────────────────────────────
const addComment = async (req, res) => {
  try {
    const data = await ticketCommentService.addComment(req.params.id, req.user, req.body, req.files || []);
    return res.status(201).json({ success: true, message: "Comment added.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getComments = async (req, res) => {
  try {
    const data = await ticketCommentService.getComments(req.params.id, req.user);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const deleteComment = async (req, res) => {
  try {
    await ticketCommentService.deleteComment(req.params.commentId, req.user);
    return res.status(200).json({ success: true, message: "Comment deleted." });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Approvals ─────────────────────────────────────────────────────────────────
const getApprovals = async (req, res) => {
  try {
    const data = await ticketApprovalService.getApprovals(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const approveTicket = async (req, res) => {
  try {
    const data = await ticketApprovalService.approveTicket(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Step approved successfully.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const rejectApproval = async (req, res) => {
  try {
    const data = await ticketApprovalService.rejectTicket(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Ticket rejected.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Escalation ────────────────────────────────────────────────────────────────
const escalateTicket = async (req, res) => {
  try {
    const data = await ticketEscalationService.escalateTicket(req.params.id, req.user, req.body);
    return res.status(200).json({ success: true, message: "Ticket escalated.", data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getEscalationLog = async (req, res) => {
  try {
    const data = await ticketEscalationService.getEscalationLog(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Dashboards ────────────────────────────────────────────────────────────────
const getEmployeeDashboard = async (req, res) => {
  try {
    const data = await ticketDashboardService.getEmployeeDashboard(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getTeamDashboard = async (req, res) => {
  try {
    const data = await ticketDashboardService.getTeamDashboard(req.user.id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

const getAdminDashboard = async (req, res) => {
  try {
    const data = await ticketDashboardService.getAdminDashboard(req.query);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

// ── Unread count ──────────────────────────────────────────────────────────────
const getMyUnreadCount = async (req, res) => {
  try {
    const count = await ticketService.getMyUnreadCount(req.user.id);
    return res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    return res.status(error.statusCode || 400).json({ success: false, message: error.message });
  }
};

module.exports = {
  // Ticket CRUD
  createTicket, getMyTickets, getAssignedTickets, getAllTickets, getTicketById,
  // Workflow
  assignTicket, acceptTicket, transferTicket, changeStatus, changePriority,
  // Watchers
  addWatcher, removeWatcher,
  // Timeline & rating
  getTimeline, rateTicket,
  // Comments
  addComment, getComments, deleteComment,
  // Approvals
  getApprovals, approveTicket, rejectApproval,
  // Escalation
  escalateTicket, getEscalationLog,
  // Dashboards
  getEmployeeDashboard, getTeamDashboard, getAdminDashboard,
  // Unread count
  getMyUnreadCount,
};
