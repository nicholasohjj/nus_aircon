require("dotenv").config();
const express = require("express");
const cp2 = require("./routes/cp2");
require("./bot");

const app = express();

app.use("/", cp2);

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log(`App listening on port: ${port}`);
});
