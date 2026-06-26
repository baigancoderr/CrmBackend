require("dotenv").config();

const connectDB = require("../src/config/db");
const User = require("../src/modules/user/user.model");

const backfillBiometricCodes = async () => {
  try {
    await connectDB();

    const users = await User.find({
      $or: [
        { biometricEmpCode: { $exists: false } },
        { biometricEmpCode: "" },
        { biometricEmpCode: null },
      ],
    });

    let updatedCount = 0;

    for (const user of users) {
      if (!user.employeeId) {
        continue;
      }

      user.biometricEmpCode = user.employeeId
        .replace(/^DOB/i, "")
        .padStart(4, "0");

      await user.save();
      updatedCount += 1;
    }

    console.log(
      `Biometric employee codes updated for ${updatedCount} user(s)`
    );

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

backfillBiometricCodes();
