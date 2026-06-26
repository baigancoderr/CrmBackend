const ExtraWork = require("./extraWork.model");

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/


const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6;
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
  const date = new Date(requestDate);
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

/*
|--------------------------------------------------------------------------
| Request Extra Work
|--------------------------------------------------------------------------
*/

const requestExtraWork = async (userId, reason) => {
  if (!reason || !reason.trim()) {
    throw new Error("Reason is required.");
  }

  await updateExpiredRequests(userId);

  const now = new Date();
  const day = now.getDay();

  // Monday-Friday request only after 7 PM
  if (!isWeekend(now)) {
    const requestStart = new Date(now);
    requestStart.setHours(19, 0, 0, 0);

    if (now < requestStart) {
      throw new Error(
        "Extra work request can only be submitted after 7:00 PM on working days."
      );
    }
  }

  const pendingRequest = await ExtraWork.findOne({
    employee: userId,
    status: "PENDING",
  });

  if (pendingRequest) {
    throw new Error("Your previous request is still pending.");
  }

  const approvedRequest = await ExtraWork.findOne({
    employee: userId,
    status: "APPROVED",
    validTill: { $gte: now },
  });

  if (approvedRequest) {
    throw new Error("You already have an active approved permission.");
  }

  let requestExpireAt;

  if (isWeekend(now)) {
    requestExpireAt = new Date(now);
    requestExpireAt.setHours(23, 59, 59, 999);
  } else {
    requestExpireAt = new Date(now);
    requestExpireAt.setHours(20, 0, 0, 0);
  }

  const request = await ExtraWork.create({
    employee: userId,
    requestReason: reason.trim(),
    requestDate: now,
    requestExpireAt,
    status: "PENDING",
  });

  return {
    success: true,
    message: "Extra work request submitted successfully.",
    data: request,
  };
};

/*
|--------------------------------------------------------------------------
| Approve / Reject Extra Work Request
|--------------------------------------------------------------------------
*/

const approveExtraWork = async (requestId, adminId, action) => {
  if (!["APPROVED", "REJECTED"].includes(action)) {
    throw new Error("Invalid action.");
  }

  await updateExpiredRequests();

  const request = await ExtraWork.findById(requestId);

  if (!request) {
    throw new Error("Request not found.");
  }

  if (request.status === "APPROVED") {
    throw new Error("Request already approved.");
  }

  if (request.status === "REJECTED") {
    throw new Error("Request already rejected.");
  }

  if (request.status === "EXPIRED") {
    throw new Error("Request already expired.");
  }

  const now = new Date();

  // Request expired before approval
  if (request.requestExpireAt && request.requestExpireAt < now) {
    request.status = "EXPIRED";
    await request.save();
    throw new Error("Request has expired.");
  }

  // Reject
  if (action === "REJECTED") {
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
    throw new Error("Employee already has an active approved permission.");
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

  const permission = await ExtraWork.findOne({
    employee: userId,
    status: "APPROVED",
    validFrom: { $lte: now },
    validTill: { $gte: now },
  }).sort({
    approvedAt: -1,
  });

  if (!permission) {
    throw new Error(
      "You don't have an active extra work permission."
    );
  }

  const activeSession = permission.sessions.find(
    (session) => !session.clockOut
  );

  if (activeSession) {
    throw new Error(
      "You have already clocked in. Please clock out first."
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

  const permission = await ExtraWork.findOne({
    employee: userId,
    status: "APPROVED",
    validFrom: { $lte: now },
    validTill: { $gte: now },
  }).sort({
    approvedAt: -1,
  });

  if (!permission) {
    throw new Error(
      "You don't have an active extra work permission."
    );
  }

  const activeSession = permission.sessions.find(
    (session) => !session.clockOut
  );

  if (!activeSession) {
    throw new Error(
      "Please clock in before clocking out."
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

  if (!request) {
    throw new Error("No extra work request found.");
  }

  return {
    success: true,
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
    filter.status = status;
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