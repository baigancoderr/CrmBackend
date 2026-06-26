const router = require("express").Router();

const authController = require("./auth.controller");
const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");

router.post("/login", authController.login);

router.post("/refresh", authController.refreshToken);

router.post("/change-password",authMiddleware,
  authController.changePassword
);

router.post("/request-password-reset",authMiddleware,
  authController.requestPasswordReset
);

router.get("/password-reset-requests",authMiddleware,roleMiddleware("HR", "SUPER_ADMIN"),
  authController.getPasswordResetRequests
);

router.patch("/:id/reject-password-reset",authMiddleware,roleMiddleware("HR", "SUPER_ADMIN"),
authController.rejectPasswordReset
);

router.patch("/:id/reset-password",authMiddleware,roleMiddleware("HR", "SUPER_ADMIN"),
  authController.resetPassword
);


router.post("/logout",authMiddleware,authController.logout);

module.exports = router;