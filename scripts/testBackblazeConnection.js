require("dotenv").config();
const fs = require("fs/promises");
const path = require("path");
const {
  PutObjectCommand,
  HeadBucketCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { getB2Config, getS3Client } = require("../src/config/backblaze");

const run = async () => {
  const config = getB2Config();
  console.log("\n=== ENV CHECK ===");
  console.log("STORAGE_PROVIDER:", process.env.STORAGE_PROVIDER);
  console.log("B2_BUCKET_NAME:", config.bucket);
  console.log("B2_REGION:", config.region);
  console.log("B2_ENDPOINT:", config.endpoint);
  console.log("B2_PUBLIC_BASE_URL:", config.publicBaseUrl);
  console.log("B2_APPLICATION_KEY_ID:", config.keyId ? `${config.keyId.slice(0, 6)}...` : "MISSING");
  console.log("B2_APPLICATION_KEY:", config.applicationKey ? "SET" : "MISSING");
  console.log("B2_BUCKET_PRIVATE:", process.env.B2_BUCKET_PRIVATE === "true");

  const publicBucketInUrl = config.publicBaseUrl?.match(/\/file\/([^/]+)/)?.[1];
  if (publicBucketInUrl && publicBucketInUrl !== config.bucket) {
    console.warn(
      `\n⚠ MISMATCH: B2_PUBLIC_BASE_URL uses bucket "${publicBucketInUrl}" but B2_BUCKET_NAME is "${config.bucket}"`
    );
  }

  const s3 = getS3Client();
  const testKey = `_connection-test/${Date.now()}-test.txt`;
  const tmpFile = path.join(__dirname, "uploads", "_b2-test.txt");

  console.log("\n=== TEST 1: List buckets ===");
  try {
    const { ListBucketsCommand } = require("@aws-sdk/client-s3");
    const listed = await s3.send(new ListBucketsCommand({}));
    const names = (listed.Buckets || []).map((b) => b.Name);
    console.log("✓ Accessible buckets:", names.join(", ") || "(none)");
    if (names.length && !names.includes(config.bucket)) {
      console.warn(`⚠ B2_BUCKET_NAME "${config.bucket}" not in accessible bucket list`);
    }
  } catch (err) {
    console.warn("ListBuckets failed:", err.name, err.message);
    if (err.$metadata) console.warn("  HTTP:", err.$metadata.httpStatusCode);
  }

  console.log("\n=== TEST 2: Bucket access (HeadBucket) ===");
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
    console.log("✓ Bucket accessible with current credentials");
  } catch (err) {
    console.error("✗ Bucket access failed:", err.name, err.message);
    if (err.$metadata) console.error("  HTTP:", err.$metadata.httpStatusCode);
    process.exit(1);
  }

  await fs.mkdir(path.dirname(tmpFile), { recursive: true });
  await fs.writeFile(tmpFile, `CRM B2 test ${new Date().toISOString()}`);

  console.log("\n=== TEST 3: Upload (PutObject) ===");
  try {
    const body = await fs.readFile(tmpFile);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: testKey,
        Body: body,
        ContentType: "text/plain",
      })
    );
    console.log("✓ Upload successful:", testKey);
  } catch (err) {
    console.error("✗ Upload failed:", err.name, err.message);
    process.exit(1);
  }

  const publicUrl = config.publicBaseUrl
    ? `${config.publicBaseUrl.replace(/\/$/, "")}/${testKey}`
    : `${config.endpoint.replace(/\/$/, "")}/${config.bucket}/${testKey}`;

  console.log("\n=== TEST 4: Public URL access (private bucket check) ===");
  console.log("Public URL:", publicUrl);
  try {
    const res = await fetch(publicUrl, { method: "GET" });
    console.log("HTTP status:", res.status, res.statusText);
    if (res.ok) {
      const text = await res.text();
      console.log("✓ Public URL works — bucket is PUBLIC or file is publicly readable");
      console.log("  Body preview:", text.slice(0, 60));
    } else {
      console.log("✗ Public URL blocked — bucket is likely PRIVATE (expected for private buckets)");
    }
  } catch (err) {
    console.error("✗ Public URL fetch error:", err.message);
  }

  console.log("\n=== TEST 5: Signed URL access (private bucket solution) ===");
  try {
    const signedUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: config.bucket, Key: testKey }),
      { expiresIn: 300 }
    );
    console.log("Signed URL generated (5 min expiry)");

    const signedRes = await fetch(signedUrl, { method: "GET" });
    console.log("Signed URL HTTP status:", signedRes.status, signedRes.statusText);
    if (signedRes.ok) {
      const text = await signedRes.text();
      console.log("✓ Signed URL works — private bucket access OK via presigned URLs");
      console.log("  Body preview:", text.slice(0, 60));
    } else {
      console.error("✗ Signed URL failed");
    }
  } catch (err) {
    console.error("✗ Signed URL error:", err.name, err.message);
  }

  console.log("\n=== CLEANUP: Delete test file ===");
  try {
    await s3.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: testKey })
    );
    await fs.unlink(tmpFile).catch(() => undefined);
    console.log("✓ Test file deleted from B2");
  } catch (err) {
    console.warn("Cleanup warning:", err.message);
  }

  console.log("\n=== DONE ===\n");
};

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
