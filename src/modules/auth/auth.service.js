const bcrypt = require("bcryptjs");

const User = require("../user/user.model");

const {generateAccessToken,generateRefreshToken,createSessionId,} = require("../../utils/jwt");

const { redisClient } = require("../../config/redis");

const login = async (body) => {
  const { email, password } = body;
  const user = await User.findOne({ email });

  if (!user) {
    throw new Error("Invalid Credentials");
  }

  const isMatch = await bcrypt.compare(password,user.password);

  if (!isMatch) {
    throw new Error("Invalid Credentials");
  }

  if (!user.isActive) {
    throw new Error(
      "Your account is inactive. Contact administrator."
    );
  }

  const sessionId = createSessionId();
  const accessToken = generateAccessToken(user, sessionId);
  const refreshToken = generateRefreshToken(user);

  await redisClient.set(`session:${user._id}`, sessionId, {
    EX: 60 * 60 * 24 * 7,
  });

  await redisClient.set(`refresh:${user._id}`, refreshToken, {
    EX: 60 * 60 * 24 * 7,
  });

  return {
    accessToken,
    refreshToken,
    isFirstLogin: user.isFirstLogin,
    role: user.role,
  };
};

const changePassword = async (userId, body) => {
  const { oldPassword, newPassword } = body;

  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User Not Found");
  }

  const isMatch = await bcrypt.compare(
    oldPassword,
    user.password
  );

  if (!isMatch) {
    throw new Error("Old Password Incorrect");
  }

  const hashedPassword = await bcrypt.hash(
    newPassword,
    10
  );

  user.password = hashedPassword;
  user.isFirstLogin = false;
  user.lastPasswordChangedAt = new Date();

  await user.save();

  return {
    message: "Password Changed Successfully",
  };
};

const requestPasswordReset = async (userId, body) => {
  const { reason, source = "SETTINGS" } = body;

  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.passwordResetRequest?.status === "PENDING") {
    throw new Error("A password reset request is already pending");
  }

  const requestedAt = new Date();
  const requestReason = reason || "Password reset requested";

  user.passwordResetRequest = {
    status: "PENDING",
    reason: requestReason,
    source,
    requestedAt,
    reviewedAt: null,
    reviewedBy: null,
    remarks: "",
  };

  user.passwordResetHistory.push({
    status: "PENDING",
    reason: requestReason,
    source,
    requestedAt,
    reviewedAt: null,
    reviewedBy: null,
    remarks: "",
  });

  await user.save();

  return {
    message: "Password reset request submitted successfully",
  };
};

const forgotPassword = async (body) => {
  const { email } = body;

  if (!email || !String(email).trim()) {
    throw new Error("Email is required");
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user || !user.isActive) {
    return {
      message:
        "If your email is registered, your request has been sent to HR. She will contact you soon.",
    };
  }

  if (user.passwordResetRequest?.status === "PENDING") {
    return {
      message:
        "A password reset request is already pending. HR will contact you soon.",
    };
  }

  const requestedAt = new Date();
  const requestReason = "Forgot password - requested via login page";

  user.passwordResetRequest = {
    status: "PENDING",
    reason: requestReason,
    source: "LOGIN",
    requestedAt,
    reviewedAt: null,
    reviewedBy: null,
    remarks: "",
  };

  user.passwordResetHistory.push({
    status: "PENDING",
    reason: requestReason,
    source: "LOGIN",
    requestedAt,
    reviewedAt: null,
    reviewedBy: null,
    remarks: "",
  });

  await user.save();

  return {
    message:
      "Request sent to HR. She will contact you soon.",
  };
};

const getPasswordResetHistory = async () => {
  const users = await User.find({
  $or: [
      { "passwordResetHistory.0": { $exists: true } },
      { "passwordResetRequest.status": "PENDING" },
    ],
  })
    .select(
      "employeeId name email role passwordResetRequest passwordResetHistory"
    )
    .populate("passwordResetHistory.reviewedBy", "name employeeId")
    .lean();

  const records = [];

  users.forEach((user) => {
    (user.passwordResetHistory || []).forEach((entry, index) => {
      records.push({
        id: `${user._id}-${index}`,
        userId: user._id,
        employeeId: user.employeeId,
        name: user.name,
        email: user.email,
        role: user.role,
        status: entry.status,
        reason: entry.reason,
        source: entry.source || "SETTINGS",
        requestedAt: entry.requestedAt,
        reviewedAt: entry.reviewedAt,
        reviewedBy: entry.reviewedBy,
        remarks: entry.remarks || "",
      });
    });
  });

  return records.sort(
    (left, right) =>
      new Date(right.requestedAt).getTime() -
      new Date(left.requestedAt).getTime()
  );
};

const getPasswordResetRequests = async () => {
  return await User.find({
    "passwordResetRequest.status": "PENDING",
  })
    .select(
      "employeeId name email role passwordResetRequest"
    )
    .sort({ createdAt: -1 });
};

const resetPassword = async (userId, hrId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.passwordResetRequest?.status !== "PENDING") {
    throw new Error("No pending password reset request found");
  }

  const temporaryPassword =
    Math.random().toString(36).slice(-8) + "@123";

  const hashedPassword = await bcrypt.hash(
    temporaryPassword,
    10
  );

  const reviewedAt = new Date();

  const pendingHistoryIndex = user.passwordResetHistory.findIndex(
    (entry) =>
      entry.status === "PENDING" &&
      new Date(entry.requestedAt).getTime() ===
        new Date(user.passwordResetRequest.requestedAt).getTime()
  );

  if (pendingHistoryIndex >= 0) {
    user.passwordResetHistory[pendingHistoryIndex].status = "APPROVED";
    user.passwordResetHistory[pendingHistoryIndex].reviewedAt = reviewedAt;
    user.passwordResetHistory[pendingHistoryIndex].reviewedBy = hrId;
  } else {
    user.passwordResetHistory.push({
      status: "APPROVED",
      reason: user.passwordResetRequest.reason,
      source: user.passwordResetRequest.source || "SETTINGS",
      requestedAt: user.passwordResetRequest.requestedAt,
      reviewedAt,
      reviewedBy: hrId,
    });
  }

  user.password = hashedPassword;
  user.isFirstLogin = true;
  user.lastPasswordChangedAt = reviewedAt;
  user.passwordResetRequest = { status: "NONE" };

  await user.save();

  // End active sessions so the employee must sign in with the new temporary password.
  await redisClient.del([`refresh:${userId}`, `session:${userId}`]);

  return {
    message: "Password reset successfully",
    data: {
      employeeId: user.employeeId,
      name: user.name,
      temporaryPassword,
      status: "APPROVED",
    },
  };
};

const rejectPasswordReset = async (userId,hrId,body) => {
  const { remarks } = body;

  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.passwordResetRequest?.status !== "PENDING") {
    throw new Error("No pending password reset request found");
  }

  const reviewedAt = new Date();

  const pendingHistoryIndex = user.passwordResetHistory.findIndex(
    (entry) =>
      entry.status === "PENDING" &&
      new Date(entry.requestedAt).getTime() ===
        new Date(user.passwordResetRequest.requestedAt).getTime()
  );

  if (pendingHistoryIndex >= 0) {
    user.passwordResetHistory[pendingHistoryIndex].status = "REJECTED";
    user.passwordResetHistory[pendingHistoryIndex].reviewedAt = reviewedAt;
    user.passwordResetHistory[pendingHistoryIndex].reviewedBy = hrId;
    user.passwordResetHistory[pendingHistoryIndex].remarks = remarks;
  } else {
    user.passwordResetHistory.push({
      status: "REJECTED",
      reason: user.passwordResetRequest.reason,
      source: user.passwordResetRequest.source || "SETTINGS",
      requestedAt: user.passwordResetRequest.requestedAt,
      reviewedAt,
      reviewedBy: hrId,
      remarks,
    });
  }

  user.passwordResetRequest = {
    status: "NONE",
  };

  await user.save();

  return {
    message: "Request rejected successfully",
  };
};

const refreshAccessToken = async (refreshToken) => {
  const jwt = require("jsonwebtoken");

  if (!refreshToken) {
    throw new Error("Refresh token is required");
  }

  let decoded;

  try {
    decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET
    );
  } catch {
    throw new Error("Invalid refresh token");
  }

  const storedToken = await redisClient.get(
    `refresh:${decoded.id}`
  );

  if (storedToken && storedToken !== refreshToken) {
    throw new Error("Invalid refresh token");
  }

  if (!storedToken) {
    await redisClient.set(
      `refresh:${decoded.id}`,
      refreshToken
    );
  }

  const user = await User.findById(decoded.id);

  if (!user) {
    throw new Error("User not found");
  }

  if (!user.isActive) {
    throw new Error(
      "Your account is inactive. Contact administrator."
    );
  }

  const sessionId = await redisClient.get(`session:${decoded.id}`);

  if (!sessionId) {
    throw new Error("Session expired. Please login again.");
  }

  const accessToken = generateAccessToken(user, sessionId);

  return {
    accessToken,
    role: user.role,
  };
};


const logout = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  const session = await redisClient.get(`session:${userId}`);

  if (!session) {
    throw new Error("User already logged out");
  }

  await redisClient.del([`refresh:${userId}`, `session:${userId}`]);

  return {
    message: "Logout Successfully",
  };
};

module.exports = {
  login,
  changePassword,
  resetPassword,
  requestPasswordReset,
  forgotPassword,
  getPasswordResetRequests,
  getPasswordResetHistory,
  rejectPasswordReset,
  refreshAccessToken,
   logout,
};