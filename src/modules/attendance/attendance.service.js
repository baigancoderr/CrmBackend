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
    });

    return attendance;
  }

  let clockIn = attendance.clockIn || punchDateTime;
  let clockOut = attendance.clockOut || null;

  if (!attendance.clockIn || punchDateTime < attendance.clockIn) {
    clockIn = punchDateTime;
    attendance.clockIn = clockIn;
    attendance.clockInSource = "BIOMETRIC";
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

  if (existingAttendance) {
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

  const attendance =
    await Attendance.create({
      employee: userId,
      date: today,
      ...getAttendanceEmployeeSnapshot(user),
      clockIn: now,
      clockInSource: "MANUAL",
      lateMinutes: metrics.lateMinutes,
      earlyOutMinutes: metrics.earlyOutMinutes,
      status: metrics.status,
    });

  return {
    success: true,
    message:
      "Clock In Successful",
    data: attendance,
  };
};

const clockOut = async (userId) => {
  const user = await User.findById(userId);
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

  if (attendance.clockOut) {
    throw new Error(
      "Already clocked out"
    );
  }

  const now = new Date();

  attendance.clockOut = now;
  attendance.clockOutSource = "MANUAL";

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
  };
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

  if (!clockIn || !clockOut) {
    throw new Error("Clock In and Clock Out are required");
  }

  if (!reason) {
    throw new Error("Reason is required");
  }

  const attendanceDate = attendance.date;
  const user = await User.findById(attendance.employee);

  const clockInDate = new Date(`${attendanceDate}T${clockIn}:00`);
  const clockOutDate = new Date(`${attendanceDate}T${clockOut}:00`);

  if (clockOutDate <= clockInDate) {
    throw new Error("Clock Out must be greater than Clock In");
  }

  attendance.clockIn = clockInDate;
  attendance.clockOut = clockOutDate;

  const metrics = calculateAttendanceMetrics(
    clockInDate,
    clockOutDate,
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

  await attendance.save();

  return {
    success: true,
    message: "Attendance Updated Successfully",
    data: attendance,
  };
};

module.exports = {
  clockIn,
  clockOut,
  getTodayAttendance,
  getMyHistory,
  getMyMonthlyAttendance,
  getDashboard,
  getAttendanceDashboardDetails,
  getMyAttendanceDashboard,
  getEmployeeAttendance,
  manualUpdateAttendance,
  applyBiometricPunch,
  parseBiometricPunchDate,
};
