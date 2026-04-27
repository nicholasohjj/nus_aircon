const axios = require("axios");
const { ORE_HEADERS } = require("./config");
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

async function getRecentUsageStat(meterDisplayName, lookBackHours = 168) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/cp/get_recent_usage_stat",
    {
      svcClaimDto: {
        username: meterId,
        user_id: null,
        svcName: "oresvc",
        endpoint: "/cp/get_recent_usage_stat",
        scope: "self",
        target: "meter.reading",
        operation: "list",
      },
      request: {
        meter_displayname: meterId,
        look_back_hours: lookBackHours,
        convert_to_money: true,
      },
    },
    { headers: ORE_HEADERS, validateStatus: () => true },
  );

  if (resp.status !== 200) return null;
  return resp.data?.usage_stat?.kwh_rank_in_building || null;
}

async function getMonthToDateUsage(meterDisplayName) {
  const meterId = String(meterDisplayName || "").trim();
  if (!meterId) return null;

  const resp = await axios.post(
    "https://ore.evs.com.sg/get_month_to_date_usage",
    {
      svcClaimDto: {
        username: meterId,
        user_id: null,
        svcName: "oresvc",
        endpoint: "/get_month_to_date_usage",
        scope: "self",
        target: "meter.month_to_date_kwh_usage",
        operation: "read",
      },
      request: {
        meter_displayname: meterId,
        convert_to_money: "true",
      },
    },
    { headers: ORE_HEADERS, validateStatus: () => true },
  );

  if (resp.status !== 200) return null;
  const val = resp.data?.month_to_date_usage;
  return typeof val === "number" ? val : null;
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

async function formatUsageSummary(
  history = [],
  creditBal = null,
  days = 7,
  meterId = null,
) {
  const a = analyzeUsage(history, creditBal);

  const lines = [];

  if (a.lastDay != null) {
    lines.push(`📈 *Yesterday:* SGD ${a.lastDay.toFixed(2)}`);
  }
  if (a.avgDaily != null) {
    lines.push(`📊 *${days}-day avg:* SGD ${a.avgDaily.toFixed(2)} / day`);
  }
  if (a.total != null) {
    lines.push(`🧮 *${days}-day total:* SGD ${a.total.toFixed(2)}`);
  }

  if (meterId) {
    try {
      const [rankResult, mtdResult] = await Promise.allSettled([
        getRecentUsageStat(meterId),
        getMonthToDateUsage(meterId),
      ]);

      const rank = rankResult.status === "fulfilled" ? rankResult.value : null;
      const mtd = mtdResult.status === "fulfilled" ? mtdResult.value : null;

      if (rank) {
        const pct = (Number(rank.rank_val) * 100).toFixed(0);
        const buildingAvg = Number(rank.ref_val).toFixed(2);
        lines.push(
          `🏆 *Building rank:* top ${100 - pct}% (building avg: SGD ${buildingAvg}/day)`,
        );
      }

      if (mtd !== null) {
        // negative = spent, so display as positive cost
        lines.push(`🗓️ *This month so far:* SGD ${Math.abs(mtd).toFixed(2)}`);
      }
    } catch {
      // silently skip if rank fetch fails
    }
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
  getMonthToDateUsage,
  getRecentUsageStat,
};
