const bcrypt = require("bcryptjs");
const User = require("./user.model");
const fs = require("fs");
const path = require("path");
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

const ensureEmploymentTypeDefaults = async () => {
    await User.updateMany(
        {
            $or: [
                { employmentType: { $exists: false } },
                { employmentType: null },
                { employmentType: "" },
            ],
        },
        {
            $set: { employmentType: "FULL_TIME" },
        }
    );
};

const rolePermissions = {
    SUPER_ADMIN: ["HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT", "EMPLOYEE"],
    // HR can manage other HR accounts too, but not Super Admin.
    HR: ["HR", "PROJECT_MANAGER", "TL", "ACCOUNTANT", "EMPLOYEE"],
    PROJECT_MANAGER: ["TL", "EMPLOYEE"],
    TL: ["EMPLOYEE"],
};

const resolveActorRole = async (currentUser) => {
    if (!currentUser?.id) {
        throw new Error("Unauthorized");
    }

    const actor = await User.findById(currentUser.id).select("role");

    if (!actor) {
        throw new Error("User not found");
    }

    return actor.role;
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
        birthday,
    } = body;

    const actorRole = await resolveActorRole(currentUser);
    const allowedRoles = rolePermissions[actorRole] || [];

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
        birthday: birthday ? new Date(birthday) : null,
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
    await ensureEmploymentTypeDefaults();

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
    const {name,phone,gender,profilePhoto,addressInfo,socialLinks,birthday,} = body;

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

    if (birthday !== undefined) {
        user.birthday = birthday ? new Date(birthday) : null;
    }

  if (profilePhoto !== undefined) {

    if (
        user.profilePhoto &&
        fs.existsSync(
            path.join(
                __dirname,
                "../../",
                user.profilePhoto
            )
        )
    ) {
        fs.unlinkSync(
            path.join(
                __dirname,
                "../../",
                user.profilePhoto
            )
        );
    }

    user.profilePhoto = profilePhoto;
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

const updateProfilePhoto = async (userId, profilePhoto) => {
    const user = await User.findById(userId);

    if (!user) {
        throw new Error("User not found");
    }

    if (
        user.profilePhoto &&
        fs.existsSync(
            path.join(__dirname, "../../", user.profilePhoto)
        )
    ) {
        fs.unlinkSync(
            path.join(__dirname, "../../", user.profilePhoto)
        );
    }

    user.profilePhoto = profilePhoto;

    await user.save();

    return user;
};

const getAllUsers = async () => {
    await ensureEmploymentTypeDefaults();

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

const getVisibleTeamMembers = async (currentUser) => {
    await ensureEmploymentTypeDefaults();

    const currentUserRecord = await User.findById(currentUser.id).select(
        "department manager teamLeader"
    );

    if (!currentUserRecord) {
        throw new Error("User not found");
    }

    const managerId = currentUserRecord.manager
        ? String(currentUserRecord.manager)
        : "";
    const teamLeaderId = currentUserRecord.teamLeader
        ? String(currentUserRecord.teamLeader)
        : "";

    const users = await User.find({
        isActive: true,
        _id: { $ne: currentUser.id },
    })
        .select(
            "_id employeeId name firstName lastName role designation department profilePhoto phone email shift joiningDate officeLocation isActive manager teamLeader birthday"
        )
        .sort({ name: 1 })
        .lean();

    // Expose only common employee directory details for all authenticated users.
    return users.map((user) => {
        const userManagerId = user.manager ? String(user.manager) : "";
        const userTeamLeaderId = user.teamLeader ? String(user.teamLeader) : "";
        const sameDepartment =
            Boolean(currentUserRecord.department) &&
            user.department === currentUserRecord.department;
        const sameReportingLine =
            (managerId && userManagerId === managerId) ||
            (teamLeaderId && userTeamLeaderId === teamLeaderId);

        return {
            _id: user._id,
            employeeId: user.employeeId || "",
            name: user.name,
            firstName: user.firstName || "",
            lastName: user.lastName || "",
            role: user.role,
            designation: user.designation || "",
            department: user.department || "",
            profilePhoto: user.profilePhoto || "",
            phone: user.phone || "",
            email: user.email,
            shift: user.shift || "",
            officeLocation: user.officeLocation || "",
            joiningDate: user.joiningDate || null,
            birthday: user.birthday || null,
            isActive: Boolean(user.isActive),
            isSameDepartment: Boolean(sameDepartment),
            isSameReportingLine: Boolean(sameReportingLine),
        };
    });
};

const getUpcomingBirthdays = async (days = 30, limit = 5) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const users = await User.find({
        isActive: true,
        birthday: { $ne: null },
    })
        .select("_id name designation department profilePhoto birthday")
        .sort({ name: 1 })
        .lean();

    const upcoming = users
        .map((user) => {
            const birthday = user.birthday ? new Date(user.birthday) : null;
            if (!birthday || Number.isNaN(birthday.getTime())) {
                return null;
            }

            const nextBirthday = new Date(
                today.getFullYear(),
                birthday.getMonth(),
                birthday.getDate()
            );

            if (nextBirthday < today) {
                nextBirthday.setFullYear(today.getFullYear() + 1);
            }

            const diffMs = nextBirthday.getTime() - today.getTime();
            const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

            return {
                _id: user._id,
                name: user.name || "",
                designation: user.designation || "",
                department: user.department || "",
                profilePhoto: user.profilePhoto || "",
                birthday: birthday.toISOString(),
                nextBirthday: nextBirthday.toISOString(),
                daysUntil: diffDays,
            };
        })
        .filter((record) => record && record.daysUntil <= days)
        .sort((left, right) => left.daysUntil - right.daysUntil)
        .slice(0, limit);

    return {
        success: true,
        data: upcoming,
    };
};

const getUserById = async (userId) => {
    await ensureEmploymentTypeDefaults();

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

const updateUserById = async (currentUser, userId, body) => {
    const user = await User.findById(userId);

    if (!user) {
        throw new Error("User not found");
    }

    const actorRole = await resolveActorRole(currentUser);
    const allowedTargetRoles = rolePermissions[actorRole] || [];

    if (!allowedTargetRoles.includes(user.role)) {
        throw new Error(
            `You do not have permission to update users with role ${user.role}`
        );
    }

    if (body.role) {
        if (!allowedTargetRoles.includes(body.role)) {
            throw new Error(`You do not have permission to assign role ${body.role}`);
        }
    }

    if (body.email !== undefined) {
        const normalizedEmail = String(body.email).trim().toLowerCase();

        if (!normalizedEmail) {
            throw new Error("Official email is required");
        }

        const existingUser = await User.findOne({
            email: normalizedEmail,
            _id: { $ne: userId },
        });

        if (existingUser) {
            throw new Error("User already exists with this email");
        }

        user.email = normalizedEmail;
    }

    if (body.employeeId !== undefined) {
        const normalizedEmployeeId = normalizeEmployeeId(body.employeeId);

        if (!normalizedEmployeeId) {
            throw new Error("CRM Employee ID is required");
        }

        const existingEmployeeId = await User.findOne({
            employeeId: normalizedEmployeeId,
            _id: { $ne: userId },
        });

        if (existingEmployeeId) {
            throw new Error("CRM Employee ID is already assigned to another employee");
        }

        user.employeeId = normalizedEmployeeId;
    }

    if (body.biometricEmpCode !== undefined) {
        const normalizedCode = normalizeBiometricEmpCode(body.biometricEmpCode);

        if (!normalizedCode) {
            throw new Error("Biometric machine EMP ID is required");
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
    }

    if (body.manager) {
        const reportingManager = await User.findById(body.manager);

        if (!reportingManager) {
            throw new Error("Reporting manager not found");
        }
    }

    if (body.firstName !== undefined) {
        user.firstName = String(body.firstName).trim();
    }

    if (body.lastName !== undefined) {
        user.lastName = String(body.lastName).trim();
    }

    if (body.name !== undefined) {
        user.name = String(body.name).trim();
    } else if (body.firstName !== undefined || body.lastName !== undefined) {
        user.name = buildFullName(user.firstName, user.lastName, user.name);
    }

    if (body.phone !== undefined) {
        user.phone = String(body.phone).trim();
    }

    if (body.gender !== undefined) {
        user.gender = body.gender;
    }

    if (body.profilePhoto !== undefined) {
        user.profilePhoto = body.profilePhoto;
    }

    if (body.department !== undefined) {
        user.department = String(body.department).trim();
    }

    if (body.designation !== undefined) {
        user.designation = String(body.designation).trim();
    }

    if (body.birthday !== undefined) {
        user.birthday = body.birthday ? new Date(body.birthday) : null;
    }

    if (body.joiningDate !== undefined) {
        user.joiningDate = body.joiningDate ? new Date(body.joiningDate) : null;
    }

    if (body.officeLocation !== undefined) {
        user.officeLocation = String(body.officeLocation).trim();
    }

    if (body.shift !== undefined) {
        user.shift = String(body.shift).trim();
    }

    if (body.manager !== undefined) {
        user.manager = body.manager || null;
    }

    if (body.teamLeader !== undefined) {
        user.teamLeader = body.teamLeader || null;
    }

    if (body.addressInfo !== undefined) {
        user.addressInfo = {
            ...user.addressInfo,
            ...body.addressInfo,
        };
    }

    if (body.socialLinks !== undefined) {
        user.socialLinks = {
            ...user.socialLinks,
            ...body.socialLinks,
        };
    }

    if (body.employmentType !== undefined) {
        user.employmentType = body.employmentType;
    }

    if (body.isActive !== undefined) {
        user.isActive = Boolean(body.isActive);
    }

    if (body.role !== undefined) {
        user.role = body.role;
    }

    await user.save();

    return {
        message: "Employee details updated successfully",
        data: {
            id: user._id,
            employeeId: user.employeeId,
            name: user.name,
            email: user.email,
            role: user.role,
            phone: user.phone,
            department: user.department,
            designation: user.designation,
            isActive: user.isActive,
        },
    };
};

const deleteUserById = async (currentUser, userId) => {
    if (String(currentUser.id) === String(userId)) {
        throw new Error("You cannot delete your own account");
    }

    const user = await User.findById(userId);

    if (!user) {
        throw new Error("User not found");
    }

    const actorRole = await resolveActorRole(currentUser);
    const allowedTargetRoles = rolePermissions[actorRole] || [];

    if (!allowedTargetRoles.includes(user.role)) {
        throw new Error(
            `You do not have permission to delete users with role ${user.role}`
        );
    }

    await User.findByIdAndDelete(userId);

    return {
        message: "Employee deleted successfully",
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
    updateProfilePhoto,
    getAllUsers,
    getVisibleTeamMembers,
    getUpcomingBirthdays,
    getUserById,
    updateUserStatus,
    updateUserById,
    deleteUserById,
    updateBiometricEmpCode,
    getDashboardCounts,
};