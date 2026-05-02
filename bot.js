require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const { escHtml } = require("./services/utils");
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID; // get this from @userinfobot
const pendingReplies = new Map();
const PENDING_REPLY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const chatLocks = new Map();

const hostelInlineKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("🏠 PGPR / PGP / RC / NUSC (cp2)", "hostel_cp2")],
  [
    Markup.button.callback(
      "🏠 UTown Residence / RVRC (cp2nus)",
      "hostel_cp2nus",
    ),
  ],
]);

const mainKeyboard = Markup.keyboard([
  ["⚡ Top Up"],
  ["💰 Balance", "📊 Usage"],
  ["ℹ️ Help"],
]).resize();

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

setInterval(() => {
  const now = Date.now();
  for (const chatId of Object.keys(sessions)) {
    if (now - (sessions[chatId].updatedAt ?? 0) > SESSION_TTL_MS) {
      delete sessions[chatId];
    }
  }
}, SESSION_TTL_MS).unref();

setInterval(
  () => {
    const now = Date.now();

    for (const [messageId, entry] of pendingReplies.entries()) {
      if (now - entry.createdAt > PENDING_REPLY_TTL_MS) {
        pendingReplies.delete(messageId);
      }
    }
  },
  60 * 60 * 1000,
).unref();

function getSession(chatId) {
  const now = Date.now();
  const s = sessions[chatId];

  if (!s || (s.updatedAt && now - s.updatedAt > SESSION_TTL_MS)) {
    sessions[chatId] = { stage: "idle", updatedAt: now };
  } else {
    sessions[chatId].updatedAt = now;
  }

  return sessions[chatId];
}

async function withChatLock(chatId, fn) {
  // Chain onto the existing lock for this chat, or resolve immediately
  const prev = chatLocks.get(chatId) ?? Promise.resolve();
  let release;
  const next = new Promise((res) => (release = res));
  chatLocks.set(
    chatId,
    prev.then(() => next),
  );

  try {
    await prev; // wait for previous handler to finish
    return await fn();
  } finally {
    release(); // unblock the next handler
    // Clean up if no more waiters
    if (chatLocks.get(chatId) === next) chatLocks.delete(chatId);
  }
}

function resetSession(chatId) {
  sessions[chatId] = { stage: "idle", updatedAt: Date.now() };
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
  const savedMeterId = sessions[chatId]?.txtMtrId; // preserve it
  resetSession(chatId);
  const session = getSession(chatId);
  session.stage = "awaiting_hostel";
  if (savedMeterId) session.txtMtrId = savedMeterId;
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
    `• /usage — show last 7 days of daily consumption,\n` +
    `  estimated days remaining, and current balance\n` +
    `• /feedback — share feedback or report an issue\n` +
    `• /cancel — cancel the current flow\n` +
    `• /help — show this message`
  );
}

async function sendHelp(ctx) {
  return ctx.replyWithMarkdown(helpText(), mainKeyboard);
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
  return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard);
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
//     { parse_mode: "HTML", ...ratingKeyboard() },
//   );
// });

bot.start(async (ctx) => {
  const chatId = ctx.chat?.id;
  track("bot_start", { chatId });
  if (chatId) resetSession(chatId);

  const payload = ctx.startPayload?.trim() ?? "";

  const cp2nusMatch = payload.match(/^nus_(\d{8})$/);
  if (cp2nusMatch) {
    const meterId = cp2nusMatch[1];
    track("bot_start_deeplink", { chatId, meterId, hostel: "cp2nus" });

    const session = getSession(chatId);
    session.stage = "awaiting_amount";
    session.hostel = HOSTELS.CP2NUS;
    session.txtMtrId = meterId;

    return ctx.reply(
      `⚡ EVS Electricity Top-Up\n\n` +
        `🏠 Hostel: <b>UTown Residence / RVRC (cp2nus)</b>\n` +
        `🔌 Meter ID: <code>${meterId}</code>\n\n` +
        `Enter the amount in SGD (e.g. <code>20</code>, min $6, max $50):\n\n` +
        `📄 By using this bot, you agree to our <a href="${SERVER_URL}/terms">Terms of Use</a>.`,
      {
        parse_mode: "HTML",
        reply_markup: Markup.keyboard([["❌ Cancel"]]).resize().reply_markup,
      },
    );
  }

  if (isValidMeterId(payload)) {
    track("bot_start_deeplink", { chatId, meterId: payload });

    const session = getSession(chatId);
    session.stage = "awaiting_hostel";
    session.txtMtrId = payload;

    return ctx.reply(
      `⚡ EVS Electricity Top-Up\n\nPlease select your hostel:\n\n` +
        `📄 By using this bot, you agree to our <a href="${SERVER_URL}/terms">Terms of Use</a>.`,
      { parse_mode: "HTML", reply_markup: hostelInlineKeyboard.reply_markup },
    );
  }

  return ctx.reply(
    `⚡ EVS Electricity Top-Up\n\nChoose an option below:\n\n` +
      `📄 By using this bot, you agree to our <a href="${SERVER_URL}/terms">Terms of Use</a>.`,
    { parse_mode: "HTML", reply_markup: mainKeyboard.reply_markup },
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
  return ctx.reply("🏠 Please select your hostel:", hostelInlineKeyboard); // ← fix
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
    { parse_mode: "HTML", ...ratingKeyboard() },
  );
});

bot.command("help", sendHelp);

bot.command("cancel", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId) resetSession(chatId);
  return ctx.reply(
    "❌ Top-up cancelled. Use /topup to start again.",
    mainKeyboard,
  );
});

bot.hears("❌ Cancel", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId) resetSession(chatId);
  return ctx.reply(
    "❌ Top-up cancelled. Use /topup to start again.",
    mainKeyboard,
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

bot.on("web_app_data", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  try {
    const data = JSON.parse(ctx.webAppData?.data?.text() || "{}");
    const {
      status,
      merchantTxnRef,
      meterId,
      amount,
      address,
      balance,
      reason,
    } = data;

    const ok = status === "success";
    const stars = ok ? "✅" : "⚠️";
    const title = ok ? "*Top-Up Successful*" : "*Top-Up Failed*";

    const lines = [
      `${stars} ${title}`,
      "",
      `🔌 Meter ID: \`${meterId || "-"}\``,
    ];

    if (address) lines.push(`🏠 Address: ${address}`);

    if (amount) {
      const amtNum = Number(String(amount).replace(/[^0-9.]/g, ""));
      if (!isNaN(amtNum)) lines.push(`💵 Amount: SGD ${amtNum.toFixed(2)}`);
    }

    if (balance !== "" && balance != null) {
      const balNum = Number(balance);
      if (!isNaN(balNum))
        lines.push(`💰 New Balance: SGD ${balNum.toFixed(2)}`);
    }

    if (merchantTxnRef) lines.push(`🧾 Reference: \`${merchantTxnRef}\``);
    if (!ok && reason) lines.push(`\n❌ Reason: ${reason}`);

    track(ok ? "miniapp_closed_success" : "miniapp_closed_failed", {
      chatId,
      meterId,
      status,
    });

    resetSession(chatId);
    await ctx.replyWithMarkdown(lines.join("\n"), mainKeyboard);
  } catch (err) {
    console.error("web_app_data parse error", err);
    await ctx.reply(
      "Payment completed. Check your meter balance to confirm.",
      mainKeyboard,
    );
  }
});

bot.on("message", async (ctx, next) => {
  const chatId = ctx.chat?.id;
  if (!chatId || String(chatId) !== String(OWNER_CHAT_ID)) return next();

  const replyToId = ctx.message?.reply_to_message?.message_id;
  if (!replyToId || !pendingReplies.has(replyToId)) return next();

  const pending = pendingReplies.get(replyToId);
  if (!pending) return next();

  const targetChatId = pending.chatId;
  const replyText = ctx.message?.text;
  if (!replyText) return ctx.reply("⚠️ Only text replies are supported.");

  // Figure out which owner message to thread future user replies back to.
  // If this entry is the root notification, that's the ownerMsgId.
  // If it's a forwarded user reply, follow ownerMsgId back to the root.
  const rootOwnerMsgId = pending.ownerMsgId ?? replyToId;

  const sentMsg = await bot.telegram
    .sendMessage(
      targetChatId,
      `💬 <b>Message from the developer:</b>\n\n${escHtml(replyText)}`,
      { parse_mode: "HTML" },
    )
    .catch(() => null);

  if (!sentMsg) {
    return ctx.reply(
      "⚠️ Failed to send reply — user may have blocked the bot.",
    );
  }

  // Map the bot's new message ID → back to owner's root thread message
  pendingReplies.set(sentMsg.message_id, {
    chatId: targetChatId,
    ownerMsgId: rootOwnerMsgId,
    createdAt: Date.now(),
  });

  return ctx.reply("✅ Reply sent to user.");
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  await withChatLock(chatId, async () => {
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
        `${stars} Got it!\n\nNow please type your feedback or any comments (or tap <b>Skip</b> to submit without a message):`,
        {
          parse_mode: "HTML",
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
        `📬 <b>New Feedback</b>`,
        `👤 From: <code>${chatId}</code>`,
        `${stars} Rating: ${feedbackRating}/5`,
      ];

      if (feedbackText)
        notifyLines.push(`💬 Message: <i>${escHtml(feedbackText)}</i>`);

      if (OWNER_CHAT_ID) {
        const notifyMsg = await bot.telegram
          .sendMessage(OWNER_CHAT_ID, notifyLines.join("\n"), {
            parse_mode: "HTML",
          })
          .catch((err) => {
            console.error("Failed to notify owner:", err);
            return null;
          });

        // store mapping: notification message_id -> original user's chatId
        if (notifyMsg) {
          pendingReplies.set(notifyMsg.message_id, {
            chatId,
            ownerMsgId: null,
            createdAt: Date.now(),
          });
        }
      }
      return ctx.reply(
        `✅ <b>Thanks for your feedback!</b>\n\n${stars}\n\n` +
          (feedbackText ? `<i>"${escHtml(feedbackText)}"</i>\n\n` : "") +
          `Your input helps us improve the bot.`,
        { parse_mode: "HTML", ...mainKeyboard },
      );
    }

    if (session.stage === "awaiting_meter_id") {
      if (!isValidMeterId(text)) {
        return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
      }

      session.txtMtrId = text;
      await ctx.sendChatAction("typing");
      const loadingMsg = await ctx
        .reply("🔍 Fetching meter details…")
        .catch(() => null);
      if (!loadingMsg) return;

      try {
        const [summary, usage] = await Promise.all([
          getMeterSummary(text),
          getMeterUsage(text, 7),
        ]);

        session.stage = "awaiting_amount";

        const lines = [`✅ Meter ID: <code>${text}</code>`];

        if (summary.address) {
          lines.push(`🏠 <b>Address:</b> ${escHtml(summary.address)}`);
        }

        const bal = Number(summary.credit_bal);
        if (summary.credit_bal != null && Number.isFinite(bal)) {
          lines.push(`💰 <b>Balance:</b> SGD ${bal.toFixed(2)}`);
        }

        const usageText = await formatUsageSummary(
          usage.history,
          summary.credit_bal,
          7,
          text,
        );
        if (usageText) {
          lines.push("");
          lines.push("<b>Daily consumption</b>");
          lines.push(usageText);
        }

        lines.push("");
        lines.push(
          "Now enter the <b>amount in SGD</b> (e.g. <code>20</code> for $20.00, min $6, max $50):",
        );

        await ctx.telegram
          .editMessageText(
            chatId,
            loadingMsg.message_id,
            undefined,
            lines.join("\n"),
            { parse_mode: "HTML" },
          )
          .catch(() => ctx.reply(lines.join("\n"), { parse_mode: "HTML" }));
      } catch (err) {
        track("prefill_usage_error", {
          chatId,
          meterId: text,
          error: err.message,
        });
        session.stage = "awaiting_meter_id";
        delete session.txtMtrId;

        const fallback = `⚠️ Meter ID <code>${text}</code> could not be found. Please check and try again:`;

        await ctx.telegram
          .editMessageText(chatId, loadingMsg.message_id, undefined, fallback, {
            parse_mode: "HTML",
          })
          .catch(() => ctx.reply(fallback, { parse_mode: "HTML" }));
      }
      return;
    }

    if (session.stage === "awaiting_meter_id_usage") {
      if (!isValidMeterId(text)) {
        return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
      }

      session.stage = "idle";
      await ctx.sendChatAction("typing");
      const loadingMsg = await ctx
        .reply("🔍 Checking recent usage…")
        .catch(() => null);
      if (!loadingMsg) return;
      try {
        const [summary, usage] = await Promise.all([
          getMeterSummary(text),
          getMeterUsage(text, 7),
        ]);

        const lines = [`⚡ <b>Meter ID:</b> <code>${text}</code>`];
        if (summary.address)
          lines.push(`🏠 <b>Address:</b> ${escHtml(summary.address)}`);

        const bal = Number(summary.credit_bal);
        if (summary.credit_bal != null && Number.isFinite(bal)) {
          lines.push(`💰 <b>Balance:</b> SGD ${bal.toFixed(2)}`);
        }

        lines.push("");
        lines.push("<b>Daily consumption (last 7 days)</b>");
        lines.push(
          (await formatUsageSummary(
            usage.history,
            summary.credit_bal,
            7,
            text,
          )) || "No usage data available.",
        );

        await ctx.telegram
          .editMessageText(
            chatId,
            loadingMsg.message_id,
            undefined,
            lines.join("\n"),
            { parse_mode: "HTML" },
          )
          .catch(() => ctx.reply(lines.join("\n"), { parse_mode: "HTML" }));
        return ctx.reply("Choose an option:", mainKeyboard);
      } catch (err) {
        track("usage_error", { chatId, meterId: text, error: err.message });
        await ctx.telegram
          .editMessageText(
            chatId,
            loadingMsg.message_id,
            undefined,
            "⚠️ Failed to fetch usage history. Please try again.",
          )
          .catch(() =>
            ctx.reply("⚠️ Failed to fetch usage history. Please try again."),
          );
        return ctx.reply("Choose an option:", mainKeyboard);
      }
    }

    if (session.stage === "awaiting_amount") {
      if (
        !session.txtMtrId ||
        !isValidMeterId(session.txtMtrId) ||
        !session.hostel
      ) {
        resetSession(chatId);
        return ctx.reply(
          "⚠️ No valid Meter ID on record. Please enter your 8-digit Meter ID:",
          Markup.keyboard([["❌ Cancel"]]).resize(),
        );
      }

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

      const webAppPath = getWebAppPath(session.hostel);
      const webAppUrl =
        `${SERVER_URL}${webAppPath}?txtMtrId=${encodeURIComponent(session.txtMtrId)}` +
        `&txtAmount=${encodeURIComponent(session.amountDollars)}`;

      session.webAppUrl = webAppUrl;
      session.stage = "awaiting_payment";

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
        Markup.keyboard([
          [Markup.button.webApp("💳 Pay Now", webAppUrl)],
          ["❌ Cancel"],
        ]).resize(),
      );
    }

    if (session.stage === "awaiting_payment") {
      return ctx.reply(
        "💳 Please tap the Pay Now button below to continue payment, or tap ❌ Cancel to cancel.",
        Markup.keyboard([
          [Markup.button.webApp("💳 Pay Now", session.webAppUrl)],
          ["❌ Cancel"],
        ]).resize(),
      );
    }

    if (session.stage === "awaiting_meter_id_balance") {
      if (!isValidMeterId(text)) {
        return ctx.reply("⚠️ Invalid Meter ID. Please try again.");
      }

      session.stage = "idle";
      await ctx.sendChatAction("typing");
      const loadingMsg = await ctx
        .reply("🔍 Checking balance…")
        .catch(() => null);
      if (!loadingMsg) return;
      try {
        const summary = await getMeterSummary(text);

        const lines = [`⚡ <b>Meter ID:</b> <code>${text}</code>`];
        if (summary.address)
          lines.push(`🏠 <b>Address:</b> ${escHtml(summary.address)}`);

        const bal = Number(summary.credit_bal);
        if (summary.credit_bal != null && Number.isFinite(bal)) {
          lines.push(`💰 <b>Balance:</b> SGD ${bal.toFixed(2)}`);
        } else {
          lines.push(`💰 <b>Balance:</b> unavailable`);
        }

        await ctx.telegram
          .editMessageText(
            chatId,
            loadingMsg.message_id,
            undefined,
            lines.join("\n"),
            { parse_mode: "HTML" }, // no reply_markup here
          )
          .catch(() => ctx.reply(lines.join("\n"), { parse_mode: "HTML" }));
        return ctx.reply("Choose an option:", mainKeyboard);
      } catch (err) {
        track("balance_error", { chatId, error: err.message });
        await ctx.telegram
          .editMessageText(
            chatId,
            loadingMsg.message_id,
            undefined,
            "⚠️ Failed to fetch balance. Please try again.",
          )
          .catch(() =>
            ctx.reply("⚠️ Failed to fetch balance. Please try again."),
          );

        return ctx.reply("Choose an option:", mainKeyboard);
      }
    }

    // Inside withChatLock, before the final fallback reply:
    if (session.stage === "idle") {
      // Check if this message is a reply to a bot message that's part of a thread
      const replyToId = ctx.message?.reply_to_message?.message_id;
      if (replyToId && pendingReplies.has(replyToId)) {
        const pending = pendingReplies.get(replyToId);
        if (
          pending &&
          String(pending.chatId) === String(chatId) &&
          pending.ownerMsgId
        ) {
          // Send back to owner, threading onto the original notification
          const sentOwnerMsg = await bot.telegram
            .sendMessage(
              OWNER_CHAT_ID,
              `↩️ <b>User reply:</b>\n\n${escHtml(text)}`,
              {
                parse_mode: "HTML",
                reply_to_message_id: pending.ownerMsgId,
              },
            )
            .catch(() => null);

          if (!sentOwnerMsg) {
            return ctx.reply("⚠️ Could not forward your reply.");
          }

          // Update entry so owner can reply to this new message too
          pendingReplies.set(sentOwnerMsg.message_id, {
            chatId,
            ownerMsgId: pending.ownerMsgId,
            createdAt: Date.now(),
          });

          return ctx.reply("✅ Your reply was sent.");
        }
      }
    }

    const looksLikeMeterId = /^\d{8}$/.test(text);
    const looksLikeAmount =
      /^\d+(\.\d{1,2})?$/.test(text) && Number(text) >= 6 && Number(text) <= 50;

    if (looksLikeMeterId || looksLikeAmount) {
      return ctx.reply(
        "⚠️ It looks like your previous session may have expired.\n\nUse /topup to start a new top-up, or /help for available commands.",
        mainKeyboard,
      );
    }

    return ctx.reply(
      "I didn't understand that. Use /topup to top up, /balance to check balance, or /help for instructions.",
      mainKeyboard,
    );
  });
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
