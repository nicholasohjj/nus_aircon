require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const express = require("express");
const cp2nus = require("./routes/cp2nus");
const cp2 = require("./routes/cp2");
const { captureException } = require("./services/analytics");

require("./bot");

const app = express();

let termsHtml;
try {
  const md = fs.readFileSync(path.join(__dirname, "terms.md"), "utf8");
  termsHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Terms of Use</title>
  <style>body { font-family: sans-serif; max-width: 720px; margin: 40px auto; padding: 0 20px; line-height: 1.6 }</style>
</head>
<body>${marked(md)}</body>
</html>`;
} catch (err) {
  console.error("Failed to load terms.md:", err.message);
}

app.get("/terms", (req, res) => {
  if (!termsHtml) return res.status(503).send("Terms temporarily unavailable.");
  res.send(termsHtml);
});
if (process.env.NODE_ENV !== "production") {
  app.get("/debug", (req, res) => res.send("cp2nus prefix reachable"));
}
app.use("/cp2nus", cp2nus);
app.use("/", cp2);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err.stack);
  captureException(err, "anonymous", { path: req.path, method: req.method });
  res.status(500).send("Something went wrong.");
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`App listening on port: ${port}`);
});
