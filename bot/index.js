require("dotenv").config();
const { bot, pendingReplies } = require("./bot");
const {
  captureException,
  shutdownAnalytics,
} = require("../services/analytics");
const { PENDING_REPLY_TTL_MS } = require("./constants");
const { resetSession } = require("./services/session");
const { setupTelegramUi } = require("./services/ui");

// ── Register handlers (order matters — ownerReply before text) ────────────────
require("./commands/user").registerUserCommands(bot);
require("./commands/owner").registerOwnerCommands(bot);
require("./handlers/buttons").registerButtonHandlers(bot);
require("./handlers/actions").registerActionHandlers(bot);
require("./handlers/webAppData").registerWebAppDataHandler(bot);
require("./handlers/ownerReply").registerOwnerReplyHandler(bot);
require("./handlers/text").registerTextHandler(bot);

// ── Housekeeping: prune stale pending-reply entries ───────────────────────────
setInterval(
  () => {
    const now = Date.now();
    for (const [id, entry] of pendingReplies) {
      if (now - entry.createdAt > PENDING_REPLY_TTL_MS)
        pendingReplies.delete(id);
    }
  },
  60 * 60 * 1000,
).unref();

// ── Global error handler ──────────────────────────────────────────────────────
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

// ── Launch ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    await setupTelegramUi(bot);
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });

    // Retry up to 5 times — handles Railway deploy overlap where the old
    // instance hasn't fully released the long-poll connection yet.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await bot.launch({ dropPendingUpdates: true });
        const { state } = require("./bot");
        console.log(
          `🤖 EVS Telegram bot running… (top-ups ${state.topupDisabled ? "DISABLED" : "enabled"})`,
        );
        return;
      } catch (err) {
        if (err.response?.error_code === 409 && attempt < 5) {
          const delay = attempt * 3000;
          console.warn(
            `⚠️ 409 Conflict on attempt ${attempt}, retrying in ${delay / 1000}s…`,
          );
          await new Promise((res) => setTimeout(res, delay));
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    console.error("Failed to launch Telegram bot:", err);
    process.exit(1);
  }
})();

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.once("SIGINT", async () => {
  await shutdownAnalytics();
  bot.stop("SIGINT");
});
process.once("SIGTERM", async () => {
  await shutdownAnalytics();
  bot.stop("SIGTERM");
});

module.exports = { bot };
