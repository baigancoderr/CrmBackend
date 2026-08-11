require("dotenv").config();

const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { createAdapter } = require("@socket.io/redis-adapter");

const connectDB = require("./src/config/db");
const {
  connectRedis,
  redisClient,
} = require("./src/config/redis");

const routes = require("./src/routes");
const {
  initializeChatSocket,
} = require("./src/modules/chat/chat.socket");
const { UPLOAD_LIMITS } = require("./src/constants/uploadLimits");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

const PORT = process.env.PORT || 8080;
const isBiometricSyncEnabled =
  process.env.ETIME_SYNC_ENABLED !== "false";

const defaultAllowedOrigins = [
  "https://newofficefrontend.fastsolution.cloud",
  "https://newofficebackend.fastsolution.cloud",
  "https://manageteam.fastsolution.cloud",
  "https://manageteam-api.fastsolution.cloud",
  "https://officecrm.furfoori.com/",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const envAllowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [
  ...new Set([...defaultAllowedOrigins, ...envAllowedOrigins]),
];

const isLocalDevOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(
    origin
  );

const isProduction = process.env.NODE_ENV === "production";
const isMongoConnected = () => mongoose.connection.readyState === 1;

const corsOptions = {
  origin: isProduction
    ? (origin, callback) => {
        if (
          !origin ||
          allowedOrigins.includes(origin) ||
          isLocalDevOrigin(origin)
        ) {
          callback(null, true);
          return;
        }

        callback(null, false);
      }
    : true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
  credentials: false,
  optionsSuccessStatus: 204,
};

// Middlewares
app.use(cors(corsOptions));
app.options("/{*splat}", cors(corsOptions));
// Daily work report attachments are sent as base64 JSON.
app.use(express.json({ limit: UPLOAD_LIMITS.EXPRESS_JSON_BODY_LIMIT }));
app.use(cookieParser());

// Public disk uploads. Mount /api/uploads before /api routes so reverse
// proxies that only forward /api still serve chat/employee/notes files.
const uploadsPath = path.join(__dirname, "uploads");
app.use("/uploads", express.static(uploadsPath));
app.use("/api/uploads", express.static(uploadsPath));

// Routes
app.use("/api", routes);

// Global Error Handler
const errorMiddleware = require("./src/middleware/error.middleware");
app.use(errorMiddleware);


(async () => {
  try {
    const dbConnected = await connectDB();
    if (!dbConnected) {
      console.warn(
        "The server will continue without MongoDB. Database-backed routes may fail until the connection is restored."
      );
    }

    await connectRedis();
    const socketPubClient = redisClient.duplicate();
    const socketSubClient = redisClient.duplicate();
    await Promise.all([
      socketPubClient.connect(),
      socketSubClient.connect(),
    ]);
    io.adapter(
      createAdapter(socketPubClient, socketSubClient)
    );

    const {
      ensureDailyAttendanceRecords,
      reconcileRecentAttendanceFromBiometricInOut,
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
    // In/Out API heal for missing clock-outs (yesterday etc.) — default every 30 min
    const inOutReconcileIntervalMs =
      Number(process.env.ETIME_INOUT_RECONCILE_INTERVAL_MS) ||
      30 * 60 * 1000;
    const inOutReconcileLookbackDays =
      Number(process.env.ETIME_INOUT_RECONCILE_LOOKBACK_DAYS) || 3;

    const runAttendanceSeed = async () => {
      if (!isMongoConnected()) {
        console.warn(
          "[Attendance Seed] Skipped: MongoDB is not connected"
        );
        return;
      }

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
      if (!isMongoConnected()) {
        console.warn(
          "[Biometric Sync] Skipped: MongoDB is not connected"
        );
        return;
      }

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

    const runInOutReconcile = async () => {
      if (!isMongoConnected()) {
        console.warn(
          "[Biometric In/Out] Skipped: MongoDB is not connected"
        );
        return;
      }

      try {
        const result =
          await reconcileRecentAttendanceFromBiometricInOut(
            inOutReconcileLookbackDays
          );
        console.log(`[Biometric In/Out] ${result.message}`);
      } catch (error) {
        console.error(
          "[Biometric In/Out] Failed:",
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

      // Heal missing clock-outs from DownloadInOutPunchData (not just punch stream).
      runInOutReconcile();
      setInterval(runInOutReconcile, inOutReconcileIntervalMs);
      console.log(
        `Biometric In/Out reconcile scheduled every ${inOutReconcileIntervalMs / 1000}s (lookback ${inOutReconcileLookbackDays} day(s))`
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

    const { startTaskScheduler } = require("./src/modules/project/task/taskScheduler");
    startTaskScheduler();

    const { startAnnouncementScheduler } = require("./src/modules/announcement/announcement.scheduler");
    startAnnouncementScheduler();

    initializeChatSocket(io);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log("Chat socket initialized");
    });
  } catch (error) {
    console.error(error);
  }
})();