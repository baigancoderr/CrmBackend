const { redisClient } = require("../config/redis");
const {
  emitAbuseAlert,
  incrementMetric,
} = require("../utils/observability");

const consumeRateLimit = async ({
  key,
  windowSeconds,
  maxRequests,
}) => {
  const multi = redisClient.multi();
  multi.incr(key);
  multi.ttl(key);
  const result = await multi.exec();

  const currentCount = Number(result?.[0] ?? 0);
  const ttl = Number(result?.[1] ?? -1);

  if (currentCount === 1 || ttl === -1) {
    await redisClient.expire(key, windowSeconds);
  }

  return {
    currentCount,
    remaining: Math.max(maxRequests - currentCount, 0),
    exceeded: currentCount > maxRequests,
  };
};

const createChatRateLimit = ({
  keyPrefix,
  windowSeconds,
  maxRequests,
  message,
  metricName,
}) => {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id?.toString();

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const key = `${keyPrefix}:${userId}`;
      const result = await consumeRateLimit({
        key,
        windowSeconds,
        maxRequests,
      });

      if (!result.exceeded) {
        return next();
      }

      await incrementMetric(metricName, {
        userId,
        route: req.path,
      });

      await emitAbuseAlert("chat_rate_limit_exceeded", {
        userId,
        route: req.path,
        keyPrefix,
        maxRequests,
        windowSeconds,
      });

      return res.status(429).json({
        success: false,
        message,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Rate limiter unavailable",
      });
    }
  };
};

const chatSendRateLimit = createChatRateLimit({
  keyPrefix: "rate:chat:send",
  windowSeconds: 60,
  maxRequests: 40,
  message: "Too many messages. Please slow down.",
  metricName: "chat_send_rate_limited",
});

const chatUploadRateLimit = createChatRateLimit({
  keyPrefix: "rate:chat:upload",
  windowSeconds: 60,
  maxRequests: 12,
  message: "Too many uploads. Please try again later.",
  metricName: "chat_upload_rate_limited",
});

module.exports = {
  consumeRateLimit,
  chatSendRateLimit,
  chatUploadRateLimit,
};
