const router = require("express").Router();

router.use("/auth", require("../modules/auth/auth.routes"));

router.use("/users", require("../modules/user/user.routes"));

module.exports = router;