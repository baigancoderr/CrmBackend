// Punch timeline: counting only (no action correction).
// Odd punches = currently in; even = currently out.
// Breaks = paired middle punches; first = clockIn, last (when even) = clockOut.

const MIN_PUNCH_GAP_MS = 2 * 60 * 1000;

const normalizePunchTimes = (punchTimes = []) => {
  const sorted = [...punchTimes]
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const unique = [];

  sorted.forEach((punch) => {
    const last = unique[unique.length - 1];

    // Ignore accidental double punches within the gap window.
    if (!last || punch.getTime() - last.getTime() >= MIN_PUNCH_GAP_MS) {
      unique.push(punch);
    }
  });

  return unique;
};

const derivePunchTimeline = (punchTimes = []) => {
  const punches = normalizePunchTimes(punchTimes);

  if (punches.length === 0) {
    return {
      punches: [],
      clockIn: null,
      clockOut: null,
      breaks: [],
      totalBreakMinutes: 0,
      isCurrentlyIn: false,
      isCurrentlyOut: false,
    };
  }

  const clockIn = punches[0];
  const isCurrentlyIn = punches.length % 2 === 1;
  const clockOut = isCurrentlyIn ? null : punches[punches.length - 1];
  const breaks = [];

  // Pair middle punches for break counting only.
  // Even day: last punch is day clock-out, so pairs stop before it.
  // Odd day: currently in, so pairs use all middle punches.
  const lastBreakIndex = isCurrentlyIn
    ? punches.length - 1
    : punches.length - 2;

  for (let index = 1; index + 1 <= lastBreakIndex; index += 2) {
    const start = punches[index];
    const end = punches[index + 1];
    const minutes = Math.max(
      0,
      Math.floor((end.getTime() - start.getTime()) / 60000)
    );

    breaks.push({
      start,
      end,
      minutes,
    });
  }

  const totalBreakMinutes = breaks.reduce(
    (sum, item) => sum + item.minutes,
    0
  );

  return {
    punches,
    clockIn,
    clockOut,
    breaks,
    totalBreakMinutes,
    isCurrentlyIn,
    isCurrentlyOut: !isCurrentlyIn,
  };
};

const parseDurationToMinutes = (value) => {
  if (value === null || value === undefined) {
    return 0;
  }

  const normalized = String(value).trim();

  if (
    !normalized ||
    normalized === "--" ||
    normalized === "-" ||
    normalized === "00:00"
  ) {
    return 0;
  }

  const match = normalized.match(/^(\d{1,3}):(\d{2})$/);

  if (!match) {
    return 0;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
};

module.exports = {
  MIN_PUNCH_GAP_MS,
  normalizePunchTimes,
  derivePunchTimeline,
  parseDurationToMinutes,
};
