const BUSINESS_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

const getTodayDateKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
  }).format(new Date());

const getDateKeyFromDate = (dateValue) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIMEZONE,
  }).format(dateValue);

const parseIstTimeOnDate = (dateKey, timeValue) => {
  if (!dateKey || !timeValue) {
    return null;
  }

  const normalized = String(timeValue).trim();

  if (
    !normalized ||
    normalized === "--" ||
    normalized === "-" ||
    normalized === "00:00"
  ) {
    return null;
  }

  const hasSeconds = /^\d{2}:\d{2}:\d{2}$/.test(normalized);
  const hasMinutes = /^\d{2}:\d{2}$/.test(normalized);

  if (!hasSeconds && !hasMinutes) {
    return null;
  }

  const timePart = hasSeconds ? normalized : `${normalized}:00`;
  const parsed = new Date(`${dateKey}T${timePart}${IST_OFFSET}`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

const parseBiometricPunchDateString = (punchDateString) => {
  if (!punchDateString) {
    return null;
  }

  const [datePart, timePart] = punchDateString.trim().split(" ");

  if (!datePart || !timePart) {
    return null;
  }

  const [day, month, year] = datePart.split("/");
  const [hours, minutes, seconds = "0"] = timePart.split(":");
  const dateKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return parseIstTimeOnDate(
    dateKey,
    `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
  );
};

const formatIstTimePart = (dateValue) => {
  if (!dateValue) {
    return "";
  }

  return new Date(dateValue).toLocaleTimeString("en-GB", {
    timeZone: BUSINESS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const getIstWeekdayIndex = (dateKey) => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
  }).format(new Date(`${dateKey}T12:00:00${IST_OFFSET}`));

  const weekdayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return weekdayMap[weekday] ?? 0;
};

const isIstWeekendDateKey = (dateKey) => {
  const weekday = getIstWeekdayIndex(dateKey);
  return weekday === 0 || weekday === 6;
};

const isIstWeekendNow = () => isIstWeekendDateKey(getTodayDateKey());

const getIstDayBounds = (dateKey) => ({
  start: new Date(`${dateKey}T00:00:00${IST_OFFSET}`),
  end: new Date(`${dateKey}T23:59:59.999${IST_OFFSET}`),
});

const getIstWeekdayShort = (dateKey) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIMEZONE,
    weekday: "short",
  })
    .format(new Date(`${dateKey}T12:00:00${IST_OFFSET}`))
    .toUpperCase();

const parseBiometricRowDateKey = (row, fallbackDateKey = "") => {
  const raw = row?.DateString || row?.dateString || row?.Date || "";

  const slashMatch = String(raw).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashMatch) {
    return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
  }

  const isoMatch = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  return fallbackDateKey;
};

module.exports = {
  BUSINESS_TIMEZONE,
  IST_OFFSET,
  getTodayDateKey,
  getDateKeyFromDate,
  parseIstTimeOnDate,
  parseBiometricPunchDateString,
  formatIstTimePart,
  getIstWeekdayIndex,
  isIstWeekendDateKey,
  isIstWeekendNow,
  getIstDayBounds,
  getIstWeekdayShort,
  parseBiometricRowDateKey,
};
