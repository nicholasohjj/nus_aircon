const { escHtml } = require("../../services/utils");
const { bot, pendingReplies } = require("../bot");

const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

/**
 * Intercepts messages from the owner that are replies to bot-forwarded
 * feedback notifications, and routes them back to the originating user.
 *
 * Must be registered BEFORE the generic on("text") handler so it can
 * short-circuit via next() when the message isn't an owner reply.
 */
function registerOwnerReplyHandler(telegramBot) {
  telegramBot.on("message", async (ctx, next) => {
    const chatId = ctx.chat?.id;
    if (!chatId || String(chatId) !== String(OWNER_CHAT_ID)) return next();

    const replyToId = ctx.message?.reply_to_message?.message_id;
    if (!replyToId || !pendingReplies.has(replyToId)) return next();

    const pending = pendingReplies.get(replyToId);
    if (!pending) return next();

    const replyText = ctx.message?.text;
    if (!replyText) return ctx.reply("⚠️ Only text replies are supported.");

    const targetChatId = pending.chatId;
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

    // Allow owner to keep threading by replying to their own reply
    pendingReplies.set(sentMsg.message_id, {
      chatId: targetChatId,
      ownerMsgId: rootOwnerMsgId,
      createdAt: Date.now(),
    });

    return ctx.reply("✅ Reply sent to user.");
  });
}

module.exports = { registerOwnerReplyHandler };
