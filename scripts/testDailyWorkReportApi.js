require("dotenv").config();

const connectDB = require("../src/config/db");
const { connectRedis } = require("../src/config/redis");
const User = require("../src/modules/user/user.model");
const {
  generateAccessToken,
  createSessionId,
} = require("../src/utils/jwt");
const { redisClient } = require("../src/config/redis");

const API_BASE_URL = `http://localhost:${process.env.PORT || 5000}/api`;

const getLocalDateString = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createTokenForUser = async (user) => {
  const sessionId = createSessionId();
  const accessToken = generateAccessToken(user, sessionId);

  await redisClient.set(`session:${user._id}`, sessionId, {
    EX: 60 * 60,
  });

  return accessToken;
};

const run = async () => {
  await connectDB();
  await connectRedis();

  const employee = await User.findOne({
    role: "EMPLOYEE",
    isActive: true,
  });

  const manager = await User.findOne({
    role: { $in: ["PROJECT_MANAGER", "TL"] },
    isActive: true,
  });

  if (!employee || !manager) {
    console.log("Missing employee or manager test data.");
    process.exit(1);
  }

  const token = await createTokenForUser(employee);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const reportDate = getLocalDateString(yesterday);

  const basePayload = {
    projectName: "API Test Project",
    reportDate,
    workDescription: "API route test for yesterday report.",
    reportingManagerId: String(manager._id),
    blockers: "",
    attachment: null,
  };

  const submit = async (label, payload) => {
    const response = await fetch(`${API_BASE_URL}/daily-work-report/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    console.log(`\n[${label}] status=${response.status}`);
    console.log(body.message || body.raw || body);
    return response.ok;
  };

  await submit("without attachment", basePayload);

  const largeDataUrl = `data:application/pdf;base64,${"A".repeat(150000)}`;
  await submit("with ~150KB attachment", {
    ...basePayload,
    projectName: "API Test With Attachment",
    attachment: {
      fileName: "test.pdf",
      mimeType: "application/pdf",
      fileSize: 110000,
      dataUrl: largeDataUrl,
    },
  });

  const hugeDataUrl = `data:application/pdf;base64,${"B".repeat(7000000)}`;
  await submit("with ~7MB attachment", {
    ...basePayload,
    projectName: "API Test Huge Attachment",
    attachment: {
      fileName: "large.pdf",
      mimeType: "application/pdf",
      fileSize: 5000000,
      dataUrl: hugeDataUrl,
    },
  });

  process.exit(0);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
