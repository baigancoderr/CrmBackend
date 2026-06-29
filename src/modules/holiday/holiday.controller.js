const holidayService = require("./holiday.service");

const createHoliday = async (req, res) => {
  try {
    const holiday = await holidayService.createHoliday(
      req.body,
      req.user.id
    );

    return res.status(201).json({
      success: true,
      message: "Holiday created successfully.",
      data: holiday,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getAllHolidays = async (req, res) => {
  try {
    const holidays = await holidayService.getAllHolidays(
      req.query
    );

    return res.status(200).json({
      success: true,
      ...holidays,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getHolidayById = async (req, res) => {
  try {
    const holiday = await holidayService.getHolidayById(
      req.params.id
    );

    return res.status(200).json({
      success: true,
      data: holiday,
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

const updateHoliday = async (req, res) => {
  try {
    const holiday = await holidayService.updateHoliday(
      req.params.id,
      req.body,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: "Holiday updated successfully.",
      data: holiday,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const deleteHoliday = async (req, res) => {
  try {
    const response = await holidayService.deleteHoliday(
      req.params.id,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      ...response,
    });
  } catch (error) {
    return res.status(404).json({
      success: false,
      message: error.message,
    });
  }
};

const restoreHoliday = async (req, res) => {
  try {
    const holiday = await holidayService.restoreHoliday(
      req.params.id,
      req.user.id
    );

    return res.status(200).json({
      success: true,
      message: "Holiday restored successfully.",
      data: holiday,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  createHoliday,
  getAllHolidays,
  getHolidayById,
  updateHoliday,
  deleteHoliday,
  restoreHoliday,
};