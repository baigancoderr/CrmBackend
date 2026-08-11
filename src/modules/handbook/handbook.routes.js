const express = require("express");

const router = express.Router();
const authMiddleware = require("../../middleware/auth.middleware");
const handbookController = require("./handbook.controller");

router.get("/view", authMiddleware, handbookController.viewHandbook);

module.exports = router;
