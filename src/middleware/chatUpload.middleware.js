const multer = require("multer");
const path = require("path");
const fs = require("fs");
const {
  CHAT_MAX_ATTACHMENT_SIZE_BYTES,
  CHAT_UNSUPPORTED_FILE_MESSAGE,
  isChatAttachmentAllowed,
} = require("../constants/chatAttachments");

const isPrivateStorageEnabled =
  process.env.CHAT_UPLOAD_PRIVATE_STORAGE === "true";

const uploadDir = path.join(
  __dirname,
  isPrivateStorageEnabled
    ? "../../uploads-private/chat"
    : "../../uploads/chat"
);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, {
    recursive: true,
  });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);

    cb(
      null,
      Date.now() +
        "-" +
        Math.round(Math.random() * 1e9) +
        ext
    );
  },
});

const fileFilter = (req, file, cb) => {
  if (isChatAttachmentAllowed(file.originalname, file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(CHAT_UNSUPPORTED_FILE_MESSAGE), false);
  }
};

module.exports = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: CHAT_MAX_ATTACHMENT_SIZE_BYTES,
  },
});
