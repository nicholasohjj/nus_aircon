require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { getMeterSummary } = require("../services/ore");
const app = express();

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// ── Constants ─────────────────────────────────────────────────────────────────

const EVS_API_BASE = "https://p-1.evs.com.sg";
const ENETS_PP_HOST = "https://enetspp-nus-live.evs.com.sg";
const NETS_API_HOST = "https://api.nets.com.sg";

const ORE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Content-Type": "application/json; charset=UTF-8",
  Origin: "https://cp2.evs.com.sg",
  Referer: "https://cp2.evs.com.sg/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  Authorization: "Bearer",
};

const FIXED_USER_ID = "5771";

const DEFAULT_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlDecode(str) {
  return String(str || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractHiddenField(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m =
    String(html || "").match(
      new RegExp(
        `<input[^>]*\\bname=["']${escaped}["'][^>]*\\bvalue=["']([^"']*)["']`,
        "i",
      ),
    ) ||
    String(html || "").match(
      new RegExp(
        `<input[^>]*\\bvalue=["']([^"']*)["'][^>]*\\bname=["']${escaped}["']`,
        "i",
      ),
    );
  return m ? htmlDecode(m[1]) : null;
}

function errorPage(msg) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Error</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
min-height:100vh;background:#0d0d0d;color:#ff5c5c;padding:24px;text-align:center;}</style>
</head><body><div><h2>Error</h2><p>${escHtml(msg)}</p></div></body></html>`;
}

// ── Step 1: POST /enets/init_pay ──────────────────────────────────────────────

async function initPay({ username, amount }) {
  const resp = await axios.post(
    `${EVS_API_BASE}/enets/init_pay`,
    {
      amount: String(amount),
      username: String(username),
      user_id: FIXED_USER_ID,
      meter_displayname: String(username),
    },
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "*/*",
        Origin: "https://cp2nus.evs.com.sg",
        Referer: "https://cp2nus.evs.com.sg/",
      },
      validateStatus: () => true,
    },
  );

  if (resp.status !== 200)
    throw new Error(`init_pay returned HTTP ${resp.status}`);

  const { nets_resp } = resp.data || {};
  if (!nets_resp?.req || !nets_resp?.sign) {
    throw new Error("init_pay response missing req or sign");
  }

  return {
    txn_identifier: nets_resp.txn_identifier,
    req: nets_resp.req,
    sign: nets_resp.sign,
  };
}

function buildPayDisplayAddress(meterInfo) {
  if (!meterInfo) return "";

  const premise = meterInfo.premise || {};
  const block = String(premise.block || "").trim();
  const level = String(premise.level || "").trim();
  const unit = String(premise.unit || "").trim();
  const building = String(premise.building || "").trim();

  const head = `${block}, ${level}-${unit} ${building}`.trim();

  const fullAddress = String(meterInfo.address || "").trim();
  const prefix = `Block ${block}, ${level}-${unit} ${building}, `;
  const tail = fullAddress.startsWith(prefix)
    ? fullAddress.slice(prefix.length)
    : fullAddress.replace(/^Block\s+[^,]+,\s*/, "");

  return `${head}, ${tail}`.trim();
}

async function getCreditBalance(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/evs1/get_credit_bal",
    {
      svcClaimDto: {
        username: meterId,
        user_id: null,
        svcName: "oresvc",
        endpoint: "/evs1/get_credit_bal",
        scope: "self",
        target: "meter.credit_balance",
        operation: "read",
      },
      request: {
        meter_displayname: meterId,
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
    },
  );

  if (resp.status !== 200) return null;
  return resp.data?.credit_bal ?? null;
}

// ── Step 2: GET meter info + balance ──────────────────────────────────────────

// ── Step 3a: Build enetspp /pay URL ───────────────────────────────────────────

function buildEnetsPayUrl({ req, sign, username, amount, address }) {
  const amtDisplay = Number(amount).toFixed(2);

  const m = Buffer.from(String(username)).toString("base64");
  const a = Buffer.from(amtDisplay).toString("base64");
  const d = Buffer.from(String(address || "")).toString("base64");

  const innerString = `m=${m}&a=${a}&d=${d}&t=${req}&s=${sign}`;
  const p = Buffer.from(innerString).toString("base64");

  console.log("[pay address]", address);
  console.log("[pay inner]", innerString);
  console.log("[pay url]", `${ENETS_PP_HOST}/pay?p=${p}`);

  return `${ENETS_PP_HOST}/pay?p=${p}`;
}

// ── Step 3b: GET /pay → parse txnReq / keyId / hmac ──────────────────────────

async function fetchNetsFields({ req, sign, username, amount, address }) {
  const payUrl = buildEnetsPayUrl({ req, sign, username, amount, address });

  const ppResp = await axios.get(payUrl, {
    headers: {
      ...DEFAULT_HEADERS,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Upgrade-Insecure-Requests": "1",
      "Sec-Fetch-Site": "same-site",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-User": "?1",
      "Sec-Fetch-Dest": "document",
    },
    validateStatus: () => true,
    maxRedirects: 5,
  });

  if (ppResp.status !== 200) {
    throw new Error(
      `enetspp /pay returned HTTP ${ppResp.status}; body=${String(ppResp.data || "").slice(0, 300)}`,
    );
  }

  const html = String(ppResp.data || "");
  const txnReq = extractHiddenField(html, "txnReq");
  const keyId = extractHiddenField(html, "keyId");
  const hmac = extractHiddenField(html, "hmac");

  if (!txnReq || !keyId || !hmac) {
    throw new Error("Could not extract txnReq / keyId / hmac from /pay page");
  }

  return { txnReq, keyId, hmac, html };
}

// ── Step 3c: POST /GW2/TxnReqListener → RSA key + txnRand ────────────────────

async function callTxnReqListener({ txnReq, keyId, hmac }) {
  let msgObj;
  try {
    msgObj = JSON.parse(txnReq);
  } catch {
    throw new Error("txnReq is not valid JSON: " + txnReq.slice(0, 120));
  }

  const netsResp = await axios.post(
    `${NETS_API_HOST}/GW2/TxnReqListener`,
    JSON.stringify(msgObj),
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/json; charset=UTF-8",
        Accept: "application/json, text/javascript, */*; q=0.01",
        Hmac: hmac,
        Keyid: keyId,
        Origin: ENETS_PP_HOST,
        Referer: ENETS_PP_HOST + "/",
      },
      validateStatus: () => true,
    },
  );

  if (netsResp.status !== 200) {
    throw new Error(`TxnReqListener returned HTTP ${netsResp.status}`);
  }

  const data = netsResp.data || {};
  const msg = data.msg || {};

  const rsaModulus = msg.rsaModulus || null;
  const rsaExponent = msg.rsaExponent || null;

  if (!rsaModulus || !rsaExponent) {
    throw new Error("TxnReqListener did not return RSA key fields");
  }

  const responseHmac = netsResp.headers?.hmac || null;

  return {
    rsaModulus,
    rsaExponent,
    netsTxnRef: msg.netsTxnRef || null,
    netsMid: msg.netsMid || null,
    merchantTxnRef: msg.merchantTxnRef || null,
    txnRand: msg.txnRand || null, // needed for credit/init
    keyId,
    hmac: responseHmac || hmac,
    txnAmount: msg.txnAmount || null,
  };
}

// ── Combined bootstrap flow ───────────────────────────────────────────────────

async function runBootstrap({ txtMtrId, txtAmount }) {
  const debug = {
    step1Status: null,
    step2Status: null,
    step3Status: null,
    stage: null,
  };

  try {
    if (!txtMtrId) throw new Error("Missing txtMtrId");
    if (!txtAmount) throw new Error("Missing txtAmount");

    const amount = Number(String(txtAmount).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error("Invalid txtAmount");

    debug.stage = "init_pay";
    const initResp = await initPay({ username: txtMtrId, amount });
    debug.step1Status = 200;

    const { req, sign, txn_identifier } = initResp;
    // STEP 2
    debug.stage = "meter_info";
    const meterSummary = await getMeterSummary(txtMtrId);
    const payAddress = buildPayDisplayAddress(meterSummary.meter_info);

    if (!payAddress) {
      throw new Error("payAddress is empty");
    }

    debug.step2Status = 200;

    debug.stage = "enetspp_pay";

    console.log("[meterSummary]", meterSummary);

    const { txnReq, keyId, hmac } = await fetchNetsFields({
      req,
      sign,
      username: txtMtrId,
      amount,
      address: payAddress,
    });

    debug.step3Status = 200;

    const netsFields = await callTxnReqListener({ txnReq, keyId, hmac });

    return {
      ok: true,
      meta: {
        txn_identifier,
        meterId: txtMtrId,
        amount,
        address: meterSummary.address || "",
        balance: meterSummary.credit_bal ?? "",
      },
      nets: netsFields,
    };
  } catch (err) {
    return {
      ok: false,
      ...debug,
      error: err.message || "Unknown error",
    };
  }
}

// ── Step 4a: POST /GW2/credit/init ───────────────────────────────────────────
// Establishes the NETS credit session. Returns jsessionId cookie.

async function callCreditInit({ txnRand, keyId, hmac }) {
  const body = new URLSearchParams({
    txnRand,
    paymentMode: "CC_1",
    routeTo: "FEH",
    selectedTokenService: "",
    tsTxnReqFlag: "",
    expiryMonth: "",
    expiryYear: "",
    tsStatus: "",
    tsIntMsg: "",
    tsMerchMsg: "",
  }).toString();

  const resp = await axios.post("https://www2.enets.sg/GW2/credit/init", body, {
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "*/*",
      Origin: ENETS_PP_HOST,
      Referer: ENETS_PP_HOST + "/",
      Hmac: hmac,
      Keyid: keyId,
    },
    validateStatus: () => true,
    maxRedirects: 0,
  });

  // Extract JSESSIONID from Set-Cookie
  const setCookie = [resp.headers["set-cookie"] || []].flat().join("; ");
  const sessionMatch = setCookie.match(/JSESSIONID=([^;]+)/i);
  const jsessionId = sessionMatch ? sessionMatch[1] : null;

  return { jsessionId, status: resp.status };
}

// ── Step 4b: POST /GW2/credit/panSubmitForm ───────────────────────────────────
// Submits RSA-encrypted card. Returns auto-submit form fields for b2s POST.

async function submitPanForm({
  jsessionId,
  txnRand,
  netsMid,
  merchantTxnRef,
  enc,
  name,
  expiryMonth,
  expiryYear,
  consumerEmail,
  imgPayMode = "on",
  browserInfo = {},
}) {
  // expiryYear arrives as 4-digit string ("2027") — pass it through as-is
  const sessionPath = jsessionId ? `;jsessionid=${jsessionId}` : "";

  const body = new URLSearchParams({
    netsMid,
    merchantTxnRef,
    txnRand,
    paymentMode: "CC_1",
    apcData: "",
    browserJavaEnabled: browserInfo.javaEnabled || "false",
    browserJavaScriptEnabled: "true",
    browserLanguage: browserInfo.language || "en-US",
    browserColorDepth: browserInfo.colorDepth || "24",
    browserScreenHeight: browserInfo.screenHeight || "963",
    browserScreenWidth: browserInfo.screenWidth || "1920",
    browserTz: browserInfo.tz || "-480",
    browserUserAgent: browserInfo.userAgent || DEFAULT_HEADERS["User-Agent"],
    enc,
    expiryMonth,
    preExpiryMonth: "",
    preExpiryYear: "",
    selectedTokenService: "",
    tsProcessingCode: "",
    tsReqFlag: "",
    pageId: "payment_page",
    button: "submit",
    txnStepStatus: "",
    netsTxnRef: "",
    gexp: "",
    gmod: "",
    txnAmount: "",
    currencyCode: "",
    tenureSubscriptionId: "",
    paymentType: "CC",
    txnInterface: "SOAPI",
    imgPayMode,
    name,
    selExpiryMonth: expiryMonth,
    expiryYear, // 4-digit, already correct from client
    consumerEmail,
  }).toString();

  const resp = await axios.post(
    `https://www2.enets.sg/GW2/credit/panSubmitForm${sessionPath}`,
    body,
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        Origin: ENETS_PP_HOST,
        Referer: ENETS_PP_HOST + "/",
        ...(jsessionId ? { Cookie: `JSESSIONID=${jsessionId}` } : {}),
      },
      validateStatus: () => true,
      maxRedirects: 5,
    },
  );

  const html = String(resp.data || "");
  const message = extractHiddenField(html, "message");
  const hmac = extractHiddenField(html, "hmac");
  const keyId = extractHiddenField(html, "KeyId");
  const action =
    html.match(
      /<form[^>]*id=["']post_form["'][^>]*action=["']([^"']+)["']/i,
    )?.[1] ||
    html.match(
      /<form[^>]*action=["']([^"']+)["'][^>]*id=["']post_form["']/i,
    )?.[1] ||
    null;

  if (!message) {
    // Try to surface an error message from the page
    const errText =
      html
        .match(/<[^>]*class=["'][^"']*error[^"']*["'][^>]*>\s*([^<]+)/i)?.[1]
        ?.trim() ||
      `panSubmitForm did not return a message field (HTTP ${resp.status})`;
    throw new Error(errText);
  }

  return { message, hmac, keyId, action };
}

// ── Step 4c: POST to b2s → follow redirect to /pay_result ────────────────────

async function postToB2s({ action, message, hmac, keyId }) {
  const b2sUrl = action || "https://p-1.evs.com.sg/enets/b2s";
  const body = new URLSearchParams({ message, hmac, KeyId: keyId }).toString();

  const resp = await axios.post(b2sUrl, body, {
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://www2.enets.sg",
      Referer: "https://www2.enets.sg/",
    },
    validateStatus: () => true,
    maxRedirects: 10,
  });

  const html = String(resp.data || "");
  // axios stores the final URL after redirects here:
  const finalUrl =
    resp.request?.res?.responseUrl || resp.request?.responseURL || "";
  const parsed = parsePayResult(finalUrl, html);

  return { status: resp.status, html, parsed, finalUrl };
}

// ── Parse /pay_result?r=&t=&a=&x=&s=&m= (all base64) ─────────────────────────

function parsePayResult(finalUrl, html) {
  let r, t, a, x, s, m;

  try {
    const u = new URL(finalUrl);
    const b64dec = (v) =>
      v ? Buffer.from(v, "base64").toString("utf8") : null;
    r = b64dec(u.searchParams.get("r")); // 'success' | 'fail'
    t = b64dec(u.searchParams.get("t")); // target / meter id
    a = b64dec(u.searchParams.get("a")); // amount e.g. "6.00"
    x = b64dec(u.searchParams.get("x")); // txn reference
    s = b64dec(u.searchParams.get("s")); // stage resp code
    m = b64dec(u.searchParams.get("m")); // message
  } catch {
    // fall through to HTML scrape
  }

  // Fallback: scrape the rendered HTML
  if (!r) {
    const getText = (label) =>
      html
        .match(new RegExp(label + "[\\s\\S]*?<span>([^<]+)<\\/span>", "i"))?.[1]
        ?.trim() || null;

    r = getText("Transaction Result");
    t = getText("Target");
    a = getText("Amount \\(SGD\\)");
    x = getText("Transaction Reference");
    s = getText("Code");
    m = getText("Transaction Message");

    if (!r) {
      if (/class=["'][^"']*\bsuccess\b/i.test(html)) r = "success";
      else if (/class=["'][^"']*\bfail\b/i.test(html)) r = "fail";
    }
  }

  const isSuccess = String(r || "").toLowerCase() === "success";
  const amtNum = parseFloat(String(a || "0").replace(/[^0-9.]/g, "")) || 0;

  return {
    status: isSuccess ? "success" : "failure",
    merchantTxnRef: x || null,
    meterId: t || null,
    amount: amtNum > 0 ? `S$ ${amtNum.toFixed(2)}` : null,
    stageRespCode: s || null,
    reason: isSuccess ? "Payment completed." : m || "Transaction failed.",
  };
}

// ── Normalise final outcome ───────────────────────────────────────────────────
// Trusts parsed.status directly — only overrides if specific failure keywords
// appear in the reason string when status is ambiguous.

function normalizeFinalOutcome(parsed = {}) {
  const reason = parsed.reason || "Unable to determine transaction outcome.";
  const isFailure =
    parsed.status === "failure" ||
    /rejected by financial institution/i.test(reason) ||
    /failed to purchase/i.test(reason) ||
    /system error/i.test(reason) ||
    /call merchant/i.test(reason);

  return {
    ...parsed,
    status: isFailure ? "failure" : "success",
    reason: isFailure ? reason : "Payment completed.",
  };
}

// ── Card payment page ─────────────────────────────────────────────────────────

function cardPaymentPage({
  n,
  e,
  netsMid,
  netsTxnRef,
  merchantTxnRef,
  amount,
  meterId,
  address = "",
  balance = "",
  txnRand = "",
  keyId = "",
  hmac = "",
}) {
  const amtDisplay = Number(amount || 0).toFixed(2);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Card Payment</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script src="https://www.enets.sg/GW2/js/jsbn.js"></script>
<script src="https://www.enets.sg/GW2/js/prng4.js"></script>
<script src="https://www.enets.sg/GW2/js/rng.js"></script>
<script src="https://www.enets.sg/GW2/js/rsa.js"></script>
<style>
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
    border-radius: 16px; padding: 28px 24px; width: 100%; max-width: 400px; }
  .logo { width: 44px; height: 44px; background: var(--accent-dim);
    border: 1.5px solid var(--accent); border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 20px; margin-bottom: 18px; }
  h1 { font-size: 1.15rem; font-weight: 700; margin-bottom: 4px; }
  .sub { color: var(--muted); font-size: 0.82rem; margin-bottom: 20px; }
  .summary { background: rgba(0,229,160,0.07); border: 1px solid rgba(0,229,160,0.18);
    border-radius: 10px; padding: 10px 14px; margin-bottom: 20px;
    font-size: 0.85rem; display: flex; justify-content: space-between; }
  .summary .val { font-family: var(--mono); color: var(--accent); font-weight: 500; }
  .field { margin-bottom: 14px; }
  label { display: block; font-size: 11px; color: var(--muted);
    text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 5px; }
  input { width: 100%; height: 40px; background: #111; border: 1px solid var(--border);
    border-radius: 9px; color: var(--text); font-size: 15px;
    font-family: var(--mono); padding: 0 12px; outline: none;
    transition: border-color 0.15s; }
  input:focus { border-color: var(--accent); }
  input.error { border-color: var(--error); }
  .row3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .btn { width: 100%; height: 44px; background: var(--accent); color: #000;
    border: none; border-radius: 10px; font-family: var(--sans);
    font-size: 1rem; font-weight: 700; cursor: pointer; margin-top: 6px;
    display: flex; align-items: center; justify-content: center; gap: 8px; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .lock { font-size: 11px; color: var(--muted); text-align: center; margin-top: 10px; }
  .err-msg { font-size: 11px; color: var(--error); margin-top: 4px; display: none; }
  #globalError { background: rgba(255,92,92,0.08); border: 1px solid rgba(255,92,92,0.3);
    border-radius: 10px; padding: 12px 14px; font-size: 0.83rem; color: var(--error);
    margin-top: 14px; display: none; font-family: var(--mono); }
</style>
</head>
<body>
<div class="card">
  <div class="logo">⚡</div>
  <h1>Card payment</h1>
  <p class="sub">Details are RSA-encrypted before leaving your device.</p>

  <div class="summary">
    <span>Meter <span style="font-family:var(--mono)">${escHtml(meterId)}</span></span>
    <span class="val">SGD ${escHtml(amtDisplay)}</span>
  </div>

  <form id="payForm" autocomplete="off" onsubmit="return handleSubmit(event)">
    <div class="field">
      <label>Cardholder name</label>
      <input type="text" id="cardName" placeholder="As printed on card" autocomplete="cc-name" style="font-family:var(--sans)">
      <div class="err-msg" id="errName">Required</div>
    </div>
    <div class="field">
      <label>Email</label>
      <input type="email" id="cardEmail" placeholder="you@example.com" autocomplete="email" style="font-family:var(--sans)">
      <div class="err-msg" id="errEmail">Valid email required</div>
    </div>
    <div class="field">
      <label>Card number</label>
      <input type="tel" id="cardNo" placeholder="•••• •••• •••• ••••" maxlength="19" autocomplete="cc-number" inputmode="numeric">
      <div class="err-msg" id="errCard">Enter a valid card number</div>
    </div>
    <div class="row3">
      <div class="field">
        <label>Month</label>
        <input type="tel" id="expMth" placeholder="MM" maxlength="2" inputmode="numeric">
        <div class="err-msg" id="errMth">01–12</div>
      </div>
      <div class="field">
        <label>Year</label>
        <input type="tel" id="expYr" placeholder="YY" maxlength="2" inputmode="numeric">
        <div class="err-msg" id="errYr">e.g. 27</div>
      </div>
      <div class="field">
        <label>CVV</label>
        <input type="tel" id="cvv" placeholder="•••" maxlength="4" inputmode="numeric">
        <div class="err-msg" id="errCvv">Required</div>
      </div>
    </div>

    <input type="hidden" name="enc"            id="enc">
    <input type="hidden" name="netsMid"        value="${escHtml(netsMid)}">
    <input type="hidden" name="netsTxnRef"     value="${escHtml(netsTxnRef)}">
    <input type="hidden" name="txnRand"        value="${escHtml(txnRand)}">
    <input type="hidden" name="keyId"          value="${escHtml(keyId)}">
    <input type="hidden" name="hmac"           value="${escHtml(hmac)}">

    <button type="submit" class="btn" id="submitBtn">
      <span id="btnLabel">Pay SGD ${escHtml(amtDisplay)}</span>
    </button>
    <p class="lock">🔒 eNETS RSA-encrypted · Powered by eNETS</p>
    <div id="globalError"></div>
  </form>
</div>

<script>
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  const RSA_N          = ${JSON.stringify(n)};
  const RSA_E          = ${JSON.stringify(e)};
  const MERCHANT_TXN_REF = ${JSON.stringify(merchantTxnRef)};
  const amtDisplay     = ${JSON.stringify(amtDisplay)};

  function linebrk(str, maxLen) {
    let out = '', i = 0;
    while (i + maxLen < str.length) { out += str.substring(i, i + maxLen) + '\\n'; i += maxLen; }
    return out + str.substring(i);
  }

  function autoNext(curId, nextId, maxLen) {
    document.getElementById(curId).addEventListener('input', function() {
      if (this.value.replace(/\\D/g,'').length >= maxLen) document.getElementById(nextId)?.focus();
    });
  }
  function autoBack(curId, prevId) {
    document.getElementById(curId).addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && !this.value) {
        const prev = document.getElementById(prevId);
        prev?.focus();
        const len = prev?.value?.length ?? 0;
        prev?.setSelectionRange?.(len, len);
      }
    });
  }

  function setError(inputId, errId, msg) {
    document.getElementById(inputId).classList.add('error');
    const em = document.getElementById(errId);
    if (msg) em.textContent = msg;
    em.style.display = 'block';
  }
  function clearError(inputId, errId) {
    document.getElementById(inputId).classList.remove('error');
    document.getElementById(errId).style.display = 'none';
  }

  function validate() {
    ['cardName','cardEmail','cardNo','expMth','expYr','cvv'].forEach((id,i) =>
      clearError(id, ['errName','errEmail','errCard','errMth','errYr','errCvv'][i]));
    let ok = true;
    const name = document.getElementById('cardName').value.trim();
    const email = document.getElementById('cardEmail').value.trim();
    const card  = document.getElementById('cardNo').value.replace(/\\s/g,'');
    const mth   = document.getElementById('expMth').value.trim();
    const yr    = document.getElementById('expYr').value.trim();
    const cvv   = document.getElementById('cvv').value.trim();
    if (!name)  { setError('cardName','errName','Required'); ok = false; }
    if (!email || !/^[^@]+@[^@]+\\.[^@]+$/.test(email)) { setError('cardEmail','errEmail','Valid email required'); ok = false; }
    if (!card || card.length < 13 || card.length > 19 || !/^\\d+$/.test(card)) { setError('cardNo','errCard','Enter a valid card number'); ok = false; }
    const mInt = parseInt(mth, 10);
    if (!mth || isNaN(mInt) || mInt < 1 || mInt > 12) { setError('expMth','errMth','01–12'); ok = false; }
    if (!yr || yr.length !== 2 || !/^\\d{2}$/.test(yr)) { setError('expYr','errYr','2-digit year'); ok = false; }
    if (!cvv || cvv.length < 3 || !/^\\d+$/.test(cvv)) { setError('cvv','errCvv','3–4 digits'); ok = false; }
    return ok ? { name, email, card, mth: mth.padStart(2,'0'), yr, cvv } : null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    document.getElementById('globalError').style.display = 'none';
    const fields = validate();
    if (!fields) return false;

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    document.getElementById('btnLabel').textContent = 'Encrypting…';

    try {
      var rsa = new RSAKey();
      rsa.setPublic(RSA_N, RSA_E);
      var res = rsa.encrypt('cardNo=' + fields.card + ',cvv=' + fields.cvv);
      if (!res) throw new Error('RSA encryption failed');
      var enc = 'RSA' + linebrk(res, 2048);

      // Read hidden fields from the form DOM (set server-side)
      const txnRand  = document.querySelector('input[name=txnRand]').value;
      const keyId    = document.querySelector('input[name=keyId]').value;
      const hmacVal  = document.querySelector('input[name=hmac]').value;
      const netsMid  = document.querySelector('input[name=netsMid]').value;
      const netsTxnRef = document.querySelector('input[name=netsTxnRef]').value;

      const payload = new URLSearchParams({
        browserJavaEnabled:       'false',
        browserJavaScriptEnabled: 'true',
        browserLanguage:          navigator.language || 'en-US',
        browserColorDepth:        String(screen.colorDepth || 24),
        browserScreenHeight:      String(window.innerHeight),
        browserScreenWidth:       String(window.innerWidth),
        browserTz:                String(new Date().getTimezoneOffset()),
        browserUserAgent:         navigator.userAgent,
        enc,
        netsMid,
        netsTxnRef,
        merchantTxnRef: MERCHANT_TXN_REF,
        txnRand,
        keyId,
        hmac:           hmacVal,
        currencyCode:   'SGD',
        txnAmount:      String(Math.round(${JSON.stringify(Number(amount))} * 100)),
        name:           fields.name,
        expiryMonth:    fields.mth,
        imgPayMode: 'on',
        expiryYear:     '20' + fields.yr,   // 4-digit: server uses as-is
        consumerEmail:  fields.email,
        meterId:        ${JSON.stringify(meterId)},
        address:        ${JSON.stringify(address)},
        balance:        ${JSON.stringify(balance)},
        amount:         'S$ ' + amtDisplay,
      });

      document.getElementById('btnLabel').textContent = 'Processing…';

      const result = await fetch('/webapp/enets_pay', {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body:    payload.toString(),
      });

      const out = await result.json().catch(() => ({}));
      if (!result.ok || !out.ok) throw new Error(out.error || 'Payment request failed');

      const q = new URLSearchParams({
        status:  out.status          || 'unknown',
        ref:     out.merchantTxnRef  || MERCHANT_TXN_REF || '',
        meterId: out.meterId         || ${JSON.stringify(meterId)},
        amount:  out.amount          || ('SGD ' + amtDisplay),
        reason:  out.reason          || '',
        address: out.address         || ${JSON.stringify(address)},
        balance: ${JSON.stringify(balance)},
      }).toString();

      window.location.href = '/webapp/result?' + q;

    } catch (err) {
      btn.disabled = false;
      document.getElementById('btnLabel').textContent = 'Pay SGD ' + amtDisplay;
      const ge = document.getElementById('globalError');
      ge.textContent = '⚠️ ' + (err.message || 'Encryption error');
      ge.style.display = 'block';
    }
    return false;
  }

  document.getElementById('cardNo').addEventListener('input', function() {
    let v = this.value.replace(/\\D/g,'').substring(0,16);
    this.value = v.replace(/(\\d{4})(?=\\d)/g,'$1 ');
  });

  autoNext('expMth', 'expYr', 2);
  autoNext('expYr',  'cvv',   2);
  autoBack('expYr',  'expMth');
  autoBack('cvv',    'expYr');
</script>
</body>
</html>`;
}

// ── Result page ───────────────────────────────────────────────────────────────

function renderFinalResultPage(parsed) {
  const ok = parsed.status === "success";
  const title = ok ? "Top-Up Successful" : "Top-Up Failed";
  const reason = parsed.reason || "Unable to determine transaction outcome.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(title)}</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');
  :root { --bg:#0d0d0d;--surface:#161616;--border:#2a2a2a;--accent:#00e5a0;
    --accent-dim:rgba(0,229,160,0.12);--text:#f0f0f0;--muted:#888;--error:#ff5c5c;
    --mono:'DM Mono',monospace;--sans:'DM Sans',sans-serif; }
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
    padding:32px 28px;width:100%;max-width:400px;text-align:center;}
  .logo{width:52px;height:52px;background:${ok ? "var(--accent-dim)" : "rgba(255,92,92,0.12)"};
    border:1.5px solid ${ok ? "var(--accent)" : "var(--error)"};border-radius:14px;
    display:flex;align-items:center;justify-content:center;margin:0 auto 24px;font-size:24px;}
  h1{margin:0 0 8px;font-size:1.25rem;}
  .subtitle{color:var(--muted);font-size:0.9rem;margin-bottom:24px;}
  .detail-row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;
    border-bottom:1px solid var(--border);font-size:0.9rem;}
  .detail-row:last-of-type{border-bottom:none;}
  .detail-label{color:var(--muted);}
  .detail-value{color:${ok ? "var(--accent)" : "var(--text)"};font-family:var(--mono);
    font-weight:500;text-align:right;max-width:58%;word-break:break-word;}
  .status-note{margin-top:22px;padding:14px;border-radius:12px;font-size:0.9rem;
    background:${ok ? "rgba(0,229,160,0.08)" : "rgba(255,92,92,0.08)"};
    border:1px solid ${ok ? "rgba(0,229,160,0.22)" : "rgba(255,92,92,0.25)"};
    color:${ok ? "var(--accent)" : "var(--error)"};}
  .actions{margin-top:20px;display:grid;gap:10px;}
  .btn{width:100%;border:none;border-radius:10px;padding:12px 16px;
    font-family:var(--sans);font-size:0.95rem;font-weight:700;cursor:pointer;
    background:${ok ? "var(--accent)" : "#2a2a2a"};color:${ok ? "#000" : "#fff"};}
  .btn.secondary{background:#242424;color:#fff;}
</style>
</head>
<body>
<div class="card">
  <div class="logo">${ok ? "✅" : "⚠️"}</div>
  <h1>${escHtml(title)}</h1>
  <div class="subtitle">${ok ? "Your transaction has been processed." : "Your transaction was not completed."}</div>
  <div class="detail-row"><span class="detail-label">Reference</span><span class="detail-value">${escHtml(parsed.merchantTxnRef || "-")}</span></div>
  <div class="detail-row"><span class="detail-label">Meter ID</span><span class="detail-value">${escHtml(parsed.meterId || "-")}</span></div>
  ${parsed.address ? `<div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${escHtml(parsed.address)}</span></div>` : ""}
  ${
    parsed.balance !== undefined &&
    parsed.balance !== null &&
    parsed.balance !== ""
      ? `<div class="detail-row"><span class="detail-label">Balance</span><span class="detail-value">SGD ${escHtml(Number(parsed.balance).toFixed(2))}</span></div>`
      : ""
  }
  <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">${escHtml(parsed.amount || "-")}</span></div>
  <div class="status-note">${escHtml(reason)}</div>
  <div class="actions">
    <button class="btn" onclick="window.location.href='/webapp?txtMtrId=${encodeURIComponent(parsed.meterId || "")}&txtAmount=${encodeURIComponent((parsed.amount || "").replace(/[^0-9.]/g, ""))}'" >Top Up Again</button>
    <button class="btn secondary" onclick="window.Telegram?.WebApp?.close()">Close</button>
  </div>
</div>
</body>
</html>`;
}

// ── Loading page ──────────────────────────────────────────────────────────────

function loadingPage(txtMtrId, txtAmount, meterInfo = {}) {
  const amtDisplay = Number(txtAmount).toFixed(2);
  const balanceDisplay =
    meterInfo.credit_bal !== undefined && meterInfo.credit_bal !== null
      ? Number(meterInfo.credit_bal).toFixed(2)
      : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EVS (cp2nus) Payment</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
  :root{--bg:#0d0d0d;--surface:#161616;--border:#2a2a2a;--accent:#00e5a0;
    --accent-dim:rgba(0,229,160,0.12);--text:#f0f0f0;--muted:#888;--error:#ff5c5c;
    --mono:'DM Mono',monospace;--sans:'DM Sans',sans-serif;}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);min-height:100vh;
    display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:16px;
    padding:32px 28px;width:100%;max-width:380px;text-align:center;}
  .logo{width:52px;height:52px;background:var(--accent-dim);border:1.5px solid var(--accent);
    border-radius:14px;display:flex;align-items:center;justify-content:center;
    margin:0 auto 24px;font-size:24px;}
  h1{font-size:1.25rem;font-weight:700;letter-spacing:-0.02em;margin-bottom:6px;}
  .subtitle{color:var(--muted);font-size:0.85rem;margin-bottom:28px;}
  .detail-row{display:flex;justify-content:space-between;align-items:center;
    padding:10px 0;border-bottom:1px solid var(--border);font-size:0.875rem;}
  .detail-row:last-of-type{border-bottom:none;}
  .detail-label{color:var(--muted);}
  .detail-value{font-family:var(--mono);font-weight:500;color:var(--accent);
    max-width:58%;text-align:right;word-break:break-word;}
  .spinner-wrap{margin:32px 0 16px;display:flex;flex-direction:column;align-items:center;gap:14px;}
  .spinner{width:36px;height:36px;border:2.5px solid var(--border);
    border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;}
  @keyframes spin{to{transform:rotate(360deg);}}
  .status-text{color:var(--muted);font-size:0.82rem;font-family:var(--mono);min-height:1.2em;}
  .error-card{background:rgba(255,92,92,0.08);border:1px solid rgba(255,92,92,0.3);
    border-radius:12px;padding:16px;margin-top:20px;font-size:0.83rem;color:var(--error);
    display:none;text-align:left;font-family:var(--mono);line-height:1.5;}
  .retry-btn{margin-top:16px;background:var(--accent);color:#000;border:none;
    border-radius:10px;padding:12px 24px;font-family:var(--sans);font-weight:700;
    font-size:0.9rem;cursor:pointer;display:none;width:100%;}
</style>
</head>
<body>
<div class="card">
  <div class="logo">⚡</div>
  <h1>Electricity Top-Up</h1>
  <p class="subtitle">Connecting to payment gateway…</p>

  <div class="detail-row">
    <span class="detail-label">Meter ID</span>
    <span class="detail-value">${escHtml(txtMtrId)}</span>
  </div>
  ${meterInfo.address ? `<div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${escHtml(meterInfo.address)}</span></div>` : ""}
  ${balanceDisplay !== null ? `<div class="detail-row"><span class="detail-label">Current Balance</span><span class="detail-value">SGD ${escHtml(balanceDisplay)}</span></div>` : ""}
  <div class="detail-row">
    <span class="detail-label">Amount</span>
    <span class="detail-value">SGD ${escHtml(amtDisplay)}</span>
  </div>

  <div class="spinner-wrap" id="spinnerWrap">
    <div class="spinner"></div>
    <div class="status-text" id="statusText">Initialising…</div>
  </div>

  <div class="error-card" id="errorCard"></div>
  <button class="retry-btn" id="retryBtn" onclick="runFlow()">Try Again</button>
</div>

<script>
  const tg = window.Telegram?.WebApp;
  if (tg) { tg.ready(); tg.expand(); }

  const METER_ID   = ${JSON.stringify(txtMtrId)};
  const TXN_AMOUNT = ${JSON.stringify(txtAmount)};

  async function runFlow() {
    document.getElementById('errorCard').style.display   = 'none';
    document.getElementById('retryBtn').style.display    = 'none';
    document.getElementById('spinnerWrap').style.display = 'flex';
    document.getElementById('statusText').textContent    = 'Initialising…';

    try {
      document.getElementById('statusText').textContent = 'Creating transaction…';

      const resp = await fetch(
        '/webapp/bootstrap?txtMtrId=' + encodeURIComponent(METER_ID) +
        '&txtAmount=' + encodeURIComponent(TXN_AMOUNT)
      );
      const out = await resp.json().catch(() => ({}));

      if (!resp.ok || !out.ok) throw new Error(out.error || 'Failed to initialise payment');
      if (!out.redirectUrl)    throw new Error('Missing redirect URL from bootstrap');

      window.location.href = out.redirectUrl;
    } catch (err) {
      document.getElementById('spinnerWrap').style.display = 'none';
      const ec = document.getElementById('errorCard');
      ec.textContent   = '⚠️ ' + (err.message || 'Unknown error');
      ec.style.display = 'block';
      document.getElementById('retryBtn').style.display = 'block';
    }
  }

  runFlow();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── Main webapp entry ─────────────────────────────────────────────────────────

app.get("/webapp", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;
  if (!txtMtrId || !txtAmount)
    return res.status(400).send(errorPage("Missing meter ID or amount."));

  try {
    const meterSummary = await getMeterSummary(txtMtrId);
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.send(loadingPage(txtMtrId, txtAmount, meterSummary));
  } catch {
    res.setHeader("Content-Type", "text/html; charset=UTF-8");
    return res.send(loadingPage(txtMtrId, txtAmount, {}));
  }
});

// ── Bootstrap: runs all steps, returns redirect URL to /webapp/pay ─────────────

app.get("/webapp/bootstrap", async (req, res) => {
  const { txtMtrId, txtAmount } = req.query;

  if (!txtMtrId || !txtAmount) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing meter ID or amount." });
  }

  try {
    const boot = await runBootstrap({ txtMtrId, txtAmount });

    if (!boot.ok) {
      return res.status(500).json(boot);
    }

    const params = new URLSearchParams({
      txtMtrId,
      txtAmount,
      address: boot.meta.address || "",
      balance: String(boot.meta.balance ?? ""),
      n: boot.nets.rsaModulus || "",
      e: boot.nets.rsaExponent || "",
      netsMid: boot.nets.netsMid || "",
      netsTxnRef: boot.nets.netsTxnRef || "",
      merchantTxnRef: boot.nets.merchantTxnRef || "",
      txnRand: boot.nets.txnRand || "",
      keyId: boot.nets.keyId || "",
      hmac: boot.nets.hmac || "",
    });

    return res.status(200).json({
      ok: true,
      redirectUrl: "/webapp/pay?" + params.toString(),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      stage: err.stage || "unknown",
      step1Status: err.step1Status,
      step2Status: err.step2Status,
      step3Status: err.step3Status,
      error: err.error || err.message,
    });
  }
});

// ── Card payment page ─────────────────────────────────────────────────────────

app.get("/webapp/pay", (req, res) => {
  const {
    txtMtrId,
    txtAmount,
    address = "",
    balance = "",
    n,
    e,
    netsMid,
    netsTxnRef,
    merchantTxnRef,
    txnRand = "",
    keyId = "",
    hmac = "",
  } = req.query;

  if (!txtMtrId || !txtAmount || !n || !e || !netsMid || !netsTxnRef) {
    return res
      .status(400)
      .send(errorPage("Missing required payment parameters."));
  }

  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  return res.send(
    cardPaymentPage({
      n,
      e,
      netsMid,
      netsTxnRef,
      merchantTxnRef: merchantTxnRef || "",
      amount: txtAmount,
      meterId: txtMtrId,
      address,
      balance,
      txnRand,
      keyId,
      hmac,
    }),
  );
});

// ── eNETS pay proxy ───────────────────────────────────────────────────────────

app.post(
  "/webapp/enets_pay",
  express.urlencoded({ extended: false, limit: "10mb" }),
  async (req, res) => {
    try {
      const {
        enc,
        netsMid,
        netsTxnRef,
        merchantTxnRef,
        txnRand,
        name,
        expiryMonth,
        expiryYear,
        consumerEmail,
        imgPayMode,
        browserJavaEnabled,
        browserLanguage,
        browserColorDepth,
        browserScreenHeight,
        browserScreenWidth,
        browserTz,
        browserUserAgent,
        keyId: reqKeyId,
        hmac: reqHmac,
        meterId,
        address,
        balance,
        amount,
      } = req.body;

      if (!enc || !netsMid || !merchantTxnRef) {
        return res.status(400).json({
          ok: false,
          error: "Missing required fields (enc, netsMid, merchantTxnRef)",
        });
      }

      const browserInfo = {
        javaEnabled: browserJavaEnabled || "false",
        language: browserLanguage || "en-US",
        colorDepth: browserColorDepth || "24",
        screenHeight: browserScreenHeight || "963",
        screenWidth: browserScreenWidth || "1920",
        tz: browserTz || "-480",
        userAgent: browserUserAgent || DEFAULT_HEADERS["User-Agent"],
      };

      // Step 4a: establish credit session
      const { jsessionId } = await callCreditInit({
        txnRand: txnRand || "",
        keyId: reqKeyId || "",
        hmac: reqHmac || "",
      });

      // Step 4b: submit RSA-encrypted card data
      // expiryYear arrives as 4-digit string ("2027") — pass through as-is
      const panResult = await submitPanForm({
        jsessionId,
        txnRand: txnRand || "",
        netsMid,
        merchantTxnRef,
        enc,
        name: name || "",
        expiryMonth: expiryMonth || "",
        expiryYear: expiryYear || "",
        consumerEmail: consumerEmail || "",
        imgPayMode: imgPayMode || "on",
        browserInfo,
      });

      // Step 4c: POST auto-submit form to b2s, follow redirect to /pay_result
      const b2sResult = await postToB2s({
        action: panResult.action,
        message: panResult.message,
        hmac: panResult.hmac,
        keyId: panResult.keyId,
      });

      const parsed = b2sResult.parsed || {};
      const normalized = normalizeFinalOutcome(parsed);
      const finalAmount = parsed.amount || amount || "";

      return res.status(200).json({
        ok: true,
        source: "pay_result",
        status: normalized.status,
        merchantTxnRef: normalized.merchantTxnRef || merchantTxnRef || "",
        meterId: normalized.meterId || meterId || "",
        address: address || "",
        balance: balance || "",
        amount: finalAmount,
        reason: normalized.reason,
        stageRespCode: parsed.stageRespCode || "",
        upstreamStatus: { b2s: b2sResult.status, finalUrl: b2sResult.finalUrl },
      });
    } catch (err) {
      console.error("[enets_pay]", err.message);
      return res.status(500).json({ ok: false, error: err.message });
    }
  },
);

// ── Result page ───────────────────────────────────────────────────────────────

app.get("/webapp/result", (req, res) => {
  const {
    status = "unknown",
    ref = "",
    meterId = "",
    amount = "",
    reason = "",
    address = "",
    balance = "",
  } = req.query;

  res.setHeader("Content-Type", "text/html; charset=UTF-8");
  return res.send(
    renderFinalResultPage({
      status,
      merchantTxnRef: ref,
      meterId,
      amount,
      reason,
      address,
      balance,
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────────

app.listen(3001, () => console.log("Server running on http://localhost:3001"));
