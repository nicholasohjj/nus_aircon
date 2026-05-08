const { track } = require("../../services/analytics");
const { resetSession, getSession } = require("../services/session");
const { state } = require("../bot");
const {
  STAGES,
  HOSTELS,
  mainKeyboard,
  cancelKeyboard,
  TOPUP_DISABLED_MESSAGE,
} = require("../constants");

function registerActionHandlers(bot) {
  bot.action("hostel_cp2", makeHostelHandler(HOSTELS.CP2));
  bot.action("hostel_cp2nus", makeHostelHandler(HOSTELS.CP2NUS));
}

function makeHostelHandler(hostel) {
  return async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    if (state.topupDisabled) {
      await ctx.answerCbQuery("Top-ups are temporarily unavailable.");
      resetSession(chatId);
      return ctx.reply(TOPUP_DISABLED_MESSAGE, mainKeyboard);
    }

    const session = getSession(chatId);
    if (session.stage !== STAGES.AWAITING_HOSTEL) {
      return ctx.answerCbQuery("⚠️ Please start a new top-up.");
    }
    await ctx.answerCbQuery();

    session.hostel = hostel;
    track("hostel_selected", { chatId, hostel });

    if (session.txtMtrId) {
      session.stage = STAGES.AWAITING_AMOUNT;
      return ctx.replyWithMarkdown(
        `🔌 Meter ID: \`${session.txtMtrId}\`\n\nEnter the *amount in SGD* (e.g. \`20\`, min $6, max $50):`,
        cancelKeyboard,
      );
    }

    session.stage = STAGES.AWAITING_METER_ID;
    return ctx.reply("🔌 Please enter your 8-digit Meter ID:", {
      ...cancelKeyboard,
      reply_markup: {
        ...cancelKeyboard.reply_markup,
        input_field_placeholder: "e.g. 12345678",
      },
    });
  };
}

module.exports = { registerActionHandlers };
