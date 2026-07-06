const Leave = require("./leave.model");
const Holiday = require("../holiday/holiday.model");
const User = require("../user/user.model");

const getDatesBetween = (fromDate, toDate) => {
  const dates = [];

  let current = new Date(fromDate);
  const end = new Date(toDate);

  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
};

const isWeekend = (date) => {
  const day = new Date(date).getDay();
  return day === 0 || day === 6;
};

const isHoliday = async (date) => {
  const holiday = await Holiday.findOne({
    isDeleted: false,
    isActive: true,
    fromDate: { $lte: date },
    toDate: { $gte: date },
  });

  return !!holiday;
};

const calculateLeaveDays = async (
  fromDate,
  toDate,
  category
) => {
  if (category === "HALF_DAY") {
    return {
      totalCalendarDays: 0.5,
      totalLeaveDays: 0.5,
      skippedWeekendDays: 0,
      skippedHolidayDays: 0,
    };
  }

  const dates = getDatesBetween(
    fromDate,
    toDate
  );

  let totalLeaveDays = 0;
  let skippedWeekendDays = 0;
  let skippedHolidayDays = 0;

  for (const date of dates) {
    if (isWeekend(date)) {
      skippedWeekendDays++;
      continue;
    }

    const holiday = await isHoliday(date);

    if (holiday) {
      skippedHolidayDays++;
      continue;
    }

    totalLeaveDays++;
  }

  return {
    totalCalendarDays: dates.length,
    totalLeaveDays,
    skippedWeekendDays,
    skippedHolidayDays,
  };
};

const hasPendingLeave = async (employeeId) => {
  return await Leave.findOne({
    employeeId,
    status: "PENDING",
    isDeleted: false,
  });
};

const getMentionUsers = async (mentionIds = []) => {

     mentionIds = [
    ...new Set(
      mentionIds.map(String)
    ),
  ];
  if (!mentionIds.length) {
    return [];
  }

  const allowedRoles = [
    "HR",
    "TL",
    "PROJECT_MANAGER",
    "SUPER_ADMIN",
  ];

  const users = await User.find({
    _id: {
      $in: mentionIds,
    },
    role: {
      $in: allowedRoles,
    },
  }).select(
    "_id name employeeId role"
  );

  if (
    users.length !== mentionIds.length
  ) {
    throw new Error(
      "Only HR, TL, Project Manager and Super Admin can be mentioned."
    );
  }

  return users;
};

const APPROVER_ROLES = [
  "HR",
  "PROJECT_MANAGER",
  "SUPER_ADMIN",
];


const canApproveLeave = (role) => {
  return APPROVER_ROLES.includes(role);
};

module.exports = {
  getDatesBetween,
  isWeekend,
  isHoliday,
  calculateLeaveDays,
  hasPendingLeave,
  getMentionUsers,
  APPROVER_ROLES,
  canApproveLeave,
};