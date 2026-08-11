const fs = require("fs/promises");
const path = require("path");
const {
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { getB2Config, getS3Client } = require("../config/backblaze");

const STORAGE_FOLDERS = {
  employees: { folder: "employees", localPrefix: "/uploads/employees" },
  chat: { folder: "chat", localPrefix: "/api/uploads/chat" },
  tickets: { folder: "tickets", localPrefix: "/uploads/tickets" },
  projects: { folder: "projects", localPrefix: "/uploads/projects" },
  areas: { folder: "areas", localPrefix: "/api/uploads/areas" },
  notes: { folder: "notes", localPrefix: "/uploads/notes" },
};

const B2KEY_PREFIX = "b2key:";

const LOCAL_UPLOAD_ROOT = path.join(__dirname, "../../uploads");
const LOCAL_PRIVATE_UPLOAD_ROOT = path.join(__dirname, "../../uploads-private");

const normalizeEnvValue = (value) =>
  String(value || "")
    .split("#")[0]
    .trim();

const getStorageProvider = () =>
  normalizeEnvValue(process.env.STORAGE_PROVIDER).toLowerCase() || "local";

const isBackblazeStorage = () => getStorageProvider() === "backblaze";

const isCloudStorage = () => isBackblazeStorage();

const isPrivateBucket = () => {
  if (!isBackblazeStorage()) return false;
  return getB2Config().bucketPrivate;
};

const isPrivateStorageRef = (value) =>
  typeof value === "string" && value.startsWith(B2KEY_PREFIX);

const getStorageConfig = (storageKey) => {
  const config = STORAGE_FOLDERS[storageKey];

  if (!config) {
    throw new Error(`Unknown storage key: ${storageKey}`);
  }

  return config;
};

const toStorageRef = (remotePath) => `${B2KEY_PREFIX}${remotePath}`;

const parseStorageRef = (storedValue) => {
  if (!isPrivateStorageRef(storedValue)) {
    return null;
  }

  return storedValue.slice(B2KEY_PREFIX.length);
};

const buildPublicUrl = (remotePath) => {
  const { bucket, publicBaseUrl, endpoint } = getB2Config();

  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, "")}/${remotePath}`;
  }

  return `${endpoint.replace(/\/$/, "")}/${bucket}/${remotePath}`;
};

const buildStoredFileUrl = (remotePath) => {
  if (isPrivateBucket()) {
    return toStorageRef(remotePath);
  }

  return buildPublicUrl(remotePath);
};

const getSignedAccessUrl = async (remotePath, expiresIn) => {
  const { bucket, signedUrlExpirySeconds } = getB2Config();
  const s3 = getS3Client();

  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: remotePath,
    }),
    {
      expiresIn: expiresIn || signedUrlExpirySeconds,
    }
  );
};

const resolveAccessibleUrl = async (storedValue) => {
  if (!storedValue) {
    return storedValue;
  }

  if (/^https?:\/\//i.test(storedValue)) {
    return storedValue;
  }

  const remotePath = parseStorageRef(storedValue);

  if (remotePath) {
    return getSignedAccessUrl(remotePath);
  }

  return storedValue;
};

const uploadToBackblaze = async (localPath, remotePath, contentType) => {
  const { bucket } = getB2Config();
  const s3 = getS3Client();
  const fileBuffer = await fs.readFile(localPath);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: remotePath,
      Body: fileBuffer,
      ContentType: contentType || "application/octet-stream",
    })
  );

  return buildStoredFileUrl(remotePath);
};

const persistUploadedFile = async (file, storageKey) => {
  const config = getStorageConfig(storageKey);

  if (isBackblazeStorage()) {
    const remotePath = `${config.folder}/${file.filename}`;
    const storedUrl = await uploadToBackblaze(
      file.path,
      remotePath,
      file.mimetype
    );

    await fs.unlink(file.path).catch(() => undefined);
    return storedUrl;
  }

  return `${config.localPrefix}/${file.filename}`;
};

const persistUploadedFiles = async (files = [], storageKey) => {
  const fileUrls = [];

  for (const file of files) {
    fileUrls.push(await persistUploadedFile(file, storageKey));
  }

  return fileUrls;
};

const buildAttachmentMeta = async (file, storageKey, extra = {}) => ({
  fileName: file.originalname,
  fileUrl: await persistUploadedFile(file, storageKey),
  fileSize: file.size,
  mimeType: file.mimetype,
  ...extra,
});

const buildAttachmentMetaList = async (files = [], storageKey, extra = {}) => {
  const attachments = [];

  for (const file of files) {
    attachments.push(await buildAttachmentMeta(file, storageKey, extra));
  }

  return attachments;
};

const extractRemotePathFromUrl = (fileUrl) => {
  const fromRef = parseStorageRef(fileUrl);
  if (fromRef) {
    return fromRef;
  }

  if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
    return null;
  }

  const { bucket, publicBaseUrl, endpoint } = getB2Config();

  if (publicBaseUrl && fileUrl.startsWith(publicBaseUrl)) {
    return fileUrl.slice(publicBaseUrl.replace(/\/$/, "").length + 1);
  }

  const pathStylePrefix = `${endpoint.replace(/\/$/, "")}/${bucket}/`;
  if (fileUrl.startsWith(pathStylePrefix)) {
    return fileUrl.slice(pathStylePrefix.length);
  }

  const nativeMatch = fileUrl.match(/\/file\/[^/]+\/(.+?)(?:\?|$)/);
  return nativeMatch ? decodeURIComponent(nativeMatch[1]) : null;
};

const resolveLocalAbsolutePath = (fileUrl) => {
  if (!fileUrl || /^https?:\/\//i.test(fileUrl) || isPrivateStorageRef(fileUrl)) {
    return null;
  }

  const normalized = fileUrl.startsWith("/") ? fileUrl : `/${fileUrl}`;
  const withoutApiPrefix = normalized.replace(/^\/api/, "");

  if (withoutApiPrefix.startsWith("/uploads-private/")) {
    return path.join(
      LOCAL_PRIVATE_UPLOAD_ROOT,
      withoutApiPrefix.replace(/^\/uploads-private\//, "")
    );
  }

  if (withoutApiPrefix.startsWith("/uploads/")) {
    return path.join(
      LOCAL_UPLOAD_ROOT,
      withoutApiPrefix.replace(/^\/uploads\//, "")
    );
  }

  return null;
};

const deleteStoredFile = async (fileUrl) => {
  if (!fileUrl) {
    return;
  }

  const remotePath = extractRemotePathFromUrl(fileUrl);

  if (remotePath && isBackblazeStorage()) {
    const { bucket } = getB2Config();
    const s3 = getS3Client();

    await s3
      .send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: remotePath,
        })
      )
      .catch(() => undefined);

    return;
  }

  const absolutePath = resolveLocalAbsolutePath(fileUrl);

  if (absolutePath) {
    await fs.unlink(absolutePath).catch(() => undefined);
  }
};

module.exports = {
  STORAGE_FOLDERS,
  B2KEY_PREFIX,
  getStorageProvider,
  isBackblazeStorage,
  isCloudStorage,
  isPrivateBucket,
  isPrivateStorageRef,
  persistUploadedFile,
  persistUploadedFiles,
  buildAttachmentMeta,
  buildAttachmentMetaList,
  deleteStoredFile,
  extractRemotePathFromUrl,
  parseStorageRef,
  resolveLocalAbsolutePath,
  buildPublicUrl,
  buildStoredFileUrl,
  getSignedAccessUrl,
  resolveAccessibleUrl,
};
