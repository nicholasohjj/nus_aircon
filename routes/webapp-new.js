const express = require("express");
const axios = require("axios");
const { getMeterInfo } = require("../services/ore");

const router = express.Router();

const EVS_NEW_HEADERS = {
  Accept: "*/*",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json; charset=UTF-8",
  Origin: "https://cp2nus.evs.com.sg",
  Referer: "https://cp2nus.evs.com.sg/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
};

const PAY_BASE = "https://enetspp-nus-live.evs.com.sg";

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ensureBaseHref(html, baseHref) {
  const body = String(html || "");
  if (!body) return body;
  if (/<base\b/i.test(body)) return body;
  const headOpen = body.match(/<head\b[^>]*>/i)?.[0];
  if (!headOpen) return body;
  return body.replace(
    /<head\b[^>]*>/i,
    `${headOpen}\n<base href="${String(baseHref)}">`,
  );
}

function errorPage(msg) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Error</title>
  <style>
    body {
      font-family: sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #0d0d0d;
      color: #ff5c5c;
      padding: 24px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div>
    <h2>Error</h2>
    <p>${escHtml(msg)}</p>
  </div>
</body>
</html>`;
}

function loadingPage(txtMtrId, txtAmount, meterInfo = {}) {
  const amtDisplay = Number(txtAmount).toFixed(2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EVS Payment</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  body {
    background: #0d0d0d;
    color: #f0f0f0;
    font-family: sans-serif;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #161616;
    border: 1px solid #2a2a2a;
    border-radius: 16px;
    padding: 28px;
    width: 100%;
    max-width: 380px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    padding: 10px 0;
    border-bottom: 1px solid #2a2a2a;
  }
  .error {
    margin-top: 16px;
    color: #ff5c5c;
    display: none;
    white-space: pre-wrap;
  }
</style>
</head>
<body>
<div class="card">
  <h2>Electricity Top-Up</h2>
  <p>Connecting to EVS payment gateway…</p>

  <div class="row"><span>Meter ID</span><span>${escHtml(txtMtrId)}</span></div>
  ${
    meterInfo?.address
      ? `<div class="row"><span>Address</span><span>${escHtml(meterInfo.address)}</span></div>`
      : ""
  }
  <div class="row"><span>Amount</span><span>SGD ${escHtml(amtDisplay)}</span></div>

  <div id="status">Initialising…</div>
  <div id="error" class="error"></div>
</div>

<script>
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  async function runFlow() {
    const status = document.getElementById('status');
    const error = document.getElementById('error');

    try {
      const resp = await fetch(
        '/webapp/new/bootstrap?txtMtrId=' + encodeURIComponent(${JSON.stringify(txtMtrId)}) +
        '&txtAmount=' + encodeURIComponent(${JSON.stringify(txtAmount)})
      );

      const out = await resp.json().catch(() => ({}));

      if (!resp.ok || !out.ok) {
        throw new Error(out.error || 'Failed to initialise payment flow');
      }

      status.textContent = 'Opening payment gateway…';

      if (!out.redirectUrl) {
        throw new Error('Missing redirect URL');
      }

      window.location.href = out.redirectUrl;
    } catch (err) {
      status.style.display = 'none';
      error.style.display = 'block';
      error.textContent = '⚠️ ' + (err.message || 'Unknown error');
    }
  }

  runFlow();
</script>
</body>
</html>`;
}

function toB64(value) {
  return Buffer.from(String(value ?? ""), "utf8").toString("base64");
}

function normalizeAmount(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toFixed(2);
}

function buildPayP({ meterDisplayName, amountDisplay, address, req, sign }) {
  const inner = new URLSearchParams({
    m: toB64(meterDisplayName),
    a: toB64(amountDisplay),
    d: toB64(address || ""),
    t: String(req),
    s: String(sign),
  }).toString();

  return Buffer.from(inner, "utf8").toString("base64");
}

function fromB64(value) {
  try {
    return Buffer.from(String(value || ""), "base64").toString("utf8");
  } catch {
    return "";
  }
}

function renderResultPage({
  result = "unknown",
  amount = "",
  target = "",
  txnRef = "",
  code = "",
  message = "",
}) {
  const ok = String(result).toLowerCase() === "success";

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>eNETS Payment Result</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
    <style>
      body {
        margin: 0;
        background: #0d0d0d;
        color: #f0f0f0;
        font-family: sans-serif;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .result-container {
        border-radius: 12px;
        padding: 24px;
        width: 100%;
        max-width: 520px;
        margin: 0 auto;
        border: 2px solid ${ok ? "green" : "red"};
        background-color: ${ok ? "#e8f5e9" : "#ffebee"};
        color: #111;
      }
      .monospace-font {
        font-family: "Courier New", monospace;
        word-break: break-word;
      }
      .close-btn {
        margin-top: 15px;
        padding: 10px 20px;
        background-color: ${ok ? "green" : "red"};
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
  <div class="result-container">
    <h1 class="monospace-font">Payment Result</h1>
  
    <p class="monospace-font">Transaction Result: <span>${escHtml(result)}</span></p>
    <p class="monospace-font">Amount (SGD): <span>${escHtml(amount)}</span></p>
    <p class="monospace-font">Target: <span>${escHtml(target)}</span></p>
    <p class="monospace-font">Transaction Reference: <span>${escHtml(txnRef)}</span></p>
    <p class="monospace-font">Code: <span>${escHtml(code)}</span></p>
    <p class="monospace-font">Transaction Message: <span>${escHtml(message)}</span></p>
    <p class="monospace-font"><span>${ok ? "Transaction Successful" : "Transaction Failed"}</span></p>
  
    <button class="close-btn" onclick="closeTab()">Close</button>
  </div>
  
  <script>
    function closeTab() {
      const tg = window.Telegram?.WebApp;
      if (tg) tg.close();
      else window.close();
    }
  </script>
  </body>
  </html>`;
}

async function initPay({ amount, username, meter_displayname }) {
  const resp = await axios.post(
    "https://p-1.evs.com.sg/enets/init_pay",
    {
      amount: String(amount),
      username: String(username),
      meter_displayname: String(meter_displayname),
    },
    {
      headers: EVS_NEW_HEADERS,
      validateStatus: () => true,
    },
  );

  if (resp.status !== 200) {
    return {
      ok: false,
      error: "init_pay returned non-200",
      upstreamStatus: resp.status,
    };
  }

  const netsResp = resp.data?.nets_resp;
  const txn_identifier = netsResp?.txn_identifier || null;
  const req = netsResp?.req || null;
  const sign = netsResp?.sign || null;

  if (!txn_identifier || !req || !sign) {
    return {
      ok: false,
      error: "Missing txn_identifier, req, or sign in init_pay response",
    };
  }

  return {
    ok: true,
    txn_identifier,
    req,
    sign,
  };
}

router.get("/", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res.status(400).send(errorPage("Missing meter ID or amount."));
  }

  try {
    const meterInfo = await getMeterInfo(txtMtrId);
    return res
      .status(200)
      .send(loadingPage(txtMtrId, txtAmount, meterInfo || {}));
  } catch {
    return res.status(200).send(loadingPage(txtMtrId, txtAmount, {}));
  }
});

router.get("/bootstrap", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res.status(400).json({
      ok: false,
      stage: "init",
      error: "Missing meter ID or amount.",
    });
  }

  const amountDisplay = normalizeAmount(txtAmount);
  if (!amountDisplay) {
    return res.status(400).json({
      ok: false,
      stage: "init",
      error: "Invalid amount.",
    });
  }

  try {
    const [initOut, meterInfo] = await Promise.all([
      initPay({
        amount: amountDisplay,
        username: txtMtrId,
        meter_displayname: txtMtrId,
      }),
      getMeterInfo(txtMtrId),
    ]);

    if (!initOut.ok) {
      return res.status(502).json({
        ...initOut,
        stage: "init_pay",
      });
    }

    const p = buildPayP({
      meterDisplayName: txtMtrId,
      amountDisplay,
      address: meterInfo?.address || "",
      req: initOut.req,
      sign: initOut.sign,
    });

    return res.status(200).json({
      ok: true,
      stage: "pay_page",
      redirectUrl: "/webapp/new/pay?p=" + encodeURIComponent(p),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      stage: "init",
      error: err.message || "Unknown error",
    });
  }
});

router.get("/pay", async (req, res) => {
  const { p } = req.query;

  if (!p) {
    return res.status(400).send(errorPage("Missing p."));
  }

  try {
    const payResp = await axios.get(`${PAY_BASE}/pay`, {
      params: { p: String(p) },
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        Referer: "https://cp2nus.evs.com.sg/",
      },
      validateStatus: () => true,
    });

    if (payResp.status !== 200) {
      return res
        .status(502)
        .send(errorPage(`Upstream pay returned ${payResp.status}.`));
    }

    let html = String(payResp.data || "");

    html = html.replace(
      /https:\/\/enetspp-nus-live\.evs\.com\.sg\/pay_result/gi,
      "/webapp/new/pay_result",
    );

    html = ensureBaseHref(html, "https://enetspp-nus-live.evs.com.sg/");

    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.status(200).send(html);
  } catch (err) {
    return res
      .status(500)
      .send(errorPage(err.message || "Failed to open payment page."));
  }
});

router.post("/init_pay", async (req, res) => {
  try {
    const { amount, username, meter_displayname } = req.body || {};

    if (!amount || !username || !meter_displayname) {
      return res.status(400).json({
        ok: false,
        error: "Missing amount, username, or meter_displayname",
      });
    }

    const amountDisplay = normalizeAmount(amount);
    if (!amountDisplay) {
      return res.status(400).json({
        ok: false,
        error: "Invalid amount",
      });
    }

    const [initOut, meterInfo] = await Promise.all([
      initPay({ amount: amountDisplay, username, meter_displayname }),
      getMeterInfo(meter_displayname),
    ]);

    if (!initOut.ok) {
      return res.status(502).json(initOut);
    }

    const p = buildPayP({
      meterDisplayName: meter_displayname,
      amountDisplay,
      address: meterInfo?.address || "",
      req: initOut.req,
      sign: initOut.sign,
    });

    return res.status(200).json({
      ok: true,
      txn_identifier: initOut.txn_identifier,
      req: initOut.req,
      sign: initOut.sign,
      address: meterInfo?.address || null,
      premise: meterInfo?.premise || null,
      meter_info: meterInfo || null,
      p,
      redirectUrl: `${PAY_BASE}/pay?p=${encodeURIComponent(p)}`,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Unknown error",
    });
  }
});

router.get("/pay_result", (req, res) => {
  const result = fromB64(req.query.r);
  const target = fromB64(req.query.t);
  const amount = fromB64(req.query.a);
  const txnRef = fromB64(req.query.x);
  const code = fromB64(req.query.s);
  const message = fromB64(req.query.m);

  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  return res.send(
    renderResultPage({
      result,
      amount,
      target,
      txnRef,
      code,
      message,
    }),
  );
});

module.exports = router;
