const express = require("express");

const router = express.Router();

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const ticketUpload = require("../../middleware/ticketUpload.middleware");
const ticketController = require("./ticket.controller");
const { UPLOAD_MAX_FILES } = require("../../constants/uploadLimits");

// ── Role sets ─────────────────────────────────────────────────────────────────
const ALL_ROLES          = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT", "EMPLOYEE"];
const MANAGER_ROLES      = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];
const ASSIGNEE_ROLES     = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT"];
const DASHBOARD_ROLES    = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER"];

// ── Dashboards ────────────────────────────────────────────────────────────────
router.get(
  "/dashboard/me",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.getEmployeeDashboard
);

router.get(
  "/dashboard/team",
  authMiddleware,
  roleMiddleware(...DASHBOARD_ROLES),
  ticketController.getTeamDashboard
);

router.get(
  "/dashboard/admin",
  authMiddleware,
  roleMiddleware(...DASHBOARD_ROLES),
  ticketController.getAdminDashboard
);

// ── Unread count ──────────────────────────────────────────────────────────────
router.get(
  "/unread-count",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.getMyUnreadCount
);

// ── Ticket list & creation ────────────────────────────────────────────────────
router.post(
  "/",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketUpload.array("attachments", UPLOAD_MAX_FILES.TICKET),
  ticketController.createTicket
);

router.get(
  "/my",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.getMyTickets
);

router.get(
  "/assigned",
  authMiddleware,
  roleMiddleware(...ASSIGNEE_ROLES),
  ticketController.getAssignedTickets
);

router.get(
  "/all",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  ticketController.getAllTickets
);

// ── Single ticket operations ──────────────────────────────────────────────────
router.get(
  "/:id",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.getTicketById
);

router.patch(
  "/:id/assign",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  ticketController.assignTicket
);

router.patch(
  "/:id/accept",
  authMiddleware,
  roleMiddleware(...ASSIGNEE_ROLES),
  ticketController.acceptTicket
);

router.patch(
  "/:id/transfer",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  ticketController.transferTicket
);

router.patch(
  "/:id/status",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.changeStatus
);

router.patch(
  "/:id/priority",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  ticketController.changePriority
);

// ── Watchers ──────────────────────────────────────────────────────────────────
router.post(
  "/:id/watchers",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.addWatcher
);

router.delete(
  "/:id/watchers/:userId",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.removeWatcher
);

// ── Comments ──────────────────────────────────────────────────────────────────
router.post(
  "/:id/comments",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketUpload.array("attachments", UPLOAD_MAX_FILES.TICKET_COMMENT),
  ticketController.addComment
);

router.get(
  "/:id/comments",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.getComments
);

router.delete(
  "/:id/comments/:commentId",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.deleteComment
);

// ── Approvals ─────────────────────────────────────────────────────────────────
router.get(
  "/:id/approvals",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  ticketController.getApprovals
);

router.patch(
  "/:id/approve",
  authMiddleware,
  roleMiddleware(...ASSIGNEE_ROLES),
  ticketController.approveTicket
);

router.patch(
  "/:id/reject",
  authMiddleware,
  roleMiddleware(...ASSIGNEE_ROLES),
  ticketController.rejectApproval
);

// ── Escalation ────────────────────────────────────────────────────────────────
router.patch(
  "/:id/escalate",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  ticketController.escalateTicket
);

router.get(
  "/:id/escalations",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  ticketController.getEscalationLog
);

// ── Timeline & rating ─────────────────────────────────────────────────────────
router.get(
  "/:id/timeline",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.getTimeline
);

router.post(
  "/:id/rate",
  authMiddleware,
  roleMiddleware(...ALL_ROLES),
  ticketController.rateTicket
);

module.exports = router;
