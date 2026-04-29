require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID; // get this from @userinfobot

console.log("🚀 SERVER_URL =", SERVER_URL);
if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN env var is required");
const {
  getMeterSummary,
  getMeterUsage,
  formatUsageSummary,
} = require("./services/ore");
const {
  track,
  captureException,
  shutdownAnalytics,
} = require("./services/analytics");
const { isValidAmount, isValidMeterId } = require("./services/validators");
const bot = new Telegraf(TOKEN);

function isHttpsUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:";
  } catch {
    return false;
  }
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

function hostelInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🏠 PGPR / PGP / RC / NUSC (cp2)", "hostel_cp2")],
    [
      Markup.button.callback(
        "🏠 UTown Residence / RVRC (cp2nus)",
        "hostel_cp2nus",
      ),
    ],
  ]);
}

function resetSession(chatId) {
  sessions[chatId] = { stage: "idle", updatedAt: Date.now(), inFlight: false };
}

function mainKeyboard() {
  return Markup.keyboard([
    ["⚡ Top Up"],
    ["💰 Balance", "📊 Usage"],
    ["ℹ️ Help"],
  ]).resize();
}

function ratingKeyboard() {
  return Markup.keyboard([
    ["⭐ 1", "⭐⭐ 2", "⭐⭐⭐ 3", "⭐⭐⭐⭐ 4", "⭐⭐⭐⭐⭐ 5"],
    ["❌ Cancel"],
  ]).resize();
}

function parseStar(text) {
  const map = {
    "⭐ 1": 1,
    "⭐⭐ 2": 2,
    "⭐⭐⭐ 3": 3,
    "⭐⭐⭐⭐ 4": 4,
    "⭐⭐⭐⭐⭐ 5": 5,
  };
  return map[text] ?? null;
}

function startTopUp(chatId) {
  resetSession(chatId);
  const session = getSession(chatId);
  session.stage = "awaiting_hostel";
  return session;
}

function getWebAppPath(hostel) {
  return hostel === HOSTELS.CP2NUS ? "/cp2nus/webapp" : "/webapp";
}

function helpText() {
  return (
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
    `*Useful commands*\n` +
    `• /topup — start a new top-up\n` +
    `• /balance — check meter balance\n` +
    `• /usage — show recent daily usage\n` +
    `• /feedback — share feedback or report an issue\n` +
    `• /cancel — cancel the current flow\n` +
    `• /help — show this message`
  );
}

function escapeMarkdown(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

async function sendHelp(ctx) {
  return ctx.replyWithMarkdown(helpText(), mainKeyboard());
}

async function setupTelegramUi() {
  await bot.telegram.setMyCommands([
    { command: "topup", description: "Start electricity top-up" },
    { command: "balance", description: "Check meter balance" },
    { command: "usage", description: "Show recent daily usage" },
    { command: "feedback", description: "Share feedback or report an issue" },
    { command: "help", description: "Show help and usage" },
    { command: "cancel", description: "Cancel current flow" },
  ]);
}

bot.hears("💰 Balance", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  track("balance_button", { chatId });

  const session = getSession(chatId);
  session.stage = "awaiting_meter_id_balance";

  return ctx.reply(
    "🔌 Please enter your 8-digit Meter ID to check your balance:",
    Markup.keyboard([["❌ Cancel"]]).resize(),
  );
});

bot.hears("📊 Usage", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  track("usage_button", { chatId });

  const session = getSession(chatId);
  session.stage = "awaiting_meter_id_usage";

  return ctx.reply(
    "🔌 Please enter your 8-digit Meter ID to view the last 7 days of usage:",
    Markup.keyboard([["❌ Cancel"]]).resize(),
  );
});

bot.hears("ℹ️ Help", sendHelp);

bot.hears("⚡ Top Up", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  startTopUp(chatId);
  return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard());
});

// bot.hears("💬 Feedback", async (ctx) => {
//   const chatId = ctx.chat?.id;
//   if (!chatId) return;

//   track("feedback_button", { chatId });

//   resetSession(chatId);
//   const session = getSession(chatId);
//   session.stage = "awaiting_feedback_rating";

//   return ctx.reply(
//     "💬 *Share your feedback*\n\nHow would you rate your experience?",
//     { parse_mode: "Markdown", ...ratingKeyboard() },
//   );
// });

bot.start(async (ctx) => {
  const chatId = ctx.chat?.id;
  track("bot_start", { chatId });
  if (chatId) resetSession(chatId);

  const meterId = ctx.startPayload?.trim();

  if (meterId && isValidMeterId(meterId)) {
    track("bot_start_deeplink", { chatId, meterId });

    const session = getSession(chatId);
    session.stage = "awaiting_hostel";
    session.txtMtrId = meterId;

    return ctx.reply(
      `⚡ EVS Electricity Top-Up\n\n🔌 Meter ID *${meterId}* detected.\n\nPlease select your hostel:`,
      { parse_mode: "Markdown", ...hostelInlineKeyboard() }, // ← fix
    );
  }

  return ctx.reply(
    "⚡ EVS Electricity Top-Up\n\nChoose an option below:",
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
  return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard()); // ← fix
});

bot.command("feedback", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  track("feedback_command", { chatId });

  resetSession(chatId);
  const session = getSession(chatId);
  session.stage = "awaiting_feedback_rating";

  return ctx.reply(
    "💬 *Share your feedback*\n\nHow would you rate your experience?",
    { parse_mode: "Markdown", ...ratingKeyboard() },
  );
});

bot.command("help", sendHelp);

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

bot.action("hostel_cp2", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = getSession(chatId);
  if (session.stage !== "awaiting_hostel") {
    return ctx.answerCbQuery("⚠️ Please start a new top-up.");
  }
  await ctx.answerCbQuery();

  session.hostel = HOSTELS.CP2;
  track("hostel_selected", { chatId, hostel: "cp2" });

  if (session.txtMtrId) {
    session.stage = "awaiting_amount";
    return ctx.replyWithMarkdown(
      `🔌 Meter ID: \`${session.txtMtrId}\`\n\nEnter the *amount in SGD* (e.g. \`20\`, min $6, max $50):`,
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
  }

  session.stage = "awaiting_meter_id";
  return ctx.reply(
    "🔌 Please enter your 8-digit Meter ID:",
    Markup.keyboard([["❌ Cancel"]]).resize(),
  );
});

bot.action("hostel_cp2nus", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const session = getSession(chatId);
  if (session.stage !== "awaiting_hostel") {
    return ctx.answerCbQuery("⚠️ Please start a new top-up.");
  }
  await ctx.answerCbQuery();

  session.hostel = HOSTELS.CP2NUS;
  track("hostel_selected", { chatId, hostel: "cp2nus" });

  if (session.txtMtrId) {
    session.stage = "awaiting_amount";
    return ctx.replyWithMarkdown(
      `🔌 Meter ID: \`${session.txtMtrId}\`\n\nEnter the *amount in SGD* (e.g. \`20\`, min $6, max $50):`,
      Markup.keyboard([["❌ Cancel"]]).resize(),
    );
  }

  session.stage = "awaiting_meter_id";
  return ctx.reply(
    "🔌 Please enter your 8-digit Meter ID:",
    Markup.keyboard([["❌ Cancel"]]).resize(),
  );
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const text = String(ctx.message?.text || "").trim();
  if (!text || text.startsWith("/")) return;

  const session = getSession(chatId);

  if (session.stage === "awaiting_feedback_rating") {
    const rating = parseStar(text);
    if (rating === null) {
      return ctx.reply(
        "⚠️ Please tap one of the star buttons to rate your experience.",
        ratingKeyboard(),
      );
    }

    session.feedbackRating = rating;
    session.stage = "awaiting_feedback_text";

    const stars = "⭐".repeat(rating);
    return ctx.reply(
      `${stars} Got it!\n\nNow please type your feedback or any comments (or tap *Skip* to submit without a message):`,
      {
        parse_mode: "Markdown",
        ...Markup.keyboard([["⏭ Skip"], ["❌ Cancel"]]).resize(),
      },
    );
  }

  if (session.stage === "awaiting_feedback_text") {
    const feedbackText = text === "⏭ Skip" ? null : text;

    track("feedback_submitted", {
      chatId,
      rating: session.feedbackRating,
      message: feedbackText,
    });

    // Log to console so it's easy to grep in server logs even without a DB
    console.log(
      `📝 FEEDBACK from ${chatId}: rating=${session.feedbackRating}`,
      feedbackText ? `| message="${feedbackText}"` : "(no message)",
    );
    const { feedbackRating } = session;

    resetSession(chatId);

    const stars = "⭐".repeat(feedbackRating ?? 0);
    const notifyLines = [
      `📬 *New Feedback*`,
      `👤 From: \`${chatId}\``,
      `${stars} Rating: ${feedbackRating}/5`,
    ];
    if (feedbackText)
      notifyLines.push(`💬 Message: _${escapeMarkdown(feedbackText)}_`);

    if (OWNER_CHAT_ID) {
      await bot.telegram
        .sendMessage(OWNER_CHAT_ID, notifyLines.join("\n"), {
          parse_mode: "Markdown",
        })
        .catch((err) => console.error("Failed to notify owner:", err));
    }
    return ctx.replyWithMarkdown(
      `✅ *Thanks for your feedback!*\n\n${stars}\n\n` +
        (feedbackText ? `_"${escapeMarkdown(feedbackText)}"_\n\n` : "") +
        `Your input helps us improve the bot.`,
      mainKeyboard(),
    );
  }

  if (session.stage === "awaiting_meter_id") {
    if (!isValidMeterId(text)) {
      return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
    }

    session.txtMtrId = text;
    if (session.inFlight) return ctx.reply("⏳ Please wait…");
    session.inFlight = true;
    await ctx.sendChatAction("typing");
    const loadingMsg = await ctx.reply("🔍 Fetching meter details…");
    try {
      const [summary, usage] = await Promise.all([
        getMeterSummary(text),
        getMeterUsage(text, 7),
      ]);

      session.stage = "awaiting_amount";

      const lines = [`✅ Meter ID: \`${text}\``];

      if (summary.address) {
        lines.push(`🏠 *Address:* ${escapeMarkdown(summary.address)}`);
      }

      const bal = Number(summary.credit_bal);
      if (summary.credit_bal != null && Number.isFinite(bal)) {
        lines.push(`💰 *Balance:* SGD ${bal.toFixed(2)}`);
      }

      const usageText = await formatUsageSummary(
        usage.history,
        summary.credit_bal,
        7,
        text,
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

      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        lines.join("\n"),
        { parse_mode: "Markdown" },
      );
    } catch (err) {
      track("prefill_usage_error", {
        chatId,
        meterId: text,
        error: err.message,
      });

      session.stage = "awaiting_amount";
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        `✅ Meter ID: \`${text}\`\n\n⚠️ Couldn't fetch usage.\n\nEnter amount (min $6, max $50):`,
        { parse_mode: "Markdown" },
      );
    } finally {
      session.inFlight = false;
    }
    return;
  }

  if (session.stage === "awaiting_meter_id_usage") {
    if (!isValidMeterId(text)) {
      return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
    }

    session.stage = "idle";
    if (session.inFlight) return ctx.reply("⏳ Please wait…");
    session.inFlight = true;
    await ctx.sendChatAction("typing");
    const loadingMsg = await ctx.reply("🔍 Checking recent usage…");
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
        (await formatUsageSummary(
          usage.history,
          summary.credit_bal,
          7,
          text,
        )) || "No usage data available.",
      );

      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        lines.join("\n"),
        { parse_mode: "Markdown" },
      );
      return ctx.reply("Choose an option:", mainKeyboard());
    } catch (err) {
      track("usage_error", { chatId, meterId: text, error: err.message });
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        "⚠️ Failed to fetch usage history. Please try again.",
      );
      return ctx.reply("Choose an option:", mainKeyboard());
    } finally {
      session.inFlight = false;
    }
  }

  if (session.stage === "awaiting_amount") {
    const amt = Number(text);

    if (!isValidAmount(amt)) {
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

    if (session.inFlight) return ctx.reply("⏳ Please wait…");
    session.inFlight = true;
    try {
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
          mode: "url_fallback",
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

      track("payment_button_shown", {
        chatId,
        hostel: session.hostel,
        meterId: session.txtMtrId,
        amount: amountDollars,
        webAppUrl,
        mode: "telegram_webapp",
      });

      return ctx.replyWithMarkdown(
        `📋 *Order Summary*\n\n` +
          `🏠 Hostel: *${hostelLabel}*\n` +
          `🔌 Meter ID: \`${session.txtMtrId}\`\n` +
          `💵 Amount: $${amountDollars.toFixed(2)} SGD\n\n` +
          `Tap below to proceed to payment:`,
        Markup.inlineKeyboard([Markup.button.webApp("💳 Pay Now", webAppUrl)]),
      );
    } finally {
      // ← try closes / finally
      session.inFlight = false;
    } // ← finally closes
  }

  if (session.stage === "awaiting_meter_id_balance") {
    if (!isValidMeterId(text)) {
      return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
    }

    session.stage = "idle";
    if (session.inFlight) return ctx.reply("⏳ Please wait…");
    session.inFlight = true;
    await ctx.sendChatAction("typing");
    const loadingMsg = await ctx.reply("🔍 Checking balance…");
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

      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        lines.join("\n"),
        { parse_mode: "Markdown" }, // no reply_markup here
      );
      return ctx.reply("Choose an option:", mainKeyboard());
    } catch (err) {
      track("balance_error", { chatId, error: err.message });
      await ctx.telegram.editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        "⚠️ Failed to fetch balance. Please try again.",
      );
      return ctx.reply("Choose an option:", mainKeyboard());
    } finally {
      session.inFlight = false;
    }
  }

  return ctx.reply(
    "I didn’t understand that. Use /topup to top up, /balance to check balance, or /help for instructions.",
    mainKeyboard(),
  );
});

(async () => {
  try {
    await setupTelegramUi();

    // clear old webhook if any
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });

    await bot.launch({
      dropPendingUpdates: true,
    });

    console.log("🤖 EVS Telegram bot running...");
  } catch (err) {
    console.error("Failed to launch Telegram bot:", err);
    process.exit(1);
  }
})();

process.once("SIGINT", async () => {
  await shutdownAnalytics();
  bot.stop("SIGINT");
});

process.once("SIGTERM", async () => {
  await shutdownAnalytics();
  bot.stop("SIGTERM");
});

bot.catch((err, ctx) => {
  console.error("Telegram bot error", err);
  captureException(err, String(ctx?.chat?.id ?? "anonymous"));
  if (ctx?.chat?.id) {
    resetSession(ctx.chat.id);
    ctx
      .reply("⚠️ Something went wrong. Please try /topup again.")
      .catch(() => {});
  }
});
