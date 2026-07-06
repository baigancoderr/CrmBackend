const User = require("../user/user.model");
const {
  downloadInOutPunchData,
} = require("./etimeoffice.service");
const {
  normalizeEmpCode,
} = require("../../utils/biometricEmpCode");

const isBiometricFetchEnabled = () =>
  process.env.ETIME_FETCH_ENABLED !== "false";

const getLocalDateKey = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date());
};

const toEtimeDate = (dateKey) => {
  const [year, month, day] = dateKey.split("-");

  return `${day}/${month}/${year}`;
};

const buildEmployeeLookup = (employees) => {
  const lookup = new Map();

  employees.forEach((employee) => {
    if (employee.biometricEmpCode) {
      lookup.set(
        normalizeEmpCode(employee.biometricEmpCode),
        employee
      );
    }

    if (employee.employeeId) {
      lookup.set(
        normalizeEmpCode(
          employee.employeeId.replace(/^DOB/i, "")
        ),
        employee
      );
    }
  });

  return lookup;
};

const formatCrmEmployee = (employee) => {
  if (!employee) {
    return null;
  }

  return {
    _id: employee._id,
    employeeId: employee.employeeId,
    biometricEmpCode: employee.biometricEmpCode || "",
    name: employee.name,
    designation: employee.designation || "",
    department: employee.department || "",
    profilePhoto: employee.profilePhoto || "",
  };
};

const getUserBiometricEmpCode = (user) => {
  if (!user) {
    return null;
  }

  if (user.biometricEmpCode) {
    return normalizeEmpCode(user.biometricEmpCode);
  }

  if (user.employeeId) {
    return normalizeEmpCode(
      user.employeeId.replace(/^DOB/i, "")
    );
  }

  return null;
};

const mapInOutRow = (row, matchedEmployee) => ({
  empcode: row.Empcode,
  name: row.Name,
  inTime: row.INTime,
  outTime: row.OUTTime,
  workTime: row.WorkTime,
  overTime: row.OverTime,
  breakTime: row.BreakTime || "00:00",
  status: row.Status,
  dateString: row.DateString,
  remark: row.Remark || "",
  lateIn: row.Late_In || "00:00",
  erlOut: row.Erl_Out || "00:00",
  crmEmployee: formatCrmEmployee(matchedEmployee),
});

const fetchBiometricInOutForUser = async (
  userId,
  dateKey
) => {
  const targetDate = dateKey || getLocalDateKey();

  if (!isBiometricFetchEnabled()) {
    return {
      date: targetDate,
      records: [],
      total: 0,
      error:
        "Biometric fetch is disabled. Manual attendance mode is active.",
    };
  }

  const user = await User.findById(userId)
    .select(
      "employeeId biometricEmpCode name designation department profilePhoto"
    )
    .lean();

  if (!user) {
    throw new Error("User not found");
  }

  const empcode = getUserBiometricEmpCode(user);

  if (!empcode) {
    return {
      date: targetDate,
      records: [],
      total: 0,
      error:
        "Biometric EMP ID is not configured for your account",
    };
  }

  const etimeDate = toEtimeDate(targetDate);

  try {
    const apiResponse = await downloadInOutPunchData(
      empcode,
      etimeDate,
      etimeDate
    );

    const records = (apiResponse.InOutPunchData || []).map(
      (row) => mapInOutRow(row, user)
    );

    return {
      date: targetDate,
      records,
      total: records.length,
      error: null,
    };
  } catch (error) {
    return {
      date: targetDate,
      records: [],
      total: 0,
      error: error.message,
    };
  }
};

const fetchBiometricInOutRecords = async (dateKey) => {
  const targetDate = dateKey || getLocalDateKey();

  if (!isBiometricFetchEnabled()) {
    return {
      date: targetDate,
      records: [],
      total: 0,
      error:
        "Biometric fetch is disabled. Manual attendance mode is active.",
    };
  }

  const employees = await User.find({
    isActive: true,
  })
    .select(
      "employeeId biometricEmpCode name designation department profilePhoto"
    )
    .lean();

  const employeeLookup = buildEmployeeLookup(employees);
  const etimeDate = toEtimeDate(targetDate);

  try {
    const apiResponse = await downloadInOutPunchData(
      "ALL",
      etimeDate,
      etimeDate
    );

    const records = (apiResponse.InOutPunchData || []).map(
      (row) => {
        const empcode = normalizeEmpCode(row.Empcode);
        const matchedEmployee = employeeLookup.get(empcode);

        return mapInOutRow(row, matchedEmployee);
      }
    );

    return {
      date: targetDate,
      records,
      total: records.length,
      error: null,
    };
  } catch (error) {
    return {
      date: targetDate,
      records: [],
      total: 0,
      error: error.message,
    };
  }
};

module.exports = {
  fetchBiometricInOutRecords,
  fetchBiometricInOutForUser,
  getUserBiometricEmpCode,
  toEtimeDate,
  getLocalDateKey,
};
