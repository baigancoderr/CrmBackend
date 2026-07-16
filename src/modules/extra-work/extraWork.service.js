const ExtraWork = require("./extraWork.model");
const User = require("../user/user.model");

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/


const BUSINESS_TIMEZONE = "Asia/Kolkata";
const EXTRA_WORK_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
];

const createAppError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const toBusinessDate = (dateValue) => {
  return new Date(
    new Date(dateValue).toLocaleString("en-US", {
      timeZone: BUSINESS_TIMEZONE,
    })
  );
};

const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

const assertWeekdayExtraWorkWindow = (dateValue) => {
  const nowInBusinessTimezone = toBusinessDate(dateValue);

  if (!isWeekend(nowInBusinessTimezone)) {
    const requestStart = new Date(nowInBusinessTimezone);
    requestStart.setHours(19, 0, 0, 0);

    if (nowInBusinessTimezone < requestStart) {
      throw createAppError(
        "Extra work clock in/out is available after 7:00 PM on working days.",
        422
      );
    }
  }
};

const updateExpiredRequests = async (userId = null) => {
  const now = new Date();

  const pendingFilter = {
    status: "PENDING",
    requestExpireAt: { $lt: now },
  };

  const approvedFilter = {
    status: "APPROVED",
    validTill: { $lt: now },
  };

  if (userId) {
    pendingFilter.employee = userId;
    approvedFilter.employee = userId;
  }

  await ExtraWork.updateMany(
    pendingFilter,
    {
      $set: {
        status: "EXPIRED",
      },
    }
  );

  await ExtraWork.updateMany(
    approvedFilter,
    {
      $set: {
        status: "EXPIRED",
      },
    }
  );
};

const calculatePermissionWindow = (requestDate) => {
  const date = toBusinessDate(requestDate);
  const day = date.getDay();

  let validFrom;
  let validTill;

  // Saturday
  if (day === 6) {
    validFrom = new Date(date);
    validFrom.setHours(0, 0, 0, 0);

    validTill = new Date(date);
    validTill.setHours(23, 59, 59, 999);

    return { validFrom, validTill };
  }

  // Sunday
  if (day === 0) {
    validFrom = new Date(date);
    validFrom.setHours(0, 0, 0, 0);

    validTill = new Date(date);
    validTill.setHours(23, 59, 59, 999);

    return { validFrom, validTill };
  }

  // Friday
  if (day === 5) {
    validFrom = new Date(date);
    validFrom.setHours(20, 0, 0, 0);

    validTill = new Date(date);
    validTill.setDate(validTill.getDate() + 3);
    validTill.setHours(9, 0, 0, 0);

    return { validFrom, validTill };
  }

  // Monday - Thursday
  validFrom = new Date(date);
  validFrom.setHours(20, 0, 0, 0);

  validTill = new Date(date);
  validTill.setDate(validTill.getDate() + 1);
  validTill.setHours(9, 0, 0, 0);

  return { validFrom, validTill };
};

const calculateRequestExpiry = (requestDate) => {
  const { validTill } = calculatePermissionWindow(requestDate);
  return validTill;
};

/*
|--------------------------------------------------------------------------
| Request Extra Work
|--------------------------------------------------------------------------
*/

const requestExtraWork = async (userId, reason) => {
  if (!reason || !reason.trim()) {
    throw createAppError("Reason is required.", 422);
  }

  await updateExpiredRequests(userId);

  const now = new Date();

  const pendingRequest = await ExtraWork.findOne({
    employee: userId,
    status: "PENDING",
  });

  if (pendingRequest) {
    throw createAppError("Your previous request is still pending.", 409);
  }

  const approvedRequest = await ExtraWork.findOne({
    employee: userId,
    status: "APPROVED",
    validTill: { $gte: now },
  });

  if (approvedRequest) {
    throw createAppError(
      "You already have an active approved permission.",
      409
    );
  }

  const requestExpireAt = calculateRequestExpiry(now);

  const request = await ExtraWork.create({
    employee: userId,
    requestReason: reason.trim(),
    requestDate: now,
    requestExpireAt,
    status: "PENDING",
  });

  const hrRecipients = await User.find({
    role: {
      $in: ["HR", "SUPER_ADMIN"],
    },
    isActive: true,
  })
    .select("_id role name email employeeId")
    .lean();

  return {
    success: true,
    message: "Extra work request submitted successfully. HR has been notified.",
    notification: {
      targetRoles: ["HR", "SUPER_ADMIN"],
      recipientCount: hrRecipients.length,
      recipients: hrRecipients,
      sentAt: new Date(),
    },
    data: request,
  };
};

/*
|--------------------------------------------------------------------------
| Approve / Reject Extra Work Request
|--------------------------------------------------------------------------
*/

const approveExtraWork = async (requestId, adminId, action) => {
  const normalizedAction = String(action || "")
    .trim()
    .toUpperCase();

  if (!["APPROVED", "REJECTED"].includes(normalizedAction)) {
    throw createAppError("Invalid action.", 422);
  }

  await updateExpiredRequests();

  const request = await ExtraWork.findById(requestId);

  if (!request) {
    throw createAppError("Request not found.", 404);
  }

  if (request.status === "APPROVED") {
    throw createAppError("Request already approved.", 409);
  }

  if (request.status === "REJECTED") {
    throw createAppError("Request already rejected.", 409);
  }

  if (request.status === "EXPIRED") {
    throw createAppError("Request already expired.", 410);
  }

  const now = new Date();

  // Request expired before approval
  if (request.requestExpireAt && request.requestExpireAt < now) {
    request.status = "EXPIRED";
    await request.save();
    throw createAppError("Request has expired.", 410);
  }

  // Reject
  if (normalizedAction === "REJECTED") {
    request.status = "REJECTED";
    request.rejectedAt = now;
    request.approvedBy = adminId;

    await request.save();

    return {
      success: true,
      message: "Request rejected successfully.",
      data: request,
    };
  }

  // Check active permission
  const existingPermission = await ExtraWork.findOne({
    employee: request.employee,
    status: "APPROVED",
    validTill: { $gte: now },
  });

  if (existingPermission) {
    throw createAppError(
      "Employee already has an active approved permission.",
      409
    );
  }

  const { validFrom, validTill } = calculatePermissionWindow(
    request.requestDate
  );

  request.status = "APPROVED";
  request.approvedBy = adminId;
  request.approvedAt = now;
  request.validFrom = validFrom;
  request.validTill = validTill;

  await request.save();

  return {
    success: true,
    message: "Request approved successfully.",
    data: request,
  };
};

/*
|--------------------------------------------------------------------------
| Extra Work Clock In
|--------------------------------------------------------------------------
*/

const extraClockIn = async (userId) => {
  await updateExpiredRequests(userId);

  const now = new Date();
  assertWeekdayExtraWorkWindow(now);

  const permission = await ExtraWork.findOne({
    employee: userId,
    status: "APPROVED",
    validFrom: { $lte: now },
    validTill: { $gte: now },
  }).sort({
    approvedAt: -1,
  });

  if (!permission) {
    throw createAppError(
      "You don't have an active extra work permission.",
      422
    );
  }

  const activeSession = permission.sessions.find(
    (session) => !session.clockOut
  );

  if (activeSession) {
    throw createAppError(
      "You have already clocked in. Please clock out first.",
      409
    );
  }

  permission.sessions.push({
    clockIn: now,
  });

  await permission.save();

  return {
    success: true,
    message: "Extra work clock in successful.",
    data: permission,
  };
};

/*
|--------------------------------------------------------------------------
| Extra Work Clock Out
|--------------------------------------------------------------------------
*/

const extraClockOut = async (userId) => {
  await updateExpiredRequests(userId);

  const now = new Date();
  assertWeekdayExtraWorkWindow(now);

  const permission = await ExtraWork.findOne({
    employee: userId,
    status: "APPROVED",
    validFrom: { $lte: now },
    validTill: { $gte: now },
  }).sort({
    approvedAt: -1,
  });

  if (!permission) {
    throw createAppError(
      "You don't have an active extra work permission.",
      422
    );
  }

  const activeSession = permission.sessions.find(
    (session) => !session.clockOut
  );

  if (!activeSession) {
    throw createAppError(
      "Please clock in before clocking out.",
      409
    );
  }

  activeSession.clockOut = now;

  const durationMinutes = Math.max(
    0,
    Math.floor(
      (activeSession.clockOut.getTime() -
        activeSession.clockIn.getTime()) /
        60000
    )
  );

  activeSession.durationMinutes = durationMinutes;

  permission.totalExtraMinutes = permission.sessions.reduce(
    (total, session) => {
      return total + (session.durationMinutes || 0);
    },
    0
  );

  await permission.save();

  return {
    success: true,
    message: "Extra work clock out successful.",
    data: permission,
  };
};

/*
|--------------------------------------------------------------------------
| Get My Latest Request Status
|--------------------------------------------------------------------------
*/

const getMyRequestStatus = async (userId) => {
  await updateExpiredRequests(userId);

  const request = await ExtraWork.findOne({
    employee: userId,
  })
    .populate(
      "approvedBy",
      "name email employeeId designation"
    )
    .sort({
      createdAt: -1,
    });

  return {
    success: true,
    message: request
      ? "Latest extra work request fetched."
      : "No extra work request found.",
    data: request,
  };
};

/*
|--------------------------------------------------------------------------
| Get My Extra Work Activity
|--------------------------------------------------------------------------
*/

const getMyActivity = async (userId) => {
  await updateExpiredRequests(userId);

  const activities = await ExtraWork.find({
    employee: userId,
  })
    .populate(
      "approvedBy",
      "name email employeeId designation"
    )
    .sort({
      createdAt: -1,
    });

  const totalRequests = activities.length;

  const approvedRequests = activities.filter(
    (item) => item.status === "APPROVED"
  ).length;

  const rejectedRequests = activities.filter(
    (item) => item.status === "REJECTED"
  ).length;

  const pendingRequests = activities.filter(
    (item) => item.status === "PENDING"
  ).length;

  const expiredRequests = activities.filter(
    (item) => item.status === "EXPIRED"
  ).length;

  const totalExtraMinutes = activities.reduce(
    (total, item) => total + (item.totalExtraMinutes || 0),
    0
  );

  return {
    success: true,
    summary: {
      totalRequests,
      approvedRequests,
      rejectedRequests,
      pendingRequests,
      expiredRequests,
      totalExtraMinutes,
    },
    data: activities,
  };
};

/*
|--------------------------------------------------------------------------
| HR - Get All Extra Work Requests
|--------------------------------------------------------------------------
*/

const getAllRequests = async (
  page = 1,
  limit = 10,
  status = null
) => {
  await updateExpiredRequests();

  page = Number(page) || 1;
  limit = Number(limit) || 10;

  const skip = (page - 1) * limit;

  const filter = {};

  if (status) {
    const normalizedStatus = String(status)
      .trim()
      .toUpperCase();

    if (!EXTRA_WORK_STATUSES.includes(normalizedStatus)) {
      throw createAppError("Invalid status filter.", 422);
    }

    filter.status = normalizedStatus;
  }

  const totalRecords = await ExtraWork.countDocuments(filter);

  const requests = await ExtraWork.find(filter)
    .populate(
      "employee",
      "employeeId name email designation department"
    )
    .populate(
      "approvedBy",
      "employeeId name email designation"
    )
    .sort({
      createdAt: -1,
    })
    .skip(skip)
    .limit(limit);

  return {
    success: true,
    pagination: {
      currentPage: page,
      perPage: limit,
      totalRecords,
      totalPages: Math.ceil(totalRecords / limit),
    },
    data: requests,
  };
};


module.exports = {
  requestExtraWork,
  approveExtraWork,
  extraClockIn,
  extraClockOut,
  getMyRequestStatus,
  getMyActivity,
  getAllRequests,
};