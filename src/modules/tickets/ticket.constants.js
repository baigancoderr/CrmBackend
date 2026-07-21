const TICKET_CATEGORIES = Object.freeze([
  "IT Support",
  "HR",
  "Finance",
  "Admin",
  "Project",
  "General",
]);

const isValidTicketCategory = (value) =>
  TICKET_CATEGORIES.includes(String(value || "").trim());

module.exports = { TICKET_CATEGORIES, isValidTicketCategory };
