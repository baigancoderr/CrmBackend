const { attachmentTooLargeMessage } = require("../constants/uploadLimits");

const errorMiddleware = (err, req, res, next) => {
  console.error("[Error Middleware]:", err);

  // Set default status and message
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || "Internal Server Error";
  let errors = err.errors || [];

  // Handle Mongoose Validation Error
  if (err.name === "ValidationError") {
    statusCode = 400;
    message = "Database Validation Failed";
    errors = Object.values(err.errors).map((el) => el.message);
  }

  // Handle Mongoose Cast Error (e.g., invalid ObjectId)
  if (err.name === "CastError") {
    statusCode = 400;
    message = `Invalid ${err.path}: ${err.value}`;
    errors = [message];
  }

  // Handle Duplicate Key Error (e.g., folder unique index)
  if (err.code === 11000) {
    statusCode = 400;
    const key = Object.keys(err.keyValue)[0];
    message = `Duplicate field value entered for: ${key}`;
    errors = [message];
  }

  // Handle Multer upload errors
  if (err.code === "LIMIT_FILE_SIZE") {
    statusCode = 400;
    message = attachmentTooLargeMessage();
    errors = [message];
  }

  return res.status(statusCode).json({
    success: false,
    message,
    errors: errors.length > 0 ? errors : [message],
  });
};

module.exports = errorMiddleware;
