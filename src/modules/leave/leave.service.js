const Leave = require("./leave.model");
const LeaveBalance = require("./leaveBalance.model");
const User = require("../user/user.model");
const DailyWorkReport = require("../daily-work-report/dailyWorkReport.model");
const notificationService = require("../notifications/notification.service");
const {
  sendLeaveAppliedEmail,
  sendLeaveApprovedEmail,
  sendLeaveRejectedEmail,
} = require("../../utils/email.service");

const {calculateLeaveDays,hasPendingLeave,getMentionUsers,canApproveLeave,} = require("./leave.helper");

const LEAVE_ADMIN_ROLES = ["SUPER_ADMIN", "HR"];
const REPORTING_MANAGER_ROLES = ["PROJECT_MANAGER", "TL", "HR", "SUPER_ADMIN"];
const ANNUAL_LEAVE_LIMIT = 15;
const MONTHLY_LEAVE_CREDIT = 1.25;

const getTlScopedEmployeeIds = async (tlId) => {
  const [byManager, byTeamLeader, byDwr] = await Promise.all([
    User.find({ manager: tlId }).distinct("_id"),
    User.find({ teamLeader: tlId }).distinct("_id"),
    DailyWorkReport.distinct("employee", { reportingManager: tlId }),
  ]);

  return [
    ...new Set(
      [...byManager, ...byTeamLeader, ...byDwr].map((id) => String(id))
    ),
  ];
};

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
  usedLeaves,
  joiningDate,
  year,
  extraLeaves = 0,
}) => {
  const accruedLeaves = getAutoAllocatedLeaves(joiningDate, year);
  // Used leaves are deducted from accrued; extra leaves add to available balance
  const totalAvailable = roundLeaveValue(
    accruedLeaves + Math.max(extraLeaves, 0)
  );
  return roundLeaveValue(Math.max(totalAvailable - Math.max(usedLeaves, 0), 0));
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
  // One balance per employee (unique employeeId) — find without year lock
  let balance = await LeaveBalance.findOne({
    employeeId,
    isDeleted: false,
    isActive: true,
  });

  if (!balance) {
    const allocatedLeaves = clampAnnualLeaves(
      typeof annualAllocation === "number" ? annualAllocation : ANNUAL_LEAVE_LIMIT
    );
    const remainingLeaves = getAccruedRemainingLeaves({
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

  // Keep year current when opening balance in a new calendar year
  if (balance.year !== year) {
    balance.year = year;
  }

  const targetAllocatedLeaves = clampAnnualLeaves(
    typeof annualAllocation === "number" ? annualAllocation : balance.allocatedLeaves
  );
  const nextRemainingLeaves = getAccruedRemainingLeaves({
    usedLeaves: balance.usedLeaves,
    joiningDate,
    year,
    extraLeaves: balance.extraLeaves || 0,
  });
  const shouldUpdate =
    balance.allocatedLeaves !== targetAllocatedLeaves ||
    balance.remainingLeaves !== nextRemainingLeaves ||
    balance.isModified("year") ||
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
    earlyLeaveHours = 0,
    reportingManagerId = "",
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

  if (!["FULL_DAY", "HALF_DAY", "EARLY_LEAVE"].includes(category)) {
    throw new Error(
      "Invalid leave category."
    );
  }

  if (!["LEAVE_BALANCE","SALARY","BOTH","EARLY_LEAVE"].includes(leaveDeductionType)) {
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

  if (category !== "EARLY_LEAVE" && leaveCalculation.totalLeaveDays <=0) {
    throw new Error(
      "No leave days found after excluding weekends and holidays."
    );
  }

  const totalLeaveDays = leaveCalculation.totalLeaveDays;

  if (leaveDeductionType === "EARLY_LEAVE") {
    if (Number(earlyLeaveHours) <= 0) {
      throw new Error(
        "Early leave hours are required."
      );
    }
    if (Number(leaveBalanceDays) !== 0 || Number(salaryDeductionDays) !== 0) {
      throw new Error(
        "Early leave must not deduct from leave balance or salary."
      );
    }
  } else if (leaveDeductionType ==="LEAVE_BALANCE") {
    if (
      Number(leaveBalanceDays) !==
      totalLeaveDays
    ) {
      throw new Error(
        "Leave balance days should equal total leave days."
      );
    }
  } else if (leaveDeductionType ==="SALARY") {
    if (Number(salaryDeductionDays) !==totalLeaveDays) {
      throw new Error(
        "Salary deduction days should equal total leave days."
      );
    }
  } else if (leaveDeductionType === "BOTH") {
    if (Number(leaveBalanceDays) +Number(salaryDeductionDays) !==totalLeaveDays) {
      throw new Error(
        "Leave Balance Days + Salary Deduction Days must equal total leave days."
      );
    }
  }

  const employee = await User.findById(employeeId).select("joiningDate manager teamLeader");
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

  if (leaveDeductionType ==="EARLY_LEAVE") {
    // Early leave does not affect any bucket or salary deduction.
  } else if (leaveDeductionType ==="LEAVE_BALANCE" && balance.remainingLeaves < leaveBalanceDays) {
    throw new Error(
      "Insufficient leave balance."
    );
  } else if (leaveDeductionType === "BOTH" && balance.remainingLeaves <leaveBalanceDays) { 
    throw new Error(
      "Insufficient leave balance."
    );
  }

  const mentionUsers = await getMentionUsers(mentions);

  let selectedManagerId = String(reportingManagerId || "").trim();
  if (!selectedManagerId && employee.manager) {
    selectedManagerId = String(employee.manager);
  }

  if (!selectedManagerId) {
    throw new Error("Reporting manager is required.");
  }

  const reportingManager = await User.findOne({
    _id: selectedManagerId,
    role: { $in: REPORTING_MANAGER_ROLES },
    isActive: true,
  }).select("name employeeId role");

  if (!reportingManager) {
    throw new Error("Please select a valid reporting manager.");
  }

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
      earlyLeaveHours: Number(earlyLeaveHours) || 0,
      reason: reason.trim(),
      attachment,
      mentions:
        mentionUsers.map(
          (user) => user._id
        ),
      reportingManager: reportingManager._id,
      reportingManagerSnapshot: reportingManager.name || "",

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

  try {
    await notificationService.notifyLeaveRequested({
      leave,
      employee: createdLeave?.employeeId,
      reportingManagerId: reportingManager._id,
    });
  } catch (_error) {
    // Do not fail leave creation when notification fanout fails.
  }

  // ── Email notification ───────────────────────────────────────────────────
  // Runs independently — leave is already saved, failure only logs.
  try {
    await sendLeaveAppliedEmail({
      leave,
      employee:            createdLeave?.employeeId,   // populated: { name, employeeId }
      reportingManagerId:  reportingManager._id,
      teamLeaderId:        employee.teamLeader ?? null, // from User.findById above
    });
  } catch (_err) {
    console.error("[Leave] sendLeaveAppliedEmail error:", _err.message);
  }
  // ────────────────────────────────────────────────────────────────────────

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

const getAllLeaves = async (query, reviewer = null) => {
  const {page = 1,limit = 10,search = "",status,employeeId,year,} = query;

  const filter = {isDeleted: false,};

  const currentPage = Math.max(Number(page),1);
  const perPage = Math.max(Number(limit),1);
  const skip = (currentPage - 1) * perPage;

  const emptyResult = {
    page: currentPage,
    limit: perPage,
    totalRecords: 0,
    totalPages: 1,
    data: [],
  };

  // TL sees leaves assigned to them (reportingManager), or from their reportees /
  // DWR team (same people whose worksheets they already review).
  // PM / HR / SUPER_ADMIN see the full list.
  let allowedEmployeeIds = null;
  if (reviewer?.role === "TL") {
    const reviewerId = String(reviewer.id || reviewer._id || "");
    allowedEmployeeIds = await getTlScopedEmployeeIds(reviewerId);

    const leaveOr = [
      { reportingManager: reviewerId },
      { mentions: reviewerId },
    ];

    if (allowedEmployeeIds.length) {
      leaveOr.push({ employeeId: { $in: allowedEmployeeIds } });
    }

    filter.$or = leaveOr;
  }

  if (status) {
    filter.status = status;
  }

  if (employeeId) {
    if (reviewer?.role === "TL") {
      const reviewerId = String(reviewer.id || reviewer._id || "");
      const inTeam = (allowedEmployeeIds || []).includes(String(employeeId));
      if (!inTeam) {
        const assignedToTl = await Leave.exists({
          employeeId,
          isDeleted: false,
          $or: [
            { reportingManager: reviewerId },
            { mentions: reviewerId },
          ],
        });
        if (!assignedToTl) {
          return emptyResult;
        }
      }
    }
    filter.employeeId = employeeId;
  }

  if (year) {
    filter.fromDate = {
      $regex: `^${year}`,
    };
  }

  if (String(search || "").trim()) {
    const userSearchFilter = {
      $or: [
        {
          name: {
            $regex: String(search).trim(),
            $options: "i",
          },
        },
        {
          employeeId: {
            $regex: String(search).trim(),
            $options: "i",
          },
        },
      ],
    };

    if (allowedEmployeeIds && allowedEmployeeIds.length) {
      userSearchFilter._id = { $in: allowedEmployeeIds };
    }

    const users = await User.find(userSearchFilter).select("_id");
    const searchedIds = users.map((u) => u._id);

    if (!searchedIds.length) {
      return emptyResult;
    }

    filter.employeeId = { $in: searchedIds };
  }

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

const assertTlCanManageEmployeeLeave = async (employeeId, approver, leave = null) => {
  if (approver?.role !== "TL") {
    return;
  }

  const reviewerId = String(approver.id || approver._id || "");

  if (
    leave &&
    (String(leave.reportingManager || "") === reviewerId ||
      (Array.isArray(leave.mentions) &&
        leave.mentions.some((id) => String(id) === reviewerId)))
  ) {
    return;
  }

  const scopedIds = await getTlScopedEmployeeIds(reviewerId);
  if (scopedIds.includes(String(employeeId))) {
    return;
  }

  const error = new Error(
    "You can only manage leaves for employees who report to you."
  );
  error.statusCode = 403;
  throw error;
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

  await assertTlCanManageEmployeeLeave(leave.employeeId, approver, leave);

  const employee = await User.findById(leave.employeeId).select("joiningDate");
  if (!employee) {
    throw new Error("Employee not found.");
  }

  const approverId = approver.id || approver._id;

  const balance = await upsertMonthlyLeaveBalance({
    employeeId: leave.employeeId,
    year: new Date().getFullYear(),
    joiningDate: employee.joiningDate,
    adminId: approverId,
  });

  // Leave Balance Validation
  if (leave.leaveDeductionType ==="EARLY_LEAVE") {
    // No balance deduction for early leave.
  } else if (leave.leaveDeductionType ==="LEAVE_BALANCE" &&balance.remainingLeaves <leave.leaveBalanceDays) {
    throw new Error(
      "Insufficient leave balance."
    );
  } else if (leave.leaveDeductionType ==="BOTH" &&balance.remainingLeaves <leave.leaveBalanceDays) {
    throw new Error(
      "Insufficient leave balance."
    );
  }

  // Deduct used leaves from accrued balance and recalculate remaining
  if (leave.leaveDeductionType ==="LEAVE_BALANCE" ||leave.leaveDeductionType ==="BOTH") {
    balance.usedLeaves = roundLeaveValue(
      balance.usedLeaves + leave.leaveBalanceDays
    );
  }

  balance.remainingLeaves = getAccruedRemainingLeaves({
    usedLeaves: balance.usedLeaves,
    joiningDate: employee.joiningDate,
    year: balance.year,
    extraLeaves: balance.extraLeaves || 0,
  });

  // Leave Balance History
  if (leave.leaveBalanceDays > 0) {
    balance.history.push({
      leaveId: leave._id,
      fromDate: leave.fromDate,
      toDate: leave.toDate,
      days: leave.leaveBalanceDays,
      approvedBy: approverId,
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

  leave.approvedBy = approverId;
  leave.approvedAt = new Date();

  leave.updatedBy = approverId;

  await leave.save();

  try {
    await notificationService.notifyLeaveDecision({
      leave,
      action: "APPROVED",
      actorId: approverId,
    });
  } catch (_error) {
    // Keep leave approval resilient if notification fails.
  }

  // ── Email notification ───────────────────────────────────────────────────
  try {
    // Fetch approver name to include in the email
    const approver = await User.findById(approverId).select("name").lean();
    const populatedForEmail = await Leave.findById(leave._id)
      .populate("employeeId", "name employeeId teamLeader")
      .lean();

    await sendLeaveApprovedEmail({
      leave:          populatedForEmail,
      approvedByName: approver?.name || "Manager",
    });
  } catch (_err) {
    console.error("[Leave] sendLeaveApprovedEmail error:", _err.message);
  }
  // ────────────────────────────────────────────────────────────────────────

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

  await assertTlCanManageEmployeeLeave(leave.employeeId, approver, leave);

  const approverId = approver.id || approver._id;

  leave.status = "REJECTED";
  leave.rejectReason = reason?.trim() || "";
  leave.rejectedBy = approverId;
  leave.rejectedAt = new Date();
  leave.updatedBy = approverId;

  await leave.save();

  try {
    await notificationService.notifyLeaveDecision({
      leave,
      action: "REJECTED",
      actorId: approverId,
      reason: leave.rejectReason,
    });
  } catch (_error) {
    // Keep leave rejection resilient if notification fails.
  }

  // ── Email notification ───────────────────────────────────────────────────
  try {
    const rejector = await User.findById(approverId).select("name").lean();
    const populatedForEmail = await Leave.findById(leave._id)
      .populate("employeeId", "name employeeId teamLeader")
      .lean();

    await sendLeaveRejectedEmail({
      leave:          populatedForEmail,
      rejectedByName: rejector?.name || "Manager",
    });
  } catch (_err) {
    console.error("[Leave] sendLeaveRejectedEmail error:", _err.message);
  }
  // ────────────────────────────────────────────────────────────────────────

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

const allocateLeaveBalance = async (
  employeeId,
  allocatedLeaves,
  extraLeaves,
  usedLeaves,
  admin
) => {
  if (!canApproveLeave(admin.role)) {
    throw new Error(
      "You are not authorized to allocate leave."
    );
  }

  // JWT auth sets `id`, not `_id`
  const adminId = admin.id || admin._id || null;

  const employee = await User.findById(employeeId).select("joiningDate");
  if (!employee) {
    throw new Error(
      "Employee not found."
    );
  }

  let annualAllocation;
  if (typeof allocatedLeaves !== "undefined" && allocatedLeaves !== null && allocatedLeaves !== "") {
    const parsedAllocatedLeaves = Number(allocatedLeaves);
    if (Number.isNaN(parsedAllocatedLeaves) || parsedAllocatedLeaves < 0) {
      throw new Error("Invalid allocated leave.");
    }
    annualAllocation = parsedAllocatedLeaves;
  }

  let extraLeavesToAdd;
  if (typeof extraLeaves !== "undefined" && extraLeaves !== null && extraLeaves !== "") {
    const parsedExtraLeaves = Number(extraLeaves);
    if (Number.isNaN(parsedExtraLeaves) || parsedExtraLeaves < 0) {
      throw new Error("Invalid extra leave.");
    }
    extraLeavesToAdd = parsedExtraLeaves;
  }

  // Absolute used count set by HR; remaining = accrued + extra - used
  let usedLeavesToSet;
  if (typeof usedLeaves !== "undefined" && usedLeaves !== null && usedLeaves !== "") {
    const parsedUsedLeaves = Number(usedLeaves);
    if (Number.isNaN(parsedUsedLeaves) || parsedUsedLeaves < 0) {
      throw new Error("Invalid used leave. Must be a non-negative number.");
    }
    usedLeavesToSet = roundLeaveValue(parsedUsedLeaves);
  }

  const year = new Date().getFullYear();
  const balance = await upsertMonthlyLeaveBalance({
    employeeId,
    year,
    joiningDate: employee.joiningDate,
    adminId,
    annualAllocation,
  });

  let balanceChanged = false;

  if (typeof extraLeavesToAdd === "number" && extraLeavesToAdd > 0) {
    balance.extraLeaves = roundLeaveValue(
      roundLeaveValue(balance.extraLeaves || 0) + extraLeavesToAdd
    );
    balanceChanged = true;
  }

  if (typeof usedLeavesToSet === "number") {
    balance.usedLeaves = usedLeavesToSet;
    balance.markModified("usedLeaves");
    balanceChanged = true;
  }

  // Always recalculate remaining from accrued - used + extra when anything changes
  if (balanceChanged || typeof annualAllocation !== "undefined") {
    balance.remainingLeaves = getAccruedRemainingLeaves({
      usedLeaves: balance.usedLeaves,
      joiningDate: employee.joiningDate,
      year,
      extraLeaves: balance.extraLeaves || 0,
    });
    if (adminId) {
      balance.lastUpdatedBy = adminId;
    }
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