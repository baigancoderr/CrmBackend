const router = require("express").Router();

router.use("/auth", require("../modules/auth/auth.routes"));

router.use("/users", require("../modules/user/user.routes"));

router.use("/attendance",require("../modules/attendance/attendance.routes"));

module.exports = router;