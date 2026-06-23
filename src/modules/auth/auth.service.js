const bcrypt = require("bcryptjs");

const User = require("../user/user.model");

const {
  generateAccessToken,
  generateRefreshToken,
} = require("../../utils/jwt");

const { redisClient } =
  require("../../config/redis");

const login = async (body) => {
  const { email, password } = body;

  const user = await User.findOne({
    email,
  });

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

  const accessToken =
    generateAccessToken(user);

  const refreshToken =
    generateRefreshToken(user);

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

const changePassword = async (
  userId,
  body
) => {
  const {
    oldPassword,
    newPassword,
  } = body;

  const user =
    await User.findById(userId);

  if (!user) {
    throw new Error("User Not Found");
  }

  const isMatch =
    await bcrypt.compare(
      oldPassword,
      user.password
    );

  if (!isMatch) {
    throw new Error(
      "Old Password Incorrect"
    );
  }

  const hashedPassword =
    await bcrypt.hash(
      newPassword,
      10
    );

  user.password =
    hashedPassword;

  user.isFirstLogin = false;

  await user.save();

  return {
    message:
      "Password Changed Successfully",
  };
};

module.exports = {
  login,
  changePassword,
};