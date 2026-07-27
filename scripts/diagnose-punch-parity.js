require("dotenv").config();
const mongoose = require("mongoose");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Attendance = require("../src/modules/attendance/attendance.model");
  const ProcessedBiometricPunch = require("../src/modules/biometric/processedPunch.model");
  const User = require("../src/modules/user/user.model");
  const { getIstDayBounds } = require("../src/utils/istDateTime");

  const names = ["Soham Kavde", "Abhay Lilhare", "Surendra Nagpure", "Shubham Thakre"];
  const dates = ["2026-07-22", "2026-07-23"];

  for (const name of names) {
    const user = await User.findOne({ name, isActive: true })
      .select("_id name employeeId biometricEmpCode")
      .lean();
    if (!user) {
      console.log("User not found:", name);
      continue;
    }
    console.log(`\n#### ${user.name} (${user.biometricEmpCode || user.employeeId})`);

    for (const date of dates) {
      const att = await Attendance.findOne({ employee: user._id, date })
        .select("clockIn clockOut punches status isManuallyUpdated clockInSource clockOutSource workingMinutes")
        .lean();
      const { start, end } = getIstDayBounds(date);
      const punches = await ProcessedBiometricPunch.find({
        employee: user._id,
        punchDate: { $gte: start, $lte: end },
      })
        .sort({ punchDate: 1 })
        .lean();

      // also check next morning early punches (00:00-06:00 next day) that might be late outs
      const next = new Date(end);
      next.setHours(next.getHours() + 1);
      const nextEnd = new Date(next);
      nextEnd.setHours(nextEnd.getHours() + 6);
      const nextMorning = await ProcessedBiometricPunch.find({
        employee: user._id,
        punchDate: { $gt: end, $lte: nextEnd },
      })
        .sort({ punchDate: 1 })
        .lean();

      console.log(date, {
        att: att
          ? {
              in: att.clockIn,
              out: att.clockOut,
              punchCount: (att.punches || []).length,
              status: att.status,
              manual: att.isManuallyUpdated,
              inSrc: att.clockInSource,
              outSrc: att.clockOutSource,
            }
          : null,
        processedPunches: punches.map((p) => p.punchDate),
        nextMorningPunches: nextMorning.map((p) => p.punchDate),
      });
    }
  }

  // Aggregate: how many missing outs for yesterday have odd punch counts in processed
  const date = "2026-07-23";
  const missing = await Attendance.find({
    date,
    clockIn: { $ne: null },
    $or: [{ clockOut: null }, { clockOut: { $exists: false } }],
  })
    .select("employee employeeName")
    .lean();
  const { start, end } = getIstDayBounds(date);
  let odd = 0;
  let even = 0;
  let zero = 0;
  for (const row of missing) {
    const count = await ProcessedBiometricPunch.countDocuments({
      employee: row.employee,
      punchDate: { $gte: start, $lte: end },
    });
    if (count === 0) zero += 1;
    else if (count % 2 === 1) odd += 1;
    else even += 1;
  }
  console.log("\nYesterday missing outs punch parity:", { zero, odd, even, total: missing.length });

  await mongoose.disconnect();
})().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
