require("dotenv").config();

const express = require("express");
const cp2nus = require("./routes/cp2nus");
const cp2 = require("./routes/cp2");

// require("./bot");

const app = express();

app.get("/debug/cp2nus", (req, res) => res.send("cp2nus prefix reachable"));
app.use("/cp2nus", cp2nus);
app.use("/", cp2);

const port = process.env.PORT || 3000;

app.listen(port, "127.0.0.1", () => {
  console.log(`App listening on port: ${port}`);
});
