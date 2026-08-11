const fs = require("fs");
const path = require("path");

const HANDBOOK_PATH = path.join(
  __dirname,
  "../../../private/employee-handbook.pdf"
);

const viewHandbook = (req, res) => {
  if (!fs.existsSync(HANDBOOK_PATH)) {
    return res.status(404).json({
      message: "Employee handbook is not available.",
    });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "no-store, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const stream = fs.createReadStream(HANDBOOK_PATH);

  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({
        message: "Unable to load employee handbook.",
      });
    }
  });

  stream.pipe(res);
};

module.exports = {
  viewHandbook,
};
