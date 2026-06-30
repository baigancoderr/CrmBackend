const attendanceService = require(
  "./attendance.service"
);

const clockIn = async (
  req,
  res
) => {
  try {
    const result =
      await attendanceService.clockIn(
        req.user.id
      );

    return res.status(200).json(
      result
    );
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const clockOut = async (
  req,
  res
) => {
  try {
    const result =
      await attendanceService.clockOut(
        req.user.id
      );

    return res.status(200).json(
      result
    );
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getTodayAttendance =
  async (
    req,
    res
  ) => {
    try {
      const result =
        await attendanceService.getTodayAttendance(
          req.user.id
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message:
          error.message,
      });
    }
  };

const getMyHistory =
  async (
    req,
    res
  ) => {
    try {
      const page =
        Number(
          req.query.page
        ) || 1;

      const limit =
        Number(
          req.query.limit
        ) || 10;

      const result =
        await attendanceService.getMyHistory(
          req.user.id,
          page,
          limit
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message:
          error.message,
      });
    }
  };

const getMyMonthlyAttendance =
  async (
    req,
    res
  ) => {
    try {
      const month =
        Number(
          req.query.month
        );

      const year =
        Number(
          req.query.year
        );

      const result =
        await attendanceService.getMyMonthlyAttendance(
          req.user.id,
          month,
          year
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message:
          error.message,
      });
    }
  };

const getDashboard =
  async (
    req,
    res
  ) => {
    try {
      const result =
        await attendanceService.getDashboard();

      return res
        .status(200)
        .json(result);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message:
          error.message,
      });
    }
  };

const getEmployeeAttendance =
  async (
    req,
    res
  ) => {
    try {
      const page =
        Number(
          req.query.page
        ) || 1;

      const limit =
        Number(
          req.query.limit
        ) || 10;

      const result =
        await attendanceService.getEmployeeAttendance(
          req.params
            .employeeId,
          page,
          limit
        );

      return res
        .status(200)
        .json(result);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message:
          error.message,
      });
    }
  };

const getMonthlyTeamSheet = async (req, res) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);

    const result =
      await attendanceService.getMonthlyTeamSheet(
        month,
        year
      );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const manualUpdateAttendance = async (req, res) => {
  try {
    const result = await attendanceService.manualUpdateAttendance(
      req.params.id,
      req.body,
      req.user.id
    );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getAttendanceDashboardDetails = async (req, res) => {
  try {
    const result =
      await attendanceService.getAttendanceDashboardDetails(
        req.query.date
      );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyAttendanceDashboard = async (req, res) => {
  try {
    const result =
      await attendanceService.getMyAttendanceDashboard(
        req.user.id,
        req.query.date
      );

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  clockIn,
  clockOut,
  getTodayAttendance,
  getMyHistory,
  getMyMonthlyAttendance,
  getDashboard,
  getAttendanceDashboardDetails,
  getMyAttendanceDashboard,
  getEmployeeAttendance,
  getMonthlyTeamSheet,
  manualUpdateAttendance,
};