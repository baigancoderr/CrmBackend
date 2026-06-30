const router = require("express").Router();

const authMiddleware = require("../../middleware/auth.middleware");
const roleMiddleware = require("../../middleware/role.middleware");

const holidayController = require("./holiday.controller");

// Create Holiday
router.post("/",authMiddleware,roleMiddleware("HR", "SUPER_ADMIN"),holidayController.createHoliday);

// Get All Holidays
router.get("/",authMiddleware,holidayController.getAllHolidays);

// Get Holiday By Id
router.get("/:id",authMiddleware,holidayController.getHolidayById);

// Update Holiday
router.patch("/:id",authMiddleware,roleMiddleware("HR", "SUPER_ADMIN"),holidayController.updateHoliday);

// Soft Delete Holiday
router.delete("/:id",authMiddleware,roleMiddleware("HR", "SUPER_ADMIN"),holidayController.deleteHoliday);

// Restore Holiday
router.patch("/:id/restore",authMiddleware,roleMiddleware("HR", "SUPER_ADMIN"),holidayController.restoreHoliday);

module.exports = router;