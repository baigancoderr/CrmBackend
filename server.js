require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/config/redis");

const routes = require("./src/routes");

const app = express();
const PORT = process.env.PORT || 5000;
const isBiometricSyncEnabled =
  process.env.ETIME_SYNC_ENABLED !== "false";

// Middlewares
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Routes
app.use("/api", routes);

(async () => {
  try {
    await connectDB();
    await connectRedis();

    const {
      ensureDailyAttendanceRecords,
    } = require("./src/modules/attendance/attendance.service");
    const {
      syncBiometricPunches,
    } = require("./src/modules/biometric/biometricSync.service");

    const attendanceSeedIntervalMs =
      Number(process.env.ATTENDANCE_SEED_INTERVAL_MS) ||
      60 * 60 * 1000;
    const syncIntervalMs =
      Number(process.env.ETIME_SYNC_INTERVAL_MS) ||
      2 * 60 * 1000;

    const runAttendanceSeed = async () => {
      try {
        const result =
          await ensureDailyAttendanceRecords();
        console.log(
          `[Attendance Seed] ${result.createdCount} daily record(s) created for ${result.date}`
        );
      } catch (error) {
        console.error(
          "[Attendance Seed] Failed:",
          error.message
        );
      }
    };

    const runBiometricSync = async () => {
      try {
        const result = await syncBiometricPunches();
        console.log(
          `[Biometric Sync] ${result.message}`
        );
      } catch (error) {
        console.error(
          "[Biometric Sync] Failed:",
          error.message
        );
      }
    };

    runAttendanceSeed();
    setInterval(
      runAttendanceSeed,
      attendanceSeedIntervalMs
    );
    console.log(
      `Attendance daily seeding scheduled every ${attendanceSeedIntervalMs / 1000}s`
    );

    if (
      isBiometricSyncEnabled &&
      process.env.ETIME_CORPORATE_ID &&
      process.env.ETIME_USERNAME &&
      process.env.ETIME_PASSWORD
    ) {
      runBiometricSync();
      setInterval(runBiometricSync, syncIntervalMs);
      console.log(
        `Biometric sync scheduled every ${syncIntervalMs / 1000}s`
      );
    } else if (!isBiometricSyncEnabled) {
      console.warn(
        "Biometric sync is turned off (ETIME_SYNC_ENABLED=false). Manual attendance mode is active."
      );
    } else {
      console.warn(
        "Biometric sync disabled: E-TimeOffice credentials not configured"
      );
    }

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error(error);
  }
})();