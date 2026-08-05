/**
 * taskScheduler.js
 *
 * Runs a background job that fires once daily at 19:10 IST (7:10 PM).
 * Any task that is still IN_PROGRESS at that moment is automatically
 * paused so employees don't accumulate unintended working time overnight.
 *
 * Implementation note:
 *   We use a plain setInterval (60-second tick) to stay consistent with
 *   the existing biometric-sync and attendance-seed schedulers in server.js.
 *   No extra dependency (node-cron, agenda, etc.) is required.
 */

const mongoose = require("mongoose");
const Task = require("./task.model");
const TaskSession = require("./taskSession.model");
const taskSessionService = require("./taskSession.service");
const { logTaskHistory, calcDurationMinutes } = require("../project.helper");
const { BUSINESS_TIMEZONE } = require("../../../utils/istDateTime");

// ── Configuration ─────────────────────────────────────────────────────────────

/** Hour and minute in IST at which running tasks are auto-paused. */
const AUTO_PAUSE_HOUR = 19;   // 7 PM
const AUTO_PAUSE_MINUTE = 10; // :10

const AUTO_PAUSE_REASON = "Auto-paused at end of work hours (7:10 PM)";

// ── State ─────────────────────────────────────────────────────────────────────

/** Tracks the last date (IST YYYY-MM-DD) on which the job already ran, so the
 *  job never fires more than once per calendar day even if the server restarts
 *  within the same minute window. */
let lastRunDateKey = null;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the current IST time as { hour, minute, dateKey }. */
const getIstNow = () => {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "numeric",
    minute: "numeric",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "0";

  // hour12:false uses "24" for midnight rather than "00" on some runtimes
  const rawHour = Number(get("hour"));
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get("minute"));
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;

  return { hour, minute, dateKey };
};

// ── Core job ──────────────────────────────────────────────────────────────────

/**
 * Pauses every IN_PROGRESS task.  Called exactly once at 19:10 IST each day.
 */
const runAutoPauseJob = async () => {
  if (mongoose.connection.readyState !== 1) {
    console.warn("[Task Auto-Pause] Skipped: MongoDB is not connected.");
    return;
  }

  console.log("[Task Auto-Pause] Running end-of-day auto-pause...");

  // Find all tasks that are currently being worked on
  const activeTasks = await Task.find({
    status: "IN_PROGRESS",
    isArchived: false,
  }).select("_id projectId assignedTo assignedToNameSnapshot pauseReason").lean();

  if (!activeTasks.length) {
    console.log("[Task Auto-Pause] No IN_PROGRESS tasks found. Nothing to do.");
    return;
  }

  console.log(`[Task Auto-Pause] Found ${activeTasks.length} IN_PROGRESS task(s). Pausing...`);

  let pausedCount = 0;
  let errorCount = 0;

  for (const taskDoc of activeTasks) {
    try {
      // Use findById to get a mutable Mongoose document
      const task = await Task.findById(taskDoc._id);
      if (!task || task.status !== "IN_PROGRESS") continue; // re-check in case it changed

      task.status = "PAUSED";
      task.pauseReason = AUTO_PAUSE_REASON;
      await task.save();

      // Close the open WORKING session for this employee
      const closedSession = await taskSessionService.endOpenSession(task._id, task.assignedTo);
      if (closedSession) {
        await taskSessionService.syncTimeLogForSessions([closedSession]);
      }

      // Open a PAUSED session so the timeline stays continuous
      await taskSessionService.createSession({
        taskId: task._id,
        projectId: task.projectId,
        employeeId: task.assignedTo,
        employeeName: task.assignedToNameSnapshot || "",
        type: "PAUSED",
        reason: AUTO_PAUSE_REASON,
      });

      // Record a history entry (no acting user — use a system sentinel)
      await logTaskHistory({
        taskId: task._id,
        projectId: task.projectId,
        user: { id: null, name: "System" },
        action: "TASK_PAUSED",
        oldValue: { status: "IN_PROGRESS" },
        newValue: { status: "PAUSED" },
        reason: AUTO_PAUSE_REASON,
      });

      pausedCount++;
    } catch (err) {
      errorCount++;
      console.error(
        `[Task Auto-Pause] Failed to pause task ${taskDoc._id}: ${err.message}`
      );
    }
  }

  console.log(
    `[Task Auto-Pause] Done. Paused: ${pausedCount}, Errors: ${errorCount}.`
  );
};

// ── Tick ──────────────────────────────────────────────────────────────────────

/** Called every minute by the interval registered in server.js. */
const tick = async () => {
  try {
    const { hour, minute, dateKey } = getIstNow();

    if (hour !== AUTO_PAUSE_HOUR || minute !== AUTO_PAUSE_MINUTE) return;
    if (lastRunDateKey === dateKey) return; // already ran today

    lastRunDateKey = dateKey;
    await runAutoPauseJob();
  } catch (err) {
    console.error("[Task Auto-Pause] Unexpected error in tick:", err.message);
  }
};

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * startTaskScheduler()
 *
 * Registers a 60-second interval that fires the auto-pause check.
 * Call this once after the DB and server are ready (inside server.js).
 */
const startTaskScheduler = () => {
  const intervalMs = 60 * 1000; // 1 minute
  setInterval(tick, intervalMs);
  console.log(
    `[Task Auto-Pause] Scheduler started. Tasks will be auto-paused daily at ${AUTO_PAUSE_HOUR}:${String(AUTO_PAUSE_MINUTE).padStart(2, "0")} IST.`
  );
};

module.exports = { startTaskScheduler };
