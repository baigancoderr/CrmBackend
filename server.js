require("dotenv").config();

const http = require("http");
const path = require("path");
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
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

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PATCH", "DELETE"],
  },
});

const PORT = process.env.PORT || 6000;
const isBiometricSyncEnabled =
  process.env.ETIME_SYNC_ENABLED !== "false";

const defaultAllowedOrigins = [
  "https://newofficefrontend.fastsolution.cloud",
  "https://newofficebackend.fastsolution.cloud",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:6000",
  "http://127.0.0.1:6000",
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
// Daily work report attachments are sent as base64 JSON (up to 5 MB file).
app.use(express.json({ limit: "8mb" }));
app.use(cookieParser());

// Routes
app.use("/api", routes);
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);


(async () => {
  try {
    await connectDB();
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

    initializeChatSocket(io);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log("Chat socket initialized");
    });
  } catch (error) {
    console.error(error);
  }
})();