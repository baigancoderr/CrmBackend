const mongoose = require("mongoose");

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI;

  if (!mongoUri) {
    console.error(
      "MongoDB connection skipped: MONGO_URI is not set. Configure it before using database-backed features."
    );
    return false;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 20000,
      family: 4,
    });

    console.log("MongoDB Connected");
    return true;
  } catch (error) {
    const message =
      error?.reason?.message ||
      error?.message ||
      "Unknown MongoDB connection error";

    console.error("MongoDB connection failed:", message);
    console.error(
      "Check your MONGO_URI, network access, and Atlas IP allowlist if you are using MongoDB Atlas."
    );

    return false;
  }
};

module.exports = connectDB;