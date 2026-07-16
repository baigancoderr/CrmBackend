/**
 * Repair attendance records by re-syncing biometric in/out data for a date.
 * Usage: node scripts/repair-attendance-from-biometric.js 2026-07-10
 */
require("dotenv").config();
const mongoose = require("mongoose");

const repairDate = process.argv[2] || "2026-07-10";

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const { getAttendanceDashboardDetails } = require("../src/modules/attendance/attendance.service");
  const response = await getAttendanceDashboardDetails(repairDate);

  console.log(
    `Repaired attendance for ${repairDate}. Employees synced: ${response.data.employeeAttendanceList.length}`
  );

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
