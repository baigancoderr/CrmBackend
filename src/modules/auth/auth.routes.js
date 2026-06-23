const router = require("express").Router();

const authController = require("./auth.controller");
const authMiddleware = require("../../middleware/auth.middleware");

router.post("/login", authController.login);

router.post(
  "/change-password",
  authMiddleware,
  authController.changePassword
);

module.exports = router;