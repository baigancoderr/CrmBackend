// Simple punch model: first punch = clock in, second+ last punch = clock out.
// Break / odd-even mid-day pairing intentionally disabled.

const MIN_PUNCH_GAP_MS = 2 * 60 * 1000;

const normalizePunchTimes = (punchTimes = [], options = {}) => {
  const minGapMs =
    typeof options.minGapMs === "number" ? options.minGapMs : MIN_PUNCH_GAP_MS;
  const sorted = [...punchTimes]
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  const unique = [];

  sorted.forEach((punch) => {
    const last = unique[unique.length - 1];

    // Ignore accidental double punches within the gap window.
    if (!last || punch.getTime() - last.getTime() >= minGapMs) {
      unique.push(punch);
    }
  });

  return unique;
};

const derivePunchTimeline = (punchTimes = [], options = {}) => {
  const punches = normalizePunchTimes(punchTimes, options);

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
  // 1st punch = in; any later punch = out (latest wins as final clock out).
  const clockOut = punches.length >= 2 ? punches[punches.length - 1] : null;

  // Keep only in + out — no mid-day break punches in the stored timeline.
  const storedPunches = clockOut ? [clockIn, clockOut] : [clockIn];

  // Break pairing removed — keep empty for schema compatibility.
  // Odd/even mid punches previously counted as break windows here.
  const breaks = [];
  const totalBreakMinutes = 0;
  const isCurrentlyIn = !clockOut;

  return {
    punches: storedPunches,
    clockIn,
    clockOut,
    breaks,
    totalBreakMinutes,
    isCurrentlyIn,
    isCurrentlyOut: Boolean(clockOut),
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
