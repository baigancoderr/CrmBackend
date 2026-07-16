const { redisClient } = require("../config/redis");

const METRIC_TTL_SECONDS = Number(
  process.env.METRIC_TTL_SECONDS || 86400
);
const ABUSE_ALERT_THRESHOLD = Number(
  process.env.ABUSE_ALERT_THRESHOLD || 20
);

const safeSerialize = (payload) => {
  try {
    return JSON.stringify(payload);
  } catch (_error) {
    return JSON.stringify({
      message: "Failed to serialize payload",
    });
  }
};

const logAuditEvent = async (event, payload = {}) => {
  const entry = {
    level: "INFO",
    event,
    timestamp: new Date().toISOString(),
    payload,
  };

  console.log(safeSerialize(entry));
};

const logErrorEvent = async (event, payload = {}) => {
  const entry = {
    level: "ERROR",
    event,
    timestamp: new Date().toISOString(),
    payload,
  };

  console.error(safeSerialize(entry));
};

const incrementMetric = async (
  metricName,
  tags = {},
  value = 1
) => {
  const normalizedTags = Object.entries(tags)
    .map(([key, tagValue]) => `${key}:${tagValue}`)
    .sort()
    .join("|");

  const metricKey = `metric:${metricName}:${normalizedTags}`;
  const multi = redisClient.multi();
  multi.incrBy(metricKey, value);
  multi.expire(metricKey, METRIC_TTL_SECONDS);
  await multi.exec();
};

const emitAbuseAlert = async (signal, details = {}) => {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `alert:${signal}:${minuteBucket}`;
  const count = await redisClient.incr(key);

  if (count === 1) {
    await redisClient.expire(key, 120);
  }

  if (count >= ABUSE_ALERT_THRESHOLD) {
    await logErrorEvent("abuse_alert", {
      signal,
      count,
      details,
    });
  }
};

module.exports = {
  logAuditEvent,
  logErrorEvent,
  incrementMetric,
  emitAbuseAlert,
};
