const Leave = require("./leave.model");
const LeaveBalance = require("./leaveBalance.model");
const User = require("../user/user.model");

const {calculateLeaveDays,hasPendingLeave,getMentionUsers,canApproveLeave,} = require("./leave.helper");

const LEAVE_ADMIN_ROLES = ["SUPER_ADMIN", "HR"];
const ANNUAL_LEAVE_LIMIT = 15;
const MONTHLY_LEAVE_CREDIT = 1.25;

const roundLeaveValue = (value = 0) => Number(value.toFixed(2));
const clampAnnualLeaves = (value = ANNUAL_LEAVE_LIMIT) =>
  Math.min(Math.max(roundLeaveValue(value), 0), ANNUAL_LEAVE_LIMIT);

const getEligibleCreditMonths = (joiningDate, year) => {
  const now = new Date();
  const currentYear = now.getFullYear();

  if (year !== currentYear) {
    return year < currentYear ? 12 : 0;
  }

  if (joiningDate) {
    const joining = new Date(joiningDate);

    if (!Number.isNaN(joining.getTime())) {
      const joiningYear = joining.getFullYear();

      if (joiningYear > currentYear) {
        return 0;
      }

      if (joining > now) {
        return 0;
      }
    }
  }

  return now.getMonth() + 1;
};

const getAutoAllocatedLeaves = (joiningDate, year) => {
  const eligibleMonths = getEligibleCreditMonths(joiningDate, year);
  const creditedLeaves = roundLeaveValue(eligibleMonths * MONTHLY_LEAVE_CREDIT);
  return Math.min(creditedLeaves, ANNUAL_LEAVE_LIMIT);
};

const getAccruedRemainingLeaves = ({
  allocatedLeaves,
  usedLeaves,
  joiningDate,
  year,
  extraLeaves = 0,
}) => {
  const accruedLeaves = getAutoAllocatedLeaves(joiningDate, year);
  const spendableLeaves = Math.min(clampAnnualLeaves(allocatedLeaves), accruedLeaves);
  const totalAvailable = roundLeaveValue(spendableLeaves + Math.max(extraLeaves, 0));
  return roundLeaveValue(Math.max(totalAvailable - usedLeaves, 0));
};

const buildLeaveBalanceResponse = (balanceDoc, joiningDate) => {
  const balanceObject =
    typeof balanceDoc?.toObject === "function" ? balanceDoc.toObject() : balanceDoc;
  const accruedLeaves = getAutoAllocatedLeaves(joiningDate, balanceObject.year);

  return {
    ...balanceObject,
    accruedLeaves,
    monthlyCredit: MONTHLY_LEAVE_CREDIT,
    annualLimit: ANNUAL_LEAVE_LIMIT,
  };
};

const upsertMonthlyLeaveBalance = async ({
  employeeId,
  year,
  joiningDate,
  adminId = null,
  annualAllocation,
}) => {
  let balance = await LeaveBalance.findOne({
    employeeId,
    year,
    isDeleted: false,
    isActive: true,
  });

  if (!balance) {
    const allocatedLeaves = clampAnnualLeaves(
      typeof annualAllocation === "number" ? annualAllocation : ANNUAL_LEAVE_LIMIT
    );
    const remainingLeaves = getAccruedRemainingLeaves({
      allocatedLeaves,
      usedLeaves: 0,
      joiningDate,
      year,
      extraLeaves: 0,
    });

    balance = await LeaveBalance.create({
      employeeId,
      allocatedLeaves,
      usedLeaves: 0,
      remainingLeaves,
      year,
      lastUpdatedBy: adminId,
    });

    return balance;
  }

  const targetAllocatedLeaves = clampAnnualLeaves(
    typeof annualAllocation === "number" ? annualAllocation : balance.allocatedLeaves
  );
  const nextRemainingLeaves = getAccruedRemainingLeaves({
    allocatedLeaves: targetAllocatedLeaves,
    usedLeaves: balance.usedLeaves,
    joiningDate,
    year,
    extraLeaves: balance.extraLeaves || 0,
  });
  const shouldUpdate =
    balance.allocatedLeaves !== targetAllocatedLeaves ||
    balance.remainingLeaves !== nextRemainingLeaves ||
    (adminId && String(balance.lastUpdatedBy || "") !== String(adminId));

  if (shouldUpdate) {
    balance.allocatedLeaves = targetAllocatedLeaves;
    balance.remainingLeaves = nextRemainingLeaves;
    if (adminId) {
      balance.lastUpdatedBy = adminId;
    }
    await balance.save();
  }

  return balance;
};

const createLeave = async (body,employeeId) => {
  const {fromDate,toDate,category = "FULL_DAY",reason,attachment = "",mentions = [],
    leaveDeductionType,
    leaveBalanceDays = 0,
    salaryDeductionDays = 0,
  } = body;

  if (!fromDate) {throw new Error("From Date is required.");}

  if (!toDate) {
    throw new Error(
      "To Date is required."
    );
  }

  if (!reason?.trim()) {
    throw new Error(
      "Reason is required."
    );
  }

  if (!["FULL_DAY", "HALF_DAY"].includes(category)) {
    throw new Error(
      "Invalid leave category."
    );
  }

  if (!["LEAVE_BALANCE","SALARY","BOTH",].includes(leaveDeductionType)) {
    throw new Error(
      "Invalid leave deduction type."
    );
  }
  const startDate = new Date(fromDate);
  const endDate = new Date(toDate);

  if (startDate.getTime() >endDate.getTime()) {
    throw new Error(
      "From Date cannot be greater than To Date."
    );
  }

  const pendingLeave = await hasPendingLeave(employeeId);

  if (pendingLeave) {
    throw new Error(
      "You already have a pending leave request."
    );
  }

  const overlapLeave = await Leave.findOne({
      employeeId,
      isDeleted: false,
      status: {
        $nin: [
          "REJECTED",
          "CANCELLED",
        ],
      },
      fromDate: {
        $lte: toDate,
      },
      toDate: {
        $gte: fromDate,
      },
    });

  if (overlapLeave) {
    throw new Error(
      "Leave already exists for the selected dates."
    );
  }

  const leaveCalculation =await calculateLeaveDays(fromDate,toDate,category);

  if (leaveCalculation.totalLeaveDays <=0) {
    throw new Error(
      "No leave days found after excluding weekends and holidays."
    );
  }

  const totalLeaveDays = leaveCalculation.totalLeaveDays;

  if (leaveDeductionType ==="LEAVE_BALANCE") {
    if (
      Number(leaveBalanceDays) !==
      totalLeaveDays
    ) {
      throw new Error(
        "Leave balance days should equal total leave days."
      );
    }
  }

  if (leaveDeductionType ==="SALARY") {
    if (Number(salaryDeductionDays) !==totalLeaveDays) {
      throw new Error(
        "Salary deduction days should equal total leave days."
      );
    }
  }

  if (leaveDeductionType === "BOTH") {
    if (Number(leaveBalanceDays) +Number(salaryDeductionDays) !==totalLeaveDays) {
      throw new Error(
        "Leave Balance Days + Salary Deduction Days must equal total leave days."
      );
    }
  }

  const employee = await User.findById(employeeId).select("joiningDate");
  if (!employee) {
    throw new Error("Employee not found.");
  }

  const balance = await upsertMonthlyLeaveBalance({
    employeeId,
    year: new Date().getFullYear(),
    joiningDate: employee.joiningDate,
  });

  if (!balance) {
    throw new Error(
      "Leave balance not found."
    );
  }

  if (leaveDeductionType ==="LEAVE_BALANCE" && balance.remainingLeaves < leaveBalanceDays) {
    throw new Error(
      "Insufficient leave balance."
    );
  }

  if (leaveDeductionType === "BOTH" && balance.remainingLeaves <leaveBalanceDays) { 
    throw new Error(
      "Insufficient leave balance."
    );
  }

  const mentionUsers = await getMentionUsers(mentions);

  const leave =await Leave.create({
      employeeId,
      fromDate,
      toDate,
      category,
      totalCalendarDays:leaveCalculation.totalCalendarDays,
      totalLeaveDays:leaveCalculation.totalLeaveDays,
      skippedWeekendDays:leaveCalculation.skippedWeekendDays,
      skippedHolidayDays:leaveCalculation.skippedHolidayDays,
      leaveDeductionType,
      leaveBalanceDays,
      salaryDeductionDays,
      reason: reason.trim(),
      attachment,
      mentions:
        mentionUsers.map(
          (user) => user._id
        ),

      createdBy: employeeId,
    });

  const createdLeave =
    await Leave.findById(
      leave._id
    )
      .populate(
        "employeeId",
        "name employeeId role"
      )
      .populate(
        "mentions",
        "name employeeId role"
      )
      .populate(
        "approvedBy",
        "name employeeId role"
      )
      .populate(
        "rejectedBy",
        "name employeeId role"
      );

  return createdLeave;
};


  const getMyLeaves = async (employeeId,query) => {
  const {page = 1, limit = 10, status,year,} = query;
  const filter = {employeeId,isDeleted: false,};

  if (status) {
    filter.status = status;
  }

  if (year) {
    filter.fromDate = {
      $regex: `^${year}`,
    };
  }

  const currentPage = Math.max(
    Number(page),
    1
  );

  const perPage = Math.max(Number(limit),1);
  const skip = (currentPage - 1) * perPage;
  const totalRecords = await Leave.countDocuments(filter);

  const data = await Leave.find(filter)
    .populate(
      "approvedBy",
      "name employeeId role"
    )
    .populate(
      "rejectedBy",
      "name employeeId role"
    )
    .populate(
      "mentions",
      "name employeeId role"
    )
    .sort({
      createdAt: -1,
    })
    .skip(skip)
    .limit(perPage);

  return {
    page: currentPage,
    limit: perPage,
    totalRecords,
    totalPages:
      Math.ceil(
        totalRecords / perPage
      ) || 1,
    data,
  };
};

const getLeaveById = async (id,employeeId) => {
  const leave = await Leave.findOne({_id: id,employeeId,isDeleted: false,})
      .populate(
        "employeeId",
        "name employeeId role"
      )
      .populate(
        "mentions",
        "name employeeId role"
      )
      .populate(
        "approvedBy",
        "name employeeId role"
      )
      .populate(
        "rejectedBy",
        "name employeeId role"
      );

  if (!leave) {
    throw new Error(
      "Leave not found."
    );
  }

  return leave;
};

const cancelLeave = async (id,employeeId) => {
  const leave =await Leave.findOne({
      _id: id,
      employeeId,
      isDeleted: false,
    });

  if (!leave) {
    throw new Error(
      "Leave not found."
    );
  }

  if (
    leave.status !== "PENDING"
  ) {
    throw new Error(
      "Only pending leave can be cancelled."
    );
  }

  leave.status = "CANCELLED";
  leave.updatedBy = employeeId;

  await leave.save();

  return {
    message:
      "Leave cancelled successfully.",
  };
};

const getAllLeaves = async (query) => {
  const {page = 1,limit = 10,search = "",status,employeeId,year,} = query;

  const filter = {isDeleted: false,};

  if (status) {
    filter.status = status;
  }

  if (employeeId) {
    filter.employeeId = employeeId;
  }

  if (year) {
    filter.fromDate = {
      $regex: `^${year}`,
    };
  }

  if (search.trim()) {
    const users = await User.find({
      $or: [
        {
          name: {
            $regex: search.trim(),
            $options: "i",
          },
        },
        {
          employeeId: {
            $regex: search.trim(),
            $options: "i",
          },
        },
      ],
    }).select("_id");

    filter.employeeId = {
      $in: users.map((u) => u._id),
    };
  }

  const currentPage = Math.max(Number(page),1);

  const perPage = Math.max(Number(limit),1);

  const skip = (currentPage - 1) * perPage;

  const totalRecords = await Leave.countDocuments(filter);

  const data = await Leave.find(filter)
    .populate(
      "employeeId",
      "name employeeId role"
    )
    .populate(
      "mentions",
      "name employeeId role"
    )
    .populate(
      "approvedBy",
      "name employeeId role"
    )
    .populate(
      "rejectedBy",
      "name employeeId role"
    )
    .sort({
      createdAt: -1,
    })
    .skip(skip)
    .limit(perPage);

  return {
    page: currentPage,
    limit: perPage,
    totalRecords,
    totalPages:
      Math.ceil(
        totalRecords / perPage
      ) || 1,
    data,
  };
};


const approveLeave = async (id,approver) => {
  if (!canApproveLeave(approver.role)) {
    throw new Error(
      "You are not authorized to approve leave."
    );
  }

  const leave = await Leave.findOne({_id: id,isDeleted: false,});

  if (!leave) {
    throw new Error(
      "Leave not found."
    );
  }

  if (leave.status !== "PENDING") {
    throw new Error(
      "Leave already processed."
    );
  }

  const employee = await User.findById(leave.employeeId).select("joiningDate");
  if (!employee) {
    throw new Error("Employee not found.");
  }

  const balance = await upsertMonthlyLeaveBalance({
    employeeId: leave.employeeId,
    year: new Date().getFullYear(),
    joiningDate: employee.joiningDate,
    adminId: approver._id,
  });

  // Leave Balance Validation
  if (leave.leaveDeductionType ==="LEAVE_BALANCE" &&balance.remainingLeaves <leave.leaveBalanceDays) {
    throw new Error(
      "Insufficient leave balance."
    );
  }

  if (leave.leaveDeductionType ==="BOTH" &&balance.remainingLeaves <leave.leaveBalanceDays) {
    throw new Error(
      "Insufficient leave balance."
    );
  }

  // Deduct Leave Balance
  if (leave.leaveDeductionType ==="LEAVE_BALANCE" ||leave.leaveDeductionType ==="BOTH") {
    balance.usedLeaves +=leave.leaveBalanceDays;

    balance.remainingLeaves -=leave.leaveBalanceDays;}

  // Leave Balance History
  if (leave.leaveBalanceDays > 0) {
    balance.history.push({
      leaveId: leave._id,
      fromDate: leave.fromDate,
      toDate: leave.toDate,
      days: leave.leaveBalanceDays,
      approvedBy: approver._id,
      approvedAt: new Date(),
    });
  }

  // Salary Deduction History
  if (
    leave.salaryDeductionDays > 0
  ) {
    balance.salaryHistory.push({
      leaveId: leave._id,
      employeeId: leave.employeeId,
      fromDate: leave.fromDate,
      toDate: leave.toDate,
      salaryDeductionDays:leave.salaryDeductionDays,
      processedBy: null,
      processedAt: null,
    });
  }

  await balance.save();

  leave.status = "APPROVED";

  leave.approvedBy =approver._id;
  leave.approvedAt = new Date();

  leave.updatedBy = approver._id;

  await leave.save();

  return await Leave.findById(
    leave._id
  )
    .populate(
      "employeeId",
      "name employeeId role"
    )
    .populate(
      "approvedBy",
      "name employeeId role"
    )
    .populate(
      "mentions",
      "name employeeId role"
    )
    .populate(
      "rejectedBy",
      "name employeeId role"
    );
};

const rejectLeave = async (id,reason,approver) => {
  if (!canApproveLeave(approver.role)) {
    throw new Error(
      "You are not authorized to reject leave."
    );
  }

  const leave = await Leave.findOne({
    _id: id,
    isDeleted: false,
  });

  if (!leave) {
    throw new Error("Leave not found.");
  }

  if (leave.status !== "PENDING") {
    throw new Error(
      "Leave already processed."
    );
  }

  leave.status = "REJECTED";
  leave.rejectReason = reason?.trim() || "";
  leave.rejectedBy = approver._id;
  leave.rejectedAt = new Date();
  leave.updatedBy = approver._id;

  await leave.save();

  return await Leave.findById(
    leave._id
  )
    .populate(
      "employeeId",
      "name employeeId role"
    )
    .populate(
      "rejectedBy",
      "name employeeId role"
    )
    .populate(
      "mentions",
      "name employeeId role"
    );
};

const allocateLeaveBalance = async (employeeId,allocatedLeaves,extraLeaves,admin) => {
  if (!canApproveLeave(admin.role)) {
    throw new Error(
      "You are not authorized to allocate leave."
    );
  }

  const employee = await User.findById(employeeId).select("joiningDate");
  if (!employee) {
    throw new Error(
      "Employee not found."
    );
  }

  let annualAllocation;
  if (typeof allocatedLeaves !== "undefined") {
    const parsedAllocatedLeaves = Number(allocatedLeaves);
    if (Number.isNaN(parsedAllocatedLeaves) || parsedAllocatedLeaves < 0) {
      throw new Error("Invalid allocated leave.");
    }
    annualAllocation = parsedAllocatedLeaves;
  }

  let extraLeavesToAdd;
  if (typeof extraLeaves !== "undefined") {
    const parsedExtraLeaves = Number(extraLeaves);
    if (Number.isNaN(parsedExtraLeaves) || parsedExtraLeaves < 0) {
      throw new Error("Invalid extra leave.");
    }
    extraLeavesToAdd = parsedExtraLeaves;
  }

  const year = new Date().getFullYear();
  const balance = await upsertMonthlyLeaveBalance({
    employeeId,
    year,
    joiningDate: employee.joiningDate,
    adminId: admin._id,
    annualAllocation,
  });

  if (typeof extraLeavesToAdd === "number" && extraLeavesToAdd > 0) {
    balance.extraLeaves = roundLeaveValue(
      roundLeaveValue(balance.extraLeaves || 0) + extraLeavesToAdd
    );
    balance.remainingLeaves = getAccruedRemainingLeaves({
      allocatedLeaves: balance.allocatedLeaves,
      usedLeaves: balance.usedLeaves,
      joiningDate: employee.joiningDate,
      year,
      extraLeaves: balance.extraLeaves,
    });
    balance.lastUpdatedBy = admin._id;
    await balance.save();
  }

  const populatedBalance = await LeaveBalance.findById(
    balance._id
  )
    .populate(
      "employeeId",
      "name employeeId role"
    )
    .populate(
      "lastUpdatedBy",
      "name employeeId role"
    )
    .populate(
      "history.leaveId"
    )
    .populate(
      "history.approvedBy",
      "name employeeId role"
    );

  return buildLeaveBalanceResponse(populatedBalance, employee.joiningDate);
};


const getLeaveBalance = async (
  employeeId,
  currentUser
) => {
  const isAdmin = LEAVE_ADMIN_ROLES.includes(
    currentUser.role
  );

  // Employee can view only own balance. HR/Super Admin can view anyone's.
  if (
    !isAdmin &&
    String(currentUser.id) !==
      String(employeeId)
  ) {
    throw new Error(
      "You are not authorized to view this leave balance."
    );
  }

  const employee = await User.findById(employeeId).select("joiningDate");
  if (!employee) {
    throw new Error("Employee not found.");
  }

  const year = new Date().getFullYear();
  const balance = await upsertMonthlyLeaveBalance({
    employeeId,
    year,
    joiningDate: employee.joiningDate,
    adminId: isAdmin ? currentUser.id : null,
  });

  const populatedBalance = await LeaveBalance.findById(balance._id)
      .populate(
        "history.leaveId"
      )
      .populate(
        "history.approvedBy",
        "name employeeId role"
      )
      .populate(
        "lastUpdatedBy",
        "name employeeId role"
      );

  return buildLeaveBalanceResponse(populatedBalance, employee.joiningDate);
};

const completeLeave = async () => {
  const today = new Date()
    .toISOString()
    .split("T")[0];

  const leaves = await Leave.find({
    status: "APPROVED",
    toDate: {
      $lt: today,
    },
    isDeleted: false,
  });

  if (!leaves.length) {
    return {
      completed: 0,
    };
  }

  for (const leave of leaves) {
    leave.status = "COMPLETED";
    leave.completedAt = new Date();

    await leave.save();
  }

  return {
    completed: leaves.length,
  };
};


module.exports = {
  createLeave,
  getMyLeaves,
  getLeaveById,
  getAllLeaves,
  approveLeave,
  rejectLeave,
  cancelLeave,
  allocateLeaveBalance,
  getLeaveBalance,
  completeLeave,
};