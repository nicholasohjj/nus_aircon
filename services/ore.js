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

function toIsoRange(days = 7) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    start: start.toISOString().replace("T", " ").replace("Z", "Z"),
    end: end.toISOString().replace("T", " ").replace("Z", "Z"),
  };
}

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

async function getCreditBalance(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/tcm/get_credit_balance",
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
  return resp.data?.ref_bal ?? null;
}

async function getMeterSummary(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) {
    return { address: null, credit_bal: null, meter_info: null };
  }

  const [meterInfo, creditBal] = await Promise.allSettled([
    getMeterInfo(meterId),
    getCreditBalance(meterId),
  ]);

  return {
    meter_info: meterInfo.status === "fulfilled" ? meterInfo.value : null,
    address:
      meterInfo.status === "fulfilled"
        ? meterInfo.value?.address || null
        : null,
    credit_bal: creditBal.status === "fulfilled" ? creditBal.value : null,
  };
}

async function getMeterUsage(meterDisplayName, days = 7) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return { days, history: [], meta: null };

  const { start, end } = toIsoRange(days);

  const resp = await axios.post(
    "https://ore.evs.com.sg/get_history",
    {
      request: {
        meter_displayname: meterId,
        history_type: "meter_reading_daily",
        start_datetime: start,
        end_datetime: end,
        normalization: "meter_reading_daily",
        max_number_of_records: "1000",
        convert_to_money: "true",
        check_bypass: "true",
      },
    },
    {
      headers: ORE_HEADERS,
      validateStatus: () => true,
    },
  );

  if (resp.status !== 200) {
    throw new Error(`get_history failed with HTTP ${resp.status}`);
  }

  const block = resp.data?.meter_reading_daily || {};
  return {
    days,
    history: Array.isArray(block.history) ? block.history : [],
    meta: block.meta || null,
  };
}

function analyzeUsage(history = [], creditBal = null) {
  const diffs = history
    .map((x) => Number(x?.reading_diff))
    .filter((n) => Number.isFinite(n) && n >= 0);

  if (!diffs.length) {
    return {
      avgDaily: null,
      total: null,
      lastDay: null,
      zeroStreak: 0,
      spike: null,
      warnings: [],
    };
  }

  const total = diffs.reduce((a, b) => a + b, 0);
  const avgDaily = total / diffs.length;
  const lastDay = diffs[0] ?? null; // assuming newest first
  let zeroStreak = 0;

  for (const d of diffs) {
    if (d <= 0.05) zeroStreak += 1;
    else break;
  }

  let spike = null;
  if (
    avgDaily > 0 &&
    lastDay != null &&
    lastDay >= avgDaily * 2.5 &&
    lastDay >= 1
  ) {
    spike = {
      lastDay,
      avgDaily,
      factor: lastDay / avgDaily,
    };
  }

  const warnings = [];

  if (zeroStreak >= 3) {
    warnings.push(`🟡 Usage has been near zero for ${zeroStreak} day(s).`);
  }

  if (spike) {
    warnings.push(
      `🔴 Yesterday's usage (${lastDay.toFixed(2)}) is much higher than your recent average (${avgDaily.toFixed(2)}).`,
    );
  }

  const bal = Number(creditBal);
  if (Number.isFinite(bal) && avgDaily > 0) {
    const daysLeft = bal / avgDaily;
    if (daysLeft <= 3) {
      warnings.push(
        `🟠 Current balance may last only about ${daysLeft.toFixed(1)} day(s) at your recent usage.`,
      );
    }
  }

  return {
    avgDaily,
    total,
    lastDay,
    zeroStreak,
    spike,
    warnings,
  };
}

function formatUsageSummary(history = [], creditBal = null, days = 7) {
  const a = analyzeUsage(history, creditBal);
  const lines = [];

  if (a.lastDay != null) {
    lines.push(`📈 *Yesterday:* ${a.lastDay.toFixed(2)}`);
  }
  if (a.avgDaily != null) {
    lines.push(`📊 *${days}-day avg:* ${a.avgDaily.toFixed(2)} / day`);
  }
  if (a.total != null) {
    lines.push(`🧮 *${days}-day total:* ${a.total.toFixed(2)}`);
  }
  if (a.warnings.length) {
    lines.push("");
    lines.push(...a.warnings);
  }

  return lines.join("\n");
}

module.exports = {
  getMeterSummary,
  getMeterUsage,
  analyzeUsage,
  formatUsageSummary,
};
