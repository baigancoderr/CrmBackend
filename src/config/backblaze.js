const { S3Client } = require("@aws-sdk/client-s3");

let client = null;

const normalizeEnvValue = (value) =>
  String(value || "")
    .split("#")[0]
    .trim();

const getB2Config = () => ({
  keyId: normalizeEnvValue(process.env.B2_APPLICATION_KEY_ID),
  applicationKey: normalizeEnvValue(process.env.B2_APPLICATION_KEY),
  bucket: normalizeEnvValue(process.env.B2_BUCKET_NAME),
  region: normalizeEnvValue(process.env.B2_REGION) || "us-west-004",
  endpoint: normalizeEnvValue(process.env.B2_ENDPOINT),
  publicBaseUrl: normalizeEnvValue(process.env.B2_PUBLIC_BASE_URL),
  bucketPrivate:
    normalizeEnvValue(process.env.B2_BUCKET_PRIVATE).toLowerCase() === "true",
  signedUrlExpirySeconds:
    Number(normalizeEnvValue(process.env.B2_SIGNED_URL_EXPIRY_SECONDS)) || 3600,
});

const getS3Client = () => {
  if (client) {
    return client;
  }

  const { keyId, applicationKey, region, endpoint } = getB2Config();

  if (!keyId || !applicationKey || !endpoint) {
    throw new Error(
      "B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY, and B2_ENDPOINT are required when STORAGE_PROVIDER=backblaze."
    );
  }

  client = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: applicationKey,
    },
    forcePathStyle: true,
  });

  return client;
};

module.exports = {
  getB2Config,
  getS3Client,
};
