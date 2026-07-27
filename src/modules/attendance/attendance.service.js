const Attendance = require("./attendance.model");
const User = require("../user/user.model");
const mongoose = require("mongoose");
const ProcessedBiometricPunch = require("../biometric/processedPunch.model");
const {
  getBiometricSyncStatus,
} = require("../biometric/biometricSync.service");
const {
  fetchBiometricInOutRecords,
  fetchBiometricInOutForUser,
  fetchBiometricInOutForRange,
} = require("../biometric/biometricInOut.service");
const {
  getTodayDateKey,
  getDateKeyFromDate,
  parseIstTimeOnDate,
  parseBiometricPunchDateString,
  formatIstTimePart,
  isIstWeekendNow,
  isIstWeekendDateKey,
  getIstDayBounds,
  getIstWeekdayShort,
} = require("../../utils/istDateTime");
const {
  derivePunchTimeline,
  parseDurationToMinutes,
} = require("./punchTimeline");

const getTodayDate = () => getTodayDateKey();

const parseBiometricPunchDate = (punchDateString) =>
  parseBiometricPunchDateString(punchDateString);

const getDateKey = (dateValue) => getDateKeyFromDate(dateValue);

const getAttendanceEmployeeSnapshot = (user) => ({
  employeeId: user?.employeeId || "",
  employeeName: user?.name || "",
  biometricEmpCode: user?.biometricEmpCode || "",
});

const ensureDailyAttendanceRecords = async (dateKey) => {
  const targetDate = dateKey || getTodayDate();

  const activeEmployees = await User.find({
    isActive: true,
  })
    .select("employeeId biometricEmpCode name")
    .lean();

  if (activeEmployees.length === 0) {
    return {
      success: true,
      date: targetDate,
      createdCount: 0,
      totalEmployees: 0,
    };
  }

  const existingRecords = await Attendance.find({
    date: targetDate,
    employee: {
      $in: activeEmployees.map((employee) => employee._id),
    },
  })
    .select("employee")
    .lean();

  const existingEmployeeIds = new Set(
    existingRecords.map((record) => String(record.employee))
  );

  const missingRecords = activeEmployees
    .filter(
      (employee) =>
        !existingEmployeeIds.has(String(employee._id))
    )
    .map((employee) => ({
      employee: employee._id,
      date: targetDate,
      ...getAttendanceEmployeeSnapshot(employee),
      status: "ABSENT",
    }));

  if (missingRecords.length > 0) {
    await Attendance.insertMany(missingRecords, {
      ordered: false,
    });
  }

  return {
    success: true,
    date: targetDate,
    createdCount: missingRecords.length,
    totalEmployees: activeEmployees.length,
  };
};

// Attendance status rules:
// Check-in: 10:00–10:10 = Present, after 10:10 = Late
// Check-out: before 16:00 = Half Day, 16:00–18:59 = Early Leave, 19:00+ = Normal checkout
const ATTENDANCE_RULES = {
  LATE_GRACE_MINUTES: 10,
  HALF_DAY_CHECKOUT_TIME: "16:00",
};

const getOfficeTimes = (user, dateKey) => {
  const startTime = user?.officeTiming?.startTime || "10:00";
  const endTime = user?.officeTiming?.endTime || "19:00";
  const halfDayCutoff =
    user?.officeTiming?.halfDayCutoff ||
    ATTENDANCE_RULES.HALF_DAY_CHECKOUT_TIME;

  const officeStart = parseIstTimeOnDate(dateKey, `${startTime}:00`);
  const officeEnd = parseIstTimeOnDate(dateKey, `${endTime}:00`);
  const lateGraceEnd = new Date(
    officeStart.getTime() +
      ATTENDANCE_RULES.LATE_GRACE_MINUTES * 60000
  );
  const halfDayCutoffTime = parseIstTimeOnDate(
    dateKey,
    `${halfDayCutoff}:00`
  );

  return {
    officeStart,
    officeEnd,
    lateGraceEnd,
    halfDayCutoffTime,
  };
};

const calculateAttendanceMetrics = (
  clockInDate,
  clockOutDate,
  user,
  dateKey,
  options = {}
) => {
  const {
    officeStart,
    officeEnd,
    lateGraceEnd,
    halfDayCutoffTime,
  } = getOfficeTimes(user, dateKey);

  // Mid-day break/out punches must not flip status to Half Day / Early Leave.
  const applyCheckoutStatus = options.applyCheckoutStatus !== false;

  let lateMinutes = 0;
  let overtimeMinutes = 0;
  let shortfallMinutes = 0;
  let workingMinutes = 0;
  let status = "ABSENT";

  if (clockInDate) {
    // Check-in: Present within grace window, Late after grace end time.
    status = "PRESENT";
    if (clockInDate > lateGraceEnd) {
    lateMinutes = Math.floor(
      (clockInDate - lateGraceEnd) / 60000
    );
    status = "LATE";
    }
  }

  if (clockInDate && clockOutDate) {
    // Working clock starts from office start time if employee checks in early.
    const effectiveWorkStart =
      clockInDate < officeStart ? officeStart : clockInDate;
    workingMinutes = Math.floor(
      Math.max(clockOutDate - effectiveWorkStart, 0) / 60000
    );

    // Provisional mid-day outs (break) should not create shortfall / early-leave metrics.
    if (applyCheckoutStatus) {
      if (clockOutDate > officeEnd) {
        overtimeMinutes = Math.floor(
          (clockOutDate - officeEnd) / 60000
        );
      }

      if (clockOutDate < officeEnd) {
        shortfallMinutes = Math.floor(
          (officeEnd - clockOutDate) / 60000
        );
      }

      if (clockOutDate < halfDayCutoffTime) {
        status = "HALF_DAY";
      } else if (clockOutDate < officeEnd) {
        status = "EARLY_LEAVE";
      }
      // 19:00 or later keeps Present/Late from check-in
    }
  }

  return {
    lateMinutes,
    overtimeMinutes,
    shortfallMinutes,
    earlyOutMinutes: shortfallMinutes,
    workingMinutes,
    status,
  };
};

const shouldApplyCheckoutStatus = (dateKey, officeEnd) => {
  const today = getTodayDateKey();

  if (dateKey < today) {
    return true;
  }

  if (dateKey > today) {
    return false;
  }

  return new Date() >= officeEnd;
};

const resolveShiftState = (attendance, user, dateKey) => {
  if (!attendance?.clockIn) {
    return "NOT_STARTED";
  }

  // Simple model: clock in + clock out = day done. No mid-day break state.
  if (attendance?.clockOut) {
    return "COMPLETED";
  }

  return "ON_SHIFT";
};

const getExistingPunchTimes = (attendance) => {
  if (!attendance) {
    return [];
  }

  if (Array.isArray(attendance.punches) && attendance.punches.length > 0) {
    return attendance.punches;
  }

  const legacy = [];

  if (attendance.clockIn) {
    legacy.push(attendance.clockIn);
  }

  if (attendance.clockOut) {
    legacy.push(attendance.clockOut);
  }

  return legacy;
};

const applyTimelineMetrics = (
  attendance,
  timeline,
  user,
  dateKey,
  source = "BIOMETRIC",
  eventBy = null
) => {
  const previousClockIn = attendance.clockIn
    ? new Date(attendance.clockIn)
    : null;
  const previousClockOut = attendance.clockOut
    ? new Date(attendance.clockOut)
    : null;

  attendance.punches = timeline.punches;
  attendance.breaks = timeline.breaks;
  attendance.totalBreakMinutes = timeline.totalBreakMinutes;

  // Preserve employee/HR manual timestamps when present.
  if (
    previousClockIn &&
    attendance.clockInSource === "MANUAL" &&
    source !== "MANUAL"
  ) {
    attendance.clockIn = previousClockIn;
  } else {
    attendance.clockIn = timeline.clockIn;
  }

  if (
    previousClockOut &&
    attendance.clockOutSource === "MANUAL" &&
    source !== "MANUAL"
  ) {
    attendance.clockOut = previousClockOut;
  } else {
    attendance.clockOut = timeline.clockOut;
  }

  if (attendance.clockIn) {
    if (
      !(
        attendance.clockInSource === "MANUAL" &&
        previousClockIn &&
        source !== "MANUAL"
      )
    ) {
      attendance.clockInSource = source;
    }
  }

  if (attendance.clockOut) {
    if (
      !(
        attendance.clockOutSource === "MANUAL" &&
        previousClockOut &&
        source !== "MANUAL"
      )
    ) {
      attendance.clockOutSource = source;
    }
  }

  // Keep HR/audit trail light: only first in + latest out events.
  if (
    attendance.clockIn &&
    (!previousClockIn ||
      new Date(attendance.clockIn).getTime() !== previousClockIn.getTime())
  ) {
    addPunchEvent(attendance, {
      action: "CLOCK_IN",
      source: attendance.clockInSource || source,
      time: attendance.clockIn,
      by: eventBy,
      note:
        (attendance.clockInSource || source) === "BIOMETRIC"
          ? "Biometric clock in"
          : "Manual clock in by employee",
    });
  }

  if (
    attendance.clockOut &&
    (!previousClockOut ||
      new Date(attendance.clockOut).getTime() !== previousClockOut.getTime())
  ) {
    addPunchEvent(attendance, {
      action: "CLOCK_OUT",
      source: attendance.clockOutSource || source,
      time: attendance.clockOut,
      by: eventBy,
      note:
        (attendance.clockOutSource || source) === "BIOMETRIC"
          ? "Biometric clock out"
          : "Manual clock out by employee",
    });
  }

  const { officeEnd } = getOfficeTimes(user, dateKey);
  const applyCheckoutStatus =
    Boolean(attendance.clockOut) &&
    shouldApplyCheckoutStatus(dateKey, officeEnd);

  const metrics = calculateAttendanceMetrics(
    attendance.clockIn,
    attendance.clockOut,
    user,
    dateKey,
    {
      totalBreakMinutes: timeline.totalBreakMinutes,
      applyCheckoutStatus,
    }
  );

  attendance.lateMinutes = metrics.lateMinutes;
  attendance.overtimeMinutes = metrics.overtimeMinutes;
  attendance.shortfallMinutes = metrics.shortfallMinutes;
  attendance.earlyOutMinutes = metrics.earlyOutMinutes;
  attendance.workingMinutes = metrics.workingMinutes;
  attendance.status = metrics.status;

  // While still on shift (odd punches), store net worked so far from last punch.
  if (
    !attendance.clockOut &&
    attendance.clockIn &&
    timeline.punches.length > 0
  ) {
    const lastPunch = timeline.punches[timeline.punches.length - 1];
    attendance.workingMinutes = Math.max(
      0,
      Math.floor(
        (lastPunch.getTime() - new Date(attendance.clockIn).getTime()) / 60000
      )
    );
  }
};

const addPunchEvent = (attendance, event) => {
  if (!attendance.punchEvents) {
    attendance.punchEvents = [];
  }

  const eventTime = new Date(event.time);
  const eventTimestamp = eventTime.getTime();

  const alreadyExists = attendance.punchEvents.some((item) => {
    const itemTime = new Date(item.time).getTime();

    return (
      item.action === event.action &&
      item.source === event.source &&
      itemTime === eventTimestamp
    );
  });

  if (!alreadyExists) {
    let byId = null;
    if (event.by) {
      try {
        byId = new mongoose.Types.ObjectId(String(event.by));
      } catch (error) {
        byId = null;
      }
    }

    attendance.punchEvents.push({
      action: event.action,
      source: event.source,
      time: eventTime,
      by: byId,
      byName: event.byName || "",
      byEmployeeId: event.byEmployeeId || "",
      byRole: event.byRole || "",
      note: event.note || "",
      previousTime: event.previousTime || null,
      changedAt: event.changedAt || new Date(),
    });
  }
};

const wasClockOutRevoked = (attendance) => {
  if (!attendance || attendance.clockOut) {
    return false;
  }

  const events = Array.isArray(attendance.punchEvents)
    ? attendance.punchEvents
    : [];

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const note = String(events[i]?.note || "").toLowerCase();
    if (note.includes("clock out revoked")) {
      return true;
    }
  }

  return false;
};

// Fully lock only when biometric must not touch the day at all.
// Empty clockIn/clockOut still fill from biometric; set MANUAL values stay.
const hasProtectedManualPunch = (attendance) => {
  if (!attendance) {
    return false;
  }

  if (
    attendance.isManuallyUpdated &&
    (attendance.status === "ABSENT" || attendance.status === "LEAVE")
  ) {
    return true;
  }

  if (
    attendance.clockInSource === "MANUAL" &&
    attendance.clockIn &&
    attendance.clockOutSource === "MANUAL" &&
    attendance.clockOut
  ) {
    return true;
  }

  return false;
};

const applyBiometricPunch = async (
  userId,
  punchDateTime,
  userDoc = null
) => {
  const user =
    userDoc ||
    (await User.findById(userId));

  if (!user) {
    throw new Error("User not found");
  }

  const dateKey = getDateKey(punchDateTime);

  let attendance = await Attendance.findOne({
    employee: userId,
    date: dateKey,
  });

  // Skip only fully locked days (manual ABSENT/LEAVE, or both punches manual).
  if (hasProtectedManualPunch(attendance)) {
    return attendance;
  }

  const existingPunches = getExistingPunchTimes(attendance);
  const willSetClockIn = existingPunches.length === 0 && !attendance?.clockIn;
  const willSetClockOut =
    Boolean(attendance?.clockIn) || existingPunches.length >= 1;

  // Fill empty slots only; do not restore a revoked clock-out.
  if (willSetClockIn && !canOverrideWithBiometric(attendance, "clockIn")) {
    return attendance;
  }

  if (willSetClockOut && !canOverrideWithBiometric(attendance, "clockOut")) {
    return attendance;
  }

  const timeline = derivePunchTimeline([
    ...existingPunches,
    punchDateTime,
  ]);

  if (!attendance) {
    attendance = new Attendance({
      employee: userId,
      date: dateKey,
      ...getAttendanceEmployeeSnapshot(user),
      punchEvents: [],
    });
  }

  applyTimelineMetrics(
    attendance,
    timeline,
    user,
    dateKey,
    "BIOMETRIC"
  );

  attendance.employeeId = user.employeeId || attendance.employeeId;
  attendance.employeeName = user.name || attendance.employeeName;
  attendance.biometricEmpCode =
    user.biometricEmpCode || attendance.biometricEmpCode;

  await attendance.save();

  return attendance;
};

const clockIn = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  if (isIstWeekendNow()) {
    throw new Error(
      "Weekend attendance not allowed"
    );
  }

  const today = getTodayDate();

  const existingAttendance =
    await Attendance.findOne({
      employee: userId,
      date: today,
    });

  if (existingAttendance?.clockIn) {
    throw new Error(
      "Already clocked in today"
    );
  }

  const now = new Date();
  const timeline = derivePunchTimeline([now], { minGapMs: 0 });

  let attendance;

  if (existingAttendance) {
    existingAttendance.punchEvents =
      existingAttendance.punchEvents || [];
    applyTimelineMetrics(
      existingAttendance,
      timeline,
      user,
      today,
      "MANUAL",
      userId
    );
    existingAttendance.employeeId =
      user.employeeId || existingAttendance.employeeId;
    existingAttendance.employeeName =
      user.name || existingAttendance.employeeName;
    existingAttendance.biometricEmpCode =
      user.biometricEmpCode ||
      existingAttendance.biometricEmpCode;
    // Protect employee manual punches from biometric sync overwrite.
    existingAttendance.isManuallyUpdated = true;
    existingAttendance.updateReason =
      existingAttendance.updateReason || "Employee manual clock in";

    await existingAttendance.save();
    attendance = existingAttendance;
  } else {
    attendance = new Attendance({
      employee: userId,
      date: today,
      ...getAttendanceEmployeeSnapshot(user),
      punchEvents: [],
      isManuallyUpdated: true,
      updateReason: "Employee manual clock in",
    });

    applyTimelineMetrics(
      attendance,
      timeline,
      user,
      today,
      "MANUAL",
      userId
    );

    await attendance.save();
  }

  return {
    success: true,
    message:
      "Clock In Successful",
    data: attendance,
  };
};

const clockOut = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  const today = getTodayDate();

  const attendance =
    await Attendance.findOne({
      employee: userId,
      date: today,
    });

  if (!attendance) {
    throw new Error(
      "Please clock in first"
    );
  }

  if (!attendance.clockIn) {
    throw new Error(
      "Please clock in first"
    );
  }

  // Manual flow is Punch In -> Punch Out only. Block only a prior MANUAL out.
  if (attendance.clockOut && attendance.clockOutSource === "MANUAL") {
    throw new Error(
      "Already clocked out"
    );
  }

  const now = new Date();
  const clockInTime = new Date(attendance.clockIn);

  if (Number.isNaN(clockInTime.getTime()) || now <= clockInTime) {
    throw new Error("Clock Out must be after Clock In");
  }

  // Manual out: persist [clockIn, now]. Ignore biometric debounce gap.
  const timeline = derivePunchTimeline([clockInTime, now], { minGapMs: 0 });

  if (!timeline.clockOut) {
    throw new Error("Clock Out failed. Please try again.");
  }

  applyTimelineMetrics(
    attendance,
    timeline,
    user,
    today,
    "MANUAL",
    userId
  );

  attendance.employeeId = user?.employeeId || attendance.employeeId;
  attendance.employeeName = user?.name || attendance.employeeName;
  attendance.biometricEmpCode =
    user?.biometricEmpCode || attendance.biometricEmpCode;
  attendance.isManuallyUpdated = true;
  attendance.updateReason =
    attendance.updateReason || "Employee manual clock out";

  await attendance.save();

  return {
    success: true,
    message: "Clock Out Successful",
    data: attendance,
  };
};

const getTodayAttendance =
  async (userId) => {
    const today =
      getTodayDate();

    const attendance =
      await Attendance.findOne({
        employee: userId,
        date: today,
      }).populate(
        "employee",
        "employeeId name email role"
      );

    return {
      success: true,
      data: attendance,
    };
  };

const getMyHistory =
  async (
    userId,
    page,
    limit
  ) => {
    const skip =
      (page - 1) * limit;

    const total =
      await Attendance.countDocuments(
        {
          employee: userId,
        }
      );

    const records =
      await Attendance.find({
        employee: userId,
      })
        .populate("punchEvents.by", "name employeeId role")
        .populate("updatedBy", "name employeeId role")
        .sort({
          date: -1,
        })
        .skip(skip)
        .limit(limit);

    return {
      success: true,
      total,
      page,
      pages: Math.ceil(
        total / limit
      ),
      data: records,
    };
  };

const getMyMonthlyAttendance =
  async (
    userId,
    month,
    year
  ) => {
    const startDate =
      `${year}-${String(
        month
      ).padStart(2, "0")}-01`;

    const endDate =
      `${year}-${String(
        month
      ).padStart(2, "0")}-31`;

    const records =
      await Attendance.find({
        employee: userId,
        date: {
          $gte: startDate,
          $lte: endDate,
        },
      }).sort({
        date: 1,
      });

    return {
      success: true,
      data: records,
    };
  };

const getDashboard =
  async () => {
    const today =
      getTodayDate();

    const totalEmployees =
      await User.countDocuments({
        isActive: true,
      });

    const present =
      await Attendance.countDocuments(
        {
          date: today,
          status: "PRESENT",
        }
      );

    const late =
      await Attendance.countDocuments(
        {
          date: today,
          status: "LATE",
        }
      );

    const halfDay =
      await Attendance.countDocuments(
        {
          date: today,
          status: "HALF_DAY",
        }
      );

    const earlyLeave =
      await Attendance.countDocuments(
        {
          date: today,
          status: "EARLY_LEAVE",
        }
      );

    const absent =
      totalEmployees -
      (
        present +
        late +
        halfDay +
        earlyLeave
      );

    return {
      success: true,
      data: {
        totalEmployees,
        present,
        late,
        halfDay,
        earlyLeave,
        absent,
      },
    };
  };

const formatEmployeeSummary = (employee) => ({
  _id: employee._id,
  employeeId: employee.employeeId,
  biometricEmpCode: employee.biometricEmpCode || "",
  name: employee.name,
  designation: employee.designation || "",
  department: employee.department || "",
  profilePhoto: employee.profilePhoto || "",
});

const formatEmployeeSummaryFromAttendance = (record, employeeById) => {
  const employeeRef = record?.employee;
  const employeeIdKey = employeeRef?._id
    ? String(employeeRef._id)
    : employeeRef
      ? String(employeeRef)
      : "";

  const resolvedEmployee =
    employeeRef?._id && employeeRef?.name
      ? employeeRef
      : employeeIdKey
        ? employeeById.get(employeeIdKey)
        : null;

  if (resolvedEmployee?._id) {
    return formatEmployeeSummary(resolvedEmployee);
  }

  return {
    _id: employeeIdKey || record?._id,
    employeeId: record?.employeeId || "",
    biometricEmpCode: record?.biometricEmpCode || "",
    name: record?.employeeName || "Unknown",
    designation: "",
    department: "",
    profilePhoto: "",
  };
};

const formatAttendanceSummary = (record, employee = null, dateKey = null) => {
  if (!record) {
    return null;
  }

  const targetDate = dateKey || record.date;
  const shiftState = employee
    ? resolveShiftState(record, employee, targetDate)
    : null;

  return {
    _id: record._id,
    employeeId: record.employeeId || "",
    employeeName: record.employeeName || "",
    biometricEmpCode: record.biometricEmpCode || "",
    date: record.date,
    clockIn: record.clockIn,
    clockOut: record.clockOut,
    status: record.status,
    shiftState,
    clockInSource: record.clockInSource,
    clockOutSource: record.clockOutSource,
    lateMinutes: record.lateMinutes || 0,
    earlyOutMinutes:
      typeof record.earlyOutMinutes === "number"
        ? record.earlyOutMinutes
        : record.shortfallMinutes || 0,
    workingMinutes: record.workingMinutes || 0,
    overtimeMinutes: record.overtimeMinutes || 0,
    totalBreakMinutes: record.totalBreakMinutes || 0,
    punches: Array.isArray(record.punches) ? record.punches : [],
    breaks: Array.isArray(record.breaks) ? record.breaks : [],
    punchEvents: Array.isArray(record.punchEvents)
      ? record.punchEvents
      : [],
    isManuallyUpdated: Boolean(record.isManuallyUpdated),
    updateReason: record.updateReason || "",
    updatedAt: record.updatedAt || null,
    updatedBy: record.updatedBy || null,
  };
};

const formatUpdatedByName = (updatedBy) => {
  if (!updatedBy) {
    return "";
  }

  // Raw ObjectId / string id — cannot show a name without lookup.
  if (typeof updatedBy === "string") {
    return "";
  }

  if (typeof updatedBy !== "object") {
    return "";
  }

  // Unpopulated mongoose ObjectId object (has no name).
  if (!updatedBy.name && !updatedBy.employeeId && updatedBy._id && !updatedBy.role) {
    return "";
  }

  if (updatedBy.employeeId) {
    return `${updatedBy.name || "--"} (${updatedBy.employeeId})`;
  }

  return updatedBy.name || "";
};

const extractHrChangeReason = (note = "", fallback = "") => {
  const cleaned = String(note || "")
    .replace(/^Manual update:\s*/i, "")
    .replace(/^Clock Out revoked:\s*/i, "")
    .trim();

  return cleaned || String(fallback || "").trim() || "--";
};

const isHrManualPunchEvent = (event) => {
  const note = String(event?.note || "").toLowerCase();

  return (
    event?.source === "MANUAL" &&
    (note.includes("manual update") || note.includes("clock out revoked"))
  );
};

const getHrPunchActionLabel = (event) => {
  const note = String(event?.note || "").toLowerCase();

  if (note.includes("clock out revoked")) {
    return "Clock Out Revoked";
  }

  if (event?.action === "CLOCK_IN") {
    return "Clock In";
  }

  if (event?.action === "CLOCK_OUT") {
    return "Clock Out";
  }

  return event?.action || "Update";
};

// Flatten HR/manual corrections so employees can see who changed what and why.
const buildHrChangeHistory = (records = []) => {
  const changes = [];

  for (const record of records) {
    const events = (record.punchEvents || [])
      .filter(isHrManualPunchEvent)
      .slice()
      .sort((left, right) => {
        const leftTime = left.changedAt
          ? new Date(left.changedAt).getTime()
          : 0;
        const rightTime = right.changedAt
          ? new Date(right.changedAt).getTime()
          : 0;
        return leftTime - rightTime;
      });

    // Infer previous punch time from earlier same-action events when not stored.
    const lastTimeByAction = {};

    // Prefer genuine previous clock values from non-manual punches first.
    (record.punchEvents || []).forEach((event) => {
      if (
        event?.source !== "MANUAL" &&
        event?.action &&
        event?.time &&
        !lastTimeByAction[event.action]
      ) {
        lastTimeByAction[event.action] = event.time;
      }
    });

    for (const event of events) {
      const actor =
        event.by && typeof event.by === "object" && event.by.name
          ? event.by
          : null;

      const isRevoked = String(event.note || "")
        .toLowerCase()
        .includes("clock out revoked");

      const inferredPrevious =
        event.previousTime || lastTimeByAction[event.action] || null;

      // Next HR edit of same action used this event's new time as previous.
      if (event.time) {
        lastTimeByAction[event.action] = event.time;
      }

      changes.push({
        date: record.date,
        action: event.action,
        actionLabel: getHrPunchActionLabel(event),
        previousTime: inferredPrevious,
        newTime: isRevoked ? null : event.time || null,
        clockIn: record.clockIn || null,
        clockOut: record.clockOut || null,
        status: record.status || "",
        changedAt: event.changedAt || record.updatedAt || null,
        updatedByName:
          event.byName
            ? event.byEmployeeId
              ? `${event.byName} (${event.byEmployeeId})`
              : event.byName
            : formatUpdatedByName(actor) ||
              formatUpdatedByName(record.updatedBy) ||
              "--",
        updatedByRole:
          event.byRole ||
          actor?.role ||
          record.updatedBy?.role ||
          "",
        reason: extractHrChangeReason(event.note, record.updateReason),
      });
    }

    // Absent / status-only corrections may not create punchEvents.
    if (
      record.isManuallyUpdated &&
      record.updateReason &&
      events.length === 0
    ) {
      changes.push({
        date: record.date,
        action: "STATUS_UPDATE",
        actionLabel:
          record.status === "ABSENT" ? "Marked Absent" : "Manual Correction",
        previousTime: null,
        newTime: null,
        clockIn: record.clockIn || null,
        clockOut: record.clockOut || null,
        status: record.status || "",
        changedAt: record.updatedAt || null,
        updatedByName: formatUpdatedByName(record.updatedBy) || "--",
        updatedByRole: record.updatedBy?.role || "",
        reason: record.updateReason || "--",
      });
    }
  }

  return changes.sort((left, right) => {
    const leftTime = left.changedAt ? new Date(left.changedAt).getTime() : 0;
    const rightTime = right.changedAt ? new Date(right.changedAt).getTime() : 0;
    return rightTime - leftTime;
  });
};

const normalizeBiometricCode = (value) => {
  if (!value) {
    return "";
  }

  const digits = String(value).replace(/\D/g, "");

  if (!digits) {
    return String(value).trim();
  }

  const numericValue = Number.parseInt(digits, 10);
  if (Number.isNaN(numericValue)) {
    return String(value).trim();
  }

  return String(numericValue).padStart(4, "0");
};

const parseBiometricTimeToDate = (dateKey, value) =>
  parseIstTimeOnDate(dateKey, value);

const canOverrideWithBiometric = (attendance, field) => {
  if (!attendance) {
    return true;
  }

  // Always allow filling an empty slot (except revoked clock-out below).
  if (field === "clockIn" && !attendance.clockIn) {
    return true;
  }

  if (field === "clockOut" && !attendance.clockOut) {
    // HR revoked clock-out intentionally — do not restore from biometric.
    if (wasClockOutRevoked(attendance)) {
      return false;
    }
    return true;
  }

  if (
    field === "clockIn" &&
    attendance.clockInSource === "MANUAL" &&
    attendance.clockIn
  ) {
    return false;
  }

  if (
    field === "clockOut" &&
    attendance.clockOutSource === "MANUAL" &&
    attendance.clockOut
  ) {
    return false;
  }

  return true;
};

const shouldApplyBiometricClockIn = (existingClockIn, biometricClockIn, attendance) => {
  if (!biometricClockIn) {
    return false;
  }

  if (!canOverrideWithBiometric(attendance, "clockIn")) {
    return false;
  }

  if (!existingClockIn) {
    return true;
  }

  if (attendance?.clockInSource === "BIOMETRIC") {
    return (
      formatIstTimePart(existingClockIn) !==
      formatIstTimePart(biometricClockIn)
    );
  }

  return biometricClockIn < existingClockIn;
};

const shouldApplyBiometricClockOut = (
  existingClockOut,
  biometricClockOut,
  effectiveClockIn,
  attendance
) => {
  if (!biometricClockOut || !effectiveClockIn) {
    return false;
  }

  if (biometricClockOut <= effectiveClockIn) {
    return false;
  }

  if (!canOverrideWithBiometric(attendance, "clockOut")) {
    return false;
  }

  if (!existingClockOut) {
    return true;
  }

  if (attendance?.clockOutSource === "BIOMETRIC") {
    return (
      formatIstTimePart(existingClockOut) !==
      formatIstTimePart(biometricClockOut)
    );
  }

  return biometricClockOut > existingClockOut;
};

const getAttendanceFromBiometric = (
  existingAttendance,
  biometricRecord,
  dateKey,
  employee = null
) => {
  if (!biometricRecord) {
    return existingAttendance;
  }

  const biometricClockIn = parseBiometricTimeToDate(dateKey, biometricRecord.inTime);
  const biometricClockOut = parseBiometricTimeToDate(dateKey, biometricRecord.outTime);

  if (!existingAttendance) {
    if (!biometricClockIn && !biometricClockOut) {
      return null;
    }

    return {
      _id: null,
      employeeId: biometricRecord.crmEmployee?.employeeId || "",
      employeeName: biometricRecord.crmEmployee?.name || biometricRecord.name || "",
      biometricEmpCode:
        biometricRecord.crmEmployee?.biometricEmpCode || biometricRecord.empcode || "",
      date: dateKey,
      clockIn: biometricClockIn,
      clockOut: biometricClockOut,
      status: biometricRecord.status || (biometricClockIn ? "PRESENT" : "ABSENT"),
      shiftState: biometricClockIn && !biometricClockOut ? "ON_SHIFT" : "COMPLETED",
      clockInSource: biometricClockIn ? "BIOMETRIC" : null,
      clockOutSource: biometricClockOut ? "BIOMETRIC" : null,
      lateMinutes: 0,
      earlyOutMinutes: 0,
      workingMinutes: 0,
      overtimeMinutes: 0,
      totalBreakMinutes: 0,
      punchEvents: [],
    };
  }

  const shiftState =
    existingAttendance.shiftState ||
    (employee
      ? resolveShiftState(existingAttendance, employee, dateKey)
      : null);
  // Dashboard responses: prefer persisted attendance; fill missing from biometric In/Out.
  const shouldUseBiometricClockIn =
    !existingAttendance.clockIn &&
    biometricClockIn &&
    canOverrideWithBiometric(existingAttendance, "clockIn");
  const shouldUseBiometricClockOut =
    !existingAttendance.clockOut &&
    biometricClockOut &&
    canOverrideWithBiometric(existingAttendance, "clockOut");

  return {
    ...existingAttendance,
    clockIn: shouldUseBiometricClockIn
      ? biometricClockIn
      : existingAttendance.clockIn || null,
    clockOut: shouldUseBiometricClockOut
      ? biometricClockOut
      : existingAttendance.clockOut || null,
    shiftState,
    clockInSource:
      existingAttendance.clockInSource ||
      (biometricClockIn ? "BIOMETRIC" : existingAttendance.clockInSource),
    clockOutSource:
      existingAttendance.clockOutSource ||
      (biometricClockOut ? "BIOMETRIC" : existingAttendance.clockOutSource),
    // Break scene disabled — do not merge device BreakTime into CRM.
    totalBreakMinutes: existingAttendance.totalBreakMinutes || 0,
  };
};

const resolveEmployeeForBiometricRecord = (
  record,
  employeeById,
  employeeByCode
) => {
  const employeeId = record?.crmEmployee?._id
    ? String(record.crmEmployee._id)
    : "";

  if (employeeId && employeeById.has(employeeId)) {
    return employeeById.get(employeeId);
  }

  const normalizedCode = normalizeBiometricCode(
    record?.crmEmployee?.biometricEmpCode || record?.empcode
  );

  if (normalizedCode && employeeByCode.has(normalizedCode)) {
    return employeeByCode.get(normalizedCode);
  }

  return null;
};

const syncAttendanceFromBiometricInOut = async (
  dateKey,
  biometricRecords,
  employeeById,
  employeeByCode
) => {
  if (!Array.isArray(biometricRecords) || biometricRecords.length === 0) {
    return;
  }

  const employeeIds = Array.from(employeeById.keys());
  if (employeeIds.length === 0) {
    return;
  }

  const attendanceDocs = await Attendance.find({
    date: dateKey,
    employee: { $in: employeeIds },
  });

  const attendanceByEmployeeId = new Map();
  attendanceDocs.forEach((doc) => {
    attendanceByEmployeeId.set(String(doc.employee), doc);
  });

  for (const record of biometricRecords) {
    const employee = resolveEmployeeForBiometricRecord(
      record,
      employeeById,
      employeeByCode
    );

    if (!employee?._id) {
      continue;
    }

    const biometricClockIn = parseBiometricTimeToDate(dateKey, record.inTime);
    const biometricClockOut = parseBiometricTimeToDate(dateKey, record.outTime);

    if (!biometricClockIn && !biometricClockOut) {
      continue;
    }

    const employeeIdKey = String(employee._id);
    let attendance = attendanceByEmployeeId.get(employeeIdKey);

    // Skip only fully locked days. Empty clockIn/clockOut still fill below.
    if (hasProtectedManualPunch(attendance)) {
      continue;
    }

    if (!attendance) {
      if (!biometricClockIn) {
        continue;
      }

      const validClockOut =
        biometricClockOut && biometricClockOut > biometricClockIn
          ? biometricClockOut
          : null;
      const seedPunches = validClockOut
        ? [biometricClockIn, validClockOut]
        : [biometricClockIn];
      const timeline = derivePunchTimeline(seedPunches);
      // Break scene disabled — ignore device BreakTime.
      // const apiBreakMinutes = parseDurationToMinutes(record.breakTime);
      // if (timeline.totalBreakMinutes === 0 && apiBreakMinutes > 0) {
      //   timeline.totalBreakMinutes = apiBreakMinutes;
      // }

      attendance = new Attendance({
        employee: employee._id,
        date: dateKey,
        ...getAttendanceEmployeeSnapshot(employee),
        punchEvents: [],
      });

      applyTimelineMetrics(
        attendance,
        timeline,
        employee,
        dateKey,
        "BIOMETRIC"
      );

      // if (apiBreakMinutes > 0 && (attendance.totalBreakMinutes || 0) === 0) {
      //   attendance.totalBreakMinutes = apiBreakMinutes;
      //   ...recalculate metrics with break...
      // }

      await attendance.save();
      attendanceByEmployeeId.set(employeeIdKey, attendance);
      continue;
    }

    // Prefer raw punch stream from sync; hydrate from processed punches when needed.
    await hydrateAttendancePunchesFromProcessed(
      attendance,
      employee._id,
      dateKey
    );

    const existingPunches = getExistingPunchTimes(attendance);
    let timeline;
    const dayHasEnded = shouldApplyCheckoutStatus(
      dateKey,
      getOfficeTimes(employee, dateKey).officeEnd
    );
    const hasValidInOutWindow =
      biometricClockIn &&
      biometricClockOut &&
      biometricClockOut > biometricClockIn;
    const canUseBioIn = canOverrideWithBiometric(attendance, "clockIn");
    const canUseBioOut = canOverrideWithBiometric(attendance, "clockOut");
    const shouldForceBiometricWindow =
      hasValidInOutWindow &&
      canUseBioIn &&
      canUseBioOut &&
      (dayHasEnded || existingPunches.length <= 2);

    // Prefer stable In/Out API window (first in + last out). No break pairing.
    if (shouldForceBiometricWindow) {
      timeline = derivePunchTimeline([biometricClockIn, biometricClockOut]);
    } else if (!canUseBioIn && !canUseBioOut) {
      timeline = derivePunchTimeline(existingPunches);
    } else if (existingPunches.length > 2 && attendance.clockOut) {
      // Rich punch stream already has an out — keep it.
      timeline = derivePunchTimeline(existingPunches);
    } else {
      const seed = [];
      // Prefer biometric for empty/overridable slots; keep HR MANUAL values.
      const effectiveIn = canUseBioIn
        ? biometricClockIn || attendance.clockIn
        : attendance.clockIn;
      const bioOutUsable =
        biometricClockOut &&
        effectiveIn &&
        biometricClockOut > new Date(effectiveIn)
          ? biometricClockOut
          : null;
      // Fill empty out from biometric; never wipe an existing out when API OUT is missing.
      const effectiveOut = canUseBioOut
        ? bioOutUsable || attendance.clockOut
        : attendance.clockOut;

      if (effectiveIn) {
        seed.push(effectiveIn);
      }
      if (
        effectiveOut &&
        effectiveIn &&
        new Date(effectiveOut) > new Date(effectiveIn)
      ) {
        seed.push(effectiveOut);
      }
      timeline = derivePunchTimeline(
        seed.length > 0 ? seed : existingPunches
      );
    }

    // Break scene disabled — ignore device BreakTime.
    // const apiBreakMinutes = parseDurationToMinutes(record.breakTime);
    // if (
    //   timeline.totalBreakMinutes === 0 &&
    //   apiBreakMinutes > 0 &&
    //   timeline.clockOut &&
    //   timeline.punches.length <= 2
    // ) {
    //   timeline.totalBreakMinutes = apiBreakMinutes;
    // }

    let changed = false;
    const before = JSON.stringify({
      clockIn: attendance.clockIn,
      clockOut: attendance.clockOut,
      workingMinutes: attendance.workingMinutes,
      status: attendance.status,
      totalBreakMinutes: attendance.totalBreakMinutes,
      punchCount: (attendance.punches || []).length,
    });

    applyTimelineMetrics(
      attendance,
      timeline,
      employee,
      dateKey,
      "BIOMETRIC"
    );

    // if (
    //   apiBreakMinutes > 0 &&
    //   (attendance.totalBreakMinutes || 0) === 0 &&
    //   (attendance.punches || []).length <= 2
    // ) { ... }

    const after = JSON.stringify({
      clockIn: attendance.clockIn,
      clockOut: attendance.clockOut,
      workingMinutes: attendance.workingMinutes,
      status: attendance.status,
      totalBreakMinutes: attendance.totalBreakMinutes,
      punchCount: (attendance.punches || []).length,
    });

    if (before !== after) {
      changed = true;
    }

    const snapshot = getAttendanceEmployeeSnapshot(employee);
    if (
      attendance.employeeId !== snapshot.employeeId ||
      attendance.employeeName !== snapshot.employeeName ||
      attendance.biometricEmpCode !== snapshot.biometricEmpCode
    ) {
      changed = true;
      attendance.employeeId = snapshot.employeeId;
      attendance.employeeName = snapshot.employeeName;
      attendance.biometricEmpCode = snapshot.biometricEmpCode;
    }

    if (changed) {
      await attendance.save();
    }
  }
};

const MONTH_LABELS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

const formatTimePart = (dateValue) => formatIstTimePart(dateValue);

const formatMonthlySheetCell = (record, isWeekend, isFutureDate) => {
  if (isFutureDate) {
    return "";
  }

  if (!record) {
    return isWeekend ? "" : "A";
  }

  if (record.status === "WEEK_OFF") {
    return "WEEK OFF";
  }

  if (record.status === "LEAVE") {
    return "LEAVE";
  }

  if (record.status === "ABSENT") {
    return "A";
  }

  if (record.status === "HALF_DAY") {
    return "HALF DAY";
  }

  if (record.status === "EARLY_LEAVE") {
    const inLabel = record.clockIn ? formatTimePart(record.clockIn) : "";
    return inLabel ? `${inLabel} - EL` : "EL";
  }

  const hasClockIn = Boolean(record.clockIn);
  const hasClockOut = Boolean(record.clockOut);

  if (hasClockIn || hasClockOut) {
    const inLabel = hasClockIn ? formatTimePart(record.clockIn) : "";
    const outLabel = hasClockOut ? formatTimePart(record.clockOut) : "";
    return `P (IN-${inLabel || "--"}) (OUT-${outLabel || "--"})`;
  }

  return "P";
};

const recalculateAttendanceRecordMetrics = async (
  attendanceDoc,
  employee,
  dateKey
) => {
  if (!attendanceDoc || !employee) {
    return;
  }

  const targetDate = dateKey || attendanceDoc.date;
  const punches = getExistingPunchTimes(attendanceDoc);

  if (!punches.length && !attendanceDoc.clockIn) {
    return;
  }

  const timeline = derivePunchTimeline(punches);
  const source =
    attendanceDoc.clockInSource === "MANUAL" ? "MANUAL" : "BIOMETRIC";

  const previousSnapshot = JSON.stringify({
    clockIn: attendanceDoc.clockIn,
    clockOut: attendanceDoc.clockOut,
    status: attendanceDoc.status,
    workingMinutes: attendanceDoc.workingMinutes,
    totalBreakMinutes: attendanceDoc.totalBreakMinutes,
    punchCount: punches.length,
  });

  applyTimelineMetrics(
    attendanceDoc,
    timeline,
    employee,
    targetDate,
    source,
    null
  );

  const nextSnapshot = JSON.stringify({
    clockIn: attendanceDoc.clockIn,
    clockOut: attendanceDoc.clockOut,
    status: attendanceDoc.status,
    workingMinutes: attendanceDoc.workingMinutes,
    totalBreakMinutes: attendanceDoc.totalBreakMinutes,
    punchCount: (attendanceDoc.punches || []).length,
  });

  if (previousSnapshot !== nextSnapshot) {
    await attendanceDoc.save();
  }
};

const hydrateAttendancePunchesFromProcessed = async (
  attendanceDoc,
  employeeId,
  dateKey
) => {
  if (!attendanceDoc || !employeeId || !dateKey) {
    return false;
  }

  // Skip fully locked days, or days where clock-out was intentionally revoked.
  if (hasProtectedManualPunch(attendanceDoc) || wasClockOutRevoked(attendanceDoc)) {
    return false;
  }

  const { start, end } = getIstDayBounds(dateKey);
  const processedPunches = await ProcessedBiometricPunch.find({
    employee: employeeId,
    punchDate: {
      $gte: start,
      $lte: end,
    },
  })
    .sort({ punchDate: 1 })
    .lean();

  if (!processedPunches.length) {
    return false;
  }

  const processedTimes = processedPunches.map((item) => item.punchDate);
  const existingTimes = getExistingPunchTimes(attendanceDoc);

  if (processedTimes.length <= existingTimes.length) {
    return false;
  }

  const existingClockOut = attendanceDoc.clockOut
    ? new Date(attendanceDoc.clockOut)
    : null;
  const processedLastPunch = processedTimes[processedTimes.length - 1]
    ? new Date(processedTimes[processedTimes.length - 1])
    : null;
  const isProcessedOdd = processedTimes.length % 2 === 1;

  // If attendance already has a valid final clock-out and processed stream is
  // odd (likely missed a middle return punch), keep current timeline to avoid
  // regressing clockOut back to null.
  if (
    existingClockOut &&
    !Number.isNaN(existingClockOut.getTime()) &&
    isProcessedOdd &&
    processedLastPunch &&
    !Number.isNaN(processedLastPunch.getTime()) &&
    processedLastPunch.getTime() <= existingClockOut.getTime()
  ) {
    return false;
  }

  attendanceDoc.punches = processedTimes;
  return true;
};

const MIN_OUT_AFTER_IN_MS = 2 * 60 * 1000;

/**
 * When In/Out API has no OUT but a later biometric punch exists after clock-in
 * (common after HR manual clock-in blocked punch-stream), use that punch as out.
 */
const backfillMissingClockOutFromProcessedPunches = async (
  attendanceDoc,
  employee,
  dateKey
) => {
  if (!attendanceDoc?.clockIn || attendanceDoc.clockOut) {
    return false;
  }

  if (hasProtectedManualPunch(attendanceDoc)) {
    return false;
  }

  if (!canOverrideWithBiometric(attendanceDoc, "clockOut")) {
    return false;
  }

  const { start, end } = getIstDayBounds(dateKey);
  const processedPunches = await ProcessedBiometricPunch.find({
    employee: attendanceDoc.employee,
    punchDate: {
      $gte: start,
      $lte: end,
    },
  })
    .sort({ punchDate: 1 })
    .lean();

  if (!processedPunches.length) {
    return false;
  }

  const clockInMs = new Date(attendanceDoc.clockIn).getTime();
  if (Number.isNaN(clockInMs)) {
    return false;
  }

  const laterPunches = processedPunches
    .map((item) => new Date(item.punchDate))
    .filter(
      (punchDate) =>
        !Number.isNaN(punchDate.getTime()) &&
        punchDate.getTime() >= clockInMs + MIN_OUT_AFTER_IN_MS
    );

  if (laterPunches.length === 0) {
    return false;
  }

  const clockOut = laterPunches[laterPunches.length - 1];
  const timeline = derivePunchTimeline([
    attendanceDoc.clockIn,
    clockOut,
  ]);

  applyTimelineMetrics(
    attendanceDoc,
    timeline,
    employee,
    dateKey,
    "BIOMETRIC"
  );

  // Stale source after revoke/empty out — ensure filled out is biometric.
  if (attendanceDoc.clockOut) {
    attendanceDoc.clockOutSource = "BIOMETRIC";
  }

  await attendanceDoc.save();
  return true;
};

const backfillMissingClockOutsForDateRange = async (
  fromDate,
  toDate,
  employeeById
) => {
  const missingRows = await Attendance.find({
    date: { $gte: fromDate, $lte: toDate },
    clockIn: { $ne: null },
    $or: [{ clockOut: null }, { clockOut: { $exists: false } }],
  });

  let filled = 0;

  for (const attendance of missingRows) {
    const employee =
      employeeById.get(String(attendance.employee)) ||
      (await User.findById(attendance.employee)
        .select(
          "employeeId biometricEmpCode name designation department officeTiming"
        )
        .lean());

    if (!employee) {
      continue;
    }

    const changed = await backfillMissingClockOutFromProcessedPunches(
      attendance,
      employee,
      attendance.date
    );

    if (changed) {
      filled += 1;
    }
  }

  return filled;
};

const getAttendanceDashboardDetails = async (dateKey) => {
  const today = dateKey || getTodayDate();

  const activeEmployees = await User.find({
    isActive: true,
  })
    .select(
      "employeeId biometricEmpCode name designation department profilePhoto role officeTiming"
    )
    .sort({ name: 1 })
    .lean();

  const employeeById = new Map();
  const employeeByCode = new Map();
  activeEmployees.forEach((employee) => {
    const employeeId = String(employee._id);
    employeeById.set(employeeId, employee);

    const normalizedCode = normalizeBiometricCode(
      employee.biometricEmpCode || employee.employeeId?.replace(/^DOB/i, "")
    );
    if (normalizedCode) {
      employeeByCode.set(normalizedCode, employee);
    }
  });

  const biometricInOutResponse =
    await fetchBiometricInOutRecords(today);

  await syncAttendanceFromBiometricInOut(
    today,
    biometricInOutResponse.records,
    employeeById,
    employeeByCode
  );

  const todayRecords = await Attendance.find({
    date: today,
  });

  for (const record of todayRecords) {
    if (!record?.employee) {
      continue;
    }

    const employee = employeeById.get(String(record.employee));
    if (!employee) {
      continue;
    }

    await hydrateAttendancePunchesFromProcessed(
      record,
      record.employee,
      today
    );
    await recalculateAttendanceRecordMetrics(record, employee, today);
  }

  const attendanceByEmployeeId = new Map();

  todayRecords.forEach((record) => {
    if (record.employee) {
      attendanceByEmployeeId.set(String(record.employee), record);
    }
  });

  const present = todayRecords.filter(
    (record) => record.status === "PRESENT"
  ).length;

  const late = todayRecords.filter(
    (record) => record.status === "LATE"
  ).length;

  const halfDay = todayRecords.filter(
    (record) => record.status === "HALF_DAY"
  ).length;

  const earlyLeave = todayRecords.filter(
    (record) => record.status === "EARLY_LEAVE"
  ).length;

  const checkInCount = todayRecords.filter(
    (record) => record.clockIn
  ).length;

  const checkOutCount = todayRecords.filter(
    (record) => record.clockOut
  ).length;

  const biometricCheckIns = todayRecords.filter(
    (record) => record.clockInSource === "BIOMETRIC"
  ).length;

  const manualCheckIns = todayRecords.filter(
    (record) => record.clockInSource === "MANUAL"
  ).length;

  const biometricCheckOuts = todayRecords.filter(
    (record) => record.clockOutSource === "BIOMETRIC"
  ).length;

  const manualCheckOuts = todayRecords.filter(
    (record) => record.clockOutSource === "MANUAL"
  ).length;

  const missingPunchRecords = todayRecords.filter((record) => {
    if (!record.clockIn) {
      return false;
    }

    const employee = employeeById.get(String(record.employee));
    if (!employee) {
      return false;
    }

    const shiftState = resolveShiftState(record, employee, today);
    const { officeEnd } = getOfficeTimes(employee, today);

    return (
      shiftState !== "COMPLETED" &&
      (today < getTodayDateKey() || new Date() >= officeEnd)
    );
  });

  const isEmployeeAbsent = (attendance) => {
    if (!attendance) {
      return true;
    }

    if (attendance.status === "ABSENT") {
      return true;
    }

    return !attendance.clockIn && !attendance.clockOut;
  };

  const totalEmployees = activeEmployees.length;
  const absent = activeEmployees.filter((employee) => {
    const record = attendanceByEmployeeId.get(String(employee._id));
    return isEmployeeAbsent(record);
  }).length;

  const attendanceRate =
    totalEmployees > 0
      ? Number(
          (
            (checkInCount / totalEmployees) *
            100
          ).toFixed(1)
        )
      : 0;

  const workingMinutesList = todayRecords
    .filter((record) => record.workingMinutes > 0)
    .map((record) => record.workingMinutes);

  const avgWorkingMinutes =
    workingMinutesList.length > 0
      ? Math.round(
          workingMinutesList.reduce(
            (sum, value) => sum + value,
            0
          ) / workingMinutesList.length
        )
      : 0;

  const clockInTimes = todayRecords
    .filter((record) => record.clockIn)
    .map((record) => new Date(record.clockIn).getTime());

  let avgCheckInTime = null;

  if (clockInTimes.length > 0) {
    const averageTimestamp =
      clockInTimes.reduce(
        (sum, value) => sum + value,
        0
      ) / clockInTimes.length;

    avgCheckInTime = new Date(averageTimestamp);
  }

  const lateArrivals = todayRecords
    .filter(
      (record) =>
        record.status === "LATE" ||
        record.lateMinutes > 0
    )
    .sort(
      (a, b) => b.lateMinutes - a.lateMinutes
    )
    .map((record) => ({
      employee: formatEmployeeSummaryFromAttendance(
        record,
        employeeById
      ),
      attendance: formatAttendanceSummary(
        record,
        employeeById.get(String(record.employee)),
        today
      ),
    }));

  const { start: startOfDay, end: endOfDay } = getIstDayBounds(today);

  const recentBiometricPunches =
    await ProcessedBiometricPunch.find({
      punchDate: {
        $gte: startOfDay,
        $lte: endOfDay,
      },
    })
      .populate(
        "employee",
        "employeeId biometricEmpCode name designation profilePhoto"
      )
      .sort({ punchDate: -1 })
      .limit(50)
      .lean();

  const biometricSyncResponse =
    await getBiometricSyncStatus();

  const biometricByEmployeeId = new Map();
  const biometricByEmpCode = new Map();
  biometricInOutResponse.records.forEach((record) => {
    const employeeId = record.crmEmployee?._id
      ? String(record.crmEmployee._id)
      : "";
    const normalizedCode = normalizeBiometricCode(
      record.crmEmployee?.biometricEmpCode || record.empcode
    );

    if (employeeId && !biometricByEmployeeId.has(employeeId)) {
      biometricByEmployeeId.set(employeeId, record);
    }

    if (normalizedCode && !biometricByEmpCode.has(normalizedCode)) {
      biometricByEmpCode.set(normalizedCode, record);
    }
  });

  const employeeAttendanceList = activeEmployees.map(
    (employee) => {
      const record = attendanceByEmployeeId.get(
        String(employee._id)
      );
      const normalizedCode = normalizeBiometricCode(
        employee.biometricEmpCode || employee.employeeId?.replace(/^DOB/i, "")
      );
      const biometricRecord =
        biometricByEmployeeId.get(String(employee._id)) ||
        biometricByEmpCode.get(normalizedCode);
      const attendanceSummary = getAttendanceFromBiometric(
        formatAttendanceSummary(record, employee, today),
        biometricRecord,
        today,
        employee
      );

      return {
        employee: formatEmployeeSummary(employee),
        attendance: attendanceSummary,
      };
    }
  );

  const absentEmployees = employeeAttendanceList.filter((item) =>
    isEmployeeAbsent(item.attendance)
  );

  return {
    success: true,
    data: {
      date: today,
      overview: {
        totalEmployees,
        presentToday: present,
        lateToday: late,
        halfDayToday: halfDay,
        earlyLeaveToday: earlyLeave,
        absentToday: absent,
        attendanceRate,
        checkInCount,
        checkOutCount,
        missingPunches: missingPunchRecords.length,
        biometricCheckIns,
        manualCheckIns,
        biometricCheckOuts,
        manualCheckOuts,
        avgWorkingMinutes,
        avgCheckInTime,
      },
      statusBreakdown: {
        present,
        late,
        halfDay,
        earlyLeave,
        absent,
        onLeave: 0,
      },
      biometricSync: biometricSyncResponse.data,
      employeeAttendanceList,
      lateArrivals,
      missingPunchEmployees: missingPunchRecords.map(
        (record) => ({
          employee: formatEmployeeSummaryFromAttendance(
            record,
            employeeById
          ),
          attendance: formatAttendanceSummary(
            record,
            employeeById.get(String(record.employee)),
            today
          ),
        })
      ),
      absentEmployees,
      recentBiometricPunches: recentBiometricPunches.map(
        (punch) => ({
          punchId: punch.punchId,
          empcode: punch.empcode,
          punchDate: punch.punchDate,
          employee: punch.employee
            ? formatEmployeeSummary(punch.employee)
            : null,
        })
      ),
      biometricInOutRecords: biometricInOutResponse.records,
      biometricInOutTotal: biometricInOutResponse.total,
      biometricInOutError: biometricInOutResponse.error,
    },
  };
};

const getMyAttendanceDashboard = async (
  userId,
  dateKey
) => {
  const today = dateKey || getTodayDate();

  const user = await User.findById(userId)
    .select(
      "employeeId biometricEmpCode name designation department profilePhoto role"
    )
    .lean();

  if (!user) {
    throw new Error("User not found");
  }

  const employeeById = new Map([[String(userId), user]]);
  const employeeByCode = new Map();
  const normalizedCode = normalizeBiometricCode(
    user.biometricEmpCode || user.employeeId?.replace(/^DOB/i, "")
  );

  if (normalizedCode) {
    employeeByCode.set(normalizedCode, user);
  }

  const biometricInOutResponse =
    await fetchBiometricInOutForUser(
      userId,
      today
    );

  await syncAttendanceFromBiometricInOut(
    today,
    biometricInOutResponse.records,
    employeeById,
    employeeByCode
  );

  const todayAttendanceDoc = await Attendance.findOne({
    employee: userId,
    date: today,
  })
    .populate("punchEvents.by", "name employeeId role")
    .populate("updatedBy", "name employeeId role");

  if (todayAttendanceDoc) {
    await hydrateAttendancePunchesFromProcessed(
      todayAttendanceDoc,
      userId,
      today
    );
    await recalculateAttendanceRecordMetrics(
      todayAttendanceDoc,
      user,
      today
    );
  }

  const todayAttendance = todayAttendanceDoc
    ? todayAttendanceDoc.toObject()
    : null;

  const history = await Attendance.find({
    employee: userId,
  })
    .populate("punchEvents.by", "name employeeId role")
    .populate("updatedBy", "name employeeId role")
    .sort({ date: -1 })
    .limit(60)
    .lean();

  // Dedicated pull of HR corrections (may go beyond recent day history).
  const hrChangeRecords = await Attendance.find({
    employee: userId,
    $or: [
      { isManuallyUpdated: true },
      { "punchEvents.source": "MANUAL" },
      {
        "punchEvents.note": {
          $regex: /Manual update:|Clock Out revoked:/i,
        },
      },
    ],
  })
    .populate("punchEvents.by", "name employeeId role")
    .populate("updatedBy", "name employeeId role")
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();

  const biometricToday =
    biometricInOutResponse.records[0] || null;

  const derivedShiftState = resolveShiftState(
    todayAttendance,
    user,
    today
  );
  const { officeEnd } = getOfficeTimes(user, today);
  const hasClockIn = Boolean(todayAttendance?.clockIn);
  // Simple in/out: any persisted clockOut counts (no mid-day break hiding).
  const hasClockOut = Boolean(todayAttendance?.clockOut);
  const shiftState = !hasClockIn
    ? "NOT_STARTED"
    : hasClockOut
      ? "COMPLETED"
      : derivedShiftState;
  const isPresent = Boolean(
    todayAttendance &&
      ["PRESENT", "LATE", "HALF_DAY", "EARLY_LEAVE"].includes(
        todayAttendance.status
      )
  );
  // Break scene disabled.
  const totalBreakMinutes = todayAttendance?.totalBreakMinutes || 0;
  const missingPunch =
    hasClockIn &&
    shiftState !== "COMPLETED" &&
    (today < getTodayDateKey() || new Date() >= officeEnd);

  return {
    success: true,
    data: {
      date: today,
      employee: formatEmployeeSummary(user),
      todayAttendance: formatAttendanceSummary(
        todayAttendance,
        user,
        today
      ),
      biometricToday,
      biometricInOutRecords:
        biometricInOutResponse.records,
      biometricInOutError:
        biometricInOutResponse.error,
      history: history.map((record) => ({
        date: record.date,
        attendance: formatAttendanceSummary(record, user, record.date),
      })),
      hrChangeHistory: buildHrChangeHistory(hrChangeRecords),
      overview: {
        status: todayAttendance?.status || "ABSENT",
        isPresent,
        hasClockIn,
        hasClockOut,
        shiftState,
        missingPunch,
        workingMinutes:
          todayAttendance?.workingMinutes || 0,
        totalBreakMinutes,
        lateMinutes: todayAttendance?.lateMinutes || 0,
        earlyOutMinutes:
          typeof todayAttendance?.earlyOutMinutes === "number"
            ? todayAttendance.earlyOutMinutes
            : todayAttendance?.shortfallMinutes || 0,
        overtimeMinutes:
          todayAttendance?.overtimeMinutes || 0,
        clockInSource:
          todayAttendance?.clockInSource || null,
        clockOutSource:
          todayAttendance?.clockOutSource || null,
        biometricStatus: biometricToday?.status || null,
        biometricInTime: biometricToday?.inTime || "--:--",
        biometricOutTime: biometricToday?.outTime || "--:--",
        biometricWorkTime: biometricToday?.workTime || "00:00",
        biometricLateIn: biometricToday?.lateIn || "00:00",
      },
    },
  };
};

const getEmployeeAttendance =
  async (
    employeeId,
    page,
    limit
  ) => {
    const user =
      await User.findOne({
        employeeId,
      });

    if (!user) {
      throw new Error(
        "Employee not found"
      );
    }

    const skip =
      (page - 1) * limit;

    const total =
      await Attendance.countDocuments(
        {
          employee:
            user._id,
        }
      );

    const records =
      await Attendance.find({
        employee:
          user._id,
      })
        .populate("punchEvents.by", "name employeeId role")
        .populate("updatedBy", "name employeeId role")
        .sort({
          date: -1,
        })
        .skip(skip)
        .limit(limit);

    return {
      success: true,
      total,
      page,
      pages: Math.ceil(
        total / limit
      ),
      data: records,
    };
  };

const syncMonthlyAttendanceFromBiometric = async (
  month,
  year,
  employeeById,
  employeeByCode
) => {
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const today = getTodayDateKey();
  const effectiveEnd = monthEnd > today ? today : monthEnd;

  if (monthStart > today) {
    return;
  }

  const rangeResponse = await fetchBiometricInOutForRange(
    monthStart,
    effectiveEnd
  );

  if (rangeResponse.error) {
    console.warn(
      `[Biometric Month Sync] ${monthStart}..${effectiveEnd} skipped: ${rangeResponse.error}`
    );
    return;
  }

  const dateKeys = Object.keys(rangeResponse.recordsByDate).sort();
  console.log(
    `[Biometric Month Sync] Hydrating ${dateKeys.length} day(s) for ${month}/${year}`
  );
  for (const dateKey of dateKeys) {
    await syncAttendanceFromBiometricInOut(
      dateKey,
      rangeResponse.recordsByDate[dateKey],
      employeeById,
      employeeByCode
    );
  }
};

const getMonthlyTeamSheet = async (month, year, employeeId = "") => {
  if (!month || !year || month < 1 || month > 12) {
    throw new Error("Valid month and year are required");
  }

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const userFilter = {
    isActive: true,
  };

  if (String(employeeId || "").trim()) {
    userFilter._id = String(employeeId).trim();
  }

  const activeEmployees = await User.find(userFilter)
    .select("employeeId biometricEmpCode name designation department officeTiming")
    .sort({ name: 1 })
    .lean();

  const employeeById = new Map();
  const employeeByCode = new Map();
  activeEmployees.forEach((employee) => {
    employeeById.set(String(employee._id), employee);

    const normalizedCode = normalizeBiometricCode(
      employee.biometricEmpCode || employee.employeeId?.replace(/^DOB/i, "")
    );

    if (normalizedCode) {
      employeeByCode.set(normalizedCode, employee);
    }
  });

  await syncMonthlyAttendanceFromBiometric(
    month,
    year,
    employeeById,
    employeeByCode
  );

  const employeeIds = activeEmployees.map((employee) => employee._id);

  const monthlyRecords = await Attendance.find({
    employee: {
      $in: employeeIds,
    },
    date: {
      $gte: monthStart,
      $lte: monthEnd,
    },
  })
    .select("employee date status clockIn clockOut")
    .lean();

  const attendanceMap = new Map();
  const todayDateKey = getTodayDate();

  monthlyRecords.forEach((record) => {
    const key = `${String(record.employee)}-${record.date}`;
    attendanceMap.set(key, record);
  });

  const rows = Array.from({ length: lastDay }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
    const day = getIstWeekdayShort(date);
    const isWeekend = isIstWeekendDateKey(date);
    const isFutureDate = date > todayDateKey;

    const cells = activeEmployees.map((employee) => {
      const key = `${String(employee._id)}-${date}`;
      const record = attendanceMap.get(key);
      return formatMonthlySheetCell(record, isWeekend, isFutureDate);
    });

    return {
      date,
      day,
      cells,
    };
  });

  return {
    success: true,
    data: {
      month,
      year,
      monthLabel: MONTH_LABELS[month - 1],
      employees: activeEmployees.map((employee) => ({
        _id: employee._id,
        employeeId: employee.employeeId || "",
        biometricEmpCode: employee.biometricEmpCode || "",
        name: employee.name || "",
        designation: employee.designation || "",
        department: employee.department || "",
      })),
      rows,
    },
  };
};

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const getDateKeysBetween = (fromDate, toDate) => {
  const keys = [];
  const start = new Date(`${fromDate}T00:00:00${process.env.IST_OFFSET || "+05:30"}`);
  const end = new Date(`${toDate}T00:00:00${process.env.IST_OFFSET || "+05:30"}`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return keys;
  }

  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(getDateKeyFromDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
};

const reconcileEmployeeAttendanceFromBiometricRange = async (
  employeeId,
  fromDate,
  toDate
) => {
  const normalizedEmployeeId = String(employeeId || "").trim();
  const normalizedFromDate = String(fromDate || "").trim();
  const normalizedToDate = String(toDate || "").trim();

  if (!normalizedEmployeeId) {
    throw new Error("Employee ID is required");
  }

  if (
    !DATE_KEY_REGEX.test(normalizedFromDate) ||
    !DATE_KEY_REGEX.test(normalizedToDate)
  ) {
    throw new Error("Valid fromDate and toDate are required in YYYY-MM-DD format");
  }

  const dateKeys = getDateKeysBetween(normalizedFromDate, normalizedToDate);
  if (dateKeys.length === 0) {
    throw new Error("Invalid date range");
  }

  const user = await User.findOne({
    employeeId: normalizedEmployeeId,
    isActive: true,
  })
    .select("employeeId biometricEmpCode name designation department officeTiming")
    .lean();

  if (!user?._id) {
    throw new Error("Employee not found");
  }

  const employeeById = new Map([[String(user._id), user]]);
  const employeeByCode = new Map();
  const normalizedCode = normalizeBiometricCode(
    user.biometricEmpCode || user.employeeId?.replace(/^DOB/i, "")
  );
  if (normalizedCode) {
    employeeByCode.set(normalizedCode, user);
  }

  const rangeResponse = await fetchBiometricInOutForRange(
    normalizedFromDate,
    normalizedToDate
  );

  if (rangeResponse.error) {
    throw new Error(rangeResponse.error);
  }

  const updatedDateKeys = [];
  for (const dateKey of dateKeys) {
    const dayRecords = (rangeResponse.recordsByDate?.[dateKey] || []).filter((record) => {
      const recordCode = normalizeBiometricCode(
        record?.crmEmployee?.biometricEmpCode || record?.empcode
      );
      return Boolean(recordCode) && recordCode === normalizedCode;
    });

    const beforeRecords = await Attendance.find({
      employee: user._id,
      date: dateKey,
    })
      .select("clockIn clockOut workingMinutes status totalBreakMinutes punches breaks")
      .lean();
    const beforeJson = JSON.stringify(beforeRecords);

    await syncAttendanceFromBiometricInOut(
      dateKey,
      dayRecords,
      employeeById,
      employeeByCode
    );

    const afterRecords = await Attendance.find({
      employee: user._id,
      date: dateKey,
    })
      .select("clockIn clockOut workingMinutes status totalBreakMinutes punches breaks")
      .lean();
    const afterJson = JSON.stringify(afterRecords);

    if (beforeJson !== afterJson) {
      updatedDateKeys.push(dateKey);
    }
  }

  return {
    success: true,
    employee: {
      _id: user._id,
      employeeId: user.employeeId || "",
      name: user.name || "",
      biometricEmpCode: user.biometricEmpCode || "",
    },
    fromDate: normalizedFromDate,
    toDate: normalizedToDate,
    processedDays: dateKeys.length,
    updatedDays: updatedDateKeys.length,
    updatedDateKeys,
  };
};

/**
 * Re-hydrate recent days from eTime In/Out API (fills missing clockOut/clockIn).
 * Punch-stream cron alone often leaves yesterday's outs empty; this heals that.
 */
const reconcileRecentAttendanceFromBiometricInOut = async (
  lookbackDays = 3
) => {
  const days = Math.max(1, Math.min(Number(lookbackDays) || 3, 14));
  const today = getTodayDateKey();
  const fromAnchor = new Date(
    `${today}T12:00:00${process.env.IST_OFFSET || "+05:30"}`
  );
  fromAnchor.setDate(fromAnchor.getDate() - (days - 1));
  const fromDate = getDateKeyFromDate(fromAnchor);
  const dateKeys = getDateKeysBetween(fromDate, today);

  const activeEmployees = await User.find({ isActive: true })
    .select(
      "employeeId biometricEmpCode name designation department officeTiming"
    )
    .lean();

  const employeeById = new Map();
  const employeeByCode = new Map();
  activeEmployees.forEach((employee) => {
    employeeById.set(String(employee._id), employee);

    const normalizedCode = normalizeBiometricCode(
      employee.biometricEmpCode ||
        employee.employeeId?.replace(/^DOB/i, "")
    );

    if (normalizedCode) {
      employeeByCode.set(normalizedCode, employee);
    }
  });

  const missingFilter = {
    date: { $gte: fromDate, $lte: today },
    clockIn: { $ne: null },
    $or: [{ clockOut: null }, { clockOut: { $exists: false } }],
  };

  const missingBefore = await Attendance.countDocuments(missingFilter);

  const rangeResponse = await fetchBiometricInOutForRange(fromDate, today);

  if (rangeResponse.error) {
    return {
      success: false,
      fromDate,
      toDate: today,
      daysRequested: dateKeys.length,
      missingClockOutBefore: missingBefore,
      missingClockOutAfter: missingBefore,
      filledCount: 0,
      error: rangeResponse.error,
      message: `In/Out reconcile skipped: ${rangeResponse.error}`,
    };
  }

  for (const dateKey of dateKeys) {
    await syncAttendanceFromBiometricInOut(
      dateKey,
      rangeResponse.recordsByDate?.[dateKey] || [],
      employeeById,
      employeeByCode
    );
  }

  const punchBackfillFilled = await backfillMissingClockOutsForDateRange(
    fromDate,
    today,
    employeeById
  );

  const missingAfter = await Attendance.countDocuments(missingFilter);
  const filledCount = Math.max(0, missingBefore - missingAfter);

  return {
    success: true,
    fromDate,
    toDate: today,
    daysRequested: dateKeys.length,
    employeeCount: activeEmployees.length,
    missingClockOutBefore: missingBefore,
    missingClockOutAfter: missingAfter,
    filledCount,
    punchBackfillFilled,
    error: null,
    message: `In/Out reconcile ${fromDate}..${today}: filled ~${filledCount} missing clock-out(s) (${missingBefore} → ${missingAfter} still open; punch-backfill ${punchBackfillFilled})`,
  };
};

const manualUpdateAttendance = async (
  attendanceId,
  body,
  updatedBy
) => {
  const { clockIn, clockOut, reason, date, employeeId, status } = body;

  if (!reason) {
    throw new Error("Reason is required");
  }

  const normalizedStatus =
    status === "ABSENT" || status === "PRESENT" ? status : null;

  if (!normalizedStatus && !clockIn && !clockOut) {
    throw new Error("Clock In or Clock Out is required");
  }

  let targetEmployeeId = null;
  let fallbackDate = date || null;

  const attendanceById = await Attendance.findById(attendanceId);

  if (attendanceById) {
    targetEmployeeId = attendanceById.employee;
    fallbackDate = fallbackDate || attendanceById.date;
  } else if (employeeId) {
    targetEmployeeId = employeeId;
  } else if (attendanceId) {
    const userById = await User.findById(attendanceId);

    if (userById) {
      targetEmployeeId = userById._id;
    }
  }

  if (!targetEmployeeId) {
    throw new Error("Attendance not found");
  }

  const targetDate = fallbackDate;

  if (!targetDate) {
    throw new Error("Date is required");
  }

  let attendance = await Attendance.findOne({
    employee: targetEmployeeId,
    date: targetDate,
  });

  const user = await User.findById(targetEmployeeId);

  if (!user) {
    throw new Error("User not found");
  }

  if (!attendance) {
    attendance = await Attendance.create({
      employee: targetEmployeeId,
      date: targetDate,
      ...getAttendanceEmployeeSnapshot(user),
      status: "ABSENT",
      punchEvents: [],
    });
  }

  if (normalizedStatus === "ABSENT") {
    attendance.clockIn = null;
    attendance.clockOut = null;
    attendance.punches = [];
    attendance.breaks = [];
    attendance.totalBreakMinutes = 0;
    attendance.status = "ABSENT";
    attendance.workingMinutes = 0;
    attendance.lateMinutes = 0;
    attendance.overtimeMinutes = 0;
    attendance.shortfallMinutes = 0;
    attendance.earlyOutMinutes = 0;
    attendance.employeeId = user?.employeeId || attendance.employeeId;
    attendance.employeeName = user?.name || attendance.employeeName;
    attendance.biometricEmpCode =
      user?.biometricEmpCode || attendance.biometricEmpCode;
    attendance.updatedBy = updatedBy;
    attendance.updateReason = reason;
    attendance.isManuallyUpdated = true;

    await attendance.save();

    return {
      success: true,
      message: "Attendance marked as absent",
      data: attendance,
    };
  }

  if (normalizedStatus === "PRESENT" && !clockIn && !clockOut) {
    throw new Error("Clock In or Clock Out is required for present status");
  }

  const existingClockIn = attendance.clockIn || null;
  const existingClockOut = attendance.clockOut || null;

  const nextClockIn = clockIn
    ? parseIstTimeOnDate(targetDate, `${clockIn}:00`)
    : existingClockIn;
  const nextClockOut = clockOut
    ? parseIstTimeOnDate(targetDate, `${clockOut}:00`)
    : existingClockOut;

  if (clockOut && !nextClockIn) {
    throw new Error("Clock In is required before setting Clock Out");
  }

  if (nextClockIn && nextClockOut && nextClockOut <= nextClockIn) {
    throw new Error("Clock Out must be greater than Clock In");
  }

  if (clockIn) {
    attendance.clockIn = nextClockIn;
    attendance.clockInSource = "MANUAL";
  }

  if (clockOut) {
    attendance.clockOut = nextClockOut;
    attendance.clockOutSource = "MANUAL";
  }

  // Keep punch timeline aligned with HR override (counting only).
  const manualPunches = [];
  if (attendance.clockIn) {
    manualPunches.push(attendance.clockIn);
  }
  if (attendance.clockOut) {
    manualPunches.push(attendance.clockOut);
  }
  const timeline = derivePunchTimeline(manualPunches);
  attendance.punches = timeline.punches;
  attendance.breaks = timeline.breaks;
  attendance.totalBreakMinutes = timeline.totalBreakMinutes;

  const { officeEnd } = getOfficeTimes(user, targetDate);
  const metrics = calculateAttendanceMetrics(
    attendance.clockIn,
    attendance.clockOut,
    user,
    targetDate,
    {
      totalBreakMinutes: timeline.totalBreakMinutes,
      applyCheckoutStatus: shouldApplyCheckoutStatus(
        targetDate,
        officeEnd
      ),
    }
  );

  attendance.workingMinutes = metrics.workingMinutes;
  attendance.lateMinutes = metrics.lateMinutes;
  attendance.overtimeMinutes = metrics.overtimeMinutes;
  attendance.shortfallMinutes = metrics.shortfallMinutes;
  attendance.earlyOutMinutes = metrics.earlyOutMinutes;
  attendance.status = metrics.status;
  attendance.employeeId = user?.employeeId || attendance.employeeId;
  attendance.employeeName = user?.name || attendance.employeeName;
  attendance.biometricEmpCode =
    user?.biometricEmpCode || attendance.biometricEmpCode;

  attendance.updatedBy = updatedBy;
  attendance.updateReason = reason;
  attendance.isManuallyUpdated = true;

  const updater = await User.findById(updatedBy)
    .select("name employeeId role")
    .lean();
  const updaterSnapshot = {
    byName: updater?.name || "",
    byEmployeeId: updater?.employeeId || "",
    byRole: updater?.role || "",
  };

  if (clockIn) {
    addPunchEvent(attendance, {
      action: "CLOCK_IN",
      source: "MANUAL",
      time: nextClockIn,
      previousTime: existingClockIn,
      by: updatedBy,
      ...updaterSnapshot,
      note: `Manual update: ${reason}`,
    });
  }

  if (clockOut && nextClockOut) {
    addPunchEvent(attendance, {
      action: "CLOCK_OUT",
      source: "MANUAL",
      time: nextClockOut,
      previousTime: existingClockOut,
      by: updatedBy,
      ...updaterSnapshot,
      note: `Manual update: ${reason}`,
    });
  }

  await attendance.save();

  return {
    success: true,
    message: "Attendance Updated Successfully",
    data: attendance,
  };
};

const revokeClockOut = async (attendanceId, reason, updatedBy) => {
  const attendance = await Attendance.findById(attendanceId);

  if (!attendance) {
    throw new Error("Attendance not found");
  }

  if (!reason || !reason.trim()) {
    throw new Error("Reason is required");
  }

  if (!attendance.clockIn) {
    throw new Error("Clock In is missing. Cannot revoke Clock Out.");
  }

  if (!attendance.clockOut) {
    throw new Error("Clock Out is already empty");
  }

  const user = await User.findById(attendance.employee);
  const attendanceDate = attendance.date;
  const previousClockOut = attendance.clockOut;

  // Remove last out punch so timeline returns to ON_SHIFT.
  const punches = getExistingPunchTimes(attendance);
  if (punches.length > 0 && punches.length % 2 === 0) {
    punches.pop();
  }

  const timeline = derivePunchTimeline(punches);
  applyTimelineMetrics(
    attendance,
    timeline,
    user,
    attendanceDate,
    "MANUAL",
    updatedBy
  );

  attendance.updatedBy = updatedBy;
  attendance.updateReason = reason.trim();
  attendance.isManuallyUpdated = true;

  const updater = await User.findById(updatedBy)
    .select("name employeeId role")
    .lean();

  addPunchEvent(attendance, {
    action: "CLOCK_OUT",
    source: "MANUAL",
    time: previousClockOut,
    previousTime: previousClockOut,
    by: updatedBy,
    byName: updater?.name || "",
    byEmployeeId: updater?.employeeId || "",
    byRole: updater?.role || "",
    note: `Clock Out revoked: ${reason.trim()}`,
  });

  await attendance.save();

  return {
    success: true,
    message: "Clock Out revoked successfully",
    data: attendance,
  };
};

module.exports = {
  ensureDailyAttendanceRecords,
  clockIn,
  clockOut,
  getTodayAttendance,
  getMyHistory,
  getMyMonthlyAttendance,
  getDashboard,
  getAttendanceDashboardDetails,
  getMyAttendanceDashboard,
  getEmployeeAttendance,
  getMonthlyTeamSheet,
  reconcileEmployeeAttendanceFromBiometricRange,
  reconcileRecentAttendanceFromBiometricInOut,
  manualUpdateAttendance,
  revokeClockOut,
  applyBiometricPunch,
  parseBiometricPunchDate,
};
