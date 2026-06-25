const router = require("express").Router();

const userController = require("./user.controller");

const authMiddleware = require("../../middleware/auth.middleware");

// const roleMiddleware = require("../../middleware/role.middleware");

router.post("/create",authMiddleware,userController.createUser);

router.get("/profile",authMiddleware,userController.getProfile);

router.put("/profile",authMiddleware,userController.updateProfile);

router.get("/",authMiddleware,userController.getAllUsers);

router.get("/dashboard-counts",authMiddleware,userController.getDashboardCounts);

router.get("/:id",authMiddleware,userController.getUserById);

router.patch("/status/:id",authMiddleware,userController.updateUserStatus);



module.exports = router;