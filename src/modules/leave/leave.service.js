const Leave = require("./leave.model");
const LeaveBalance = require("./leaveBalance.model");
const User = require("../user/user.model");

const {calculateLeaveDays,hasPendingLeave,getMentionUsers,canApproveLeave,} = require("./leave.helper");

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

  const balance =await LeaveBalance.findOne({
      employeeId,
      year:new Date().getFullYear(),
      isDeleted: false,
      isActive: true,
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
  const {page = 1, imit = 10, status,year,} = query;
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

  const balance = await LeaveBalance.findOne({
      employeeId: leave.employeeId,
      year: new Date().getFullYear(),
      isDeleted: false,
      isActive: true,
    });

  if (!balance) {
    throw new Error(
      "Leave balance not found."
    );
  }

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

const allocateLeaveBalance = async (employeeId,allocatedLeaves,admin) => {
  if (!canApproveLeave(admin.role)) {
    throw new Error(
      "You are not authorized to allocate leave."
    );
  }

  allocatedLeaves = Number(allocatedLeaves);

  if (isNaN(allocatedLeaves) || allocatedLeaves < 0
  ) {
    throw new Error(
      "Invalid allocated leave."
    );
  }

  let balance = await LeaveBalance.findOne({
      employeeId,
      year: new Date().getFullYear(),
      isDeleted: false,
    });

  if (!balance) {
    balance =
      await LeaveBalance.create({
        employeeId,
        allocatedLeaves,
        usedLeaves: 0,
        remainingLeaves:allocatedLeaves,
        year:new Date().getFullYear(),

        lastUpdatedBy:admin._id,
      });

    return balance;
  }

  balance.allocatedLeaves = allocatedLeaves;

  balance.remainingLeaves = Math.max(allocatedLeaves -balance.usedLeaves,0);
  balance.lastUpdatedBy =admin._id;
  await balance.save();

  return await LeaveBalance.findById(
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
};


const getLeaveBalance = async (employeeId) => {const balance =
    await LeaveBalance.findOne({
      employeeId,
      year: new Date().getFullYear(),
      isDeleted: false,
      isActive: true,
    })
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

  if (!balance) {
    throw new Error(
      "Leave balance not found."
    );
  }

  return balance;
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