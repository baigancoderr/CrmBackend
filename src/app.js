const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const routes = require("./routes");

const app = express();

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.use("/api", routes);

module.exports = app;