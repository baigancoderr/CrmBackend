const getAuthHeader = () => {
  const corporateId = process.env.ETIME_CORPORATE_ID;
  const username = process.env.ETIME_USERNAME;
  const password = process.env.ETIME_PASSWORD;

  if (!corporateId || !username || !password) {
    throw new Error(
      "E-TimeOffice credentials are missing in environment variables"
    );
  }

  const authString = `${corporateId}:${username}:${password}:True`;
  const encoded = Buffer.from(authString).toString("base64");

  return `Basic ${encoded}`;
};

const ETIME_BASE_URL =
  process.env.ETIME_BASE_URL ||
  "https://api.etimeoffice.com/api";

const downloadLastPunchData = async (lastRecord, empcode = "ALL") => {
  const url = new URL(
    `${ETIME_BASE_URL}/DownloadLastPunchData`
  );

  url.searchParams.set("Empcode", empcode);
  url.searchParams.set("LastRecord", lastRecord);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `E-TimeOffice API failed with status ${response.status}`
    );
  }

  const data = await response.json();

  if (data.Error) {
    throw new Error(
      data.Msg || "E-TimeOffice API returned an error"
    );
  }

  return data;
};

const getInitialLastRecord = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear());

  return `${month}${year}$0`;
};

const downloadInOutPunchData = async (
  empcode = "ALL",
  fromDate,
  toDate
) => {
  const url = new URL(
    `${ETIME_BASE_URL}/DownloadInOutPunchData`
  );

  url.searchParams.set("Empcode", empcode);
  url.searchParams.set("FromDate", fromDate);
  url.searchParams.set("ToDate", toDate);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `E-TimeOffice IN/OUT API failed with status ${response.status}`
    );
  }

  const data = await response.json();

  if (data.Error) {
    throw new Error(
      data.Msg || "E-TimeOffice IN/OUT API returned an error"
    );
  }

  return data;
};

module.exports = {
  downloadLastPunchData,
  downloadInOutPunchData,
  getInitialLastRecord,
};
