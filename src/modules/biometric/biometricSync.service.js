const Attendance = require("../attendance/attendance.model");
const User = require("../user/user.model");
const ProcessedBiometricPunch = require("./processedPunch.model");
const BiometricSyncState = require("./biometricSyncState.model");
const {
  downloadLastPunchData,
  getInitialLastRecord,
} = require("./etimeoffice.service");
const {
  normalizeEmpCode,
} = require("../../utils/biometricEmpCode");

const isBiometricSyncEnabled = () =>
  process.env.ETIME_SYNC_ENABLED !== "false";

const getAttendanceHelpers = () => {
  return require("../attendance/attendance.service");
};

const getSyncState = async () => {
  let state = await BiometricSyncState.findOne();

  if (!state) {
    state = await BiometricSyncState.create({
      lastMaxRecord: getInitialLastRecord(),
      lastSyncStatus: "IDLE",
    });
  }

  if (!state.lastMaxRecord) {
    state.lastMaxRecord = getInitialLastRecord();
    await state.save();
  }

  return state;
};

const syncBiometricPunches = async () => {
  if (!isBiometricSyncEnabled()) {
    const state = await getSyncState();
    state.lastSyncedAt = new Date();
    state.lastSyncStatus = "IDLE";
    state.lastSyncMessage =
      "Biometric sync is disabled. Manual attendance mode is active.";
    await state.save();

    return {
      success: true,
      processedCount: 0,
      skippedCount: 0,
      lastMaxRecord: state.lastMaxRecord,
      message: state.lastSyncMessage,
    };
  }

  const state = await getSyncState();
  const lastRecord = state.lastMaxRecord;

  let apiResponse;

  try {
    apiResponse = await downloadLastPunchData(lastRecord);
  } catch (error) {
    if (
      error.message.includes("LastRecord") &&
      lastRecord !== getInitialLastRecord()
    ) {
      state.lastMaxRecord = getInitialLastRecord();
      await state.save();
      apiResponse = await downloadLastPunchData(
        state.lastMaxRecord
      );
    } else {
      state.lastSyncStatus = "FAILED";
      state.lastSyncMessage = error.message;
      state.lastSyncedAt = new Date();
      await state.save();

      throw error;
    }
  }

  const { applyBiometricPunch, parseBiometricPunchDate } =
    getAttendanceHelpers();

  const punchData = apiResponse.PunchData || [];

  const sortedPunches = [...punchData].sort((a, b) => {
    const dateA = parseBiometricPunchDate(a.PunchDate);
    const dateB = parseBiometricPunchDate(b.PunchDate);

    return dateA - dateB;
  });

  let processedCount = 0;
  let skippedCount = 0;

  for (const punch of sortedPunches) {
    if (!punch.ID) {
      continue;
    }

    const alreadyProcessed = await ProcessedBiometricPunch.findOne({
      punchId: punch.ID,
    });

    if (alreadyProcessed) {
      skippedCount += 1;
      continue;
    }

    const empcode = normalizeEmpCode(punch.Empcode);

    const user = await User.findOne({
      $or: [
        { biometricEmpCode: empcode },
        { employeeId: `DOB${empcode}` },
      ],
      isActive: true,
    });

    if (!user) {
      skippedCount += 1;
      continue;
    }

    const punchDateTime = parseBiometricPunchDate(
      punch.PunchDate
    );

    if (!punchDateTime || Number.isNaN(punchDateTime.getTime())) {
      skippedCount += 1;
      continue;
    }

    await applyBiometricPunch(
      user._id,
      punchDateTime,
      user
    );

    await ProcessedBiometricPunch.create({
      punchId: punch.ID,
      empcode,
      punchDate: punchDateTime,
      employee: user._id,
    });

    processedCount += 1;
  }

  if (
    apiResponse.MaxRecord &&
    apiResponse.MaxRecord !== "0"
  ) {
    state.lastMaxRecord = apiResponse.MaxRecord;
  }

  state.lastSyncedAt = new Date();
  state.lastSyncStatus = "SUCCESS";
  state.lastSyncMessage = `Processed ${processedCount} punch(es), skipped ${skippedCount}`;
  await state.save();

  return {
    success: true,
    processedCount,
    skippedCount,
    lastMaxRecord: state.lastMaxRecord,
    message: state.lastSyncMessage,
  };
};

const getBiometricSyncStatus = async () => {
  const state = await getSyncState();

  return {
    success: true,
    data: {
      lastMaxRecord: state.lastMaxRecord,
      lastSyncedAt: state.lastSyncedAt,
      lastSyncStatus: state.lastSyncStatus,
      lastSyncMessage: state.lastSyncMessage,
    },
  };
};

module.exports = {
  syncBiometricPunches,
  getBiometricSyncStatus,
  normalizeEmpCode,
};
