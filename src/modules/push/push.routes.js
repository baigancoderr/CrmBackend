const express = require("express");

const router = express.Router();

const authMiddleware = require("../../middleware/auth.middleware");
const pushController = require("./push.controller");

router.use(authMiddleware);

router.get("/public-key", pushController.getPublicKey);
router.post("/subscriptions", pushController.subscribe);
router.delete("/subscriptions", pushController.unsubscribe);

module.exports = router;
