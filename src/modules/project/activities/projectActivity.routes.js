const express = require("express");
const authMiddleware = require("../../../middleware/auth.middleware");
const { listProjectActivities } = require("./projectActivity.controller");

const router = express.Router({ mergeParams: true });

router.get("/", authMiddleware, listProjectActivities);

module.exports = router;
