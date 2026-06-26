const router = require("express").Router();

router.use("/auth", require("../modules/auth/auth.routes"));

router.use("/users", require("../modules/user/user.routes"));

router.use("/attendance",require("../modules/attendance/attendance.routes"));

router.use("/biometric", require("../modules/biometric/biometric.routes"));
router.use("/extrawork", require("../modules/extra-work/extraWork.routes"));


module.exports = router;