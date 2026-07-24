const router = require("express").Router();



const userController = require("./user.controller");

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");
const upload = require("../../middleware/upload.middleware");

const ADMIN_ROLES = ["SUPER_ADMIN", "HR"];
const MANAGER_ROLES = ["SUPER_ADMIN", "HR", "PROJECT_MANAGER", "TL"];

router.post("/create", authMiddleware, userController.createUser);

router.get("/profile", authMiddleware, userController.getProfile);

// router.put("/profile", authMiddleware, userController.updateProfile);



router.put(
  "/profile/photo",
  authMiddleware,
  upload.single("profilePhoto"),
  userController.updateProfilePhoto
);

router.put("/profile",authMiddleware,upload.single("profilePhoto"),userController.updateProfile);

router.get(
  "/",
  authMiddleware,
  roleMiddleware(...MANAGER_ROLES),
  userController.getAllUsers
);

router.get(
  "/team-list",
  authMiddleware,
  userController.getVisibleTeamMembers
);

router.get(
  "/birthdays",
  authMiddleware,
  userController.getUpcomingBirthdays
);

router.get(
  "/dashboard-counts",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  userController.getDashboardCounts
);

router.patch(
  "/biometric-code/:id",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  userController.updateBiometricEmpCode
);

router.patch(
  "/status/:id",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  userController.updateUserStatus
);

router.patch(
  "/:id",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  userController.updateUserById
);

router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  userController.deleteUserById
);

router.get(
  "/:id",
  authMiddleware,
  roleMiddleware(...ADMIN_ROLES),
  userController.getUserById
);

module.exports = router;
