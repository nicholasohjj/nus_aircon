const { Markup } = require("telegraf");
const { track } = require("../../services/analytics");
const { getUser, forgetUser } = require("../services/userStore");
const { isValidMeterId } = require("../../services/validators");
const { resetSession, getSession } = require("../services/session");
const { handleMeterIdLookup } = require("../services/lookup");
const {
  handleTopUpStart,
  startTopUp,
  getHostelLabel,
} = require("../services/topup");
const { sendHelp, SERVER_URL } = require("../services/ui");
const { state, pendingReplies } = require("../bot");
const {
  STAGES,
  HOSTELS,
  mainKeyboard,
  cancelKeyboard,
  ratingKeyboard,
  TOPUP_DISABLED_MESSAGE,
} = require("../constants");

// ── /start ────────────────────────────────────────────────────────────────────
function registerStart(bot) {
  bot.start(async (ctx) => {
    const chatId = ctx.chat?.id;
    track("bot_start", { chatId });
    if (chatId) resetSession(chatId);

    const payload = ctx.startPayload?.trim() ?? "";

    // Deep link while top-ups are disabled
    if (
      state.topupDisabled &&
      (isValidMeterId(payload) || /^nus_\d{8}$/.test(payload))
    ) {
      track("topup_disabled_deeplink", { chatId, payload });
      return ctx.reply(
        `⚡ EVS Electricity Bot\n\n${TOPUP_DISABLED_MESSAGE}`,
        mainKeyboard,
      );
    }

    // cp2nus deep link: /start nus_12345678
    const cp2nusMatch = payload.match(/^nus_(\d{8})$/);
    if (cp2nusMatch) {
      const meterId = cp2nusMatch[1];
      track("bot_start_deeplink", { chatId, meterId, hostel: "cp2nus" });

      const session = getSession(chatId);
      session.stage = STAGES.AWAITING_AMOUNT;
      session.hostel = HOSTELS.CP2NUS;
      session.txtMtrId = meterId;

      return ctx.reply(
        `⚡ EVS Electricity Top-Up\n\n` +
          `🏠 Hostel: <b>${getHostelLabel(HOSTELS.CP2NUS)}</b>\n` +
          `🔌 Meter ID: <code>${meterId}</code>\n\n` +
          `Enter the amount in SGD (e.g. <code>20</code>, min $6, max $50):\n\n` +
          `📄 By using this bot, you agree to our <a href="${SERVER_URL}/terms">Terms of Use</a>.`,
        { parse_mode: "HTML", reply_markup: cancelKeyboard.reply_markup },
      );
    }

    // cp2 deep link: /start 12345678
    if (isValidMeterId(payload)) {
      track("bot_start_deeplink", { chatId, meterId: payload });
      // Stash the meter ID so startTopUp can pick it up
      getSession(chatId).txtMtrId = payload;
      return handleTopUpStart(ctx, chatId);
    }

    return ctx.reply(
      `⚡ EVS Electricity Top-Up\n\nChoose an option below:\n\n` +
        `📄 By using this bot, you agree to our <a href="${SERVER_URL}/terms">Terms of Use</a>.`,
      { parse_mode: "HTML", reply_markup: mainKeyboard.reply_markup },
    );
  });
}

// ── /topup ────────────────────────────────────────────────────────────────────
function registerTopup(bot) {
  bot.command("topup", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (state.topupDisabled) {
      track("topup_disabled_command", { chatId });
      resetSession(chatId);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, mainKeyboard);
    }

    track("topup_command", { chatId });
    return handleTopUpStart(ctx, chatId);
  });
}

// ── /balance ──────────────────────────────────────────────────────────────────
function registerBalance(bot) {
  bot.command("balance", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("balance_command", { chatId });
    const saved = getUser(chatId);
    if (saved?.meterId) {
      getSession(chatId).stage = STAGES.IDLE;
      return handleMeterIdLookup(ctx, chatId, saved.meterId, "balance", {
        fromSaved: true,
      });
    }

    const session = getSession(chatId);
    session.stage = STAGES.AWAITING_METER_ID_BALANCE;

    return ctx.reply(
      "🔌 Please enter your 8-digit Meter ID to check your balance:",
      {
        ...cancelKeyboard,
        reply_markup: {
          ...cancelKeyboard.reply_markup,
          input_field_placeholder: "e.g. 12345678",
        },
      },
    );
  });
}

// ── /usage ────────────────────────────────────────────────────────────────────
function registerUsage(bot) {
  bot.command("usage", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("usage_command", { chatId });
    const saved = getUser(chatId);
    if (saved?.meterId) {
      getSession(chatId).stage = STAGES.IDLE;
      return handleMeterIdLookup(ctx, chatId, saved.meterId, "usage", {
        fromSaved: true,
      });
    }

    const session = getSession(chatId);
    session.stage = STAGES.AWAITING_METER_ID_USAGE;

    return ctx.reply(
      "🔌 Please enter your 8-digit Meter ID to view the last 7 days of usage:",
      {
        ...cancelKeyboard,
        reply_markup: {
          ...cancelKeyboard.reply_markup,
          input_field_placeholder: "e.g. 12345678",
        },
      },
    );
  });
}

// ── /forget ───────────────────────────────────────────────────────────────────
function registerForget(bot) {
  bot.command("forget", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("forget_command", { chatId });
    const deleted = forgetUser(chatId);
    resetSession(chatId);

    return ctx.reply(
      deleted
        ? "🗑️ Your saved Meter ID and hostel have been removed.\n\nUse /topup to start a fresh top-up."
        : "ℹ️ You don't have a saved Meter ID.",
      mainKeyboard,
    );
  });
}

// ── /feedback ─────────────────────────────────────────────────────────────────
function registerFeedback(bot) {
  bot.command("feedback", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("feedback_command", { chatId });
    resetSession(chatId);

    const session = getSession(chatId);
    session.stage = STAGES.AWAITING_FEEDBACK_RATING;

    return ctx.reply(
      "💬 *Share your feedback*\n\nHow would you rate your experience?",
      {
        parse_mode: "HTML",
        ...ratingKeyboard(),
      },
    );
  });
}

// ── /help ─────────────────────────────────────────────────────────────────────
function registerHelp(bot) {
  bot.command("help", sendHelp);
}

// ── /cancel ───────────────────────────────────────────────────────────────────
function registerCancel(bot) {
  bot.command("cancel", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) resetSession(chatId);
    return ctx.reply(
      "❌ Top-up cancelled. Use /topup to start again.",
      mainKeyboard,
    );
  });
}

// ── Register all user commands ────────────────────────────────────────────────
function registerUserCommands(bot) {
  registerStart(bot);
  registerTopup(bot);
  registerBalance(bot);
  registerUsage(bot);
  registerForget(bot);
  registerFeedback(bot);
  registerHelp(bot);
  registerCancel(bot);
}

module.exports = { registerUserCommands };
