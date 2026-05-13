require("dotenv").config();
const path = require("path");
const express = require("express");
const cp2nus = require("./routes/cp2nus");
const cp2 = require("./routes/cp2");
const { captureException } = require("./services/analytics");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");

const openapiSpec = YAML.load(path.join(__dirname, "docs/openapi.yaml"));

require("./bot/index");

const app = express();
app.use("/assets", express.static("assets"));

app.use("/app", express.static(path.join(__dirname, "frontend/dist")));

app.get(/^\/app\/.*$/, (req, res) => {
  res.sendFile(path.join(__dirname, "frontend/dist/index.html"));
});

app.get("/health", (req, res) => res.status(200).json({ ok: true }));

app.get("/terms", (req, res) => {
  res.redirect("/app/terms");
});

if (process.env.NODE_ENV !== "production") {
  app.get("/debug", (req, res) => res.send("cp2nus prefix reachable"));
}
app.use("/api", swaggerUi.serve, swaggerUi.setup(openapiSpec));

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
