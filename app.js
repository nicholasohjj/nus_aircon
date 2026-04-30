require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const express = require("express");
const cp2nus = require("./routes/cp2nus");
const cp2 = require("./routes/cp2");

require("./bot");

const app = express();

app.get("/terms", (req, res) => {
  const md = fs.readFileSync(path.join(__dirname, "terms.md"), "utf8");
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Terms of Use</title>
  <style>body{font-family:sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6}</style>
  </head><body>${marked(md)}</body></html>`);
});
app.get("/debug", (req, res) => res.send("cp2nus prefix reachable"));
app.use("/cp2nus", cp2nus);
app.use("/", cp2);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`App listening on port: ${port}`);
});
