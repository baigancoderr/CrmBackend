require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Attendance = require("../src/modules/attendance/attendance.model");
  const {
    fetchBiometricInOutRecords,
  } = require("../src/modules/biometric/biometricInOut.service");
  const { parseIstTimeOnDate } = require("../src/utils/istDateTime");

  const dates = ["2026-07-22", "2026-07-23"];
  for (const date of dates) {
    const missing = await Attendance.find({
      date,
      clockIn: { $ne: null },
      $or: [{ clockOut: null }, { clockOut: { $exists: false } }],
    })
      .select(
        "employeeId employeeName biometricEmpCode clockIn clockOut isManuallyUpdated clockInSource clockOutSource status updateReason punchEvents"
      )
      .lean();

    const bio = await fetchBiometricInOutRecords(date);
    const bioByCode = new Map();
    (bio.records || []).forEach((r) => {
      const digits = String(r.empcode || "").replace(/\D/g, "");
      const n = digits
        ? String(Number.parseInt(digits, 10)).padStart(4, "0")
        : "";
      if (n) bioByCode.set(n, r);
      bioByCode.set(String(r.empcode || "").trim(), r);
    });

    let apiHasOut = 0;
    let apiNoOut = 0;
    let noMatch = 0;
    const samples = [];

    for (const row of missing) {
      const raw =
        row.biometricEmpCode ||
        String(row.employeeId || "").replace(/^DOB/i, "");
      const digits = String(raw).replace(/\D/g, "");
      const code = digits
        ? String(Number.parseInt(digits, 10)).padStart(4, "0")
        : String(raw).trim();
      const rec = bioByCode.get(code) || bioByCode.get(String(raw).trim());
      if (!rec) {
        noMatch += 1;
        if (samples.length < 10) {
          samples.push({
            name: row.employeeName,
            code,
            reason: "NO_BIO_MATCH",
            manual: row.isManuallyUpdated,
            inSrc: row.clockInSource,
            status: row.status,
          });
        }
        continue;
      }
      const out = parseIstTimeOnDate(date, rec.outTime);
      if (out) {
        apiHasOut += 1;
        if (samples.length < 15) {
          samples.push({
            name: row.employeeName,
            code,
            reason: "API_HAS_OUT_BUT_DB_EMPTY",
            outTime: rec.outTime,
            inTime: rec.inTime,
            manual: row.isManuallyUpdated,
            inSrc: row.clockInSource,
            status: row.status,
          });
        }
      } else {
        apiNoOut += 1;
        if (samples.length < 15) {
          samples.push({
            name: row.employeeName,
            code,
            reason: "API_OUT_EMPTY",
            outTime: rec.outTime,
            inTime: rec.inTime,
            manual: row.isManuallyUpdated,
          });
        }
      }
    }

    console.log(`\n=== ${date} ===`);
    console.log("DB missing outs:", missing.length);
    console.log("API has OUT but DB empty:", apiHasOut);
    console.log("API also no OUT:", apiNoOut);
    console.log("No biometric match:", noMatch);
    console.log("API error:", bio.error);
    console.log("Samples:", JSON.stringify(samples, null, 2));
  }

  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
