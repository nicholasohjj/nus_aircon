const { escHtml } = require("../../services/utils");
const {
  getMeterSummary,
  getMeterUsage,
  formatUsageSummary,
} = require("../../services/ore");
const { track } = require("../../services/analytics");
const { getSession } = require("./session");
const { mainKeyboard } = require("../constants");

function lowBalanceWarning(bal) {
  const n = Number(bal);
  if (!Number.isFinite(n) || n >= 5) return null;
  return `⚠️ <b>Low balance:</b> Your balance is SGD ${n.toFixed(2)}. Consider topping up soon.`;
}

/**
 * Fetches meter balance and/or 7-day usage, edits a loading message in-place,
 * then prompts the user to choose their next action.
 *
 * @param {"balance"|"usage"} mode
 * @param {{ fromSaved?: boolean }} opts
 */
async function handleMeterIdLookup(
  ctx,
  chatId,
  meterId,
  mode,
  { fromSaved = false } = {},
) {
  const session = getSession(chatId);
  session.stage = "idle";

  await ctx.sendChatAction("typing");
  const loadingMsg = await ctx
    .reply(
      mode === "usage" ? "🔍 Checking recent usage…" : "🔍 Checking balance…",
    )
    .catch(() => null);
  if (!loadingMsg) return;

  try {
    const [summary, usage] =
      mode === "usage"
        ? await Promise.all([
            getMeterSummary(meterId),
            getMeterUsage(meterId, 7),
          ])
        : [await getMeterSummary(meterId), null];

    const lines = [`⚡ <b>Meter ID:</b> <code>${meterId}</code>`];

    if (summary.address)
      lines.push(`🏠 <b>Address:</b> ${escHtml(summary.address)}`);

    const bal = Number(summary.credit_bal);
    if (summary.credit_bal != null && Number.isFinite(bal)) {
      lines.push(`💰 <b>Balance:</b> SGD ${bal.toFixed(2)}`);
    } else if (mode === "balance") {
      lines.push(`💰 <b>Balance:</b> unavailable`);
    }

    const warn = lowBalanceWarning(summary.credit_bal);
    if (warn) lines.push(`\n${warn}`);

    if (mode === "usage") {
      lines.push("", "<b>Daily consumption (last 7 days)</b>");
      lines.push(
        (await formatUsageSummary(
          usage.history,
          summary.credit_bal,
          7,
          meterId,
        )) || "No usage data available.",
      );
    }

    if (fromSaved) {
      lines.push(
        "",
        `💡 <i>Showing saved meter <code>${meterId}</code>. Use /forget to change.</i>`,
      );
    }

    const edited = await ctx.telegram
      .editMessageText(
        chatId,
        loadingMsg.message_id,
        undefined,
        lines.join("\n"),
        {
          parse_mode: "HTML",
        },
      )
      .catch(async () => {
        await ctx.reply(lines.join("\n"), {
          parse_mode: "HTML",
          ...mainKeyboard,
        });
        return null;
      });

    if (edited) return ctx.reply("Choose an option:", mainKeyboard);
  } catch (err) {
    track(`${mode}_error`, { chatId, meterId, error: err.message });

    const errorText = `⚠️ Failed to fetch ${mode === "usage" ? "usage history" : "balance"}. Please try again.`;
    const edited = await ctx.telegram
      .editMessageText(chatId, loadingMsg.message_id, undefined, errorText)
      .catch(async () => {
        await ctx.reply(errorText, mainKeyboard);
        return null;
      });

    if (edited) return ctx.reply("Choose an option:", mainKeyboard);
  }
}

module.exports = { handleMeterIdLookup, lowBalanceWarning };
