const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { UPLOAD_LIMITS, UPLOAD_MAX_FILES } = require("../constants/uploadLimits");

const uploadDir = path.join(__dirname, "../../uploads/areas");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname || "");
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const allowedMimeTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "application/x-zip-compressed",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "text/plain",
];

const fileFilter = (req, file, cb) => {
  const isAllowed = allowedMimeTypes.includes(file.mimetype) || file.mimetype.startsWith("image/");
  if (isAllowed) cb(null, true);
  else cb(new Error("Only PDF, Word, Excel, images, zip, and text files are allowed."), false);
};

module.exports = multer({
  storage,
  fileFilter,
  limits: { fileSize: UPLOAD_LIMITS.ATTACHMENT_MAX_BYTES, files: UPLOAD_MAX_FILES.AREA_DOCUMENTS },
});
