const { track } = require("../../services/analytics");
const { getUser } = require("../services/userStore");
const { resetSession, getSession } = require("../services/session");
const { handleMeterIdLookup } = require("../services/lookup");
const { handleTopUpStart } = require("../services/topup");
const { sendHelp } = require("../services/ui");
const { state } = require("../bot");
const {
  STAGES,
  mainKeyboard,
  cancelKeyboard,
  TOPUP_DISABLED_MESSAGE,
} = require("../constants");

function registerButtonHandlers(bot) {
  // ── ⚡ Top Up ───────────────────────────────────────────────────────────────
  bot.hears("⚡ Top Up", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (state.topupDisabled) {
      track("topup_disabled_button", { chatId });
      resetSession(chatId);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, mainKeyboard);
    }

    track("topup_button", { chatId });
    return handleTopUpStart(ctx, chatId);
  });

  // ── 💰 Balance ──────────────────────────────────────────────────────────────
  bot.hears("💰 Balance", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("balance_button", { chatId });
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

  // ── 📊 Usage ────────────────────────────────────────────────────────────────
  bot.hears("📊 Usage", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    track("usage_button", { chatId });
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

  // ── ℹ️ Help ─────────────────────────────────────────────────────────────────
  bot.hears("ℹ️ Help", sendHelp);

  // ── ❌ Cancel ───────────────────────────────────────────────────────────────
  bot.hears("❌ Cancel", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (chatId) resetSession(chatId);
    return ctx.reply(
      "❌ Top-up cancelled. Use /topup to start again.",
      mainKeyboard,
    );
  });
}

module.exports = { registerButtonHandlers };
