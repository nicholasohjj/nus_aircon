const axios = require("axios");
const {
  DEFAULT_HEADERS,
  EVS_API_BASE,
  ENETS_PP_HOST,
  NETS_API_HOST,
} = require("./config");
const { extractHiddenField } = require("./utils");
const { isCp2Meter } = require("./cp2Service");
const { isValidAmount, isValidMeterId } = require("./validators");
const { getMeterSummary } = require("./ore");
const FIXED_USER_ID = "5771";

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

function buildEnetsPayUrl({ req, sign, username, amount, address }) {
  const amtDisplay = Number(amount).toFixed(2);

  const m = Buffer.from(String(username)).toString("base64");
  const a = Buffer.from(amtDisplay).toString("base64");
  const d = Buffer.from(String(address || "")).toString("base64");

  const innerString = `m=${m}&a=${a}&d=${d}&t=${req}&s=${sign}`;
  const p = Buffer.from(innerString).toString("base64");

  return `${ENETS_PP_HOST}/pay?p=${p}`;
}

async function fetchEnvJsp() {
  const resp = await axios.get(
    "https://www2.enets.sg/GW2/pluginpages/env.jsp",
    {
      headers: {
        ...DEFAULT_HEADERS,
        Accept: "*/*",
        "Sec-Fetch-Site": "cross-site",
        "Sec-Fetch-Mode": "no-cors",
        "Sec-Fetch-Dest": "script",
        Referer: ENETS_PP_HOST + "/",
      },
      validateStatus: () => true,
    },
  );

  const setCookie = [resp.headers["set-cookie"] || []].flat().join("; ");
  const sessionMatch = setCookie.match(/JSESSIONID=([^;]+)/i);
  return sessionMatch ? sessionMatch[1] : null;
}

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

  // paymtSvcInfoList[0].netsMid (e.g. "807574000") is the acquiring MID
  // used by panSubmitForm — distinct from top-level netsMid ("UMID_807572000")
  const paymtNetsMid =
    Array.isArray(msg.paymtSvcInfoList) && msg.paymtSvcInfoList.length > 0
      ? msg.paymtSvcInfoList[0].netsMid || null
      : null;

  return {
    rsaModulus,
    rsaExponent,
    netsTxnRef: msg.netsTxnRef || null,
    netsMid: msg.netsMid || null, // UMID_xxxxxx  (top-level)
    paymtNetsMid: paymtNetsMid, // 807574000    (panSubmitForm)
    merchantTxnRef: msg.merchantTxnRef || null,
    txnRand: msg.txnRand || null,
    routeTo: msg.routeTo || "FEH", // read from response, not hardcoded
    stageRespCode: msg.stageRespCode || null,
    keyId: msg.apiKey || keyId, // prefer apiKey from response body
    hmac: responseHmac || hmac, // response hmac differs from request
    txnAmount: msg.txnAmount || null,
  };
}

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

    if (!isValidMeterId(txtMtrId)) {
      return {
        ok: false,
        ...debug,
        code: "INVALID_METER_ID",
        error: "Meter ID must be exactly 8 digits.",
      };
    }

    const amount = Number(String(txtAmount).replace(/[^0-9.]/g, ""));
    if (!isValidAmount(txtAmount))
      return {
        ok: false,
        ...debug,
        code: "INVALID_AMOUNT",
        error: "Amount must be between $6.00 and $50.00.",
      };

    debug.stage = "meter_system_check";
    let cp2Check = false;

    try {
      cp2Check = await isCp2Meter(txtMtrId);
    } catch (checkErr) {
      // Network failure during check — log and proceed rather than block
      console.warn(
        "[meter_system_check] check request failed, proceeding:",
        checkErr.message,
      );
    }
    if (cp2Check.ok) {
      return {
        ok: false,
        ...debug,
        code: "WRONG_SYSTEM",
        error:
          "This meter belongs to the CP2 system and cannot be topped up here. " +
          "Please use the CP2 portal instead.",
      };
    }

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

async function callCreditInit({ txnRand, keyId, hmac, jsessionId }) {
  const sessionPath = jsessionId ? `;jsessionid=${jsessionId}` : ""; // ← add this

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

  const resp = await axios.post(
    `https://www2.enets.sg/GW2/credit/init${sessionPath}`,
    body,
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "*/*",
        Origin: ENETS_PP_HOST,
        Referer: ENETS_PP_HOST + "/",
        Hmac: hmac,
        Keyid: keyId,
        ...(jsessionId ? { Cookie: `JSESSIONID=${jsessionId}` } : {}),
      },
      validateStatus: () => true,
      maxRedirects: 0,
    },
  );

  // Extract JSESSIONID from Set-Cookie
  const setCookie = [resp.headers["set-cookie"] || []].flat().join("; ");
  const sessionMatch = setCookie.match(/JSESSIONID=([^;]+)/i);
  const returnedSession = sessionMatch ? sessionMatch[1] : jsessionId;

  return { jsessionId: returnedSession, status: resp.status };
}

async function submitPanForm({
  jsessionId,
  txnRand,
  netsMid,
  netsTxnRef,
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
    netsTxnRef,
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
    `https://www2.enets.sg/GW2/credit/panSubmitForm`,
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

  let preParsed = null;
  try {
    const msgObj = JSON.parse(decodeURIComponent(message));
    const status = msgObj?.msg?.netsTxnStatus;
    const msg = msgObj?.msg || {};

    if (status === "1" || msgObj?.ss === "0") {
      preParsed = {
        status: "failure",
        merchantTxnRef: msg.merchantTxnRef || null,
        meterId: null,
        amount: null,
        stageRespCode: msg.stageRespCode || null,
        reason: (msg.netsTxnMsg || "Payment declined.").replace(/\+/g, " "),
      };
    } else if (status === "0") {
      // Approved — bank has authorised, no need to hit b2s
      const amtDeducted = msg.netsAmountDeducted;
      const amtFormatted =
        amtDeducted > 0 ? `S$ ${(amtDeducted / 100).toFixed(2)}` : null;
      preParsed = {
        status: "success",
        merchantTxnRef: msg.merchantTxnRef || null,
        meterId: null,
        amount: amtFormatted,
        stageRespCode: msg.stageRespCode || null,
        reason: "Payment completed.",
      };
    }
  } catch {}
  return { message, hmac, keyId, action, preParsed };
}

async function postToB2s({ action, message, hmac, keyId, jsessionId }) {
  const b2sUrl = action || "https://p-1.evs.com.sg/enets/b2s";

  const safeMessage = message.replace(/\+/g, "%2B");

  const body =
    `message=${safeMessage}` +
    `&hmac=${encodeURIComponent(hmac)}` +
    `&KeyId=${encodeURIComponent(keyId)}`;

  const resp = await axios.post(b2sUrl, body, {
    headers: {
      ...DEFAULT_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "Upgrade-Insecure-Requests": "1",
      Origin: "https://www2.enets.sg",
      Referer: "https://www2.enets.sg/",
      "Sec-Fetch-Site": "cross-site",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Dest": "document",
      ...(jsessionId ? { Cookie: `JSESSIONID=${jsessionId}` } : {}),
    },
    validateStatus: () => true,
    maxRedirects: 0,
  });

  const locationHeader = resp.headers?.location || "";
  const responseBody = String(resp.data || "");

  if (resp.status === 303 || (resp.status >= 301 && resp.status <= 308)) {
    const finalUrl = locationHeader.startsWith("http")
      ? locationHeader
      : locationHeader
        ? `https://enetspp-nus-live.evs.com.sg${locationHeader}`
        : "";

    const parsed = parsePayResult(finalUrl, "");
    return { status: resp.status, html: "", parsed, finalUrl };
  }

  const scrapedReason =
    responseBody
      .match(/<[^>]*class=["'][^"']*error[^"']*["'][^>]*>\s*([^<]+)/i)?.[1]
      ?.trim() ||
    responseBody.match(/<p[^>]*>\s*([^<]{10,200})\s*<\/p>/i)?.[1]?.trim() ||
    responseBody.match(/<title[^>]*>\s*([^<]+)\s*<\/title>/i)?.[1]?.trim() ||
    `b2s returned HTTP ${resp.status} without redirect`;

  return {
    status: resp.status,
    html: responseBody,
    parsed: {
      status: "failure",
      merchantTxnRef: null,
      meterId: null,
      amount: null,
      stageRespCode: null,
      reason: scrapedReason,
    },
    finalUrl: "",
  };
}

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

module.exports = {
  initPay,
  buildPayDisplayAddress,
  buildEnetsPayUrl,
  fetchEnvJsp,
  fetchNetsFields,
  callTxnReqListener,
  runBootstrap,
  callCreditInit,
  submitPanForm,
  postToB2s,
  parsePayResult,
};
