const bcrypt = require("bcryptjs");
const User = require("./user.model");
const {
    normalizeBiometricEmpCode,
} = require("../../utils/biometricEmpCode");
const {
    normalizeEmployeeId,
    syncEmployeeIdCounter,
} = require("../../utils/employeeId");

const buildFullName = (firstName, lastName, fallbackName = "") => {
    const trimmedFirstName = (firstName || "").trim();
    const trimmedLastName = (lastName || "").trim();

    if (trimmedFirstName && trimmedLastName) {
        return `${trimmedFirstName} ${trimmedLastName}`;
    }

    if (trimmedFirstName) {
        return trimmedFirstName;
    }

    return (fallbackName || "").trim();
};

const createUser = async (currentUser, body) => {
    const {
        firstName,
        lastName,
        name,
        email,
        role,
        phone,
        department,
        designation,
        joiningDate,
        manager,
        teamLeader,
        addressInfo,
        socialLinks,
        gender,
        profilePhoto,
        employmentType,
        officeLocation,
        shift,
        isActive,
    } = body;

    const rolePermissions = {
        SUPER_ADMIN: ["HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT", "EMPLOYEE"],
        HR: ["PROJECT_MANAGER", "TL", "ACCOUNTANT", "EMPLOYEE"],
        PROJECT_MANAGER: ["TL", "EMPLOYEE"],
        TL: ["EMPLOYEE"],
    };

    const allowedRoles = rolePermissions[currentUser.role] || [];

    if (!allowedRoles.includes(role)) {
        throw new Error(
            `You do not have permission to create ${role}`
        );
    }

    const resolvedFirstName = (firstName || name || "").trim();

    if (!resolvedFirstName) {
        throw new Error("First name is required");
    }

    if (!email) {
        throw new Error("Official email is required");
    }

    if (!role) {
        throw new Error("Role is required");
    }

    const existingUser = await User.findOne({
        email: email.toLowerCase(),
    });

    if (existingUser) {
        throw new Error(
            "User already exists with this email"
        );
    }

    if (manager) {
        const reportingManager = await User.findById(manager);

        if (!reportingManager) {
            throw new Error("Reporting manager not found");
        }
    }

    const employeeId = normalizeEmployeeId(body.employeeId);

    if (!employeeId) {
        throw new Error("CRM Employee ID is required");
    }

    const existingEmployeeId = await User.findOne({
        employeeId,
    });

    if (existingEmployeeId) {
        throw new Error(
            "CRM Employee ID is already assigned to another employee"
        );
    }

    const biometricEmpCode = body.biometricEmpCode
        ? normalizeBiometricEmpCode(body.biometricEmpCode)
        : employeeId.replace(/^DOB/i, "").padStart(4, "0");

    if (!biometricEmpCode) {
        throw new Error("Biometric machine EMP ID is required");
    }

    const existingBiometricCode = await User.findOne({
        biometricEmpCode,
    });

    if (existingBiometricCode) {
        throw new Error(
            "Biometric machine EMP ID is already assigned to another employee"
        );
    }

    const temporaryPassword =
        Math.random().toString(36).slice(-8) + "@123";
    const hashedPassword = await bcrypt.hash(
        temporaryPassword,
        10
    );

    const fullName = buildFullName(
        resolvedFirstName,
        lastName,
        name
    );

    const newUser = await User.create({
        employeeId,
        biometricEmpCode,
        firstName: resolvedFirstName,
        lastName: (lastName || "").trim(),
        name: fullName,
        email: email.toLowerCase(),
        password: hashedPassword,
        role,
        phone: phone || "",
        gender: gender || "OTHER",
        profilePhoto,
        department: department || "",
        designation: designation || "",
        joiningDate,
        manager: manager || null,
        teamLeader,
        addressInfo,
        socialLinks,
        employmentType: employmentType || "FULL_TIME",
        officeLocation: officeLocation || "",
        shift: shift || "",
        isFirstLogin: true,
        isActive: isActive !== undefined ? isActive : true,
    });

    await syncEmployeeIdCounter();

    return {
        message: `${role} created successfully`,
        data: {
            id: newUser._id,
            employeeId: newUser.employeeId,
            biometricEmpCode: newUser.biometricEmpCode,
            firstName: newUser.firstName,
            lastName: newUser.lastName,
            name: newUser.name,
            email: newUser.email,
            role: newUser.role,
            phone: newUser.phone,
            department: newUser.department,
            designation: newUser.designation,
            employmentType: newUser.employmentType,
            officeLocation: newUser.officeLocation,
            shift: newUser.shift,
            isActive: newUser.isActive,
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

const updateBiometricEmpCode = async (
    currentUser,
    userId,
    biometricEmpCode
) => {
    const allowedRoles = ["SUPER_ADMIN", "HR"];

    if (!allowedRoles.includes(currentUser.role)) {
        throw new Error(
            "You do not have permission to update biometric EMP ID"
        );
    }

    const normalizedCode = normalizeBiometricEmpCode(
        biometricEmpCode
    );

    if (!normalizedCode) {
        throw new Error(
            "Biometric machine EMP ID is required"
        );
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new Error("User not found");
    }

    const existingBiometricCode = await User.findOne({
        biometricEmpCode: normalizedCode,
        _id: { $ne: userId },
    });

    if (existingBiometricCode) {
        throw new Error(
            "Biometric machine EMP ID is already assigned to another employee"
        );
    }

    user.biometricEmpCode = normalizedCode;
    await user.save();

    return {
        message: "Biometric machine EMP ID updated successfully",
        data: {
            id: user._id,
            employeeId: user.employeeId,
            biometricEmpCode: user.biometricEmpCode,
            name: user.name,
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
    updateBiometricEmpCode,
    getDashboardCounts,
};