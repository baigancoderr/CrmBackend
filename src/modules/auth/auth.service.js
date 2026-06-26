const bcrypt = require("bcryptjs");

const User = require("../user/user.model");

const {generateAccessToken,generateRefreshToken,} = require("../../utils/jwt");

const { redisClient } =require("../../config/redis");

const login = async (body) => {
  const { email, password } = body;
  const user = await User.findOne({email,});

  if (!user) {
    throw new Error(
      "Invalid Credentials"
    );
  }

  const isMatch =
    await bcrypt.compare(
      password,
      user.password
    );

  if (!isMatch) {
    throw new Error(
      "Invalid Credentials"
    );
  }
  
  if (!user.isActive) {
    throw new Error(
        "Your account is inactive. Contact administrator."
    );
}

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  await redisClient.set(
    `refresh:${user._id}`,
    refreshToken
  );

  return {
    accessToken,
    refreshToken,
    isFirstLogin:
    user.isFirstLogin,
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
  const { reason } = body;

  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  if (user.passwordResetRequest?.status === "PENDING") {
    throw new Error("A password reset request is already pending");
  }

  user.passwordResetRequest = {
    status: "PENDING",
    reason,
    requestedAt: new Date(),
    reviewedAt: null,
    reviewedBy: null,
    remarks: "",
  };

  await user.save();

  return {
    message: "Password reset request submitted successfully",
  };
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

  user.password = hashedPassword;
  user.isFirstLogin = true;
  user.lastPasswordChangedAt = new Date();

  user.passwordResetHistory.push({
    status: "APPROVED",
    reason: user.passwordResetRequest.reason,
    requestedAt: user.passwordResetRequest.requestedAt,
    reviewedAt: new Date(),
    reviewedBy: hrId,
    temporaryPassword,
  });

  user.passwordResetRequest = {
    status: "NONE",
  };

  await user.save();

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

  user.passwordResetHistory.push({
    status: "REJECTED",
    reason: user.passwordResetRequest.reason,
    requestedAt: user.passwordResetRequest.requestedAt,
    reviewedAt: new Date(),
    reviewedBy: hrId,
    remarks,
  });

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

  const accessToken = generateAccessToken(user);

  return {
    accessToken,
    role: user.role,
  };
};

module.exports = {
  login,
  changePassword,
  resetPassword,
  requestPasswordReset,
  getPasswordResetRequests,
  rejectPasswordReset,
  refreshAccessToken,
};