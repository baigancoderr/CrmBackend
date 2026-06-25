const bcrypt = require("bcryptjs");
const User = require("./user.model");

const createUser = async (currentUser, body) => {
    const {name,email,role,phone,department,designation,joiningDate,manager,teamLeader,addressInfo,socialLinks,gender,profilePhoto,} = body;

    const rolePermissions = {SUPER_ADMIN: ["HR","PROJECT_MANAGER","TL","EMPLOYEE",],
        HR: ["PROJECT_MANAGER","TL","EMPLOYEE",],
        PROJECT_MANAGER: ["TL","EMPLOYEE",],
        TL: ["EMPLOYEE",],
    };

    const allowedRoles = rolePermissions[currentUser.role] || [];

    if (!allowedRoles.includes(role)) {
        throw new Error(
            `You do not have permission to create ${role}`
        );
    }

    const existingUser = await User.findOne({
        email: email.toLowerCase(),
    });

    if (existingUser) {
        throw new Error(
            "User already exists with this email"
        );
    }

    const totalUsers =await User.countDocuments();

    const employeeId = `DOB${String(
        totalUsers + 1
    ).padStart(4, "0")}`;

   const temporaryPassword =Math.random().toString(36).slice(-8) + "@123";
   const hashedPassword =await bcrypt.hash(temporaryPassword,10);

   const newUser = await User.create({
  employeeId,
  name,
  email: email.toLowerCase(),
  password: hashedPassword,
  role,
  phone,
  gender,
  profilePhoto,
  department,
  designation,
  joiningDate,
  manager,
  teamLeader,
  addressInfo,
  socialLinks,
  isFirstLogin: true,
  isActive: true,
});

    return {
        message: `${role} created successfully`,
        data: {
            id: newUser._id,
            employeeId: newUser.employeeId,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
            temporaryPassword,
        },
    };
};


const getProfile = async (userId) => {
    const user =
        await User.findById(userId)
            .select("-password")
            .populate(
                "manager",
                "name email employeeId"
            )
            .populate(
                "teamLeader",
                "name email employeeId"
            );

    if (!user) {
        throw new Error(
            "User not found"
        );
    }

    return user;
};

const updateProfile = async (userId,body) => {
    const {name,phone,gender,profilePhoto,addressInfo,socialLinks,} = body;

    const user =await User.findById(userId);

    if (!user) {
        throw new Error(
            "User not found"
        );
    }

    if (name !== undefined) {
        user.name = name;
    }

    if (phone !== undefined) {
        user.phone = phone;
    }

    if (gender !== undefined) {
        user.gender = gender;
    }

    if (
        profilePhoto !== undefined
    ) {
        user.profilePhoto =
            profilePhoto;
    }

    if (
        addressInfo !== undefined
    ) {
        user.addressInfo = {
            ...user.addressInfo,
            ...addressInfo,
        };
    }

    if (
        socialLinks !== undefined
    ) {
        user.socialLinks = {
            ...user.socialLinks,
            ...socialLinks,
        };
    }

    await user.save();

    return user;
};

const getAllUsers = async () => {
    const users = await User.find()
        .select("-password")
        .populate(
            "manager",
            "name employeeId"
        )
        .populate(
            "teamLeader",
            "name employeeId"
        )
        .sort({
            createdAt: -1,
        });

    return users;
};

const getUserById = async (userId) => {
    const user = await User.findById(userId)
        .select("-password")
        .populate(
            "manager",
            "name email employeeId"
        )
        .populate(
            "teamLeader",
            "name email employeeId"
        );

    if (!user) {
        throw new Error(
            "User not found"
        );
    }

    return user;
};

const updateUserStatus = async (userId,body) => {
    const { isActive } = body;

    const user =await User.findById(userId);

    if (!user) {
        throw new Error(
            "User not found"
        );
    }

    user.isActive = isActive;

    await user.save();

    return {
        message:
            "User status updated successfully",
        data: {
            id: user._id,
            name: user.name,
            isActive:
                user.isActive,
        },
    };
};

const getDashboardCounts = async () => {
    const totalUsers =await User.countDocuments();

    const totalHR =
        await User.countDocuments({
            role: "HR",
        });

    const totalProjectManagers =
        await User.countDocuments({
            role: "PROJECT_MANAGER",
        });

    const totalTL =
        await User.countDocuments({
            role: "TL",
        });

    const totalEmployees =
        await User.countDocuments({
            role: "EMPLOYEE",
        });

    const activeUsers =
        await User.countDocuments({
            isActive: true,
        });

    const inactiveUsers =
        await User.countDocuments({
            isActive: false,
        });

    return {
        totalUsers,
        totalHR,
        totalProjectManagers,
        totalTL,
        totalEmployees,
        activeUsers,
        inactiveUsers,
    };
};

module.exports = {
    createUser,
    getProfile,
    updateProfile,
    getAllUsers,
     getUserById,
    updateUserStatus,
    getDashboardCounts,
};