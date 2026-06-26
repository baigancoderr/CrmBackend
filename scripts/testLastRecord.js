require("dotenv").config();

const auth = Buffer.from(
  `${process.env.ETIME_CORPORATE_ID}:${process.env.ETIME_USERNAME}:${process.env.ETIME_PASSWORD}:True`
).toString("base64");

const records = ["062026$874", "062026$875", "062026$0"];

const run = async () => {
  for (const lastRecord of records) {
    const url = `https://api.etimeoffice.com/api/DownloadLastPunchData?Empcode=ALL&LastRecord=${encodeURIComponent(lastRecord)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    const data = await res.json();
    console.log(
      lastRecord,
      "Error:",
      data.Error,
      "Msg:",
      data.Msg,
      "count:",
      (data.PunchData || []).length,
      "Max:",
      data.MaxRecord
    );
  }
};

run();
