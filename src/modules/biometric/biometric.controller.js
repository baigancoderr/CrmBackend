const biometricSyncService = require("./biometricSync.service");

const syncPunches = async (req, res) => {
  try {
    const result = await biometricSyncService.syncBiometricPunches();

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getSyncStatus = async (req, res) => {
  try {
    const result =
      await biometricSyncService.getBiometricSyncStatus();

    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getInOutData = async (req, res) => {
  try {
    const { fetchBiometricInOutRecords } = require(
      "./biometricInOut.service"
    );

    const result = await fetchBiometricInOutRecords(
      req.query.date
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const getMyInOutData = async (req, res) => {
  try {
    const { fetchBiometricInOutForUser } = require(
      "./biometricInOut.service"
    );

    const result = await fetchBiometricInOutForUser(
      req.user.id,
      req.query.date
    );

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  syncPunches,
  getSyncStatus,
  getInOutData,
  getMyInOutData,
};
