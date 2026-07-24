const webPush = require("web-push");
const PushSubscription = require("./pushSubscription.model");

let vapidConfigured = false;

const getVapidConfig = () => {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || "").trim();
  const subject =
    (process.env.VAPID_SUBJECT || "mailto:admin@digitalonebox.local").trim();

  return {
    publicKey,
    privateKey,
    subject,
  };
};

const isWebPushConfigured = () => {
  const { publicKey, privateKey } = getVapidConfig();
  return Boolean(publicKey && privateKey);
};

const configureWebPush = () => {
  if (vapidConfigured) {
    return;
  }

  const { publicKey, privateKey, subject } = getVapidConfig();
  if (!publicKey || !privateKey) {
    return;
  }

  webPush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
};

const normalizeSubscription = (subscription = {}) => {
  const endpoint = String(subscription.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();
  const expirationTime = subscription.expirationTime
    ? new Date(subscription.expirationTime)
    : null;

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  return {
    endpoint,
    expirationTime:
      expirationTime && !Number.isNaN(expirationTime.getTime())
        ? expirationTime
        : null,
    keys: { p256dh, auth },
  };
};

const upsertSubscription = async ({ userId, subscription, userAgent = "" }) => {
  const normalized = normalizeSubscription(subscription);
  if (!userId || !normalized) {
    const error = new Error("Invalid push subscription payload.");
    error.statusCode = 400;
    throw error;
  }

  const nextDoc = await PushSubscription.findOneAndUpdate(
    { endpoint: normalized.endpoint },
    {
      $set: {
        user: userId,
        endpoint: normalized.endpoint,
        expirationTime: normalized.expirationTime,
        keys: normalized.keys,
        userAgent: String(userAgent || "").slice(0, 400),
        isActive: true,
        lastUsedAt: new Date(),
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  return nextDoc;
};

const removeSubscription = async ({ userId, endpoint }) => {
  const normalizedEndpoint = String(endpoint || "").trim();
  if (!userId || !normalizedEndpoint) {
    return { deletedCount: 0 };
  }

  const result = await PushSubscription.deleteOne({
    user: userId,
    endpoint: normalizedEndpoint,
  });

  return { deletedCount: result.deletedCount || 0 };
};

const buildNotificationPayload = (payload = {}) => {
  return JSON.stringify({
    title: String(payload.title || "Digital One Box"),
    body: String(payload.body || ""),
    url: String(payload.url || "/"),
    tag: String(payload.tag || "dob-notification"),
    icon: String(payload.icon || "/pwa-192x192.png"),
    badge: String(payload.badge || "/pwa-192x192.png"),
    data:
      payload.data && typeof payload.data === "object" ? payload.data : {},
  });
};

const shouldDeleteStaleSubscription = (error) => {
  const statusCode = Number(error?.statusCode || 0);
  return statusCode === 404 || statusCode === 410;
};

const sendPushToUsers = async (userIds = [], payload = {}) => {
  if (!isWebPushConfigured()) {
    return { sentCount: 0, failedCount: 0, skipped: true };
  }

  const uniqueUserIds = [
    ...new Set(
      userIds
        .map((id) => (id ? id.toString() : ""))
        .filter(Boolean)
    ),
  ];

  if (!uniqueUserIds.length) {
    return { sentCount: 0, failedCount: 0, skipped: false };
  }

  configureWebPush();

  const subscriptions = await PushSubscription.find({
    user: { $in: uniqueUserIds },
    isActive: true,
  }).lean();

  if (!subscriptions.length) {
    return { sentCount: 0, failedCount: 0, skipped: false };
  }

  const serializedPayload = buildNotificationPayload(payload);
  let sentCount = 0;
  let failedCount = 0;
  const staleEndpoints = [];

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const pushSubscription = normalizeSubscription(subscription);
      if (!pushSubscription) {
        failedCount += 1;
        return;
      }

      try {
        await webPush.sendNotification(pushSubscription, serializedPayload);
        sentCount += 1;
      } catch (error) {
        failedCount += 1;
        if (shouldDeleteStaleSubscription(error)) {
          staleEndpoints.push(subscription.endpoint);
        }
      }
    })
  );

  if (staleEndpoints.length) {
    await PushSubscription.deleteMany({
      endpoint: { $in: staleEndpoints },
    });
  }

  return {
    sentCount,
    failedCount,
    skipped: false,
  };
};

const getPublicVapidKey = () => {
  return getVapidConfig().publicKey || "";
};

module.exports = {
  getPublicVapidKey,
  isWebPushConfigured,
  upsertSubscription,
  removeSubscription,
  sendPushToUsers,
};
