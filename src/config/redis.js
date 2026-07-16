const { createClient } = require("redis");

const redisClient = createClient({
  url: process.env.REDIS_URL,
});

redisClient.on("error", (err) => {
  console.log("Redis Error:", err);
});

const connectRedis = async () => {
  try {
    await redisClient.connect();
    console.log("Redis Connected");
  } catch (err) {
    console.log("⚠️ Redis connection failed. App will run without caching:", err.message);
    // App continues without Redis
  }
};

module.exports = {
  redisClient,
  connectRedis,
};