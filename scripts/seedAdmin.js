require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const User = require("../src/modules/user/user.model");
const { syncEmployeeIdCounter } = require("../src/utils/employeeId");

const connectDB = require("../src/config/db");

const seedAdmin = async () => {
  try {
    await connectDB();

    const adminExists = await User.findOne({
      email: "admin@gmail.com",
    });

    if (adminExists) {
      console.log("Admin already exists");
      process.exit();
    }

    const hashedPassword = await bcrypt.hash(
      "Admin@123",
      10
    );

    await User.create({
      employeeId: "DOB0001",
      biometricEmpCode: "0001",
      name: "Super Admin",
      email: "admin@gmail.com",
      password: hashedPassword,
      role: "SUPER_ADMIN",
      isFirstLogin: false,
    });

    await syncEmployeeIdCounter();

    console.log("Super Admin Created");

    process.exit();
  } catch (error) {
    console.log(error);
    process.exit(1);
  }
};

seedAdmin();