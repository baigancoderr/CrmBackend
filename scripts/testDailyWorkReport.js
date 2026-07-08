require("dotenv").config();

const connectDB = require("../src/config/db");
const User = require("../src/modules/user/user.model");
const DailyWorkReport = require("../src/modules/daily-work-report/dailyWorkReport.model");
const dailyWorkReportService = require("../src/modules/daily-work-report/dailyWorkReport.service");

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const run = async () => {
  await connectDB();

  const employee = await User.findOne({
    role: "EMPLOYEE",
    isActive: true,
  }).select("_id name employeeId email");

  const manager = await User.findOne({
    role: { $in: ["PROJECT_MANAGER", "TL"] },
    isActive: true,
  }).select("_id name role");

  if (!employee) {
    console.log("No active employee found in database.");
    process.exit(1);
  }

  if (!manager) {
    console.log("No active PM/TL manager found in database.");
    process.exit(1);
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const reportDate = getLocalDateString(yesterday);

  const payload = {
    projectName: "Daily Work Report Test",
    reportDate,
    workDescription: "Automated test submission for yesterday date.",
    reportingManagerId: String(manager._id),
    blockers: "",
    attachment: null,
  };

  console.log("Employee:", employee.email, employee.employeeId);
  console.log("Manager:", manager.name, manager.role);
  console.log("Report date:", reportDate);

  try {
    const created = await dailyWorkReportService.submitDailyWorkReport(
      employee._id,
      payload
    );
    console.log("SUCCESS: created report", created._id, "stored date:", created.reportDate);

    if (created.reportDate !== reportDate) {
      console.log("FAILED: stored date does not match submitted date.");
      process.exitCode = 1;
    }

    await DailyWorkReport.findByIdAndDelete(created._id);
    console.log("Cleanup: test report deleted.");
  } catch (error) {
    console.log("FAILED:", error.message);
    process.exitCode = 1;
  }

  process.exit();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
