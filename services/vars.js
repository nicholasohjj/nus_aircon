const CP2_WEBPOS_BASE = "https://nus-utown.evs.com.sg";
const qs = require("querystring");
const axios = require("axios");

const WEBPOS_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
  "Upgrade-Insecure-Requests": "1",
};

function classifyLoginResponse(html) {
  const body = String(html || "");

  const isValid =
    body.includes("<title>EVS POS Package Selection Page</title>") ||
    body.includes('action="/EVSWebPOS/selectOfferServlet"') ||
    body.includes("Please confirm you are purchasing for the above premise");

  const isInvalid =
    body.includes("<title>EVS POS Main Page</title>") ||
    body.includes("Meter not found.") ||
    body.includes('action="/EVSWebPOS/loginServlet"');

  if (isValid) return "valid";
  if (isInvalid) return "invalid";
  return "unknown";
}

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

function isValidMeterId(txtMtrId) {
  return /^\d{8}$/.test(String(txtMtrId || "").trim());
}

function isValidAmount(txtAmount) {
  const amount = Number(String(txtAmount || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(amount) && amount >= 6 && amount <= 50;
}

module.exports = {
  WEBPOS_HEADERS,
  isCp2Meter,
  isValidMeterId,
  classifyLoginResponse,
  isValidAmount,
};
