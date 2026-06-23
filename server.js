require("dotenv").config();

const app = require("./src/app");

const connectDB = require("./src/config/db");
const { connectRedis } = require("./src/config/redis");

const PORT = process.env.PORT || 5000;

(async () => {
  try {
    await connectDB();
    await connectRedis();

    app.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
    });
  } catch (error) {
    console.log(error);
  }
})();