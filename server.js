require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/config/redis");

const routes = require("./src/routes");

const app = express();
const PORT = process.env.PORT || 5000;

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
      syncBiometricPunches,
    } = require("./src/modules/biometric/biometricSync.service");

    const syncIntervalMs =
      Number(process.env.ETIME_SYNC_INTERVAL_MS) ||
      2 * 60 * 1000;

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

    if (
      process.env.ETIME_CORPORATE_ID &&
      process.env.ETIME_USERNAME &&
      process.env.ETIME_PASSWORD
    ) {
      runBiometricSync();
      setInterval(runBiometricSync, syncIntervalMs);
      console.log(
        `Biometric sync scheduled every ${syncIntervalMs / 1000}s`
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