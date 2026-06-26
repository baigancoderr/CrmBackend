const router = require("express").Router();

const userController = require("./user.controller");

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");

const ADMIN_ROLES = ["SUPER_ADMIN", "HR"];

router.post("/create", authMiddleware, userController.createUser);

router.get("/profile", authMiddleware, userController.getProfile);

router.put("/profile", authMiddleware, userController.updateProfile);

router.get("/", authMiddleware, userController.getAllUsers);

router.get(
  "/dashboard-counts",
  authMiddleware,
  userController.getDashboardCounts
);

router.patch(
  "/biometric-code/:id",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  userController.updateBiometricEmpCode
);

router.patch("/status/:id", authMiddleware, userController.updateUserStatus);

router.get("/:id", authMiddleware, userController.getUserById);

module.exports = router;
