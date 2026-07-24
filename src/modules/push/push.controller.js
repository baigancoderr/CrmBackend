const pushService = require("./push.service");

const getPublicKey = async (_req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        publicKey: pushService.getPublicVapidKey(),
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

const subscribe = async (req, res) => {
  try {
    const subscription = req.body?.subscription || req.body;
    const savedSubscription = await pushService.upsertSubscription({
      userId: req.user.id,
      subscription,
      userAgent: req.headers["user-agent"] || "",
    });

    return res.status(200).json({
      success: true,
      message: "Push subscription saved successfully.",
      data: {
        id: savedSubscription._id,
        endpoint: savedSubscription.endpoint,
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message,
    });
  }
};

const unsubscribe = async (req, res) => {
  try {
    const endpoint = req.body?.endpoint || "";
    const result = await pushService.removeSubscription({
      userId: req.user.id,
      endpoint,
    });

    return res.status(200).json({
      success: true,
      message: "Push subscription removed successfully.",
      data: result,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

module.exports = {
  getPublicKey,
  subscribe,
  unsubscribe,
};
