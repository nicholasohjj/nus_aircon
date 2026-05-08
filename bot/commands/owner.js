const { escHtml } = require("../../services/utils");
const { getAllChatIds, forgetUser } = require("../services/userStore");
const { state } = require("../bot");

const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

function isOwner(ctx) {
  return OWNER_CHAT_ID && String(ctx.chat?.id) === String(OWNER_CHAT_ID);
}

// ── /broadcast ────────────────────────────────────────────────────────────────
function registerBroadcast(bot) {
  bot.command("broadcast", async (ctx) => {
    if (!isOwner(ctx)) return;

    const message = ctx.message?.text?.replace(/^\/broadcast\s*/, "").trim();
    if (!message) return ctx.reply("Usage: /broadcast <message>");

    const chatIds = getAllChatIds();
    if (!chatIds.length) return ctx.reply("No known users to broadcast to.");

    await ctx.reply(`📡 Broadcasting to ${chatIds.length} user(s)…`);

    let sent = 0;
    let failed = 0;

    for (const chatId of chatIds) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          `📢 <b>Message from the developer:</b>\n\n${escHtml(message)}`,
          { parse_mode: "HTML" },
        );
        sent++;
      } catch (err) {
        if (err.response?.error_code === 403) forgetUser(chatId);
        failed++;
      }
      await new Promise((res) => setTimeout(res, 50));
    }

    return ctx.reply(
      `✅ Broadcast complete. Sent: ${sent}, Failed: ${failed}.`,
    );
  });
}

function registerAnnounce(bot) {
  bot.command("announce", async (ctx) => {
    if (!isOwner(ctx)) return;

    const message = ctx.message?.text?.replace(/^\/announce\s*/, "").trim();
    if (!message) return ctx.reply("Usage: /announce <message>");

    const chatIds = getActiveChatIds(); // last 30 days
    if (!chatIds.length)
      return ctx.reply("No active users in the last 30 days.");

    await ctx.reply(`📡 Announcing to ${chatIds.length} active user(s)…`);

    let sent = 0;
    let failed = 0;

    for (const chatId of chatIds) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          `📢 <b>Message from the developer:</b>\n\n${escHtml(message)}`,
          { parse_mode: "HTML" },
        );
        sent++;
      } catch (err) {
        if (err.response?.error_code === 403) forgetUser(chatId);
        failed++;
      }
      await new Promise((res) => setTimeout(res, 50));
    }

    return ctx.reply(`✅ Announce complete. Sent: ${sent}, Failed: ${failed}.`);
  });
}

// ── /topupoff / /topupon / /topupstatus ───────────────────────────────────────
function registerTopupToggle(bot) {
  bot.command("topupoff", async (ctx) => {
    if (!isOwner(ctx)) return;
    state.topupDisabled = true;
    console.log("⛔ Top-ups disabled by owner via /topupoff");
    return ctx.reply(
      "⛔ Top-ups are now *disabled*. Users will see the maintenance message.\n\nUse /topupon to re-enable.",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("topupon", async (ctx) => {
    if (!isOwner(ctx)) return;
    state.topupDisabled = false;
    console.log("✅ Top-ups enabled by owner via /topupon");
    return ctx.reply(
      "✅ Top-ups are now *enabled*. Users can top up again.\n\nUse /topupoff to disable.",
      { parse_mode: "Markdown" },
    );
  });

  bot.command("topupstatus", async (ctx) => {
    if (!isOwner(ctx)) return;
    return ctx.reply(
      state.topupDisabled
        ? "⛔ Top-ups are currently *disabled*. Use /topupon to enable."
        : "✅ Top-ups are currently *enabled*. Use /topupoff to disable.",
      { parse_mode: "Markdown" },
    );
  });
}

function registerOwnerCommands(bot) {
  registerBroadcast(bot);
  registerAnnounce(bot);
  registerTopupToggle(bot);
}

module.exports = { registerOwnerCommands, isOwner };
