const Attendance = require("./attendance.model");
const User = require("../user/user.model");

const getTodayDate = () => {
  return new Date()
    .toISOString()
    .split("T")[0];
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

  const officeStart = new Date();

  officeStart.setHours(
    10,
    0,
    0,
    0
  );

  let lateMinutes = 0;

  let status = "PRESENT";

  if (now > officeStart) {
    lateMinutes = Math.floor(
      (now - officeStart) / 60000
    );

    status = "LATE";
  }

  const attendance =
    await Attendance.create({
      employee: userId,
      date: today,
      clockIn: now,
      lateMinutes,
      status,
    });

  return {
    success: true,
    message:
      "Clock In Successful",
    data: attendance,
  };
};

const clockOut = async (userId) => {
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

  const workingMinutes =
    Math.floor(
      (
        attendance.clockOut -
        attendance.clockIn
      ) / 60000
    );

  attendance.workingMinutes =
    workingMinutes;

  const officeEnd =
    new Date();

  officeEnd.setHours(
    19,
    0,
    0,
    0
  );

  if (now > officeEnd) {
    attendance.overtimeMinutes =
      Math.floor(
        (
          now -
          officeEnd
        ) / 60000
      );
  }

  if (now < officeEnd) {
    attendance.shortfallMinutes =
      Math.floor(
        (
          officeEnd -
          now
        ) / 60000
      );
  }

  if (
    workingMinutes < 240
  ) {
    attendance.status =
      "HALF_DAY";
  }

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
          createdAt: -1,
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
          createdAt: -1,
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

  const clockInDate = new Date(`${attendanceDate}T${clockIn}:00`);
  const clockOutDate = new Date(`${attendanceDate}T${clockOut}:00`);

  if (clockOutDate <= clockInDate) {
    throw new Error("Clock Out must be greater than Clock In");
  }

  attendance.clockIn = clockInDate;
  attendance.clockOut = clockOutDate;

  const officeStart = new Date(`${attendanceDate}T10:00:00`);
  const officeEnd = new Date(`${attendanceDate}T19:00:00`);

  const workingMinutes = Math.floor(
    (clockOutDate - clockInDate) / 60000
  );

  let lateMinutes = 0;
  let overtimeMinutes = 0;
  let shortfallMinutes = 0;

  if (clockInDate > officeStart) {
    lateMinutes = Math.floor(
      (clockInDate - officeStart) / 60000
    );
  }

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

  let status = "PRESENT";

  if (lateMinutes > 0) {
    status = "LATE";
  }

  if (workingMinutes < 240) {
    status = "HALF_DAY";
  }

  attendance.workingMinutes = workingMinutes;
  attendance.lateMinutes = lateMinutes;
  attendance.overtimeMinutes = overtimeMinutes;
  attendance.shortfallMinutes = shortfallMinutes;
  attendance.status = status;

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
  getEmployeeAttendance,
  manualUpdateAttendance,
};