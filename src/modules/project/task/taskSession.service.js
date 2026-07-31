const TaskSession = require("./taskSession.model");
const TimeLog = require("../reports/timeLog.model");
const Task = require("./task.model");
const { createAppError, calcDurationMinutes } = require("../project.helper");
const {
  getTodayDateKey,
  getDateKeyFromDate,
  getIstDayBounds,
} = require("../../../utils/istDateTime");

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
    const { start, end } = getIstDayBounds(query.date);
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

/**
 * Rebuilds the task's lifetime working hours from its closed WORKING sessions.
 * Recomputing (instead of adding) keeps repeated syncs — e.g. submit → reject → submit
 * on the same day — from inflating the total.
 */
const recalcTaskActualHours = async (taskId) => {
  const workingSessions = await TaskSession.find({
    taskId,
    type: "WORKING",
    endedAt: { $ne: null },
  })
    .select("duration startedAt endedAt")
    .lean();

  const totalMinutes = workingSessions.reduce(
    (sum, s) => sum + (s.duration || calcDurationMinutes(s.startedAt, s.endedAt)),
    0
  );

  const actualHours = Math.round((totalMinutes / 60) * 100) / 100;
  await Task.updateOne({ _id: taskId }, { actualHours });
  return actualHours;
};

const syncTimeLogForTask = async (taskId, employeeId, options = {}) => {
  if (!taskId || !employeeId) return null;

  const task = await Task.findById(taskId).select("projectId title").lean();
  if (!task) return null;

  await recalcTaskActualHours(taskId);

  // Days are keyed in business time (IST) so a session started before 05:30 IST
  // is not pushed onto the previous calendar day.
  const dateKey = options.dateKey || getTodayDateKey();
  const { start, end } = getIstDayBounds(dateKey);

  const sessions = await TaskSession.find({
    taskId,
    employeeId,
    startedAt: { $gte: start, $lte: end },
  })
    .sort({ startedAt: 1 })
    .lean();

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
  const startTime = sessions[0]?.startedAt || null;
  const lastEndedAt = sessions.reduce(
    (latest, s) => (s.endedAt && (!latest || s.endedAt > latest) ? s.endedAt : latest),
    null
  );

  return TimeLog.findOneAndUpdate(
    { employeeId, taskId, date: dateKey },
    {
      employeeId,
      employeeNameSnapshot: sessions[0]?.employeeNameSnapshot || "",
      projectId: task.projectId,
      taskId,
      date: dateKey,
      startTime,
      endTime: lastEndedAt || new Date(),
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

/**
 * Writes a TimeLog for every business day the given sessions touch, so time is not
 * lost when a session was started on an earlier day than the one being synced.
 */
const syncTimeLogForSessions = async (sessions = []) => {
  const pairs = new Map();
  for (const session of sessions) {
    if (!session?.taskId || !session?.employeeId || !session?.startedAt) continue;
    const dateKey = getDateKeyFromDate(new Date(session.startedAt));
    pairs.set(`${session.taskId}|${session.employeeId}|${dateKey}`, {
      taskId: session.taskId,
      employeeId: session.employeeId,
      dateKey,
    });
  }

  for (const { taskId, employeeId, dateKey } of pairs.values()) {
    await syncTimeLogForTask(taskId, employeeId, { dateKey });
  }
};

const getTaskSessions = async (taskId) => {
  return TaskSession.find({ taskId }).sort({ startedAt: 1 }).lean();
};

module.exports = {
  createSession,
  endOpenSession,
  getEmployeeTimeline,
  recalcTaskActualHours,
  syncTimeLogForTask,
  syncTimeLogForSessions,
  getTaskSessions,
};
