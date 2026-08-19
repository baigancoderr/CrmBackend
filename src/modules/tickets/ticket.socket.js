const { authenticateSocket } = require("../../utils/socketAuth");

let socketIo = null;

const initializeTicketSocket = (io) => {
  socketIo = io;

  // Ticket socket namespace
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.query?.token;

      const user = await authenticateSocket(token);
      socket.user = user;
      next();
    } catch (error) {
      next(new Error(error.message));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.user.id.toString();
    const userRoom = `user:${userId}`;

    // Join user-specific room for ticket notifications
    socket.join(userRoom);
    socket.join("ticket:all"); // Global ticket room

    socket.on("disconnect", () => {
      // Cleanup handled automatically by socket.io
    });
  });
};

/**
 * Emit ticket notification to specific user
 */
const emitTicketNotification = (userId, event, data) => {
  if (!socketIo) {
    return;
  }

  socketIo.to(`user:${userId}`).emit(event, data);
};

/**
 * Emit ticket notification to multiple users
 */
const emitTicketNotificationToUsers = (userIds, event, data) => {
  if (!socketIo || !Array.isArray(userIds)) {
    return;
  }

  userIds.forEach((userId) => {
    if (userId) {
      socketIo.to(`user:${String(userId)}`).emit(event, data);
    }
  });
};

/**
 * Notify when a new ticket is created
 */
const notifyTicketCreated = (ticket, notifyUserIds = []) => {
  const data = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    priority: ticket.priority,
    status: ticket.status,
    createdBy: ticket.createdByNameSnapshot,
    createdAt: ticket.createdAt,
  };

  // Notify the creator
  emitTicketNotification(ticket.createdBy, "ticket:created", data);

  // Notify watchers and other relevant users
  emitTicketNotificationToUsers(notifyUserIds, "ticket:new", data);
};

/**
 * Notify when a ticket is assigned
 */
const notifyTicketAssigned = (ticket, oldAssignee = null) => {
  const data = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    priority: ticket.priority,
    status: ticket.status,
    assignedTo: ticket.assignedToNameSnapshot,
    assignedBy: ticket.assignedByNameSnapshot,
    assignedAt: ticket.assignedAt,
  };

  // Notify the new assignee
  if (ticket.assignedTo) {
    emitTicketNotification(ticket.assignedTo, "ticket:assigned", data);
  }

  // Notify the creator
  emitTicketNotification(ticket.createdBy, "ticket:updated", data);

  // Notify old assignee if transferred
  if (oldAssignee && oldAssignee !== String(ticket.assignedTo)) {
    emitTicketNotification(oldAssignee, "ticket:unassigned", data);
  }

  // Notify all watchers
  if (ticket.watchers && ticket.watchers.length > 0) {
    emitTicketNotificationToUsers(
      ticket.watchers.filter(
        (w) => String(w) !== String(ticket.assignedTo) && String(w) !== String(ticket.createdBy)
      ),
      "ticket:updated",
      data
    );
  }
};

/**
 * Notify when ticket status changes
 */
const notifyTicketStatusChanged = (ticket, oldStatus, newStatus) => {
  const data = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    oldStatus,
    newStatus,
    priority: ticket.priority,
    updatedAt: new Date(),
  };

  // Notify creator
  emitTicketNotification(ticket.createdBy, "ticket:status_changed", data);

  // Notify assignee
  if (ticket.assignedTo) {
    emitTicketNotification(ticket.assignedTo, "ticket:status_changed", data);
  }

  // Notify watchers
  if (ticket.watchers && ticket.watchers.length > 0) {
    emitTicketNotificationToUsers(
      ticket.watchers.filter(
        (w) => String(w) !== String(ticket.createdBy) && String(w) !== String(ticket.assignedTo)
      ),
      "ticket:status_changed",
      data
    );
  }
};

/**
 * Notify when ticket priority changes
 */
const notifyTicketPriorityChanged = (ticket, oldPriority, newPriority) => {
  const data = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    oldPriority,
    newPriority,
    status: ticket.status,
    updatedAt: new Date(),
  };

  // Notify creator
  emitTicketNotification(ticket.createdBy, "ticket:priority_changed", data);

  // Notify assignee
  if (ticket.assignedTo) {
    emitTicketNotification(ticket.assignedTo, "ticket:priority_changed", data);
  }

  // Notify watchers
  if (ticket.watchers && ticket.watchers.length > 0) {
    emitTicketNotificationToUsers(
      ticket.watchers.filter(
        (w) => String(w) !== String(ticket.createdBy) && String(w) !== String(ticket.assignedTo)
      ),
      "ticket:priority_changed",
      data
    );
  }
};

/**
 * Notify when a comment is added
 */
const notifyTicketComment = (ticket, commentAuthor, commentText) => {
  const data = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    commentAuthor,
    commentPreview: commentText.substring(0, 100),
    createdAt: new Date(),
  };

  // Notify creator (if not the comment author)
  if (String(ticket.createdBy) !== commentAuthor._id) {
    emitTicketNotification(ticket.createdBy, "ticket:comment", data);
  }

  // Notify assignee (if not the comment author)
  if (ticket.assignedTo && String(ticket.assignedTo) !== commentAuthor._id) {
    emitTicketNotification(ticket.assignedTo, "ticket:comment", data);
  }

  // Notify watchers (excluding comment author)
  if (ticket.watchers && ticket.watchers.length > 0) {
    emitTicketNotificationToUsers(
      ticket.watchers.filter((w) => String(w) !== commentAuthor._id),
      "ticket:comment",
      data
    );
  }
};

/**
 * Notify when a ticket is escalated
 */
const notifyTicketEscalated = (ticket, escalatedBy, escalatedToLevel) => {
  const data = {
    ticketId: ticket._id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    priority: ticket.priority,
    escalatedBy,
    escalatedToLevel,
    escalatedAt: new Date(),
  };

  // Notify creator
  emitTicketNotification(ticket.createdBy, "ticket:escalated", data);

  // Notify assignee
  if (ticket.assignedTo) {
    emitTicketNotification(ticket.assignedTo, "ticket:escalated", data);
  }

  // Notify watchers
  if (ticket.watchers && ticket.watchers.length > 0) {
    emitTicketNotificationToUsers(ticket.watchers, "ticket:escalated", data);
  }
};

/**
 * Emit unread count update to a user
 */
const emitUnreadCount = (userId, count) => {
  if (!socketIo) {
    return;
  }

  socketIo.to(`user:${userId}`).emit("ticket:unread_count", { count });
};

const emitUnreadCountToUsers = (userIds, count) => {
  if (!socketIo || !Array.isArray(userIds)) {
    return;
  }

  userIds.forEach((userId) => {
    if (userId) {
      emitUnreadCount(String(userId), count);
    }
  });
};

module.exports = {
  initializeTicketSocket,
  notifyTicketCreated,
  notifyTicketAssigned,
  notifyTicketStatusChanged,
  notifyTicketPriorityChanged,
  notifyTicketComment,
  notifyTicketEscalated,
  emitUnreadCount,
  emitUnreadCountToUsers,
};
