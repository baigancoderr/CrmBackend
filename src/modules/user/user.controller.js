const userService = require("./user.service");
const fs = require("fs");
const path = require("path");

const createUser = async (req, res) => {
    try {
        const result = await userService.createUser(
            req.user,
            req.body
        );

        return res.status(201).json({
            success: true,
            message: result.message,
            data: result.data,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const getProfile = async (req, res) => {
    try {
        const result = await userService.getProfile(req.user.id);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const updateProfile = async (req, res) => {
    try {

        if (req.file) {
            req.body.profilePhoto =
                `/uploads/employees/${req.file.filename}`;
        }

        const result =
            await userService.updateProfile(
                req.user.id,
                req.body
            );

        return res.status(200).json({
            success: true,
            message:
                "Profile Updated Successfully",
            data: result,
        });

    } catch (error) {

        return res.status(400).json({
            success: false,
            message: error.message,
        });

    }
};

const updateProfilePhoto = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Profile photo file is required",
            });
        }

        const profilePhoto = `/uploads/employees/${req.file.filename}`;

        const result = await userService.updateProfilePhoto(
            req.user.id,
            profilePhoto
        );

        return res.status(200).json({
            success: true,
            message: "Profile photo updated successfully",
            data: result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const result =await userService.getAllUsers();

        return res.status(200).json({
            success: true,
            count: result.length,
            data: result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const getUserById = async (req, res) => {
    try {
        const result =await userService.getUserById(req.params.id);

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const updateUserStatus = async (req, res) => {
    try {
        const result =await userService.updateUserStatus(req.params.id,req.body);

        return res.status(200).json({
            success: true,
            message: result.message,
            data: result.data,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const updateUserById = async (req, res) => {
    try {
        const result = await userService.updateUserById(
            req.user,
            req.params.id,
            req.body
        );

        return res.status(200).json({
            success: true,
            message: result.message,
            data: result.data,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const deleteUserById = async (req, res) => {
    try {
        const result = await userService.deleteUserById(req.user, req.params.id);

        return res.status(200).json({
            success: true,
            message: result.message,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const getDashboardCounts = async (req,res) => {
    try {
        const result =await userService.getDashboardCounts();

        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

const updateBiometricEmpCode = async (req, res) => {
    try {
        const result = await userService.updateBiometricEmpCode(
            req.user,
            req.params.id,
            req.body.biometricEmpCode
        );

        return res.status(200).json({
            success: true,
            message: result.message,
            data: result.data,
        });
    } catch (error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
};

module.exports = {
    createUser,
    getProfile,
    updateProfile,
    updateProfilePhoto,
    getAllUsers,
    getUserById,
    updateUserStatus,
    updateUserById,
    deleteUserById,
    updateBiometricEmpCode,
    getDashboardCounts,
};