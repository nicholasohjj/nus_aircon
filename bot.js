require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
console.log("🚀 SERVER_URL =", SERVER_URL);
if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN env var is required");
const {
  getMeterSummary,
  getMeterUsage,
  formatUsageSummary,
} = require("./services/ore");
const bot = new Telegraf(TOKEN);

function track(event, data = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...data,
    }),
  );
}

function isHttpsUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidMeterId(value) {
  return /^\d{8}$/.test(String(value).trim());
}

const HOSTELS = {
  CP2: "cp2",
  CP2NUS: "cp2nus",
};

// In-memory session store: { chatId -> { stage, hostel, txtMtrId, txtAmount } }
const sessions = {};
const SESSION_TTL_MS = 15 * 60 * 1000;

function getSession(chatId) {
  const now = Date.now();
  const s = sessions[chatId];

  if (!s || (s.updatedAt && now - s.updatedAt > SESSION_TTL_MS)) {
    sessions[chatId] = { stage: "idle", updatedAt: now, inFlight: false };
  } else {
    sessions[chatId].updatedAt = now;
  }

  return sessions[chatId];
}

function resetSession(chatId) {
  sessions[chatId] = { stage: "idle", updatedAt: Date.now(), inFlight: false };
}

function mainKeyboard() {
  return Markup.keyboard([["⚡ Top Up"]]).resize();
}

function hostelKeyboard() {
  return Markup.keyboard([
    ["🏠 PGPR / PGP / RC / NUSC", "🏠 UTown Residence / RVRC"],
    ["❌ Cancel"],
  ]).resize();
}

function startTopUp(chatId) {
  resetSession(chatId);
  const session = getSession(chatId);
  session.stage = "awaiting_hostel";
  return session;
}

function getWebAppPath(hostel) {
  return hostel === HOSTELS.CP2NUS ? "/webapp/new" : "/webapp";
}

async function setupTelegramUi() {
  await bot.telegram.setMyCommands([
    { command: "topup", description: "Start electricity top-up" },
    { command: "balance", description: "Check meter balance" },
    { command: "usage", description: "Show recent daily usage" },
    { command: "help", description: "Show help and usage" },
    { command: "cancel", description: "Cancel current flow" },
  ]);
}

bot.hears("⚡ Top Up", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  startTopUp(chatId);
  return ctx.reply("🏠 Please select your hostel:", hostelKeyboard());
});

bot.start(async (ctx) => {
  const chatId = ctx.chat?.id;
  track("bot_start", { chatId });
  if (chatId) resetSession(chatId);

  return ctx.reply(
    "⚡ EVS Electricity Top-Up\n\nChoose an option below or use /topup.",
    mainKeyboard(),
  );
});

bot.command("balance", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  track("balance_command", { chatId });

  const session = getSession(chatId);
  session.stage = "awaiting_meter_id_balance";

  return ctx.reply(
    "🔌 Please enter your 8-digit Meter ID to check your balance:",
    Markup.keyboard([["❌ Cancel"]]).resize(),
  );
});

bot.command("usage", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  track("usage_command", { chatId });

  const session = getSession(chatId);
  session.stage = "awaiting_meter_id_usage";

  return ctx.reply(
    "🔌 Please enter your 8-digit Meter ID to view the last 7 days of usage:",
    Markup.keyboard([["❌ Cancel"]]).resize(),
  );
});

bot.command("topup", async (ctx) => {
  const chatId = ctx.chat?.id;
  track("topup_command", { chatId });
  if (!chatId) return;

  startTopUp(chatId);
  return ctx.reply("🏠 Please select your hostel:", hostelKeyboard());
});

bot.command("help", async (ctx) => {
  return ctx.replyWithMarkdown(
    `ℹ️ *EVS Top-Up Help*\n\n` +
      `*Supported hostels*\n` +
      `• PGPR\n` +
      `• Houses @ PGP\n` +
      `• Residential Colleges\n` +
      `• NUS College\n` +
      `  → uses cp2.evs.com.sg\n` +
      `• UTown Residence\n` +
      `• RVRC\n` +
      `  → uses cp2nus.evs.com.sg\n\n` +
      `*Accepted amount*\n` +
      `• Minimum: $6.00 SGD\n` +
      `• Maximum: $50.00 SGD\n\n` +
      `*WebApp requirement*\n` +
      `• Telegram WebApp buttons require an *HTTPS* \`SERVER_URL\`\n` +
      `• If your server is not HTTPS, the bot will send a normal browser link instead\n\n` +
      `*Useful commands*\n` +
      `• /topup — start a new top-up\n` +
      `• /usage — show recent daily usage\n` +
      `• /cancel — cancel the current flow\n` +
      `• /help — show this message`,
    mainKeyboard(),
  );
});

bot.command("cancel", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId) resetSession(chatId);
  return ctx.reply(
    "❌ Top-up cancelled. Use /topup to start again.",
    mainKeyboard(),
  );
});

bot.hears("❌ Cancel", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId) resetSession(chatId);
  return ctx.reply(
    "❌ Top-up cancelled. Use /topup to start again.",
    mainKeyboard(),
  );
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = String(ctx.message?.text || "").trim();
  if (!text || text.startsWith("/")) return;

  const session = getSession(chatId);

  if (session.stage === "awaiting_hostel") {
    if (text === "🏠 PGPR / PGP / RC / NUSC") {
      session.hostel = HOSTELS.CP2;
      session.stage = "awaiting_meter_id";
      track("hostel_selected", { chatId, hostel: "cp2" });
      return ctx.reply(
        "🔌 Please enter your 8-digit Meter ID:",
        Markup.keyboard([["❌ Cancel"]]).resize(),
      );
    }

    if (text === "🏠 UTown Residence / RVRC") {
      track("hostel_selected_blocked", { chatId, hostel: "cp2nus" });
      return ctx.reply(
        "⚠️ UTown Residence / RVRC is not available yet. Please select PGPR / PGP / RC / NUSC for now.",
        hostelKeyboard(),
      );
    }

    return ctx.reply(
      "⚠️ Please choose either PGPR / PGP / RC / NUSC or UTown Residence / RVRC.",
      hostelKeyboard(),
    );
  }

  if (session.stage === "awaiting_meter_id") {
    if (!isValidMeterId(text)) {
      return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
    }

    session.txtMtrId = text;
    await ctx.reply("🔍 Fetching meter details and recent usage…");

    try {
      const [summary, usage] = await Promise.all([
        getMeterSummary(text),
        getMeterUsage(text, 7),
      ]);

      session.stage = "awaiting_amount";

      const lines = [`✅ Meter ID: \`${text}\``];

      if (summary.address) {
        lines.push(`🏠 *Address:* ${summary.address}`);
      }

      const bal = Number(summary.credit_bal);
      if (summary.credit_bal != null && Number.isFinite(bal)) {
        lines.push(`💰 *Balance:* SGD ${bal.toFixed(2)}`);
      }

      const usageText = formatUsageSummary(
        usage.history,
        summary.credit_bal,
        7,
      );
      if (usageText) {
        lines.push("");
        lines.push("*Daily consumption*");
        lines.push(usageText);
      }

      lines.push("");
      lines.push(
        "Now enter the *amount in SGD* (e.g. `20` for $20.00, min $6, max $50):",
      );

      return ctx.replyWithMarkdown(
        lines.join("\n"),
        Markup.keyboard([["❌ Cancel"]]).resize(),
      );
    } catch (err) {
      track("prefill_usage_error", {
        chatId,
        meterId: text,
        error: err.message,
      });

      session.stage = "awaiting_amount";
      return ctx.replyWithMarkdown(
        `✅ Meter ID: \`${text}\`\n\n` +
          `⚠️ I couldn't fetch recent usage right now.\n\n` +
          `Now enter the *amount in SGD* (e.g. \`20\` for $20.00, min $6, max $50):`,
        Markup.keyboard([["❌ Cancel"]]).resize(),
      );
    }
  }

  if (session.stage === "awaiting_meter_id_usage") {
    if (!isValidMeterId(text)) {
      return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
    }

    session.stage = "idle";
    await ctx.reply("🔍 Checking recent usage…");

    try {
      const [summary, usage] = await Promise.all([
        getMeterSummary(text),
        getMeterUsage(text, 7),
      ]);

      const lines = [`⚡ *Meter ID:* \`${text}\``];
      if (summary.address) lines.push(`🏠 *Address:* ${summary.address}`);

      const bal = Number(summary.credit_bal);
      if (summary.credit_bal != null && Number.isFinite(bal)) {
        lines.push(`💰 *Balance:* SGD ${bal.toFixed(2)}`);
      }

      lines.push("");
      lines.push("*Daily consumption (last 7 days)*");
      lines.push(
        formatUsageSummary(usage.history, summary.credit_bal, 7) ||
          "No usage data available.",
      );

      return ctx.replyWithMarkdown(lines.join("\n"), mainKeyboard());
    } catch (err) {
      track("usage_error", { chatId, meterId: text, error: err.message });
      return ctx.reply(
        "⚠️ Failed to fetch usage history. Please try again.",
        mainKeyboard(),
      );
    }
  }

  if (session.stage === "awaiting_amount") {
    const amt = Number(text);

    if (!Number.isFinite(amt) || amt < 6 || amt > 50) {
      return ctx.reply("⚠️ Please enter a valid amount between $6 and $50.");
    }

    const amountDollars = Number(amt.toFixed(2));
    const amountCents = Math.round(amountDollars * 100);

    session.amountDollars = amountDollars;
    session.amountCents = amountCents;

    track("amount_accepted", {
      chatId,
      hostel: session.hostel,
      meterId: session.txtMtrId,
      amount: amountDollars,
    });

    session.stage = "idle";

    const webAppPath = getWebAppPath(session.hostel);
    const webAppUrl =
      `${SERVER_URL}${webAppPath}?txtMtrId=${encodeURIComponent(session.txtMtrId)}` +
      `&txtAmount=${encodeURIComponent(session.amountDollars)}`;
    console.log("🌐 WebApp URL =", webAppUrl);
    const hostelLabel =
      session.hostel === HOSTELS.CP2NUS
        ? "UTown Residence / RVRC (cp2nus)"
        : "PGPR / Houses @ PGP / Residential Colleges / NUS College (cp2)";

    if (!isHttpsUrl(SERVER_URL)) {
      track("payment_button_shown", {
        chatId,
        hostel: session.hostel,
        meterId: session.txtMtrId,
        amount: amountDollars,
        webAppUrl,
      });
      await ctx.replyWithMarkdown(
        `📋 *Order Summary*\n\n` +
          `🏠 Hostel: *${hostelLabel}*\n` +
          `🔌 Meter ID: \`${session.txtMtrId}\`\n` +
          `💵 Amount: $${amountDollars.toFixed(2)} SGD\n\n` +
          `Your \`SERVER_URL\` is \`${SERVER_URL}\`.\n` +
          `Telegram WebApp buttons require *HTTPS*, so I can’t open the WebApp inside Telegram with the current SERVER_URL.\n\n` +
          `Open the payment page in your browser instead:`,
        Markup.inlineKeyboard([
          Markup.button.url("🌐 Open Payment Page", webAppUrl),
        ]),
      );

      return ctx.replyWithMarkdown(
        `For in-Telegram WebApp support, expose your server over HTTPS and set:\n\n` +
          `\`SERVER_URL=https://<your-tunnel-host>\`\n\n` +
          `then restart the bot.`,
      );
    }

    return ctx.replyWithMarkdown(
      `📋 *Order Summary*\n\n` +
        `🏠 Hostel: *${hostelLabel}*\n` +
        `🔌 Meter ID: \`${session.txtMtrId}\`\n` +
        `💵 Amount: $${amountDollars.toFixed(2)} SGD\n\n` +
        `Tap below to proceed to payment:`,
      Markup.inlineKeyboard([Markup.button.webApp("💳 Pay Now", webAppUrl)]),
    );
  }

  if (session.stage === "awaiting_meter_id_balance") {
    if (!isValidMeterId(text)) {
      return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
    }

    session.stage = "idle";
    await ctx.reply("🔍 Checking balance…");

    try {
      const summary = await getMeterSummary(text);

      const lines = [`⚡ *Meter ID:* \`${text}\``];
      if (summary.address) lines.push(`🏠 *Address:* ${summary.address}`);

      const bal = Number(summary.credit_bal);
      if (summary.credit_bal != null && Number.isFinite(bal)) {
        lines.push(`💰 *Balance:* SGD ${bal.toFixed(2)}`);
      } else {
        lines.push(`💰 *Balance:* unavailable`);
      }

      return ctx.replyWithMarkdown(lines.join("\n"), mainKeyboard());
    } catch (err) {
      track("balance_error", { chatId, error: err.message });
      return ctx.reply(
        "⚠️ Failed to fetch balance. Please try again.",
        mainKeyboard(),
      );
    }
  }

  return ctx.reply(
    "I didn’t understand that. Use /topup to top up, /balance to check balance, or /help for instructions.",
    mainKeyboard(),
  );
});

(async () => {
  await setupTelegramUi();
  await bot.launch();
  console.log("🤖 EVS Telegram bot running...");
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

bot.catch((err, ctx) => {
  console.error("Telegram bot error", err);
  if (ctx?.chat?.id) {
    resetSession(ctx.chat.id);
    ctx
      .reply("⚠️ Something went wrong. Please try /topup again.")
      .catch(() => {});
  }
});
