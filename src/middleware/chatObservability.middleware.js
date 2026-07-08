const {
  incrementMetric,
  logAuditEvent,
} = require("../utils/observability");

const observeChatHttp = (req, res, next) => {
  const startAt = Date.now();

  res.on("finish", async () => {
    const durationMs = Date.now() - startAt;
    const userId = req.user?.id?.toString() || "anonymous";

    await incrementMetric("chat_http_requests", {
      method: req.method,
      route: req.route?.path || req.path,
      status: res.statusCode,
    });

    if (res.statusCode >= 400) {
      await incrementMetric("chat_http_failures", {
        method: req.method,
        route: req.route?.path || req.path,
        status: res.statusCode,
      });
    }

    await logAuditEvent("chat_http_request", {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      userId,
    });
  });

  next();
};

module.exports = observeChatHttp;
