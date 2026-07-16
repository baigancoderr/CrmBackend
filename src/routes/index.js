const router = require("express").Router();

router.use("/auth", require("../modules/auth/auth.routes"));

router.use("/users", require("../modules/user/user.routes"));

router.use("/attendance",require("../modules/attendance/attendance.routes"));

router.use("/biometric", require("../modules/biometric/biometric.routes"));

router.use("/extrawork", require("../modules/extra-work/extraWork.routes"));

router.use("/holiday", require("../modules/holiday/holiday.routes"));

router.use("/leave", require("../modules/leave/leave.routes"));

router.use("/daily-work-report", require("../modules/daily-work-report/dailyWorkReport.routes"));

router.use("/chat", require("../modules/chat/chat.routes"));

router.use("/notes", require("../modules/notes/notes.routes"));
router.use("/folders", require("../modules/notes/folder.routes"));

module.exports = router;