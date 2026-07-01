const Attendance = require("./attendance.model");
const User = require("../user/user.model");
const ProcessedBiometricPunch = require("../biometric/processedPunch.model");
const {
  getBiometricSyncStatus,
} = require("../biometric/biometricSync.service");
const {
  fetchBiometricInOutRecords,
  fetchBiometricInOutForUser,
} = require("../biometric/biometricInOut.service");

const getTodayDate = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
};

const parseBiometricPunchDate = (punchDateString) => {
  if (!punchDateString) {
    return null;
  }

  const [datePart, timePart] = punchDateString.trim().split(" ");

  if (!datePart || !timePart) {
    return null;
  }

  const [day, month, year] = datePart.split("/");
  const [hours, minutes, seconds] = timePart.split(":");

  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds || 0)
  );
};

const getDateKey = (dateValue) => {
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

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

const getOfficeTimes = (user, dateKey) => {
  const startTime = user?.officeTiming?.startTime || "10:00";
  const endTime = user?.officeTiming?.endTime || "19:00";

  const officeStart = new Date(`${dateKey}T${startTime}:00`);
  const officeEnd = new Date(`${dateKey}T${endTime}:00`);

  return {
    officeStart,
    officeEnd,
  };
};

const calculateAttendanceMetrics = (
  clockInDate,
  clockOutDate,
  user,
  dateKey
) => {
  const { officeStart, officeEnd } = getOfficeTimes(
    user,
    dateKey
  );

  let lateMinutes = 0;
  let overtimeMinutes = 0;
  let shortfallMinutes = 0;
  let workingMinutes = 0;
  let status = "PRESENT";

  if (clockInDate > officeStart) {
    lateMinutes = Math.floor(
      (clockInDate - officeStart) / 60000
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

    if (workingMinutes < 240) {
      status = "HALF_DAY";
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

  const day = new Date().getDay();

  if (day === 0 || day === 6) {
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

    const absent =
      totalEmployees -
      (
        present +
        late +
        halfDay
      );

    return {
      success: true,
      data: {
        totalEmployees,
        present,
        late,
        halfDay,
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

const formatTimePart = (dateValue) => {
  if (!dateValue) {
    return "";
  }

  const value = new Date(dateValue);
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const formatMonthlySheetCell = (record, isWeekend) => {
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

  const hasClockIn = Boolean(record.clockIn);
  const hasClockOut = Boolean(record.clockOut);

  if (hasClockIn || hasClockOut) {
    const inLabel = hasClockIn ? formatTimePart(record.clockIn) : "";
    const outLabel = hasClockOut ? formatTimePart(record.clockOut) : "";
    return `P (IN-${inLabel || "--"}) (OUT-${outLabel || "--"})`;
  }

  return "P";
};

const getAttendanceDashboardDetails = async (dateKey) => {
  const today = dateKey || getTodayDate();

  const activeEmployees = await User.find({
    isActive: true,
  })
    .select(
      "employeeId biometricEmpCode name designation department profilePhoto role"
    )
    .sort({ name: 1 })
    .lean();

  const todayRecords = await Attendance.find({
    date: today,
  })
    .populate(
      "employee",
      "employeeId biometricEmpCode name designation department profilePhoto"
    )
    .lean();

  const attendanceByEmployeeId = new Map();

  todayRecords.forEach((record) => {
    if (record.employee?._id) {
      attendanceByEmployeeId.set(
        String(record.employee._id),
        record
      );
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

  const totalEmployees = activeEmployees.length;
  const markedToday = todayRecords.length;
  const absent = Math.max(totalEmployees - markedToday, 0);

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
      employee: formatEmployeeSummary(record.employee),
      attendance: formatAttendanceSummary(record),
    }));

  const startOfDay = new Date(`${today}T00:00:00`);
  const endOfDay = new Date(`${today}T23:59:59`);

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

  const biometricInOutResponse =
    await fetchBiometricInOutRecords(today);

  const employeeAttendanceList = activeEmployees.map(
    (employee) => {
      const record = attendanceByEmployeeId.get(
        String(employee._id)
      );

      return {
        employee: formatEmployeeSummary(employee),
        attendance: formatAttendanceSummary(record),
      };
    }
  );

  const absentEmployees = employeeAttendanceList.filter(
    (item) => !item.attendance
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
        absent,
        onLeave: 0,
      },
      biometricSync: biometricSyncResponse.data,
      employeeAttendanceList,
      lateArrivals,
      missingPunchEmployees: missingPunchRecords.map(
        (record) => ({
          employee: formatEmployeeSummary(
            record.employee
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

  const biometricInOutResponse =
    await fetchBiometricInOutForUser(
      userId,
      today
    );

  const biometricToday =
    biometricInOutResponse.records[0] || null;

  const hasClockIn = Boolean(todayAttendance?.clockIn);
  const hasClockOut = Boolean(todayAttendance?.clockOut);
  const isPresent = Boolean(
    todayAttendance &&
      ["PRESENT", "LATE", "HALF_DAY"].includes(
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

const getMonthlyTeamSheet = async (month, year) => {
  if (!month || !year || month < 1 || month > 12) {
    throw new Error("Valid month and year are required");
  }

  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const monthEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const activeEmployees = await User.find({
    isActive: true,
  })
    .select("employeeId biometricEmpCode name designation department")
    .sort({ name: 1 })
    .lean();

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

  monthlyRecords.forEach((record) => {
    const key = `${String(record.employee)}-${record.date}`;
    attendanceMap.set(key, record);
  });

  const rows = Array.from({ length: lastDay }, (_, index) => {
    const dayNumber = index + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`;
    const dateValue = new Date(`${date}T00:00:00`);
    const day = dateValue
      .toLocaleDateString("en-US", {
        weekday: "short",
      })
      .toUpperCase();

    const weekday = dateValue.getDay();
    const isWeekend = weekday === 0 || weekday === 6;

    const cells = activeEmployees.map((employee) => {
      const key = `${String(employee._id)}-${date}`;
      const record = attendanceMap.get(key);
      return formatMonthlySheetCell(record, isWeekend);
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
  const attendance = await Attendance.findById(attendanceId);

  if (!attendance) {
    throw new Error("Attendance not found");
  }

  const { clockIn, clockOut, reason } = body;

  if (!clockIn && !clockOut) {
    throw new Error("Clock In or Clock Out is required");
  }

  if (!reason) {
    throw new Error("Reason is required");
  }

  const attendanceDate = attendance.date;
  const user = await User.findById(attendance.employee);

  const existingClockIn = attendance.clockIn || null;
  const existingClockOut = attendance.clockOut || null;

  const nextClockIn = clockIn
    ? new Date(`${attendanceDate}T${clockIn}:00`)
    : existingClockIn;
  const nextClockOut = clockOut
    ? new Date(`${attendanceDate}T${clockOut}:00`)
    : existingClockOut;

  if (!nextClockIn) {
    throw new Error("Clock In is required before setting Clock Out");
  }

  if (nextClockOut && nextClockOut <= nextClockIn) {
    throw new Error("Clock Out must be greater than Clock In");
  }

  attendance.clockIn = nextClockIn;
  attendance.clockOut = nextClockOut;

  if (clockIn) {
    attendance.clockInSource = "MANUAL";
  }

  if (clockOut) {
    attendance.clockOutSource = "MANUAL";
  }

  const metrics = calculateAttendanceMetrics(
    nextClockIn,
    nextClockOut,
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
  applyBiometricPunch,
  parseBiometricPunchDate,
};
