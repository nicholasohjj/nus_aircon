const { saveUser, touchUser } = require("../services/userStore");
const { track, identify } = require("../../services/analytics");
const { resetSession, getSession } = require("../services/session");
const { mainKeyboard } = require("../constants");
const { lowBalanceWarning } = require("../services/lookup");

function registerWebAppDataHandler(bot) {
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

        if (ok) {
          const warn = lowBalanceWarning(balance);
          if (warn) lines.push(`\n${warn}`);
        }
      }

      if (merchantTxnRef) lines.push(`🧾 Reference: \`${merchantTxnRef}\``);
      if (!ok && reason) lines.push(`\n❌ Reason: ${reason}`);

      track(ok ? "miniapp_closed_success" : "miniapp_closed_failed", {
        chatId,
        meterId,
        status,
      });

      const session = getSession(chatId);
      const hostel =
        session?.hostel ??
        require("../services/userStore").getUser(chatId)?.hostel ??
        null;

      if (ok && meterId && hostel) {
        saveUser(chatId, meterId, hostel);
        touchUser(chatId); // update last_seen on successful payment
        identify(chatId, {
          hostel,
          meterId,
          last_payment_at: new Date().toISOString(),
        });
      }

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
}

module.exports = { registerWebAppDataHandler };
