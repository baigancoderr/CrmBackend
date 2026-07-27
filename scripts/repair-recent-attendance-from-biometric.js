/**
 * Fill missing clock-in/out for recent days from eTime DownloadInOutPunchData.
 *
 * Usage:
 *   node scripts/repair-recent-attendance-from-biometric.js
 *   node scripts/repair-recent-attendance-from-biometric.js 5
 */
require("dotenv").config();
const mongoose = require("mongoose");

const lookbackDays = Number(process.argv[2]) || 5;

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  console.log("Connecting...");
  await mongoose.connect(process.env.MONGO_URI);

  const {
    reconcileRecentAttendanceFromBiometricInOut,
  } = require("../src/modules/attendance/attendance.service");

  console.log(
    `Reconciling last ${lookbackDays} day(s) from biometric In/Out API...`
  );

  const started = Date.now();
  const result = await reconcileRecentAttendanceFromBiometricInOut(
    lookbackDays
  );
  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Done in ${elapsedSec}s.`);
  console.log(result.message || JSON.stringify(result, null, 2));
  if (result.error) {
    console.error("Error:", result.error);
  }

  await mongoose.disconnect();

  if (!result.success) {
    process.exit(1);
  }
};

main().catch(async (error) => {
  console.error("Recent repair failed:", error.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
