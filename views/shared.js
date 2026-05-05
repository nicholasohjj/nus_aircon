const { escHtml } = require("../services/utils");

const BASE_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d0d0d; --surface: #161616; --border: #2a2a2a;
    --accent: #00e5a0; --accent-dim: rgba(0,229,160,0.12);
    --text: #f0f0f0; --muted: #888; --error: #ff5c5c;
    --mono: 'DM Mono', monospace; --sans: 'DM Sans', sans-serif;
  }
  body { background: var(--bg); color: var(--text); font-family: var(--sans);
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 24px; }
  .card { background: var(--surface); border: 1px solid var(--border);
    border-radius: 16px; padding: 32px 28px; width: 100%; max-width: 380px; text-align: center; }
  .detail-row { display: flex; justify-content: space-between; align-items: center;
    padding: 10px 0; border-bottom: 1px solid var(--border); font-size: 0.875rem; }
  .detail-row:last-of-type { border-bottom: none; }
  .detail-label { color: var(--muted); }
  .detail-value { font-family: var(--mono); font-weight: 500; color: var(--accent);
    max-width: 58%; text-align: right; word-break: break-word; }
`;

function sharedStyles(extra = "") {
  return `<style>${BASE_CSS}${extra}</style>`;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title>
  <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
  min-height:100vh;background:#0d0d0d;color:#ff5c5c;padding:24px;text-align:center;}</style>
  </head><body><div><h2>Error</h2><p>${escHtml(msg)}</p></div></body></html>`;
}

function htmlHead({ title, extraScripts = [], extra = "" }) {
  return `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  ${extraScripts.map((src) => `<script src="${escHtml(src)}"></script>`).join("\n")}
  ${sharedStyles(extra)}`;
}

function telegramInit() {
  return `const tg = window.Telegram?.WebApp;\nif (tg) { tg.ready(); tg.expand(); }`;
}

module.exports = { sharedStyles, errorPage, htmlHead, telegramInit };
