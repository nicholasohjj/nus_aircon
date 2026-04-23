const axios = require("axios");

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

async function getMeterInfo(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/cp/get_meter_info",
    {
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
  return resp.data?.meter_info || null;
}

async function getMeterSummary(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) {
    return { address: null, credit_bal: null };
  }

  const [meterInfo, creditBal] = await Promise.allSettled([
    getMeterInfo(meterId),
    getCreditBalance(meterId),
  ]);

  return {
    address:
      meterInfo.status === "fulfilled"
        ? meterInfo.value?.address || null
        : null,
    credit_bal: creditBal.status === "fulfilled" ? creditBal.value : null,
  };
}

module.exports = {
  ORE_HEADERS,
  getMeterInfo,
  getCreditBalance,
  getMeterSummary,
};
