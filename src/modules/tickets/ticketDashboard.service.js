const Ticket = require("./ticket.model");

const getEmployeeDashboard = async (userId) => {
  const base = { createdBy: userId, isDeleted: false };

  const [total, open, inProgress, waitingForResponse, resolved, closed, reopened] =
    await Promise.all([
      Ticket.countDocuments(base),
      Ticket.countDocuments({ ...base, status: "OPEN" }),
      Ticket.countDocuments({ ...base, status: "IN_PROGRESS" }),
      Ticket.countDocuments({ ...base, status: "WAITING_FOR_RESPONSE" }),
      Ticket.countDocuments({ ...base, status: "RESOLVED" }),
      Ticket.countDocuments({ ...base, status: "CLOSED" }),
      Ticket.countDocuments({ ...base, status: "REOPENED" }),
    ]);

  const recentTickets = await Ticket.find(base)
    .populate("assignedTo", "name")
    .sort({ createdAt: -1 })
    .limit(5)
    .select("ticketNumber subject status priority category createdAt");

  return {
    summary: { total, open, inProgress, waitingForResponse, resolved, closed, reopened },
    recentTickets,
  };
};

const getTeamDashboard = async (userId) => {
  const base = { assignedTo: userId, isDeleted: false };

  const [assigned, inProgress, escalated] = await Promise.all([
    Ticket.countDocuments({ ...base, status: "ASSIGNED" }),
    Ticket.countDocuments({ ...base, status: "IN_PROGRESS" }),
    Ticket.countDocuments({ ...base, status: "ESCALATED" }),
  ]);

  const priorityBreakdown = await Ticket.aggregate([
    { $match: { ...base, status: { $nin: ["CLOSED", "RESOLVED", "REJECTED"] } } },
    { $group: { _id: "$priority", count: { $sum: 1 } } },
    { $sort: { _id: 1 } },
  ]);

  const urgentTickets = await Ticket.find({
    ...base,
    priority: { $in: ["URGENT", "CRITICAL"] },
    status: { $nin: ["CLOSED", "RESOLVED", "REJECTED"] },
  })
    .populate("createdBy", "name employeeId")
    .sort({ priority: -1, createdAt: 1 })
    .limit(5)
    .select("ticketNumber subject status priority category createdAt");

  return {
    summary: { assigned, inProgress, escalated },
    priorityBreakdown,
    urgentTickets,
  };
};

const getAdminDashboard = async (query = {}) => {
  const { fromDate, toDate } = query;

  const dateFilter = {};
  if (fromDate) dateFilter.$gte = new Date(fromDate);
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    dateFilter.$lte = to;
  }
  const base = { isDeleted: false, ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}) };

  const [total, open, inProgress, resolved, closed, escalated, reopened] = await Promise.all([
    Ticket.countDocuments(base),
    Ticket.countDocuments({ ...base, status: "OPEN" }),
    Ticket.countDocuments({ ...base, status: "IN_PROGRESS" }),
    Ticket.countDocuments({ ...base, status: "RESOLVED" }),
    Ticket.countDocuments({ ...base, status: "CLOSED" }),
    Ticket.countDocuments({ ...base, status: "ESCALATED" }),
    Ticket.countDocuments({ ...base, status: "REOPENED" }),
  ]);

  const byCategory = await Ticket.aggregate([
    { $match: base },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  const byDepartment = await Ticket.aggregate([
    { $match: { ...base, department: { $ne: "" } } },
    { $group: { _id: "$department", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  const byPriority = await Ticket.aggregate([
    { $match: base },
    { $group: { _id: "$priority", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const byStatus = await Ticket.aggregate([
    { $match: base },
    { $group: { _id: "$status", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const byAssignee = await Ticket.aggregate([
    { $match: { ...base, assignedTo: { $ne: null } } },
    { $group: { _id: "$assignedToNameSnapshot", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 10 },
  ]);

  return {
    summary: { total, open, inProgress, resolved, closed, escalated, reopened },
    byCategory,
    byDepartment,
    byPriority,
    byStatus,
    byAssignee,
  };
};

module.exports = {
  getEmployeeDashboard,
  getTeamDashboard,
  getAdminDashboard,
};
