/**
 * Re-sync THIS MONTH (or given month/year) clock-in/out from eTime In/Out API
 * for all active employees. Safe with ongoing daily biometric cron —
 * it hydrates attendance from DownloadInOutPunchData, does not reset punch cursor.
 *
 * Usage:
 *   node scripts/repair-month-attendance-from-biometric.js
 *   node scripts/repair-month-attendance-from-biometric.js 7 2026
 */
require("dotenv").config();
const mongoose = require("mongoose");

const now = new Date();
const month = Number(process.argv[2]) || now.getMonth() + 1;
const year = Number(process.argv[3]) || now.getFullYear();

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  console.log(`Connecting...`);
  await mongoose.connect(process.env.MONGO_URI);

  const {
    getMonthlyTeamSheet,
  } = require("../src/modules/attendance/attendance.service");

  console.log(
    `Repairing biometric In/Out attendance for ${String(month).padStart(2, "0")}/${year}...`
  );

  const started = Date.now();
  const result = await getMonthlyTeamSheet(month, year);
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

  const employees = result?.data?.employees?.length || 0;
  const days = result?.data?.days?.length || result?.data?.dates?.length || 0;

  console.log(`Done in ${elapsedSec}s.`);
  console.log(`Employees: ${employees}`);
  if (days) {
    console.log(`Day columns: ${days}`);
  }
  console.log(
    "Existing month rows are hydrated from biometric In/Out. New days will continue via cron + seed."
  );

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error("Month repair failed:", error.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
