const { escHtml } = require("../services/utils");

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0d0d0d;color:#ff5c5c;padding:24px;text-align:center;}</style>
  </head><body><div><h2>Error</h2><p>${escHtml(msg)}</p></div></body></html>`;
}

module.exports = {
  errorPage,
};
