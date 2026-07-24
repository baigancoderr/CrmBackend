const TaskSession = require("./taskSession.model");
const TimeLog = require("../reports/timeLog.model");
const Task = require("./task.model");
const { createAppError, calcDurationMinutes } = require("../project.helper");

const createSession = async ({
  taskId,
  projectId,
  employeeId,
  employeeName = "",
  type,
  reason = "",
  startedAt = new Date(),
}) => {
  return TaskSession.create({
    taskId,
    projectId,
    employeeId,
    employeeNameSnapshot: employeeName,
    startedAt,
    type,
    reason,
  });
};

const endOpenSession = async (taskId, employeeId) => {
  const openSession = await TaskSession.findOne({
    taskId,
    employeeId,
    endedAt: null,
  }).sort({ startedAt: -1 });

  if (!openSession) return null;

  openSession.endedAt = new Date();
  openSession.duration = calcDurationMinutes(openSession.startedAt, openSession.endedAt);
  await openSession.save();
  return openSession;
};

const getEmployeeTimeline = async (employeeId, query = {}) => {
  const filter = { employeeId };
  if (query.date) {
    const start = new Date(`${query.date}T00:00:00.000Z`);
    const end = new Date(`${query.date}T23:59:59.999Z`);
    filter.startedAt = { $gte: start, $lte: end };
  }
  if (query.projectId) filter.projectId = query.projectId;

  const sessions = await TaskSession.find(filter)
    .sort({ startedAt: 1 })
    .populate("taskId", "title")
    .lean();

  return sessions.map((s) => ({
    taskId: s.taskId?._id || s.taskId,
    taskTitle: s.taskId?.title || "",
    type: s.type,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    durationMinutes: s.duration || calcDurationMinutes(s.startedAt, s.endedAt),
    reason: s.reason,
  }));
};

const syncTimeLogForTask = async (taskId, employeeId) => {
  const task = await Task.findById(taskId).select("projectId title");
  if (!task) return null;

  const today = new Date().toISOString().slice(0, 10);
  const sessions = await TaskSession.find({
    taskId,
    employeeId,
    startedAt: {
      $gte: new Date(`${today}T00:00:00.000Z`),
      $lte: new Date(`${today}T23:59:59.999Z`),
    },
  }).lean();

  if (!sessions.length) return null;

  let workingMinutes = 0;
  let pausedMinutes = 0;
  let blockedMinutes = 0;

  for (const s of sessions) {
    const mins = s.duration || calcDurationMinutes(s.startedAt, s.endedAt);
    if (s.type === "WORKING") workingMinutes += mins;
    else if (s.type === "PAUSED" || s.type === "BREAK") pausedMinutes += mins;
    else if (s.type === "BLOCKED") blockedMinutes += mins;
  }

  const totalMinutes = workingMinutes + pausedMinutes + blockedMinutes;
  const startTime = sessions[0]?.startedAt;
  const endTime = sessions[sessions.length - 1]?.endedAt || new Date();

  task.actualHours = Math.round(((task.actualHours || 0) + workingMinutes / 60) * 100) / 100;
  await task.save();

  return TimeLog.findOneAndUpdate(
    { employeeId, taskId, date: today },
    {
      employeeId,
      employeeNameSnapshot: sessions[0]?.employeeNameSnapshot || "",
      projectId: task.projectId,
      taskId,
      date: today,
      startTime,
      endTime,
      workingMinutes,
      pausedMinutes,
      blockedMinutes,
      idleMinutes: 0,
      totalMinutes,
      description: task.title,
    },
    { upsert: true, new: true }
  );
};

const getTaskSessions = async (taskId) => {
  return TaskSession.find({ taskId }).sort({ startedAt: 1 }).lean();
};

module.exports = {
  createSession,
  endOpenSession,
  getEmployeeTimeline,
  syncTimeLogForTask,
  getTaskSessions,
};
