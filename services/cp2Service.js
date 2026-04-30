const {
  classifyLoginResponse,
  parseEvsTransactionSummary,
  extractMerchantTxnRef,
  classifySelectOfferResponse,
  extractEnetsMessage,
  extractHiddenField,
  isRedirectStatus,
  resolveUpstreamLocation,
  htmlDecode,
} = require("./utils");
const { isValidAmount, isValidMeterId } = require("../services/validators");
const {
  WEBPOS_HEADERS,
  CP2_WEBPOS_BASE,
  DEFAULT_HEADERS,
} = require("./config");
const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");
const qs = require("querystring");

async function isCp2Meter(meterId) {
  const loginForm = qs.stringify({
    txtMtrId: String(meterId).trim(),
  });

  const resp = await axios.post(
    `${CP2_WEBPOS_BASE}/EVSWebPOS/loginServlet`,
    loginForm,
    {
      headers: {
        ...WEBPOS_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: CP2_WEBPOS_BASE,
        Referer: `${CP2_WEBPOS_BASE}/EVSWebPOS/`,
      },
      timeout: 15000,
      validateStatus: () => true,
    },
  );

  if (resp.status !== 200) {
    return {
      ok: false,
      result: "http_error",
      status: resp.status,
    };
  }

  const result = classifyLoginResponse(resp.data);

  return {
    ok: result === "valid",
    result,
    status: resp.status,
  };
}

async function runPurchaseFlow({ txtMtrId, txtAmount }) {
  const result = { ok: false, stage: "init" };

  if (!txtMtrId) return { ...result, error: "Missing txtMtrId" };
  if (txtAmount === undefined || txtAmount === null || txtAmount === "")
    return { ...result, error: "Missing txtAmount" };

  if (!isValidMeterId(txtMtrId)) {
    return { ...result, error: "Meter ID must be exactly 8 digits." };
  }

  if (!isValidAmount(txtAmount)) {
    return { ...result, error: "Amount must be between $6.00 and $50.00." };
  }

  const cleanedAmount = String(txtAmount).replace(/[^0-9.]/g, "");
  const amountDollars = Number(cleanedAmount);
  if (!Number.isFinite(amountDollars) || amountDollars <= 0) {
    return { ...result, error: "Invalid txtAmount" };
  }

  const amountCents = Math.round(amountDollars * 100);
  const { client, jar } = await createClient();

  result.stage = "evs_home";
  const step1 = await client.get(`${CP2_WEBPOS_BASE}/EVSWebPOS/`);

  result.stage = "login";
  const loginForm = new URLSearchParams({
    txtMtrId: String(txtMtrId),
    btnLogin: "Submit",
    radRetail: "1",
  }).toString();

  const step2 = await client.post(
    `${CP2_WEBPOS_BASE}/EVSWebPOS/loginServlet`,
    loginForm,
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );

  const loginResult = classifyLoginResponse(step2.data);
  if (loginResult !== "valid") {
    const cookies = await jar.getCookies(CP2_WEBPOS_BASE + "/EVSWebPOS/");
    return {
      ok: false,
      stage: "login",
      step1Status: step1.status,
      step2Status: step2.status,
      loginResult,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
    };
  }

  result.stage = "select_offer";
  const selectForm = new URLSearchParams({
    isDedicated: "0",
    hidMinPur: "1",
    hidMaxPur: "500",
    hidSelected: "",
    txtAmount: String(amountDollars),
    btnProceed: "Proceed",
    btnCancel: "Cancel",
  }).toString();

  const step3 = await client.post(
    `${CP2_WEBPOS_BASE}/EVSWebPOS/selectOfferServlet`,
    selectForm,
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    },
  );

  const selectResult = classifySelectOfferResponse(step3.data);
  const cookies = await jar.getCookies(CP2_WEBPOS_BASE + "/EVSWebPOS/");

  if (selectResult !== "success") {
    return {
      ok: false,
      stage: "select_offer",
      step1Status: step1.status,
      step2Status: step2.status,
      step3Status: step3.status,
      loginResult,
      selectResult,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
      preview: {
        loginTitle:
          String(step2.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        selectTitle:
          String(step3.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
      },
    };
  }

  result.stage = "payment_servlet";

  const step4 = await getFollowRedirects(
    client,
    `${CP2_WEBPOS_BASE}/EVSWebPOS/paymentServlet`,
    {
      params: { mode: "0", isDedicated: "1" },
      headers: {
        ...DEFAULT_HEADERS,
        Referer: `${CP2_WEBPOS_BASE}/EVSWebPOS/selectOfferServlet`,
      },
    },
  );

  const merchant_txn_ref = extractMerchantTxnRef(step4.data);
  if (!merchant_txn_ref) {
    return {
      ok: false,
      stage: "payment_servlet",
      step1Status: step1.status,
      step2Status: step2.status,
      step3Status: step3.status,
      step4Status: step4.status,
      loginResult,
      selectResult,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
      error: "merchant_txn_ref not found in paymentServlet HTML",
      upstream: {
        paymentTitle:
          String(step4.data).match(/<title>(.*?)<\/title>/i)?.[1] || null,
        paymentContentType: step4.headers?.["content-type"] || null,
        paymentLocation: step4.headers?.location || null,
        paymentPreview: String(step4.data || "").slice(0, 800),
      },
    };
  }

  result.stage = "creditpayment";

  const formBody = new URLSearchParams({
    amt: amountDollars.toFixed(2),
    payment_mode: "CC",
    txn_amount: String(amountCents),
    currency_code: "SGD",
    merchant_txn_ref: String(merchant_txn_ref),
    submission_mode: "B",
    payment_type: "SALE",
  }).toString();

  const step5 = await axios.post(
    "http://120.50.44.233/payment/creditpayment.jsp",
    formBody,
    {
      headers: {
        ...DEFAULT_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      validateStatus: () => true,
    },
  );

  const enetsMessage = extractEnetsMessage(step5.data);
  if (!enetsMessage) {
    return {
      ok: false,
      stage: "enets_paymentlistener",
      step1Status: step1.status,
      step2Status: step2.status,
      step3Status: step3.status,
      step4Status: step4.status,
      step5Status: step5.status,
      loginResult,
      selectResult,
      merchant_txn_ref,
      cookieHeader: cookies.map((c) => `${c.key}=${c.value}`).join("; "),
      error: "message not found in creditpayment.jsp HTML",
    };
  }
  result.stage = "enets_paymentlistener";

  const step6Body = new URLSearchParams({
    message: String(enetsMessage),
  }).toString();
  const step6 = await axios.post(
    "https://www.enets.sg/enets2/PaymentListener.do",
    step6Body,
    {
      headers: {
        ...DEFAULT_HEADERS,
        Origin: "http://120.50.44.233",
        Referer: "http://120.50.44.233/",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      validateStatus: () => true,
    },
  );

  const enetsHtml = String(step6.data || "");
  const netsMid = extractHiddenField(enetsHtml, "netsMid");
  const e = extractHiddenField(enetsHtml, "e");
  const n = extractHiddenField(enetsHtml, "n");
  const netsTxnRef = extractHiddenField(enetsHtml, "netsTxnRef");

  return {
    ok: true,
    stage: "enets_paymentlistener",
    step1Status: step1.status,
    step2Status: step2.status,
    step3Status: step3.status,
    step4Status: step4.status,
    step5Status: step5.status,
    step6Status: step6.status,
    merchant_txn_ref,
    enetsBody: step6.data,
    enets: { netsMid, e, n, netsTxnRef },
  };
}

async function createClient() {
  const jar = new CookieJar();
  const client = wrapper(
    axios.create({
      jar,
      withCredentials: true,
      validateStatus: () => true,
      maxRedirects: 0,
      headers: DEFAULT_HEADERS,
    }),
  );
  return { client, jar };
}

async function getFollowRedirects(
  client,
  url,
  { params, headers, maxHops = 4 } = {},
) {
  let currentUrl = String(url);
  let resp = null;
  let hops = 0;

  while (hops <= maxHops) {
    resp = await client.get(currentUrl, { params, headers });
    const status = resp?.status;
    const loc = resp?.headers?.location;

    if (!isRedirectStatus(status) || !loc) return resp;

    const nextUrl = resolveUpstreamLocation(currentUrl, loc);
    if (!nextUrl) return resp;

    currentUrl = nextUrl;
    // after the first hop, avoid re-sending query params (they might already be embedded)
    params = undefined;
    hops++;
  }

  return resp;
}

async function postResultToEvs({ status, id, message, jsessionid }) {
  const formBody = new URLSearchParams({
    message: String(message),
  }).toString();

  const headers = {
    ...DEFAULT_HEADERS,
    Origin: "https://www.enets.sg",
    Referer: "https://www.enets.sg/",
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (jsessionid) {
    headers.Cookie = `JSESSIONID=${String(jsessionid).trim()}`;
  }

  const evsResp = await axios.post(
    `${CP2_WEBPOS_BASE}/EVSWebPOS/transSumServlet?status=${encodeURIComponent(
      String(status),
    )}&id=${encodeURIComponent(String(id))}`,
    formBody,
    {
      headers,
      validateStatus: () => true,
      maxRedirects: 0,
    },
  );

  return {
    upstreamStatus: evsResp.status,
    html: String(evsResp.data || ""),
    parsed: parseEvsTransactionSummary(evsResp.data),
  };
}

function extractEvsCallbackFromHtml(html) {
  const body = String(html || "");

  // Look for a form posting back to EVS transSumServlet
  const formMatch = body.match(
    /<form[^>]*action=["']([^"']*transSumServlet\?status=[^"']+)["'][^>]*>/i,
  );

  const action = formMatch ? htmlDecode(formMatch[1]) : null;

  const message = extractHiddenField(body, "message");

  if (!action || !message) return null;

  let status = null;
  let id = null;

  try {
    const u = new URL(action, CP2_WEBPOS_BASE);
    status = u.searchParams.get("status");
    id = u.searchParams.get("id");
  } catch {
    const m =
      action.match(/transSumServlet\?status=([^&]+)&(?:amp;)?id=([^"&]+)/i) ||
      action.match(
        /transSumServlet\?status=([^&]+).*?[?&](?:amp;)?id=([^"&]+)/i,
      );

    status = m?.[1] || null;
    id = m?.[2] || null;
  }

  if (!status || !id) return null;

  return {
    action,
    status,
    id,
    message,
  };
}

module.exports = {
  isCp2Meter,
  classifyLoginResponse,
  runPurchaseFlow,
  postResultToEvs,
  extractEvsCallbackFromHtml,
};
