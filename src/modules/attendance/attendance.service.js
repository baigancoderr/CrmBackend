const Attendance = require("./attendance.model");
const User = require("../user/user.model");
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
  dateKey
) => {
  const {
    officeEnd,
    lateGraceEnd,
    halfDayCutoffTime,
  } = getOfficeTimes(user, dateKey);

  let lateMinutes = 0;
  let overtimeMinutes = 0;
  let shortfallMinutes = 0;
  let workingMinutes = 0;
  let status = "PRESENT";

  // Check-in: Present within grace window, Late after grace end time.
  if (clockInDate > lateGraceEnd) {
    lateMinutes = Math.floor(
      (clockInDate - lateGraceEnd) / 60000
    );
    status = "LATE";
  }

  if (clockOutDate) {
    workingMinutes = Math.floor(
      (clockOutDate - clockInDate) / 60000
    );

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

    // Check-out status takes priority once employee has clocked out
    if (clockOutDate < halfDayCutoffTime) {
      status = "HALF_DAY";
    } else if (clockOutDate < officeEnd) {
      status = "EARLY_LEAVE";
    }
    // 19:00 or later keeps Present/Late from check-in
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
    attendance.punchEvents.push({
      action: event.action,
      source: event.source,
      time: eventTime,
      by: event.by || null,
      note: event.note || "",
      changedAt: event.changedAt || new Date(),
    });
  }
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

  if (!attendance) {
    const metrics = calculateAttendanceMetrics(
      punchDateTime,
      null,
      user,
      dateKey
    );

    attendance = await Attendance.create({
      employee: userId,
      date: dateKey,
      ...getAttendanceEmployeeSnapshot(user),
      clockIn: punchDateTime,
      clockInSource: "BIOMETRIC",
      lateMinutes: metrics.lateMinutes,
      earlyOutMinutes: metrics.earlyOutMinutes,
      status: metrics.status,
      punchEvents: [
        {
          action: "CLOCK_IN",
          source: "BIOMETRIC",
          time: punchDateTime,
          by: null,
          note: "Biometric clock in",
        },
      ],
    });

    return attendance;
  }

  // HR manually marked absent — do not overwrite with biometric punches.
  if (attendance.isManuallyUpdated && attendance.status === "ABSENT") {
    return attendance;
  }

  let clockIn = attendance.clockIn || punchDateTime;
  let clockOut = attendance.clockOut || null;

  if (!attendance.clockIn || punchDateTime < attendance.clockIn) {
    clockIn = punchDateTime;
    attendance.clockIn = clockIn;
    attendance.clockInSource = "BIOMETRIC";
    addPunchEvent(attendance, {
      action: "CLOCK_IN",
      source: "BIOMETRIC",
      time: punchDateTime,
      by: null,
      note: "Biometric clock in synced",
    });
  }

  if (
    punchDateTime > clockIn &&
    (
      !attendance.clockOut ||
      punchDateTime > attendance.clockOut
    )
  ) {
    clockOut = punchDateTime;
    attendance.clockOut = clockOut;
    attendance.clockOutSource = "BIOMETRIC";
    addPunchEvent(attendance, {
      action: "CLOCK_OUT",
      source: "BIOMETRIC",
      time: punchDateTime,
      by: null,
      note: "Biometric clock out synced",
    });
  }

  const metrics = calculateAttendanceMetrics(
    attendance.clockIn,
    attendance.clockOut,
    user,
    dateKey
  );

  attendance.lateMinutes = metrics.lateMinutes;
  attendance.overtimeMinutes = metrics.overtimeMinutes;
  attendance.shortfallMinutes = metrics.shortfallMinutes;
  attendance.earlyOutMinutes = metrics.earlyOutMinutes;
  attendance.workingMinutes = metrics.workingMinutes;
  attendance.status = metrics.status;
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
  const metrics = calculateAttendanceMetrics(
    now,
    null,
    user,
    today
  );

  let attendance;

  if (existingAttendance) {
    existingAttendance.clockIn = now;
    existingAttendance.clockInSource = "MANUAL";
    existingAttendance.lateMinutes = metrics.lateMinutes;
    existingAttendance.earlyOutMinutes = metrics.earlyOutMinutes;
    existingAttendance.status = metrics.status;
    existingAttendance.employeeId =
      user.employeeId || existingAttendance.employeeId;
    existingAttendance.employeeName =
      user.name || existingAttendance.employeeName;
    existingAttendance.biometricEmpCode =
      user.biometricEmpCode ||
      existingAttendance.biometricEmpCode;
    addPunchEvent(existingAttendance, {
      action: "CLOCK_IN",
      source: "MANUAL",
      time: now,
      by: userId,
      note: "Manual clock in by employee",
    });

    await existingAttendance.save();
    attendance = existingAttendance;
  } else {
    attendance =
      await Attendance.create({
        employee: userId,
        date: today,
        ...getAttendanceEmployeeSnapshot(user),
        clockIn: now,
        clockInSource: "MANUAL",
        lateMinutes: metrics.lateMinutes,
        earlyOutMinutes: metrics.earlyOutMinutes,
        status: metrics.status,
        punchEvents: [
          {
            action: "CLOCK_IN",
            source: "MANUAL",
            time: now,
            by: userId,
            note: "Manual clock in by employee",
          },
        ],
      });
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

  if (attendance.clockOut) {
    throw new Error(
      "Already clocked out"
    );
  }

  const now = new Date();

  attendance.clockOut = now;
  attendance.clockOutSource = "MANUAL";
  addPunchEvent(attendance, {
    action: "CLOCK_OUT",
    source: "MANUAL",
    time: now,
    by: userId,
    note: "Manual clock out by employee",
  });

  const metrics = calculateAttendanceMetrics(
    attendance.clockIn,
    now,
    user,
    today
  );

  attendance.workingMinutes = metrics.workingMinutes;
  attendance.overtimeMinutes = metrics.overtimeMinutes;
  attendance.shortfallMinutes = metrics.shortfallMinutes;
  attendance.earlyOutMinutes = metrics.earlyOutMinutes;
  attendance.status = metrics.status;
  attendance.employeeId = user?.employeeId || attendance.employeeId;
  attendance.employeeName = user?.name || attendance.employeeName;
  attendance.biometricEmpCode =
    user?.biometricEmpCode || attendance.biometricEmpCode;

  await attendance.save();

  return {
    success: true,
    message:
      "Clock Out Successful",
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

const formatAttendanceSummary = (record) => {
  if (!record) {
    return null;
  }

  return {
    _id: record._id,
    employeeId: record.employeeId || "",
    employeeName: record.employeeName || "",
    biometricEmpCode: record.biometricEmpCode || "",
    date: record.date,
    clockIn: record.clockIn,
    clockOut: record.clockOut,
    status: record.status,
    clockInSource: record.clockInSource,
    clockOutSource: record.clockOutSource,
    lateMinutes: record.lateMinutes || 0,
    earlyOutMinutes:
      typeof record.earlyOutMinutes === "number"
        ? record.earlyOutMinutes
        : record.shortfallMinutes || 0,
    workingMinutes: record.workingMinutes || 0,
    overtimeMinutes: record.overtimeMinutes || 0,
    punchEvents: Array.isArray(record.punchEvents)
      ? record.punchEvents
      : [],
  };
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

const getAttendanceFromBiometric = (existingAttendance, biometricRecord, dateKey) => {
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
      clockInSource: biometricClockIn ? "BIOMETRIC" : null,
      clockOutSource: biometricClockOut ? "BIOMETRIC" : null,
      lateMinutes: 0,
      earlyOutMinutes: 0,
      workingMinutes: 0,
      overtimeMinutes: 0,
      punchEvents: [],
    };
  }

  const useBiometricClockIn =
    biometricClockIn &&
    canOverrideWithBiometric(existingAttendance, "clockIn") &&
    (
      !existingAttendance.clockIn ||
      existingAttendance.clockInSource === "BIOMETRIC"
    );

  const useBiometricClockOut =
    biometricClockOut &&
    canOverrideWithBiometric(existingAttendance, "clockOut") &&
    (
      !existingAttendance.clockOut ||
      existingAttendance.clockOutSource === "BIOMETRIC"
    );

  return {
    ...existingAttendance,
    clockIn: useBiometricClockIn
      ? biometricClockIn
      : existingAttendance.clockIn || biometricClockIn,
    clockOut: useBiometricClockOut
      ? biometricClockOut
      : existingAttendance.clockOut || biometricClockOut,
    clockInSource:
      existingAttendance.clockInSource ||
      (biometricClockIn ? "BIOMETRIC" : existingAttendance.clockInSource),
    clockOutSource:
      existingAttendance.clockOutSource ||
      (biometricClockOut ? "BIOMETRIC" : existingAttendance.clockOutSource),
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

    if (attendance?.isManuallyUpdated && attendance?.status === "ABSENT") {
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
      const metrics = calculateAttendanceMetrics(
        biometricClockIn,
        validClockOut,
        employee,
        dateKey
      );

      attendance = await Attendance.create({
        employee: employee._id,
        date: dateKey,
        ...getAttendanceEmployeeSnapshot(employee),
        clockIn: biometricClockIn,
        clockOut: validClockOut,
        clockInSource: "BIOMETRIC",
        clockOutSource: validClockOut ? "BIOMETRIC" : "MANUAL",
        lateMinutes: metrics.lateMinutes,
        overtimeMinutes: metrics.overtimeMinutes,
        shortfallMinutes: metrics.shortfallMinutes,
        earlyOutMinutes: metrics.earlyOutMinutes,
        workingMinutes: metrics.workingMinutes,
        status: metrics.status,
        punchEvents: [
          {
            action: "CLOCK_IN",
            source: "BIOMETRIC",
            time: biometricClockIn,
            by: null,
            note: "Biometric clock in hydrated from in/out API",
          },
          ...(validClockOut
            ? [
                {
                  action: "CLOCK_OUT",
                  source: "BIOMETRIC",
                  time: validClockOut,
                  by: null,
                  note: "Biometric clock out hydrated from in/out API",
                },
              ]
            : []),
        ],
      });

      attendanceByEmployeeId.set(employeeIdKey, attendance);
      continue;
    }

    let changed = false;
    let effectiveClockIn = attendance.clockIn ? new Date(attendance.clockIn) : null;
    let effectiveClockOut = attendance.clockOut ? new Date(attendance.clockOut) : null;

    if (shouldApplyBiometricClockIn(effectiveClockIn, biometricClockIn, attendance)) {
      attendance.clockIn = biometricClockIn;
      attendance.clockInSource = "BIOMETRIC";
      effectiveClockIn = biometricClockIn;
      changed = true;

      addPunchEvent(attendance, {
        action: "CLOCK_IN",
        source: "BIOMETRIC",
        time: biometricClockIn,
        by: null,
        note: "Biometric clock in hydrated from in/out API",
      });
    }

    if (
      shouldApplyBiometricClockOut(
        effectiveClockOut,
        biometricClockOut,
        effectiveClockIn,
        attendance
      )
    ) {
      attendance.clockOut = biometricClockOut;
      attendance.clockOutSource = "BIOMETRIC";
      effectiveClockOut = biometricClockOut;
      changed = true;

      addPunchEvent(attendance, {
        action: "CLOCK_OUT",
        source: "BIOMETRIC",
        time: biometricClockOut,
        by: null,
        note: "Biometric clock out hydrated from in/out API",
      });
    }

    // Even if punch timestamps were already present, recalc to avoid stale ABSENT status.
    if (effectiveClockIn) {
      const metrics = calculateAttendanceMetrics(
        effectiveClockIn,
        effectiveClockOut,
        employee,
        dateKey
      );

      if (
        attendance.status !== metrics.status ||
        attendance.workingMinutes !== metrics.workingMinutes ||
        attendance.lateMinutes !== metrics.lateMinutes ||
        attendance.overtimeMinutes !== metrics.overtimeMinutes ||
        attendance.shortfallMinutes !== metrics.shortfallMinutes ||
        attendance.earlyOutMinutes !== metrics.earlyOutMinutes
      ) {
        changed = true;
      }

      attendance.workingMinutes = metrics.workingMinutes;
      attendance.lateMinutes = metrics.lateMinutes;
      attendance.overtimeMinutes = metrics.overtimeMinutes;
      attendance.shortfallMinutes = metrics.shortfallMinutes;
      attendance.earlyOutMinutes = metrics.earlyOutMinutes;
      attendance.status = metrics.status;
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

const recalculateAttendanceRecordMetrics = async (attendanceDoc, employee, dateKey) => {
  if (!attendanceDoc?.clockIn || !employee) {
    return;
  }

  const clockInDate = new Date(attendanceDoc.clockIn);
  if (Number.isNaN(clockInDate.getTime())) {
    return;
  }

  const clockOutDate = attendanceDoc.clockOut
    ? new Date(attendanceDoc.clockOut)
    : null;

  if (clockOutDate && Number.isNaN(clockOutDate.getTime())) {
    return;
  }

  const metrics = calculateAttendanceMetrics(
    clockInDate,
    clockOutDate,
    employee,
    dateKey || attendanceDoc.date
  );

  const shouldUpdate =
    attendanceDoc.status !== metrics.status ||
    attendanceDoc.workingMinutes !== metrics.workingMinutes ||
    attendanceDoc.lateMinutes !== metrics.lateMinutes ||
    attendanceDoc.overtimeMinutes !== metrics.overtimeMinutes ||
    attendanceDoc.shortfallMinutes !== metrics.shortfallMinutes ||
    attendanceDoc.earlyOutMinutes !== metrics.earlyOutMinutes;

  if (!shouldUpdate) {
    return;
  }

  attendanceDoc.status = metrics.status;
  attendanceDoc.workingMinutes = metrics.workingMinutes;
  attendanceDoc.lateMinutes = metrics.lateMinutes;
  attendanceDoc.overtimeMinutes = metrics.overtimeMinutes;
  attendanceDoc.shortfallMinutes = metrics.shortfallMinutes;
  attendanceDoc.earlyOutMinutes = metrics.earlyOutMinutes;

  await attendanceDoc.save();
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

  const missingPunchRecords = todayRecords.filter(
    (record) => record.clockIn && !record.clockOut
  );

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
      attendance: formatAttendanceSummary(record),
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
        formatAttendanceSummary(record),
        biometricRecord,
        today
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
          attendance: formatAttendanceSummary(record),
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

  const todayAttendance = await Attendance.findOne({
    employee: userId,
    date: today,
  }).lean();

  const history = await Attendance.find({
    employee: userId,
  })
    .sort({ date: -1 })
    .limit(15)
    .lean();

  const biometricToday =
    biometricInOutResponse.records[0] || null;

  const hasClockIn = Boolean(todayAttendance?.clockIn);
  const hasClockOut = Boolean(todayAttendance?.clockOut);
  const isPresent = Boolean(
    todayAttendance &&
      ["PRESENT", "LATE", "HALF_DAY", "EARLY_LEAVE"].includes(
        todayAttendance.status
      )
  );

  return {
    success: true,
    data: {
      date: today,
      employee: formatEmployeeSummary(user),
      todayAttendance:
        formatAttendanceSummary(todayAttendance),
      biometricToday,
      biometricInOutRecords:
        biometricInOutResponse.records,
      biometricInOutError:
        biometricInOutResponse.error,
      history: history.map((record) => ({
        date: record.date,
        attendance: formatAttendanceSummary(record),
      })),
      overview: {
        status: todayAttendance?.status || "ABSENT",
        isPresent,
        hasClockIn,
        hasClockOut,
        missingPunch: hasClockIn && !hasClockOut,
        workingMinutes:
          todayAttendance?.workingMinutes || 0,
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
    return;
  }

  const dateKeys = Object.keys(rangeResponse.recordsByDate).sort();

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

  const metrics = calculateAttendanceMetrics(
    attendance.clockIn,
    attendance.clockOut,
    user,
    targetDate
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

  if (clockIn) {
    addPunchEvent(attendance, {
      action: "CLOCK_IN",
      source: "MANUAL",
      time: nextClockIn,
      by: updatedBy,
      note: `Manual update: ${reason}`,
    });
  }

  if (clockOut && nextClockOut) {
    addPunchEvent(attendance, {
      action: "CLOCK_OUT",
      source: "MANUAL",
      time: nextClockOut,
      by: updatedBy,
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

  attendance.clockOut = null;
  attendance.clockOutSource = "MANUAL";

  const metrics = calculateAttendanceMetrics(
    attendance.clockIn,
    null,
    user,
    attendanceDate
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
  attendance.updateReason = reason.trim();
  attendance.isManuallyUpdated = true;

  addPunchEvent(attendance, {
    action: "CLOCK_OUT",
    source: "MANUAL",
    time: previousClockOut,
    by: updatedBy,
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
  manualUpdateAttendance,
  revokeClockOut,
  applyBiometricPunch,
  parseBiometricPunchDate,
};
